package egress

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// TestIsRestricted covers the network categories the Hub must never dial
// without an explicit admin allowlist (Issue #1540 requirement list).
func TestIsRestricted(t *testing.T) {
	tests := []struct {
		ip       string
		restrict bool
	}{
		// IPv4 loopback
		{"127.0.0.1", true},
		{"127.255.255.254", true},
		// IPv6 loopback
		{"::1", true},
		// RFC1918 private
		{"10.0.0.1", true},
		{"172.16.0.1", true},
		{"172.31.255.254", true},
		{"192.168.1.1", true},
		// CGNAT (RFC 6598)
		{"100.64.0.1", true},
		{"100.127.255.254", true},
		{"100.128.0.1", false}, // outside 100.64/10
		// Link-local
		{"169.254.0.1", true},
		{"169.254.169.254", true}, // cloud metadata (v4)
		{"fe80::1", true},
		// IPv6 ULA — includes AWS metadata v6 fd00:ec2::254
		{"fc00::1", true},
		{"fd00:ec2::254", true},
		// Multicast / unspecified
		{"224.0.0.1", true},
		{"ff02::1", true},
		{"0.0.0.0", true},
		{"::", true},
		// Documentation / special purpose
		{"192.0.2.1", true},    // TEST-NET-1
		{"198.51.100.1", true}, // TEST-NET-2
		{"203.0.113.1", true},  // TEST-NET-3
		{"198.18.0.1", true},   // benchmarking
		{"192.0.0.9", true},    // anycast
		{"0.1.2.3", true},      // 0/8
		{"192.168.1.1", true},  // dup sanity
		// Public addresses must pass
		{"8.8.8.8", false},
		{"1.1.1.1", false},
		{"172.32.0.1", false}, // outside 172.16/12
		{"2606:4700:4700::1111", false},
	}
	for _, tt := range tests {
		ip := netip.MustParseAddr(tt.ip)
		if got := isRestricted(ip); got != tt.restrict {
			t.Errorf("isRestricted(%s) = %v, want %v", tt.ip, got, tt.restrict)
		}
	}
}

// TestClientDefaultDenyLocal proves the default (empty allowlist) policy
// refuses loopback/private dials — the core fail-closed decision.
func TestClientDefaultDenyLocal(t *testing.T) {
	c, err := New(Config{})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(srv.Close)

	_, err = c.Get(context.Background(), srv.URL)
	if err == nil {
		t.Fatalf("Get to %s succeeded — default policy must deny local dials", srv.URL)
	}
	// Default-deny may refuse at the scheme check (plain http) or at the
	// address check (restricted network); either is a valid policy refusal.
	if !errors.Is(err, ErrRestrictedAddress) && !errors.Is(err, ErrPlainHTTPDenied) {
		t.Fatalf("expected policy refusal (ErrRestrictedAddress or ErrPlainHTTPDenied), got: %v", err)
	}
}

