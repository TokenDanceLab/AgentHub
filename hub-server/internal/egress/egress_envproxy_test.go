package egress

// 本文件命名为 egress_envproxy_* 使其按字母序排在 egress_test.go 之前：
// net/http.ProxyFromEnvironment 在进程内首次调用时固化 env（sync.Once），
// 因此代理场景必须是本包测试进程中第一个触发 transport 请求的测试。
// NO_PROXY 固定覆盖 loopback，保证本包其余测试维持直连行为不受缓存影响。

import (
	"context"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sync/atomic"
	"testing"
)

// TestProxyFromEnvironmentHonored 证明代理配置路径 = 环境变量
// （HTTP_PROXY/NO_PROXY）：请求经代理以 absolute-form 发出，
// 拨号时 SSRF 地址校验作用于代理地址，目标主机本身不在本地解析/拨号。
// 目标选 192.0.2.1（TEST-NET-1，受限类）：若代理 env 未生效，
// dialContext 会在拨号前以策略错误失败，全程无真实外网连接。
// 注意：配置代理后受限网络检查作用于代理而非最终目标，
// 代理来自进程 env，其信任边界是管理员配置。
func TestProxyFromEnvironmentHonored(t *testing.T) {
	var proxyHits int64
	var seenURL atomic.Value // holds string
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt64(&proxyHits, 1)
		seenURL.Store(r.URL.String())
		w.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(proxy.Close)

	t.Setenv("HTTP_PROXY", proxy.URL)
	t.Setenv("HTTPS_PROXY", proxy.URL)
	// 保持 loopback 直连，避免缓存的代理 env 影响本包其他测试。
	t.Setenv("NO_PROXY", "127.0.0.1,localhost")

	c, err := New(Config{AllowCIDRs: []string{"127.0.0.0/8"}, AllowPlainHTTP: true})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	resp, err := c.Get(context.Background(), "http://192.0.2.1/v1/health")
	if err != nil {
		t.Fatalf("Get through proxy: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("status = %d, want 204 via proxy", resp.StatusCode)
	}
	if got := atomic.LoadInt64(&proxyHits); got != 1 {
		t.Fatalf("proxy hits = %d, want 1", got)
	}
	seen, _ := seenURL.Load().(string)
	if seen != "http://192.0.2.1/v1/health" {
		t.Fatalf("proxy saw URL %q, want absolute-form target URL", seen)
	}
}

// TestTransportProxyWiring 固化 transport 的代理钩子是
// http.ProxyFromEnvironment（仅 env 路径，无配置文件路径）。
func TestTransportProxyWiring(t *testing.T) {
	c, err := New(Config{})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	tr, ok := c.hc.Transport.(*http.Transport)
	if !ok || tr == nil || tr.Proxy == nil {
		t.Fatalf("transport proxy wiring missing (type %T)", c.hc.Transport)
	}
	if reflect.ValueOf(tr.Proxy).Pointer() != reflect.ValueOf(http.ProxyFromEnvironment).Pointer() {
		t.Fatal("transport.Proxy must be http.ProxyFromEnvironment")
	}
}
