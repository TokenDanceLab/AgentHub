// Package metrics 提供 Prometheus 指标的注册和管理。
//
// 本文件测试 Register 函数的幂等性（sync.Once），以及注册后
// 指标对象可以通过 prometheus API 访问。
//
// 测试约束：
//   - 不依赖 PostgreSQL、Redis 等外部服务。
//   - sync.Once 保证同一进程中只注册一次，测试利用此特性
//     验证幂等性（第二次调用 Register 是空操作，不 panic）。
package metrics

import (
	"sync"
	"testing"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/testutil"

	"github.com/agenthub/pkg/safego"
)

// TestRegisterDoesNotPanic 验证：首次调用 Register 不会 panic。
// Register 使用 sync.Once 包裹，内部调用 prometheus.MustRegister，
// 确保指标只注册一次。
func TestRegisterDoesNotPanic(t *testing.T) {
	// 首次调用 Register 不应 panic
	Register()

	// 验证所有包级指标变量已初始化（非 nil）
	if HTTPRequestsTotal == nil {
		t.Error("HTTPRequestsTotal 在 Register() 后不应为 nil")
	}
	if HTTPDuration == nil {
		t.Error("HTTPDuration 在 Register() 后不应为 nil")
	}
	if WSConnections == nil {
		t.Error("WSConnections 在 Register() 后不应为 nil")
	}
	if WSDroppedFrames == nil {
		t.Error("WSDroppedFrames 在 Register() 后不应为 nil")
	}
	if DBPoolInUse == nil {
		t.Error("DBPoolInUse 在 Register() 后不应为 nil")
	}
	if RedisPoolHitsTotal == nil {
		t.Error("RedisPoolHitsTotal 在 Register() 后不应为 nil")
	}
	if EventBusQueueLen == nil {
		t.Error("EventBusQueueLen 在 Register() 后不应为 nil")
	}
	if EventBusPanics == nil {
		t.Error("EventBusPanics 在 Register() 后不应为 nil")
	}
	// G3/G4/G9 新增 counter nil 检查（#1441 nil-guard 模式：单测不调 Register 时为 nil）
	if DeliveryOutboxRetryAttempts == nil {
		t.Error("DeliveryOutboxRetryAttempts 在 Register() 后不应为 nil")
	}
	if DeliveryOutboxDeadLetters == nil {
		t.Error("DeliveryOutboxDeadLetters 在 Register() 后不应为 nil")
	}
	if DeliveryOutboxRedispatchFailures == nil {
		t.Error("DeliveryOutboxRedispatchFailures 在 Register() 后不应为 nil")
	}
	if DeliveryOutboxScanFailures == nil {
		t.Error("DeliveryOutboxScanFailures 在 Register() 后不应为 nil")
	}
	if AgentDispatchEdgeHTTPFailures == nil {
		t.Error("AgentDispatchEdgeHTTPFailures 在 Register() 后不应为 nil")
	}
	if JWTVerificationFailures == nil {
		t.Error("JWTVerificationFailures 在 Register() 后不应为 nil")
	}
	if WSAuthFailures == nil {
		t.Error("WSAuthFailures 在 Register() 后不应为 nil")
	}
	if JTIBlacklistCheckErrors == nil {
		if RefreshBlacklistCheckErrors == nil {
			t.Error("RefreshBlacklistCheckErrors 在 Register() 后不应为 nil")
		}
		t.Error("JTIBlacklistCheckErrors 在 Register() 后不应为 nil")
		if RefreshBlacklistCheckErrors == nil {
			t.Error("RefreshBlacklistCheckErrors 在 Register() 后不应为 nil")
		}
	}
	if RefreshBlacklistCheckErrors == nil {
		t.Error("RefreshBlacklistCheckErrors 在 Register() 后不应为 nil")
	}
	if RefreshTokenReuseTotal == nil {
		t.Error("RefreshTokenReuseTotal 在 Register() 后不应为 nil")
	}
}

// TestRegisterIdempotent 验证：第二次调用 Register 不会 panic。
// sync.Once 保证注册闭包只执行一次，后续调用是空操作。
func TestRegisterIdempotent(t *testing.T) {
	// 第一次调用
	Register()
	// 第二次调用 —— sync.Once 保证不会重复注册，因此不会 panic
	Register()
	// 第三次调用
	Register()
}

