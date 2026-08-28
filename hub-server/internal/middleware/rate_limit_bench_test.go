package middleware

// rate_limit_bench_test.go — 限流中间件热路径微基准（#2037）。
//
// 度量意图：量化每个请求经过限流中间件的成本。覆盖两条生产路径：
//   - 进程内纯内存限流（WS IP 令牌桶、WS 用户连接数）——无任何外部依赖；
//   - Redis 滑动窗口/固定窗口限流——用 miniredis（进程内仿真，仅
//     loopback，与既有单测同口径），不依赖外部 Redis，门禁可封闭运行。
//
// 输入固定：预生成唯一 IP 池，循环内按位取模轮换。每个请求落在全新
// 限流键上，保证循环稳定走“放行”路径，不会耗尽突发配额跌入拒绝路径
// 产生日志输出；也避免单键计数/集合随迭代无界增长。

import (
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"

	"github.com/agenthub/hub-server/internal/cache"
)

// benchIPPoolSize 是唯一客户端 IP 池大小（2^16）。池在计时前一次性生成，
// 循环内零 fmt 开销。
const benchIPPoolSize = 65536

var benchIPs = newBenchIPPool()

func newBenchIPPool() []string {
	ips := make([]string, benchIPPoolSize)
	for i := range ips {
		ips[i] = fmt.Sprintf("10.%d.%d.1:12345", (i>>8)&255, i&255)
	}
	return ips
}

func benchIP(i int) string {
	return benchIPs[i&(benchIPPoolSize-1)]
}

// rateLimitBenchClient 构造 miniredis 后端的 cache.Client（进程内，无外部
// Redis 依赖），生命周期随基准结束自动清理。
func rateLimitBenchClient(b *testing.B) *cache.Client {
	b.Helper()
	mr, err := miniredis.Run()
	if err != nil {
		b.Fatal(err)
	}
	b.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	b.Cleanup(func() { _ = rdb.Close() })
	return cache.NewClient(rdb)
}

// BenchmarkWSIPRateLimitNewIP 度量 WS 升级前每 IP 令牌桶限流的放行路径
// （互斥锁 + map 查找/新建 + token bucket Allow）。IP 轮换使每次迭代都走
// 新建桶路径；limiter map 增长上限为 min(b.N, 65536)。
func BenchmarkWSIPRateLimitNewIP(b *testing.B) {
	limiter := NewWSIPRateLimiter()
	b.Cleanup(limiter.Stop)
	handler := WSIPRateLimitWithLimiter(limiter)

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		c, _ := ginRequest(http.MethodGet, "/ws", "")
		c.Request.RemoteAddr = benchIP(i)
		handler(c)
		if c.IsAborted() {
			b.Fatal("benchmark request must stay on the allow path")
		}
	}
}

// BenchmarkWSUserConnLimiterAcquireRelease 度量每用户 WS 连接数记账的
// 热路径（Acquire+Release 一对，连接数恒为 1，不触发踢出路径）。
func BenchmarkWSUserConnLimiterAcquireRelease(b *testing.B) {
	limiter := NewWSUserConnLimiter(nil)
	const userID = "user-bench"
	const connID = "conn-bench"

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		limiter.Acquire(userID, connID)
		limiter.Release(userID, connID)
	}
}

// BenchmarkRateLimitSlidingWindowAllow 度量 Redis 滑动窗口限流中间件的
// 放行路径（ZRemRangeByScore → ZAdd → Expire → ZCard，经 miniredis）。
// 大 limit + 长 window 保证 ZSET 不超限；每请求一个新键。
func BenchmarkRateLimitSlidingWindowAllow(b *testing.B) {
	client := rateLimitBenchClient(b)
	handler := RateLimit(client, 1_000_000, time.Hour, IPKey)

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		c, _ := ginRequest(http.MethodGet, "/api/bench", "")
		c.Request.RemoteAddr = benchIP(i)
		handler(c)
		if c.IsAborted() {
			b.Fatal("benchmark request must stay on the allow path")
		}
	}
}

// BenchmarkGlobalRateLimitAllow 度量全局每 IP 固定窗口限流的放行路径
// （INCR → EXPIRE，经 miniredis）。IP 轮换使每请求计数恒为 1，远低于
// GlobalRateLimitPerMinute，稳定走放行路径。
func BenchmarkGlobalRateLimitAllow(b *testing.B) {
	client := rateLimitBenchClient(b)
	handler := GlobalRateLimit(client)

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		c, _ := ginRequest(http.MethodGet, "/api/bench", "")
		c.Request.RemoteAddr = benchIP(i)
		handler(c)
		if c.IsAborted() {
			b.Fatal("benchmark request must stay on the allow path")
		}
	}
}
