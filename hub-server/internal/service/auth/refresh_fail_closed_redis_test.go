package auth

// #2053（与 #2049 access 路径修复对称；风险母题 AH-SR-052，SECURITY.md
// High/Accepted）行为级核验。
//
// 风险：Redis 故障时 refresh 黑名单检查吞错（fail-open），已登出/已轮换
// 的 refresh token 可能在故障窗口内继续轮换出新令牌——撤销只存在于 Redis
// 黑名单（登出/轮换的 DB 提交尚未完成或镜像滞后）时尤其危险。
//
// 已有的吞错实现没有任何分支可挂 fail-closed 策略；本文件按生产接线注入
// 真实 *cache.Client（internal/app/router.go → NewService(db, jwtCfg,
// cacheClient)），用进程内 miniredis 模拟 Redis 可达/不可达，验证
// RefreshToken 端到端行为矩阵（无真实网络连接），模式镜像
// middleware/auth_fail_closed_redis_test.go。

import (
	"context"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/agenthub/hub-server/internal/cache"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/jwtutil"
	"github.com/agenthub/hub-server/internal/metrics"
	"github.com/prometheus/client_golang/prometheus/testutil"
)

// outageCacheClient builds the same cache client production wires into
// NewService: a real *cache.Client over a *redis.Client. miniredis serves as
// the in-process Redis so the matrix runs without any external network I/O.
// Both handles are returned so a case can take Redis down mid-test
// (connection refused from then on), mirroring
// middleware/auth_fail_closed_redis_test.go.
func outageCacheClient(t *testing.T) (*cache.Client, *miniredis.Miniredis) {
	t.Helper()
	mr, err := miniredis.Run()
	require.NoError(t, err)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		_ = rdb.Close()
		mr.Close()
	})
	return cache.NewClient(rdb), mr
}

// runRefreshFailClosedCase drives one matrix row through the production
// RefreshToken path: the mocked DB returns a valid (unrevoked) refresh-token
// row — the worst case where the revocation only exists in the Redis
// blacklist (rotation/logout race window before the DB commit) — optionally
// blacklists the token hash while Redis is up, optionally takes Redis down,
// then calls RefreshToken.
func runRefreshFailClosedCase(t *testing.T, failClosedEnv string, blacklisted bool, outage bool) (*LoginResponse, sqlmock.Sqlmock, error) {
	t.Helper()
	t.Setenv("AGENTHUB_AUTH_FAIL_CLOSED", failClosedEnv)

	db, mock, sqlDB := newMockDB(t)
	t.Cleanup(func() { _ = sqlDB.Close() })

	const rawRT = "raw-refresh-fc-matrix"
	tokenHash := jwtutil.HashRefreshToken(rawRT)

	expiry := time.Now().Add(24 * time.Hour)
	mock.ExpectQuery(sqlRTByHash).
		WithArgs(sqlmock.AnyArg(), 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "device_type", "device_id", "token_hash", "revoked", "expires_at"}).
			AddRow("rt-1", "user-uuid", "desktop", "dev-1", tokenHash, false, expiry))

	// Rows where the refresh is expected to rotate all the way through:
	// reachable-and-not-blacklisted, or outage with the default fail-open
	// policy. Revoke the old row, then upsert the new refresh token.
	expectedRotation := (!outage && !blacklisted) || (outage && failClosedEnv == "")
	if expectedRotation {
		mock.ExpectExec(sqlClaimRT).
			WithArgs(true, tokenHash, false).
			WillReturnResult(sqlmock.NewResult(0, 1))
		mock.ExpectExec(sqlRevokeByDevice).
			WithArgs(true, "user-uuid", "dev-1").
			WillReturnResult(sqlmock.NewResult(0, 1))
		// UpsertRefreshToken: atomic upsert + re-fetch
		mock.ExpectExec(sqlInsertRT).
			WillReturnResult(sqlmock.NewResult(0, 1))
		mock.ExpectQuery(sqlRTByUserDevice).
			WithArgs("user-uuid", "desktop", "dev-1", 1).
			WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "device_type", "device_id", "token_hash", "revoked", "expires_at"}).
				AddRow("rt-new", "user-uuid", "desktop", "dev-1", "newhash", false, time.Now().Add(24*time.Hour)))
	}

	cacheClient, mr := outageCacheClient(t)
	if blacklisted {
		require.NoError(t, cacheClient.BlacklistRefreshToken(context.Background(), tokenHash, time.Hour),
			"blacklisting the token hash while Redis is up must succeed")
	}
	if outage {
		mr.Close() // Redis outage: connection refused from here on.
	}

	svc := NewService(db, jwtCfg(), cacheClient)
	resp, err := svc.RefreshToken(context.Background(), rawRT)
	return resp, mock, err
}