// TestRegisteredMetricsAccessible 验证：注册后的指标可通过
// prometheus.DefaultRegisterer 查询到。
//
// 注意：CounterVec / HistogramVec 类型在没有任何 label 值观察时，
// Gather 不会导出该 metric family。因此本测试在 Gather 前先为
// Vec 类型指标各创建一条观测记录，使用不会与其他测试冲突的 label。
func TestRegisteredMetricsAccessible(t *testing.T) {
	Register()

	// 为 Vec 类型指标创建至少一个子指标，使其出现在 Gather 输出中
	// 使用 _test_access 前缀避免污染其他测试的断言值
	HTTPRequestsTotal.WithLabelValues("_test_access_", "/_access_check", "000").Inc()
	HTTPDuration.WithLabelValues("_test_access_", "/_access_check", "000").Observe(0.001)
	// G3/G4/G9 新增 CounterVec 各创建一条观测记录以暴露 metric family
	DeliveryOutboxDeadLetters.WithLabelValues("_test_access_").Inc()
	AgentDispatchEdgeHTTPFailures.WithLabelValues("_test_access_").Inc()
	JWTVerificationFailures.WithLabelValues("_test_access_").Inc()
	WSAuthFailures.WithLabelValues("_test_access_").Inc()

	// 使用 Gather 获取所有注册的指标
	metricFamilies, err := prometheus.DefaultGatherer.Gather()
	if err != nil {
		t.Fatalf("Gather 失败: %v", err)
	}

	// 将搜集结果转为 set 便于查找
	names := make(map[string]bool, len(metricFamilies))
	for _, mf := range metricFamilies {
		names[mf.GetName()] = true
	}

	// 验证核心业务指标已注册
	expectedNames := []string{
		"http_requests_total",
		"http_request_duration_seconds",
		"ws_connections",
		"ws_dropped_frames_total",
		"db_pool_in_use",
		"redis_pool_hits_total",
		"eventbus_queue_length",
		"eventbus_panics_total",
		// G3 plain Counters
		"delivery_outbox_retry_attempts_total",
		"delivery_outbox_redispatch_failures_total",
		"delivery_outbox_scan_failures_total",
		// G9 plain Counter
		"jti_blacklist_check_errors_total",
		// #2154 F2 step ① plain Counter
		"refresh_token_reuse_total",
	}
	for _, name := range expectedNames {
		if !names[name] {
			t.Errorf("期望指标 %q 已注册，但在 DefaultGatherer 中未找到", name)
		}
	}
}

// TestHTTPRequestsTotalCounter 验证：CounterVec 可以正常使用（增量和查询）。
func TestHTTPRequestsTotalCounter(t *testing.T) {
	Register()

	// 模拟一次 HTTP 请求计数
	HTTPRequestsTotal.WithLabelValues("GET", "/api/test", "200").Inc()

	// 验证计数可被搜集
	metricFamilies, err := prometheus.DefaultGatherer.Gather()
	if err != nil {
		t.Fatalf("Gather 失败: %v", err)
	}
	for _, mf := range metricFamilies {
		if mf.GetName() == "http_requests_total" {
			for _, m := range mf.GetMetric() {
				labels := m.GetLabel()
				if len(labels) == 3 &&
					labels[0].GetValue() == "GET" &&
					labels[1].GetValue() == "/api/test" &&
					labels[2].GetValue() == "200" {
					if m.GetCounter().GetValue() != 1 {
						t.Errorf("http_requests_total{method=\"GET\",path=\"/api/test\",status=\"200\"} = %v, want 1",
							m.GetCounter().GetValue())
					}
					return
				}
			}
			t.Error("未找到预期的 http_requests_total 指标值")
		}
	}
}

// TestHTTPDurationHistogram 验证：HistogramVec 可以正常使用。
func TestHTTPDurationHistogram(t *testing.T) {
	Register()

	// 模拟一次请求耗时记录
	HTTPDuration.WithLabelValues("POST", "/api/upload", "201").Observe(0.35)

	// 验证指标存在
	metricFamilies, err := prometheus.DefaultGatherer.Gather()
	if err != nil {
		t.Fatalf("Gather 失败: %v", err)
	}
	for _, mf := range metricFamilies {
		if mf.GetName() == "http_request_duration_seconds" {
			for _, m := range mf.GetMetric() {
				labels := m.GetLabel()
				if len(labels) == 3 &&
					labels[0].GetValue() == "POST" &&
					labels[1].GetValue() == "/api/upload" &&
					labels[2].GetValue() == "201" {
					// 直方图至少有一次观测
					if m.GetHistogram().GetSampleCount() < 1 {
						t.Error("Histogram 的 SampleCount 应至少为 1")
					}
					return
				}
			}
			t.Error("未找到预期的 http_request_duration_seconds 指标值")
		}
	}
}

