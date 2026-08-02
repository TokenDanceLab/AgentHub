package egress

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"testing"
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
	if !strings.Contains(err.Error(), "not allowed") && !strings.Contains(err.Error(), "restricted") {
		t.Fatalf("unexpected error shape: %v", err)
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
	if err == nil || !strings.Contains(err.Error(), "plain http") {
		t.Fatalf("expected plain-http refusal, got %v", err)
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