// TestRefreshTokenRealRedisFailClosedMatrix is the #2053 behavioral gate:
// Redis reachability x AGENTHUB_AUTH_FAIL_CLOSED x blacklisted or not, with
// the production-wired *cache.Client.
func TestRefreshTokenRealRedisFailClosedMatrix(t *testing.T) {
	cases := []struct {
		name          string
		failClosedEnv string
		blacklisted   bool
		outage        bool
		wantRotation  bool
	}{
		// Redis reachable: the blacklist decision is authoritative regardless
		// of the fail-closed switch.
		{name: "redis可达_未拉黑_failclosed关_正常轮换", failClosedEnv: "", blacklisted: false, outage: false, wantRotation: true},
		{name: "redis可达_未拉黑_failclosed开_正常轮换", failClosedEnv: "true", blacklisted: false, outage: false, wantRotation: true},
		{name: "redis可达_已拉黑_failclosed关_拒绝轮换", failClosedEnv: "", blacklisted: true, outage: false, wantRotation: false},
		{name: "redis可达_已拉黑_failclosed开_拒绝轮换", failClosedEnv: "true", blacklisted: true, outage: false, wantRotation: false},
		// Redis outage, nothing blacklisted: revocation status cannot be
		// verified; the default policy is documented fail-open.
		{name: "redis故障_未拉黑_failclosed关_默认fail-open轮换", failClosedEnv: "", blacklisted: false, outage: true, wantRotation: true},
		// #2053 compensating control: with AGENTHUB_AUTH_FAIL_CLOSED=true the
		// same outage must fail closed, otherwise a revoked refresh token
		// could rotate again while its revocation status is unverifiable.
		{name: "redis故障_未拉黑_failclosed开_必须拒绝", failClosedEnv: "true", blacklisted: false, outage: true, wantRotation: false},
		// Redis outage after the token hash was blacklisted (logout/rotation
		// happened before the outage): default policy is documented fail-open.
		{name: "redis故障_故障前已拉黑_failclosed关_默认fail-open轮换", failClosedEnv: "", blacklisted: true, outage: true, wantRotation: true},
		// The symmetric compensating control for the blacklisted case.
		{name: "redis故障_故障前已拉黑_failclosed开_必须拒绝", failClosedEnv: "true", blacklisted: true, outage: true, wantRotation: false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			resp, mock, err := runRefreshFailClosedCase(t, tc.failClosedEnv, tc.blacklisted, tc.outage)
			if tc.wantRotation {
				require.NoError(t, err, "refresh must rotate when the blacklist check passes or fails open")
				require.NotNil(t, resp)
				assert.NotEmpty(t, resp.AccessToken)
				assert.NotEmpty(t, resp.RefreshToken)
			} else {
				require.Error(t, err, "refresh must be rejected")
				assert.ErrorIs(t, err, errcode.AuthRefreshInvalid)
				assert.Nil(t, resp)
			}
			assert.NoError(t, mock.ExpectationsWereMet())
		})
	}
}

// TestRefreshBlacklistCheckErrorsCounter proves that Redis errors in
// enforceRefreshBlacklist increment RefreshBlacklistCheckErrors (#2064 item ①).
// Mirrors middleware/auth_fail_closed_redis_test.go JTIBlacklistCheckErrors pattern.
func TestRefreshBlacklistCheckErrorsCounter(t *testing.T) {
	metrics.Register()

	t.Setenv("AGENTHUB_AUTH_FAIL_CLOSED", "")

	db, mock, sqlDB := newMockDB(t)
	t.Cleanup(func() { _ = sqlDB.Close() })

	const rawRT = "raw-refresh-counter-test"
	tokenHash := jwtutil.HashRefreshToken(rawRT)

	expiry := time.Now().Add(24 * time.Hour)
	mock.ExpectQuery(sqlRTByHash).
		WithArgs(sqlmock.AnyArg(), 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "device_type", "device_id", "token_hash", "revoked", "expires_at"}).
			AddRow("rt-1", "user-uuid", "desktop", "dev-1", tokenHash, false, expiry))

	// Expect rotation (fail-open default).
	mock.ExpectExec(sqlClaimRT).
		WithArgs(true, tokenHash, false).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(sqlRevokeByDevice).
		WithArgs(true, "user-uuid", "dev-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	// UpsertRefreshToken: atomic upsert + re-fetch (same adaptation as the
	// matrix cases above; the old SELECT-then-INSERT flow is gone).
	mock.ExpectExec(sqlInsertRT).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(sqlRTByUserDevice).
		WithArgs("user-uuid", "desktop", "dev-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "device_type", "device_id", "token_hash", "revoked", "expires_at"}).
			AddRow("rt-new", "user-uuid", "desktop", "dev-1", "newhash", false, time.Now().Add(24*time.Hour)))

	cacheClient, mr := outageCacheClient(t)
	mr.Close() // Redis outage → triggers error path in enforceRefreshBlacklist

	errBefore := testutil.ToFloat64(metrics.RefreshBlacklistCheckErrors)

	svc := NewService(db, jwtCfg(), cacheClient)
	resp, err := svc.RefreshToken(context.Background(), rawRT)
	require.NoError(t, err, "fail-open default must allow rotation during outage")
	require.NotNil(t, resp)

	errAfter := testutil.ToFloat64(metrics.RefreshBlacklistCheckErrors)
	delta := errAfter - errBefore
	// Three blacklist keys are checked per refresh (token hash, device key, device type key);
	// all three hit the Redis error path during outage.
	if delta < 1 {
		t.Fatalf("RefreshBlacklistCheckErrors delta = %v, want >= 1: Redis outage must be observable", delta)
	}
	assert.NoError(t, mock.ExpectationsWereMet())
}
