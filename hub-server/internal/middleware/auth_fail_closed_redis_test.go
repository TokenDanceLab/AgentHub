package middleware

// AH-SR-052（SECURITY.md，High/Accepted）补偿控制行为级核验。
//
// 风险：Redis 故障时 access-token jti 黑名单检查 fail-open，已登出的
// access JWT 可能在故障窗口内复活。记录的补偿控制：生产显式设置
// AGENTHUB_AUTH_FAIL_CLOSED=true，故障时改为拒绝请求（fail-closed）。
//
// 已有的 erroringAccessBlacklist 桩测试只覆盖「检查器返回 error」的
// middleware 分支；本文件按生产接线注入真实检查器——
// internal/app/router.go 把 a.CacheClient（*cache.Client）注入
// AuthDependencies.BlacklistChecker——并用进程内 miniredis 模拟 Redis
// 可达/不可达，验证端到端行为矩阵（无真实网络连接）。

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/prometheus/client_golang/prometheus/testutil"
	"github.com/redis/go-redis/v9"

	"github.com/agenthub/hub-server/internal/cache"
	"github.com/agenthub/hub-server/internal/jwtutil"
	"github.com/agenthub/hub-server/internal/metrics"
)

// realRedisBlacklistChecker builds the same checker production wires into
// AuthDependencies.BlacklistChecker (internal/app/router.go): a real
// *cache.Client over a *redis.Client. miniredis serves as the in-process
// Redis so the matrix runs without any external network I/O.
func realRedisBlacklistChecker(t *testing.T) (*cache.Client, *miniredis.Miniredis) {
	t.Helper()
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("start miniredis: %v", err)
	}
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		_ = rdb.Close()
		mr.Close()
	})
	return cache.NewClient(rdb), mr
}

// runRealRedisAuthCase drives one matrix row through the production middleware
// path: mint a real access JWT (with jti), optionally blacklist its jti while
// Redis is up, optionally take Redis down, then run Handler() and report
// whether the request was allowed.
func runRealRedisAuthCase(t *testing.T, failClosedEnv string, blacklistJTIBeforeOutage bool, takeRedisDown bool, useWS bool) (allowed bool, status int) {
	t.Helper()
	t.Setenv("AGENTHUB_AUTH_FAIL_CLOSED", failClosedEnv)

	checker, mr := realRedisBlacklistChecker(t)
	token := makeToken("user-fc-matrix", "desktop", "dev-fc-matrix")
	claims, err := jwtutil.ParseToken(token, testSecret())
	if err != nil {
		t.Fatalf("ParseToken: %v", err)
	}
	if claims.ID == "" {
		t.Fatal("expected minted access jti for blacklist matrix")
	}

	if blacklistJTIBeforeOutage {
		if err := checker.BlacklistAccessToken(context.Background(), claims.ID, time.Minute); err != nil {
			t.Fatalf("BlacklistAccessToken while Redis up: %v", err)
		}
	}
	if takeRedisDown {
		mr.Close() // Redis outage: connection refused from here on.
	}

	c, w := ginRequest(http.MethodGet, "/client/auth/me", "Bearer "+token)
	mw := newTestAuthMW(testConfig(), AuthDependencies{BlacklistChecker: checker}, nil)
	if useWS {
		mw.WSHandler()(c)
	} else {
		mw.Handler()(c)
	}
	return !c.IsAborted(), w.Code
}

// TestAuthMiddlewareRealRedisFailClosedMatrix is the AH-SR-052 behavioral
// gate: Redis reachability x AGENTHUB_AUTH_FAIL_CLOSED x expected behavior,
// with the production-wired *cache.Client as blacklist checker.
func TestAuthMiddlewareRealRedisFailClosedMatrix(t *testing.T) {
	// Create the metrics (nil-guarded in production code) so the outage
	// observability assertions below can read JTIBlacklistCheckErrors.
	metrics.Register()

	cases := []struct {
		name          string
		failClosedEnv string
		blacklisted   bool
		outage        bool
		useWS         bool
		wantAllowed   bool
	}{
		// Redis reachable: blacklist decision is authoritative regardless of
		// the fail-closed switch.
		{name: "redis可达_未拉黑_failclosed关_放行", failClosedEnv: "", blacklisted: false, outage: false, wantAllowed: true},
		{name: "redis可达_未拉黑_failclosed开_放行", failClosedEnv: "true", blacklisted: false, outage: false, wantAllowed: true},
		{name: "redis可达_已拉黑_failclosed关_拒绝", failClosedEnv: "", blacklisted: true, outage: false, wantAllowed: false},
		{name: "redis可达_已拉黑_failclosed开_拒绝", failClosedEnv: "true", blacklisted: true, outage: false, wantAllowed: false},
		// Redis outage after the jti was blacklisted (logout happened before
		// the outage): default policy is documented fail-open.
		{name: "redis故障_故障前已拉黑_failclosed关_默认fail-open放行", failClosedEnv: "", blacklisted: true, outage: true, wantAllowed: true},
		// AH-SR-052 compensating control: with AGENTHUB_AUTH_FAIL_CLOSED=true
		// the same outage must fail closed (401), otherwise the revoked
		// (logged-out) access JWT gets back in during the Redis outage.
		{name: "redis故障_故障前已拉黑_failclosed开_必须拒绝", failClosedEnv: "true", blacklisted: true, outage: true, wantAllowed: false},
		// WebSocket upgrade shares acceptAccessClaims; the compensating
		// control must apply to the WS path as well.
		{name: "ws_redis故障_故障前已拉黑_failclosed开_必须拒绝", failClosedEnv: "true", blacklisted: true, outage: true, useWS: true, wantAllowed: false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var errMetricBefore float64
			if tc.outage {
				errMetricBefore = testutil.ToFloat64(metrics.JTIBlacklistCheckErrors)
			}
			allowed, status := runRealRedisAuthCase(t, tc.failClosedEnv, tc.blacklisted, tc.outage, tc.useWS)
			if allowed != tc.wantAllowed {
				if tc.wantAllowed {
					t.Fatalf("expected request to be allowed, got rejected (status=%d)", status)
				}
				t.Fatalf("expected request to be rejected (401), got allowed (status=%d): revoked jti slipped through during Redis outage", status)
			}
			if !tc.wantAllowed && status != http.StatusUnauthorized {
				t.Fatalf("status = %d, want 401", status)
			}
			if tc.outage {
				// G9: a Redis outage on the blacklist path must be visible in
				// Grafana regardless of the fail-open/fail-closed decision.
				if delta := testutil.ToFloat64(metrics.JTIBlacklistCheckErrors) - errMetricBefore; delta != 1 {
					t.Fatalf("JTIBlacklistCheckErrors delta = %v, want 1: Redis outage must be observable", delta)
				}
			}
		})
	}
}