// TestGaugeMetrics 验证：Gauge 指标可以正常设置和读取。
func TestGaugeMetrics(t *testing.T) {
	Register()

	// 设置 WebSocket 连接数
	WSConnections.Set(42)
	// 设置数据库连接池使用数
	DBPoolInUse.Set(10)

	metricFamilies, err := prometheus.DefaultGatherer.Gather()
	if err != nil {
		t.Fatalf("Gather 失败: %v", err)
	}

	for _, mf := range metricFamilies {
		switch mf.GetName() {
		case "ws_connections":
			if len(mf.GetMetric()) > 0 {
				if v := mf.GetMetric()[0].GetGauge().GetValue(); v != 42 {
					t.Errorf("ws_connections = %v, want 42", v)
				}
			}
		case "db_pool_in_use":
			if len(mf.GetMetric()) > 0 {
				if v := mf.GetMetric()[0].GetGauge().GetValue(); v != 10 {
					t.Errorf("db_pool_in_use = %v, want 10", v)
				}
			}
		}
	}
}

// TestEventBusCounter 验证：EventBusPanics Counter 可以正常累加。
func TestEventBusCounter(t *testing.T) {
	Register()

	EventBusPanics.Inc()
	EventBusPanics.Inc()

	metricFamilies, err := prometheus.DefaultGatherer.Gather()
	if err != nil {
		t.Fatalf("Gather 失败: %v", err)
	}

	for _, mf := range metricFamilies {
		if mf.GetName() == "eventbus_panics_total" {
			if len(mf.GetMetric()) > 0 {
				if v := mf.GetMetric()[0].GetCounter().GetValue(); v != 2 {
					t.Errorf("eventbus_panics_total = %v, want 2", v)
				}
			}
			return
		}
	}
	t.Error("未找到 eventbus_panics_total 指标")
}

// ── #2246 slice 1：safego PanicObserver 按 name 分派 eventbus_panics_total ──
//
// 这些用例追加在 TestEventBusCounter 之后是**有意的**：TestEventBusCounter 断言
// eventbus_panics_total 的**绝对值** == 2，而该 counter 是进程级、注册在
// DefaultRegisterer 上的全局量。任何在它之前触发 "eventbus." 前缀 panic 的用例
// 都会把绝对值顶高从而误伤它。本块用例自身一律用 before/after 差值断言，不依赖
// 执行顺序，但仍必须排在其后。

// recoverOnePanic 在独立 goroutine 里制造一次真实 panic 并走 pkg/safego 恢复，
// 返回时 observer 一定已经跑完。
//
// 顺序是关键：`defer close(done)` 先注册、`defer safego.Recover(name)` 后注册，
// Go 按 LIFO 展开，所以 Recover（含 observer 回调）先执行、close 后执行。
// 反过来写就会在 observer 计数之前放行主 goroutine，断言变成竞态。
func recoverOnePanic(t *testing.T, name string) {
	t.Helper()
	done := make(chan struct{})
	go func() {
		defer close(done)
		defer safego.Recover(name)
		panic("induced panic for the observer dispatch test")
	}()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatalf("safego.Recover(%q) 未在 3s 内完成恢复", name)
	}
}

// TestHubPanicObserver_NilCountersAreSafe 验证：未调用 Register 的构建/测试里
// 两个 counter 都是 nil，observer 在恢复路径上不得 panic —— 恢复路径自己再
// panic 会把 safego 刚救回来的 goroutine 二次打死。
func TestHubPanicObserver_NilCountersAreSafe(t *testing.T) {
	savedBus, savedGoroutine := EventBusPanics, GoroutinePanicRecoveries
	EventBusPanics, GoroutinePanicRecoveries = nil, nil
	defer func() { EventBusPanics, GoroutinePanicRecoveries = savedBus, savedGoroutine }()

	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("hubPanicObserver 在 counter 为 nil 时 panic 了: %v", r)
		}
	}()
	hubPanicObserver("eventbus.handler", "boom", "stack")
	hubPanicObserver("ws.push_to_session", "boom", "stack")
	hubPanicObserver("", "boom", "stack")
}

// TestInstallPanicObserver_Idempotent 验证：init 已经装过一次，测试再显式装一次
// 不会 panic、也不会改变分派行为。这是 bus 包借用全局 hook 后能安全还原的前提
// （pkg/safego 只有一个槽位，装两次后者覆盖前者）。
func TestInstallPanicObserver_Idempotent(t *testing.T) {
	Register()
	InstallPanicObserver()
	InstallPanicObserver()

	busBefore := testutil.ToFloat64(EventBusPanics)
	recoverOnePanic(t, "eventbus.handler")
	if got := testutil.ToFloat64(EventBusPanics) - busBefore; got != 1 {
		t.Errorf("重复 InstallPanicObserver 后 eventbus_panics_total 增量 = %v, want 1", got)
	}
}