// TestClientAllowlistPermitsLocal proves an explicit admin CIDR allowlist
// restores dialing to the allowed network (test-only policy).
func TestClientAllowlistPermitsLocal(t *testing.T) {
	c, err := New(Config{
		AllowCIDRs:     []string{"127.0.0.0/8"},
		AllowPlainHTTP: true,
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	var gotPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		w.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(srv.Close)

	resp, err := c.Get(context.Background(), srv.URL+"/v1/health")
	if err != nil {
		t.Fatalf("Get with allowlist: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", resp.StatusCode)
	}
	if gotPath != "/v1/health" {
		t.Fatalf("path = %q, want /v1/health", gotPath)
	}
}

// TestClientRefusesRedirects proves redirects are not followed (ping must
// answer at the exact targeted URL).
func TestClientRefusesRedirects(t *testing.T) {
	c, err := New(Config{
		AllowCIDRs:     []string{"127.0.0.0/8"},
		AllowPlainHTTP: true,
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/elsewhere", http.StatusFound)
	}))
	t.Cleanup(srv.Close)

	resp, err := c.Get(context.Background(), srv.URL)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusFound {
		t.Fatalf("status = %d, want 302 (redirect must NOT be followed)", resp.StatusCode)
	}
}

// TestClientRefusesPlainHTTPWithoutOptIn proves https is the default scheme.
func TestClientRefusesPlainHTTPWithoutOptIn(t *testing.T) {
	c, err := New(Config{AllowCIDRs: []string{"127.0.0.0/8"}})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	_, err = c.Get(context.Background(), "http://127.0.0.1:1/v1/health")
	if err == nil || !errors.Is(err, ErrPlainHTTPDenied) {
		t.Fatalf("expected ErrPlainHTTPDenied, got %v", err)
	}
}

// TestClientRejectsRestrictedResolvedIPs simulates DNS rebinding: the host
// resolves to a mix of public and private addresses — any restricted answer
// must refuse the dial.
func TestClientRejectsRestrictedResolvedIPs(t *testing.T) {
	origResolver := net.DefaultResolver
	defer func() { net.DefaultResolver = origResolver }()
	net.DefaultResolver = &net.Resolver{
		PreferGo: true,
		Dial: func(ctx context.Context, network, address string) (net.Conn, error) {
			return nil, nil
		},
	}
	// A resolver returning private + public for "evil.example" is not
	// reachable via net.Resolver hooks; instead test the policy function
	// directly: every IP of the host must pass.
	c, err := New(Config{})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	// public only -> allowed
	for _, ip := range []netip.Addr{netip.MustParseAddr("8.8.8.8")} {
		if !c.ipAllowed(ip) {
			t.Fatalf("public IP %s must be allowed by default policy", ip)
		}
	}
	// private -> denied even when a public sibling exists (defense in depth)
	if c.ipAllowed(netip.MustParseAddr("10.0.0.1")) {
		t.Fatalf("private IP must be denied")
	}
}

// TestClientRejectsHostnameToPrivate proves hostname allowlisting never
// bypasses the IP category check (dialing "localhost" with the hostname
// allowlisted but no CIDR still refuses loopback).
func TestClientRejectsHostnameToPrivate(t *testing.T) {
	c, err := New(Config{AllowHostnames: []string{"localhost"}, AllowPlainHTTP: true})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(srv.Close)
	// srv.URL is 127.0.0.1:port — rewrite host to "localhost" to force the
	// hostname path while still hitting the same listener.
	rebound := "http://localhost" + strings.TrimPrefix(srv.URL, "http://127.0.0.1")
	_, err = c.Get(context.Background(), rebound)
	if err == nil {
		t.Fatalf("dialing localhost via hostname allowlist must still be refused (resolves to loopback)")
	}
}

// TestNewRejectsBadCIDR proves configuration errors fail at construction.
func TestNewRejectsBadCIDR(t *testing.T) {
	_, err := New(Config{AllowCIDRs: []string{"not-a-cidr"}})
	if err == nil {
		t.Fatalf("New with bad CIDR must fail")
	}
}

// TestNewAppliesDefaultTimeout 固化 Config.Timeout 的默认行为：
// 零值回退 5s 默认；显式正值原样采用（审计维度 1：默认超时存在）。
func TestNewAppliesDefaultTimeout(t *testing.T) {
	c, err := New(Config{})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if c.hc.Timeout != 5*time.Second {
		t.Errorf("default timeout = %v, want 5s", c.hc.Timeout)
	}
	c2, err := New(Config{Timeout: 2 * time.Second})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if c2.hc.Timeout != 2*time.Second {
		t.Errorf("explicit timeout = %v, want 2s", c2.hc.Timeout)
	}
}

// TestSchemeMatchesPolicy 证明 Scheme() 与 AllowPlainHTTP 始终一致：
// executiontarget.pingEdgeServer 用该返回值拼接 ping URL。
func TestSchemeMatchesPolicy(t *testing.T) {
	c, err := New(Config{})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if got := c.Scheme(); got != "https" {
		t.Errorf("default Scheme() = %q, want https", got)
	}
	c2, err := New(Config{AllowPlainHTTP: true})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if got := c2.Scheme(); got != "http" {
		t.Errorf("AllowPlainHTTP Scheme() = %q, want http", got)
	}
}

// TestDoRejectsUnsupportedSchemes 证明 scheme 关卡 fail-closed：
// 非 https（或显式 opt-in 的 http）一律在拨号前拒绝，
// 包括大写 HTTP（前缀匹配区分大小写，无绕过）。
func TestDoRejectsUnsupportedSchemes(t *testing.T) {
	c, err := New(Config{})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	for _, u := range []string{"ftp://192.0.2.1/", "HTTP://127.0.0.1/", "https:/malformed", ""} {
		_, err := c.Do(context.Background(), http.MethodGet, u)
		if err == nil || !strings.Contains(err.Error(), "unsupported URL scheme") {
			t.Errorf("Do(%q) error = %v, want unsupported-scheme refusal", u, err)
		}
	}
}

// TestDoRespectsCallerContext 证明调用方 ctx 取消会传播进请求生命周期
// （审计维度 1：尊重调用方 ctx，egress 不吞掉也不替换它）。
func TestDoRespectsCallerContext(t *testing.T) {
	c, err := New(Config{AllowCIDRs: []string{"127.0.0.0/8"}, AllowPlainHTTP: true})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		<-r.Context().Done()
	}))
	t.Cleanup(srv.Close)

	ctx, cancel := context.WithCancel(context.Background())
	errCh := make(chan error, 1)
	go func() {
		_, err := c.Get(ctx, srv.URL)
		errCh <- err
	}()
	cancel()
	select {
	case err := <-errCh:
		if err == nil {
			t.Fatal("Get returned nil error after ctx cancel")
		}
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("error = %v, want context.Canceled", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("Get did not return after ctx cancel")
	}
}

