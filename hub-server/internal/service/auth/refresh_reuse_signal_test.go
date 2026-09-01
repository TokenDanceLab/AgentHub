package auth

// #2154 F2 step ①（低风险信号片）行为级核验：已撤销（revoked）的
// refresh token 行被再次出示是 refresh 链路上唯一可在 DB 侧检测的
// 复用信号（轮换走 UpsertRefreshToken ON CONFLICT 覆盖旧 hash，
// 轮换后旧 token 复用结构性不可检测）。本片只加信号——拒绝语义不变
// （仍为 AuthRefreshInvalid）、warn 日志 + refresh_token_reuse_total
// 计数器、**不做任何级联吊销**（级联是独立决策项）。

import (
	"context"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/prometheus/client_golang/prometheus/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/metrics"
)

// TestRefreshToken_RevokedReuseSignal 模拟「登出（revoke）后复用」：
//  1. Logout 吊销该设备令牌行（DB 事实源）；
//  2. 同一（已撤销）token 再次出示 → 必须拒绝且错误码语义不变；
//  3. refresh_token_reuse_total 恰好 +1；
//  4. 不级联——sqlmock 期望在复用查询后即耗尽，任何针对该用户其它
//     令牌行的吊销 UPDATE 都会以 unexpected Exec 使
//     ExpectationsWereMet 失败。
func TestRefreshToken_RevokedReuseSignal(t *testing.T) {
	metrics.Register()

	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	// Step 1: logout revokes the token row.
	mock.ExpectExec(sqlRevokeByDevice).
		WithArgs(true, "user-uuid", "dev-1").
		WillReturnResult(sqlmock.NewResult(0, 1))

	// Step 2: the same (now revoked) token is presented again — reuse.
	mock.ExpectQuery(sqlRTByHash).
		WithArgs(sqlmock.AnyArg(), 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "device_type", "device_id", "token_hash", "revoked", "expires_at"}).
			AddRow("rt-1", "user-uuid", "desktop", "dev-1", "revoked-hash", true, time.Now().Add(24*time.Hour)))

	// No further expectations on purpose: any cascade revocation
	// (UPDATE refresh_tokens touching this user's other rows) would
	// surface as an unexpected Exec below.

	before := testutil.ToFloat64(metrics.RefreshTokenReuseTotal)

	svc := NewService(db, jwtCfg(), nil) // nil cache → NoOpCache, DB-only path

	// Logout (revoke).
	require.NoError(t, svc.Logout(context.Background(), "user-uuid", "dev-1", "", ""))

	// Reuse of the revoked token.
	resp, err := svc.RefreshToken(context.Background(), "revoked-refresh-token")
	assert.Nil(t, resp)
	assert.ErrorIs(t, err, errcode.AuthRefreshInvalid, "response semantics must stay unchanged")

	// Counter incremented exactly once.
	assert.InDelta(t, 1, testutil.ToFloat64(metrics.RefreshTokenReuseTotal)-before, 0,
		"refresh_token_reuse_total must increment exactly once per revoked-row reuse")

	// Exhausted expectations prove no cascade revocation SQL ran
	// (the user's other tokens were not revoked).
	assert.NoError(t, mock.ExpectationsWereMet())
}

// TestRefreshToken_ExpiredNoReuseSignal 验证信号的特异性：过期（但未撤销）
// 的令牌同样以 AuthRefreshInvalid 拒绝，但不计入复用计数器。
func TestRefreshToken_ExpiredNoReuseSignal(t *testing.T) {
	metrics.Register()

	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlRTByHash).
		WithArgs(sqlmock.AnyArg(), 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "device_type", "device_id", "token_hash", "revoked", "expires_at"}).
			AddRow("rt-1", "user-uuid", "desktop", "dev-1", "expired-hash", false, time.Now().Add(-time.Hour)))

	before := testutil.ToFloat64(metrics.RefreshTokenReuseTotal)

	svc := NewService(db, jwtCfg(), nil)
	resp, err := svc.RefreshToken(context.Background(), "expired-refresh-token")
	assert.Nil(t, resp)
	assert.ErrorIs(t, err, errcode.AuthRefreshInvalid)
	assert.InDelta(t, 0, testutil.ToFloat64(metrics.RefreshTokenReuseTotal)-before, 0,
		"expired-but-not-revoked tokens must not count as reuse")
	assert.NoError(t, mock.ExpectationsWereMet())
}