// TestPanicObserver_EventBusNameFeedsBothCounters 验证：eventbus. 前缀的 name
// 同时进 goroutine_panic_recoveries_total（全量）与 eventbus_panics_total
// （总线专属）。bus 包自己那处私有 Inc 已随 #2246 删除，这两个 +1 全部来自
// 本文件的 observer。
func TestPanicObserver_EventBusNameFeedsBothCounters(t *testing.T) {
	Register()
	InstallPanicObserver()

	busBefore := testutil.ToFloat64(EventBusPanics)
	goroutineBefore := testutil.ToFloat64(GoroutinePanicRecoveries)

	recoverOnePanic(t, "eventbus.handler")

	if got := testutil.ToFloat64(EventBusPanics) - busBefore; got != 1 {
		t.Errorf("eventbus_panics_total 增量 = %v, want 1（0 = counter 随私有 Inc 一起被丢了；2 = ants pool handler 对同一次 panic 重复计数）", got)
	}
	if got := testutil.ToFloat64(GoroutinePanicRecoveries) - goroutineBefore; got != 1 {
		t.Errorf("goroutine_panic_recoveries_total 增量 = %v, want 1", got)
	}
}

// TestPanicObserver_NonEventBusNameSkipsEventBusCounter 验证分派规则的另一半：
// 前缀之外的 name 只进全量 counter。少了这条，eventbus_panics_total 就不再
// 等于「总线上的 panic」，指标名与语义脱钩。
func TestPanicObserver_NonEventBusNameSkipsEventBusCounter(t *testing.T) {
	Register()
	InstallPanicObserver()

	cases := []string{
		"ws.push_to_session",  // #2246 收敛点之一（hub ws fanout）
		"events.bus_observer", // #2246 收敛点之一（edge events，前缀是 events. 不是 eventbus.）
		"ndjson.parse_line",   // #2246 收敛点之一（edge adapters）
		"ws.readLoop",         // 既有 SafeGo 名
		"dispatch.launch",     // 既有 SafeGo 名
		"",                    // 无名兜底
	}

	for _, name := range cases {
		busBefore := testutil.ToFloat64(EventBusPanics)
		goroutineBefore := testutil.ToFloat64(GoroutinePanicRecoveries)

		recoverOnePanic(t, name)

		if got := testutil.ToFloat64(EventBusPanics) - busBefore; got != 0 {
			t.Errorf("name=%q: eventbus_panics_total 增量 = %v, want 0（非总线 name 不得喂总线 counter）", name, got)
		}
		if got := testutil.ToFloat64(GoroutinePanicRecoveries) - goroutineBefore; got != 1 {
			t.Errorf("name=%q: goroutine_panic_recoveries_total 增量 = %v, want 1", name, got)
		}
	}
}

// TestPanicObserver_EventBusPrefixNotExactName 钉住「前缀而非精确名」这条决定：
// 未来总线新增的恢复点（例如 eventbus.close_drain）自动归属总线 counter，
// 不需要再回来改 observer。若有人把 HasPrefix 改成 ==，这条会红。
func TestPanicObserver_EventBusPrefixNotExactName(t *testing.T) {
	Register()
	InstallPanicObserver()

	busBefore := testutil.ToFloat64(EventBusPanics)
	recoverOnePanic(t, "eventbus.close_drain")
	if got := testutil.ToFloat64(EventBusPanics) - busBefore; got != 1 {
		t.Errorf("eventbus_panics_total 增量 = %v, want 1（eventbus. 前缀必须整族命中，不是只认 eventbus.handler）", got)
	}
}

// TestPanicObserver_ConcurrentEventBusPanicsCountEveryOne 验证分派在高并发下不丢
// 计数（observer 在各自 goroutine 内同步执行，counter 本身是 prometheus 原子量）。
func TestPanicObserver_ConcurrentEventBusPanicsCountEveryOne(t *testing.T) {
	Register()
	InstallPanicObserver()

	const n = 32
	busBefore := testutil.ToFloat64(EventBusPanics)

	var wg sync.WaitGroup
	wg.Add(n)
	for i := 0; i < n; i++ {
		go func() {
			defer wg.Done()
			defer safego.Recover("eventbus.handler")
			panic("induced concurrent panic")
		}()
	}
	waitGroupDone(t, &wg)

	if got := testutil.ToFloat64(EventBusPanics) - busBefore; got != n {
		t.Errorf("eventbus_panics_total 增量 = %v, want %d（并发下丢计数）", got, n)
	}
}

// waitGroupDone 等待 WaitGroup 归零。不用 time.Sleep：test-sleep 棘轮
// （scripts/verify/verify-test-sleep-ratchet.py）按文件计预算，改动既有文件的
// sleep 计数会顶破基线。
func waitGroupDone(t *testing.T, wg *sync.WaitGroup) {
	t.Helper()
	done := make(chan struct{})
	go func() { wg.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("等待并发 panic 恢复超时")
	}
}