// TestClientTimeoutEnforced 证明 Config.Timeout 是整个请求的截止时间：
// 永不响应的慢服务器得到 net.Error 超时错误，而不是无限挂起。
func TestClientTimeoutEnforced(t *testing.T) {
	c, err := New(Config{
		AllowCIDRs:     []string{"127.0.0.0/8"},
		AllowPlainHTTP: true,
		Timeout:        200 * time.Millisecond,
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		<-r.Context().Done()
	}))
	t.Cleanup(srv.Close)

	_, err = c.Get(context.Background(), srv.URL)
	if err == nil {
		t.Fatal("Get to a never-responding server succeeded, want timeout error")
	}
	var ne net.Error
	if !errors.As(err, &ne) || !ne.Timeout() {
		t.Fatalf("error = %v, want net.Error with Timeout()=true", err)
	}
}

// TestNoRetryOnServerError 证明无应用层重试语义：
// 5xx 原样返回给调用方（err=nil + 响应），服务端恰好收到 1 次请求。
func TestNoRetryOnServerError(t *testing.T) {
	c, err := New(Config{AllowCIDRs: []string{"127.0.0.0/8"}, AllowPlainHTTP: true})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	var hits int64
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt64(&hits, 1)
		w.WriteHeader(http.StatusInternalServerError)
	}))
	t.Cleanup(srv.Close)

	resp, err := c.Get(context.Background(), srv.URL)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 surfaced untransformed", resp.StatusCode)
	}
	if got := atomic.LoadInt64(&hits); got != 1 {
		t.Fatalf("server hits = %d, want exactly 1 (no retry)", got)
	}
}

// TestCrossHostRedirectRefused 证明指向受限地址（云 metadata）的跨主机
// 302 不会被跟随：调用方拿到的就是 302 本身（审计维度 4：重定向即止）。
func TestCrossHostRedirectRefused(t *testing.T) {
	c, err := New(Config{AllowCIDRs: []string{"127.0.0.0/8"}, AllowPlainHTTP: true})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "http://169.254.169.254/latest/meta-data/", http.StatusFound)
	}))
	t.Cleanup(srv.Close)

	resp, err := c.Get(context.Background(), srv.URL)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusFound {
		t.Fatalf("status = %d, want 302 (cross-host redirect must not be followed)", resp.StatusCode)
	}
	if loc := resp.Header.Get("Location"); !strings.Contains(loc, "169.254.169.254") {
		t.Fatalf("Location = %q, want the untouched redirect target", loc)
	}
}

// TestDialContextPolicyAtDialTime 直接演练拨号时地址校验（IP 字面量，
// 跳过 DNS）：受限 IP 拒绝、allowlist IP 真实连通、畸形地址 fail-closed。
func TestDialContextPolicyAtDialTime(t *testing.T) {
	deny, err := New(Config{})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if _, err := deny.dialContext(context.Background(), "tcp", "127.0.0.1:80"); err == nil || !errors.Is(err, ErrRestrictedAddress) {
		t.Fatalf("dialContext to loopback error = %v, want policy refusal", err)
	}
	if _, err := deny.dialContext(context.Background(), "tcp", "no-port"); err == nil || !strings.Contains(err.Error(), "invalid dial address") {
		t.Fatalf("dialContext with malformed addr error = %v, want invalid-dial refusal", err)
	}

	allow, err := New(Config{AllowCIDRs: []string{"127.0.0.0/8"}, AllowPlainHTTP: true})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(srv.Close)
	addr := strings.TrimPrefix(srv.URL, "http://")
	conn, err := allow.dialContext(context.Background(), "tcp", addr)
	if err != nil {
		t.Fatalf("dialContext with allowlisted IP: %v", err)
	}
	conn.Close()
}

