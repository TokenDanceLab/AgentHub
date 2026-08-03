package app

// #1547 — Admin server capability split: observability must not depend on
// debug credentials; AdminServerUp reflects the real listener lifecycle;
// /version reports the real build version.

import (
	"context"
	"net"
	"net/http"
	"testing"
	"time"

	"github.com/prometheus/client_golang/prometheus/testutil"
	"github.com/stretchr/testify/require"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/metrics"
)

// freePort finds an available TCP port for the admin listener.
func freePort(t *testing.T) int {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	port := l.Addr().(*net.TCPAddr).Port
	require.NoError(t, l.Close())
	return port
}

// newAdminTestApp builds a minimal App (no DB/cache — only the admin server
// paths under test touch those, and the tested routes do not).
func newAdminTestApp(port int, version string) *App {
	return &App{
		Config:    &config.Config{Server: config.ServerConfig{AdminPort: port}},
		Version:   version,
		startTime: time.Now(),
	}
}

func adminClient(addr string) *http.Client {
	return &http.Client{Timeout: 2 * time.Second}
}

// TestAdminServerMetricsAvailableWithoutDebugCredentials: 无 pprof 凭证时
// metrics/health 仍可用；pprof/config/state 路由不存在（404 fail-closed）。
func TestAdminServerMetricsAvailableWithoutDebugCredentials(t *testing.T) {
	t.Setenv("AGENTHUB_PPROF_USER", "")
	t.Setenv("AGENTHUB_PPROF_PASS", "")

	port := freePort(t)
	a := newAdminTestApp(port, "test-version-1")
	require.NoError(t, a.startAdminServer())
	t.Cleanup(func() { _ = a.AdminServer.Close() })
	require.NotNil(t, a.AdminServer, "admin server must start without debug credentials")

	addr := adminListenAddr(port)
	client := adminClient(addr)

	// metrics 可用。
	resp, err := client.Get("http://" + addr + "/metrics")
	require.NoError(t, err)
	resp.Body.Close()
	require.Equal(t, http.StatusOK, resp.StatusCode, "metrics must be available without debug credentials")

	// health 端点存在（依赖缺失时聚合 503 是正确语义——端点存活即可）。
	resp, err = client.Get("http://" + addr + "/health")
	require.NoError(t, err)
	resp.Body.Close()
	require.NotEqual(t, http.StatusNotFound, resp.StatusCode, "health endpoint must exist without debug credentials")

	// debug 能力 fail-closed：路由不存在。
	for _, path := range []string{"/debug/pprof/", "/debug/config", "/debug/state"} {
		resp, err = client.Get("http://" + addr + path)
		require.NoError(t, err)
		resp.Body.Close()
		require.Equal(t, http.StatusNotFound, resp.StatusCode, "%s must be absent (fail-closed) without credentials", path)
	}
}

// TestAdminServerDebugCapabilitiesWithCredentials: 凭证齐全时 pprof 注册，
// 无认证 401、带认证 200。
func TestAdminServerDebugCapabilitiesWithCredentials(t *testing.T) {
	t.Setenv("AGENTHUB_PPROF_USER", "admin")
	t.Setenv("AGENTHUB_PPROF_PASS", "secret")

	port := freePort(t)
	a := newAdminTestApp(port, "test-version-2")
	require.NoError(t, a.startAdminServer())
	t.Cleanup(func() { _ = a.AdminServer.Close() })

	addr := adminListenAddr(port)
	client := adminClient(addr)

	// 无认证 → 401。
	req, _ := http.NewRequest(http.MethodGet, "http://"+addr+"/debug/pprof/", nil)
	resp, err := client.Do(req)
	require.NoError(t, err)
	resp.Body.Close()
	require.Equal(t, http.StatusUnauthorized, resp.StatusCode, "pprof without credentials must 401")

	// 带认证 → 200。
	req, _ = http.NewRequest(http.MethodGet, "http://"+addr+"/debug/pprof/", nil)
	req.SetBasicAuth("admin", "secret")
	resp, err = client.Do(req)
	require.NoError(t, err)
	resp.Body.Close()
	require.Equal(t, http.StatusOK, resp.StatusCode)

	// metrics 无认证可用（独立于 debug Auth）。
	resp, err = client.Get("http://" + addr + "/metrics")
	require.NoError(t, err)
	resp.Body.Close()
	require.Equal(t, http.StatusOK, resp.StatusCode, "metrics must not require debug credentials")
}

// TestAdminServerBindFailureFatal: 端口被占用时 startAdminServer 返回错误，
// AdminServerUp 保持 0（不得短暂置 1）。
func TestAdminServerBindFailureFatal(t *testing.T) {
	t.Setenv("AGENTHUB_PPROF_USER", "")
	t.Setenv("AGENTHUB_PPROF_PASS", "")

	metrics.Register()
	// 占住端口。
	l, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	defer l.Close()
	port := l.Addr().(*net.TCPAddr).Port

	a := newAdminTestApp(port, "test-version-3")
	err = a.startAdminServer()
	require.Error(t, err, "bind failure must be returned synchronously")
	require.Contains(t, err.Error(), "bind failed")
	require.Nil(t, a.AdminServer, "no server object on bind failure")
	if metrics.AdminServerUp != nil {
		require.Equal(t, float64(0), testutil.ToFloat64(metrics.AdminServerUp), "AdminServerUp must stay 0 on bind failure")
	}
}

// TestAdminServerReportsRealVersion: /health 返回 a.Version（非硬编码 dev）。
func TestAdminServerReportsRealVersion(t *testing.T) {
	t.Setenv("AGENTHUB_PPROF_USER", "")
	t.Setenv("AGENTHUB_PPROF_PASS", "")

	port := freePort(t)
	a := newAdminTestApp(port, "v1.2.3+build42")
	require.NoError(t, a.startAdminServer())
	t.Cleanup(func() { _ = a.AdminServer.Close() })

	resp, err := adminClient(adminListenAddr(port)).Get("http://" + adminListenAddr(port) + "/health")
	require.NoError(t, err)
	defer resp.Body.Close()
	buf := make([]byte, 4096)
	n, _ := resp.Body.Read(buf)
	require.Contains(t, string(buf[:n]), "v1.2.3+build42", "/health must report the real build version")
	require.NotContains(t, string(buf[:n]), `"version":"dev"`)
}

// TestAdminServerShutdownClosesListener: Shutdown 后端口释放（listener 被正确关闭）。
func TestAdminServerShutdownClosesListener(t *testing.T) {
	t.Setenv("AGENTHUB_PPROF_USER", "")
	t.Setenv("AGENTHUB_PPROF_PASS", "")

	port := freePort(t)
	a := newAdminTestApp(port, "test-version-4")
	require.NoError(t, a.startAdminServer())

	// 等 Serve goroutine 注册 listener（避免 Shutdown 时 listener 未挂上的竞态）。
	addr := adminListenAddr(port)
	require.Eventually(t, func() bool {
		conn, err := net.DialTimeout("tcp", addr, 200*time.Millisecond)
		if err != nil {
			return false
		}
		conn.Close()
		return true
	}, 2*time.Second, 20*time.Millisecond)

	require.NoError(t, a.AdminServer.Shutdown(context.Background()))

	// 端口应可重新绑定。
	l, err := net.Listen("tcp", addr)
	require.NoError(t, err, "admin listener must be released after shutdown")
	l.Close()
}
