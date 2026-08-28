package middleware

// auth_bench_test.go — AuthMiddleware（JWT 校验）热路径微基准（#2037）。
//
// 度量意图：AuthMiddleware.Handler 是所有认证请求的必经热路径：
// Bearer 头解析 → jwtutil HS256 ParseToken → claims 注入 gin.Context。
// 本基准度量中间件层自身的每请求 CPU/分配成本（jwtutil 包的裸
// ParseToken 成本已有 internal/jwtutil 基准覆盖，此处度量的是含
// gin 上下文处理的完整中间件路径）。
//
// 输入全部固定（固定测试 secret/用户/设备，复用 auth_test.go 的
// testConfig/makeToken fixture）；无网络、无磁盘 IO；黑名单检查器与
// 权限审计回调不挂载（两者分别依赖 Redis/DB，隔离后基准只反映
// 中间件自身开销）。

import (
	"net/http"
	"testing"

	"github.com/agenthub/hub-server/internal/metrics"
)

// BenchmarkAuthHandlerValidToken 度量合法 Hub 会话 token 的完整校验路径
// （头部解析 + HS256 ParseToken + claims 注入 + Next）。
func BenchmarkAuthHandlerValidToken(b *testing.B) {
	handler := newTestAuthMW(testConfig(), AuthDependencies{}, nil).Handler()
	token := makeToken("user-bench", "desktop", "device-bench")

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		c, _ := ginRequest(http.MethodGet, "/client/users/me", "Bearer "+token)
		handler(c)
	}
}

// BenchmarkAuthHandlerInvalidToken 度量非法 token 的拒绝路径
// （ParseToken 失败 → 失败指标计数 → 401 JSON 响应 + Abort）。
// 生产环境的未认证/伪造流量都走这条路径。
func BenchmarkAuthHandlerInvalidToken(b *testing.B) {
	metrics.Register() // 幂等（sync.Once）：让 JWTVerificationFailures 计数器就位，贴近生产
	handler := newTestAuthMW(testConfig(), AuthDependencies{}, nil).Handler()

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		c, _ := ginRequest(http.MethodGet, "/client/users/me", "Bearer not-a-valid-jwt")
		handler(c)
	}
}