// TestHostnameAllowlistDialsResolvedIP 证明主机名 allowlist 分支的完整
// 成功路径：resolve → 逐 IP 策略校验 → 直连已解析 IP（大小写不敏感）。
// 与 TestClientRejectsHostnameToPrivate（无 CIDR allowlist → 拒绝）互补。
// localhost 可能解析出 127.0.0.1 和/或 ::1，因此 allowlist 同时覆盖两者，
// 服务端用双栈监听器承接任一 loopback 族地址。
func TestHostnameAllowlistDialsResolvedIP(t *testing.T) {
	c, err := New(Config{
		AllowHostnames: []string{"LocalHost"},
		AllowCIDRs:     []string{"127.0.0.0/8", "::1/128"},
		AllowPlainHTTP: true,
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	ln, err := net.Listen("tcp", "[::]:0") // dual-stack loopback listener
	if err != nil {
		t.Skipf("dual-stack listener unavailable: %v", err)
	}
	srv := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	srv.Listener = ln
	srv.Start()
	t.Cleanup(srv.Close)

	_, port, err := net.SplitHostPort(ln.Addr().String())
	if err != nil {
		t.Fatalf("SplitHostPort: %v", err)
	}
	resp, err := c.Get(context.Background(), "http://localhost:"+port)
	if err != nil {
		t.Fatalf("Get via allowlisted hostname: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", resp.StatusCode)
	}
}

// TestIsRestrictedV4MappedV6 证明 v4-mapped v6 地址按解映射后的 v4 分类。
func TestIsRestrictedV4MappedV6(t *testing.T) {
	tests := []struct {
		ip       string
		restrict bool
	}{
		{"::ffff:127.0.0.1", true},
		{"::ffff:10.0.0.1", true},
		{"::ffff:169.254.169.254", true},
		{"::ffff:8.8.8.8", false},
	}
	for _, tt := range tests {
		ip := netip.MustParseAddr(tt.ip)
		if got := isRestricted(ip); got != tt.restrict {
			t.Errorf("isRestricted(%s) = %v, want %v", tt.ip, got, tt.restrict)
		}
	}
}

// TestDoRejectsUnparseableURL 证明通过 scheme 关卡但无法解析的 URL
// 在构造请求阶段即失败（不会进入拨号）。
func TestDoRejectsUnparseableURL(t *testing.T) {
	c, err := New(Config{})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	_, err = c.Do(context.Background(), http.MethodGet, "https://192.0.2.1:badport/")
	if err == nil {
		t.Fatal("Do with unparseable URL must fail")
	}
}

// TestDialContextResolveFailure 证明 DNS 解析失败时 fail-closed：
// 通过可替换的 net.DefaultResolver 注入解析失败（进程内，无真实 DNS）。
func TestDialContextResolveFailure(t *testing.T) {
	origResolver := net.DefaultResolver
	t.Cleanup(func() { net.DefaultResolver = origResolver })
	net.DefaultResolver = &net.Resolver{
		PreferGo: true,
		Dial: func(ctx context.Context, network, address string) (net.Conn, error) {
			return nil, errors.New("injected resolver failure")
		},
	}

	c, err := New(Config{})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	_, err = c.dialContext(context.Background(), "tcp", "nosuchhost.invalid:443")
	if err == nil || !strings.Contains(err.Error(), "resolve") {
		t.Fatalf("dialContext error = %v, want resolve failure", err)
	}
}

// TestDialTimeoutDefaultAndConfigurable proves that DialTimeout defaults to 5s
// when zero and honors an explicit override (#2064 item ⑤).
func TestDialTimeoutDefaultAndConfigurable(t *testing.T) {
	// Default: DialTimeout should be 5s.
	c, err := New(Config{})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if c.dialer.Timeout != 5*time.Second {
		t.Fatalf("default dialer.Timeout = %v, want 5s", c.dialer.Timeout)
	}

	// Custom: explicit DialTimeout must be honored.
	c2, err := New(Config{DialTimeout: 10 * time.Second})
	if err != nil {
		t.Fatalf("New with DialTimeout: %v", err)
	}
	if c2.dialer.Timeout != 10*time.Second {
		t.Fatalf("custom dialer.Timeout = %v, want 10s", c2.dialer.Timeout)
	}
}
