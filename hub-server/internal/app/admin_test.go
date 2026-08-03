package app

// #1547 / #1584 — Admin server capability and lifecycle contract:
// observability does not depend on debug credentials; AdminServerUp reflects
// the real listener lifecycle; shutdown waits for the Serve owner to exit.

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

// newAdminTestApp builds a minimal App with a private listener seam that
// atomically binds 127.0.0.1:0. Production AdminPort=0 keeps its existing
// default-to-6060 semantics; tests read the actual address from AdminServer.
func newAdminTestApp(port int, version string) *App {
	return &App{
		Config:    &config.Config{Server: config.ServerConfig{AdminPort: port}},
		Version:   version,
		startTime: time.Now(),
		adminListen: func(network, _ string) (net.Listener, error) {
			return net.Listen(network, "127.0.0.1:0")
		},
	}
}

func adminClient() *http.Client {
	return &http.Client{Timeout: 2 * time.Second}
}

func shutdownAdminTestApp(t *testing.T, a *App) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	require.NoError(t, a.shutdownAdminServer(ctx))
}

// TestAdminServerMetricsAvailableWithoutDebugCredentials: 无 pprof 凭证时
// metrics/health 仍可用；pprof/config/state 路由不存在（404 fail-closed）。
func TestAdminServerMetricsAvailableWithoutDebugCredentials(t *testing.T) {
	t.Setenv("AGENTHUB_PPROF_USER", "")
	t.Setenv("AGENTHUB_PPROF_PASS", "")

	a := newAdminTestApp(0, "test-version-1")
	require.NoError(t, a.startAdminServer())
	t.Cleanup(func() { shutdownAdminTestApp(t, a) })
	require.NotNil(t, a.AdminServer, "admin server must start without debug credentials")

	addr := a.AdminServer.Addr
	client := adminClient()

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

	a := newAdminTestApp(0, "test-version-2")
	require.NoError(t, a.startAdminServer())
	t.Cleanup(func() { shutdownAdminTestApp(t, a) })

	addr := a.AdminServer.Addr
	client := adminClient()

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
	// 占住端口；这是唯一需要固定数字端口的测试。
	l, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	defer l.Close()
	port := l.Addr().(*net.TCPAddr).Port

	a := newAdminTestApp(port, "test-version-3")
	a.adminListen = nil // exercise the production bind address and failure path
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

	a := newAdminTestApp(0, "v1.2.3+build42")
	require.NoError(t, a.startAdminServer())
	t.Cleanup(func() { shutdownAdminTestApp(t, a) })

	resp, err := adminClient().Get("http://" + a.AdminServer.Addr + "/health")
	require.NoError(t, err)
	defer resp.Body.Close()
	buf := make([]byte, 4096)
	n, _ := resp.Body.Read(buf)
	require.Contains(t, string(buf[:n]), "v1.2.3+build42", "/health must report the real build version")
	require.NotContains(t, string(buf[:n]), `"version":"dev"`)
}

// TestAdminServerShutdownClosesListener proves the #1584 lifecycle boundary:
// shutdown is safe immediately after start and returns only after Serve exits.
func TestAdminServerShutdownClosesListener(t *testing.T) {
	t.Setenv("AGENTHUB_PPROF_USER", "")
	t.Setenv("AGENTHUB_PPROF_PASS", "")

	a := newAdminTestApp(0, "test-version-4")
	require.NoError(t, a.startAdminServer())
	addr := a.AdminServer.Addr

	// Do not Dial/Eventually here. A successful kernel connection does not
	// prove net/http has registered the listener; immediate shutdown is the
	// production race that must be safe.
	shutdownAdminTestApp(t, a)

	select {
	case <-a.adminServeDone:
	default:
		t.Fatal("shutdown returned before the admin Serve goroutine exited")
	}

	// The exact listener address must be reusable when shutdown returns.
	l, err := net.Listen("tcp", addr)
	require.NoError(t, err, "admin listener must be released after shutdown")
	require.NoError(t, l.Close())
	if metrics.AdminServerUp != nil {
		require.Equal(t, float64(0), testutil.ToFloat64(metrics.AdminServerUp), "AdminServerUp must be 0 after Serve exits")
	}
}

func TestAdminServerShutdownWaitsForLateServeRegistration(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	addr := listener.Addr().String()

	server := &http.Server{ReadHeaderTimeout: time.Second}
	serveDone := make(chan struct{})
	allowServe := make(chan struct{})
	shutdownStarted := make(chan struct{})
	server.RegisterOnShutdown(func() { close(shutdownStarted) })
	t.Cleanup(func() {
		select {
		case <-allowServe:
		default:
			close(allowServe)
		}
		_ = listener.Close()
	})

	a := &App{
		AdminServer:    server,
		adminServeDone: serveDone,
	}
	go func() {
		<-allowServe
		defer close(serveDone)
		_ = server.Serve(listener)
	}()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	result := make(chan error, 1)
	go func() { result <- a.shutdownAdminServer(ctx) }()

	// Shutdown has run while Serve is still deliberately unregistered.
	<-shutdownStarted
	select {
	case err := <-result:
		t.Fatalf("shutdown returned before late Serve exited: %v", err)
	default:
	}

	close(allowServe)
	require.NoError(t, <-result)

	l, err := net.Listen("tcp", addr)
	require.NoError(t, err, "late-registered listener must be released before shutdown returns")
	require.NoError(t, l.Close())
}

func TestAdminServerShutdownHonorsContext(t *testing.T) {
	done := make(chan struct{})
	a := &App{
		AdminServer:    &http.Server{ReadHeaderTimeout: time.Second},
		adminServeDone: done,
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	require.ErrorIs(t, a.shutdownAdminServer(ctx), context.Canceled)
}
