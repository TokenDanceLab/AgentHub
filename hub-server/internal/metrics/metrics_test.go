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
	"testing"

	"github.com/prometheus/client_golang/prometheus"
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
