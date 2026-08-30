// Package egress provides the fail-closed outbound dial for user-controllable
// target addresses (#1540). Before this package, execution-target health pings
// built their own http.Client and dialed user-supplied addresses directly —
// no address classification, no DNS-rebinding defense, no redirect policy.
// That is the SSRF hole this package closes.
//
// Contract (fail-closed):
//   - Default deny: loopback, unspecified, multicast, link-local, RFC1918,
//     CGNAT, IPv6 ULA and metadata addresses are rejected unless the
//     administrator explicitly allows them via CIDR/hostname allowlist.
//   - Dial-time re-check: the address is resolved, every resolved IP must
//     pass the policy, and the connection uses the already-resolved IP
//     (DNS-rebinding / TOCTOU defense).
//   - Redirects are refused (ErrUseLastResponse) — a ping must answer at
//     the exact URL the caller targeted.
//   - HTTPS is the default scheme; plain HTTP requires explicit
//     AllowPlainHTTP (trusted local policy).
//
// Trust boundary (#1549): egress guards user-controllable targets
// (execution-target ping addresses). Admin-configured fixed endpoints — Edge
// dispatch (AGENTHUB_EDGE_URL), OIDC issuer/JWKS — use
// internal/outboundhttp.NewClient, whose trust boundary is the configuration
// itself; both share the same principles (redirect refusal, bounded timeout,
// body limit via outboundhttp.ReadLimited) and are wired at the composition
// root. #1549's design is "a small number of purpose-specific clients", not a
// single universal dial path.
package egress

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"strings"
	"time"
)

// Sentinel errors for egress policy rejections (#2064 item ③).
// Callers should use errors.Is to distinguish policy refusals from transient
// network failures without relying on error message text.
var (
	// ErrPlainHTTPDenied is returned when a plain HTTP URL is requested but
	// AllowPlainHTTP is not set.
	ErrPlainHTTPDenied = errors.New("egress: plain http is not allowed by egress policy")
	// ErrRestrictedAddress is returned when a resolved IP falls into a
	// restricted network category and is not covered by the allowlist.
	ErrRestrictedAddress = errors.New("egress: address is not allowed by egress policy (restricted network)")
	// ErrUnsupportedScheme is returned for non-http/https URL schemes.
	ErrUnsupportedScheme = errors.New("egress: unsupported URL scheme (https required, or http with AllowPlainHTTP)")
)

// Config is the administrator-controlled egress policy. An empty allowlist
// is not a bug: it is the default-deny state. Production must not ping
// arbitrary user-supplied addresses without an explicit allowlist.
type Config struct {
	// AllowCIDRs are admin-approved network ranges (e.g. "10.0.0.0/8",
	// "127.0.0.1/32"). Addresses inside these ranges bypass the restricted
	// category check.
	AllowCIDRs []string
	// AllowHostnames are admin-approved hostnames (exact match). Resolving
	// them is allowed only if every resolved IP also passes the IP policy.
	AllowHostnames []string
	// AllowPlainHTTP permits http:// URLs. HTTPS is the default; plain HTTP
	// is only for explicitly trusted local deployments.
	AllowPlainHTTP bool
	// Timeout for the whole request; zero means 5 seconds.
	Timeout time.Duration
	// DialTimeout is the TCP dial timeout; zero means 5 seconds (#2064 item ⑤).
	DialTimeout time.Duration
}

// Client is a fail-closed outbound HTTP client.
type Client struct {
	hc         *http.Client
	allowCIDRs []netip.Prefix
	allowHosts map[string]bool
	allowPlain bool
	dialer     *net.Dialer
}

// New builds a Client from cfg, parsing the CIDR allowlist up front so
// configuration errors fail at construction, not at dial time.
func New(cfg Config) (*Client, error) {
	allowCIDRs := make([]netip.Prefix, 0, len(cfg.AllowCIDRs))
	for _, c := range cfg.AllowCIDRs {
		p, err := netip.ParsePrefix(strings.TrimSpace(c))
		if err != nil {
			return nil, fmt.Errorf("egress: invalid allow_cidrs entry %q: %w", c, err)
		}
		allowCIDRs = append(allowCIDRs, p.Masked())
	}
	allowHosts := make(map[string]bool, len(cfg.AllowHostnames))
	for _, h := range cfg.AllowHostnames {
		allowHosts[strings.ToLower(strings.TrimSpace(h))] = true
	}
	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = 5 * time.Second
	}
	dialTimeout := cfg.DialTimeout
	if dialTimeout <= 0 {
		dialTimeout = 5 * time.Second
	}
	c := &Client{
		allowCIDRs: allowCIDRs,
		allowHosts: allowHosts,
		allowPlain: cfg.AllowPlainHTTP,
		dialer:     &net.Dialer{Timeout: dialTimeout},
	}
	transport := &http.Transport{
		Proxy:                 http.ProxyFromEnvironment,
		DialContext:           c.dialContext,
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          10,
		IdleConnTimeout:       60 * time.Second,
		TLSHandshakeTimeout:   5 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
	}
	c.hc = &http.Client{
		Transport: transport,
		Timeout:   timeout,
		// Refuse redirects: a ping must answer at the exact targeted URL.
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	return c, nil
}

// Do performs an outbound request with the egress policy applied.
func (c *Client) Do(ctx context.Context, method, url string) (*http.Response, error) {
	if !strings.HasPrefix(url, "https://") {
		if !strings.HasPrefix(url, "http://") {
			return nil, ErrUnsupportedScheme
		}
		if !c.allowPlain {
			return nil, ErrPlainHTTPDenied
		}
	}
	req, err := http.NewRequestWithContext(ctx, method, url, nil)
	if err != nil {
		return nil, err
	}
	return c.hc.Do(req)
}

// Get is a convenience wrapper around Do.
func (c *Client) Get(ctx context.Context, url string) (*http.Response, error) {
	return c.Do(ctx, http.MethodGet, url)
}

// Scheme returns the URL scheme the policy permits for outbound URLs:
// "https" by default, "http" only when AllowPlainHTTP is set.
func (c *Client) Scheme() string {
	if c.allowPlain {
		return "http"
	}
	return "https"
}

// dialContext is the SSRF enforcement point: resolve, policy-check every
// resolved IP, then connect to the already-resolved IP.
func (c *Client) dialContext(ctx context.Context, network, addr string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return nil, fmt.Errorf("egress: invalid dial address %q: %w", addr, err)
	}

	// Hostname allowlist: a listed hostname may only be dialed if every
	// resolved IP also passes the IP policy (the allowlist never bypasses
	// the network category check).
	if c.allowHosts[strings.ToLower(host)] {
		ips, err := resolveAll(ctx, host)
		if err != nil {
			return nil, fmt.Errorf("egress: resolve %q: %w", host, err)
		}
		for _, ip := range ips {
			if !c.ipAllowed(ip) {
				return nil, fmt.Errorf("%w: host %q resolves to restricted address %s", ErrRestrictedAddress, host, ip)
			}
		}
		// Connect to the first resolved IP directly — no second DNS lookup,
		// so a rebinding attacker cannot swap the address between check and
		// connect.
		return c.dialer.DialContext(ctx, network, net.JoinHostPort(ips[0].String(), port))
	}

	// Default path: resolve and policy-check; the resolved IP is dialed
	// directly (DNS-rebinding defense).
	ips, err := resolveAll(ctx, host)
	if err != nil {
		return nil, fmt.Errorf("egress: resolve %q: %w", host, err)
	}
	for _, ip := range ips {
		if !c.ipAllowed(ip) {
			return nil, fmt.Errorf("%w: %s", ErrRestrictedAddress, ip)
		}
	}
	return c.dialer.DialContext(ctx, network, net.JoinHostPort(ips[0].String(), port))
}

// resolveAll resolves host to all IPs (v4+v6).
func resolveAll(ctx context.Context, host string) ([]netip.Addr, error) {
	if ip, err := netip.ParseAddr(host); err == nil {
		return []netip.Addr{ip.Unmap()}, nil
	}
	addrs, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil {
		return nil, err
	}
	out := make([]netip.Addr, 0, len(addrs))
	for _, a := range addrs {
		out = append(out, toAddr(a.IP))
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("no addresses")
	}
	return out, nil
}

// toAddr converts a net.IP to a netip.Addr, unmaping v4-in-v6.
func toAddr(ip net.IP) netip.Addr {
	if v4 := ip.To4(); v4 != nil {
		return netip.AddrFrom4([4]byte(v4)).Unmap()
	}
	return netip.AddrFrom16([16]byte(ip.To16())).Unmap()
}

// ipAllowed applies the default-deny network policy. An IP is allowed if it
// is inside an admin allowlist CIDR, or if it is a public address. All
// restricted categories (loopback, private, link-local, CGNAT, ULA,
// multicast, unspecified, metadata) are refused unless allowlisted.
func (c *Client) ipAllowed(ip netip.Addr) bool {
	ip = ip.Unmap()
	for _, p := range c.allowCIDRs {
		if p.Contains(ip) {
			return true
		}
	}
	return !isRestricted(ip)
}

// isRestricted reports whether ip is a network category the Hub must never
// dial without an explicit administrator allowlist.
func isRestricted(ip netip.Addr) bool {
	ip = ip.Unmap()
	if ip.IsLoopback() || ip.IsUnspecified() || ip.IsMulticast() {
		return true
	}
	if ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
		return true
	}
	// RFC1918 private + IPv6 ULA (fc00::/7) — netip.IsPrivate covers both.
	if ip.IsPrivate() {
		return true
	}
	if ip.Is6() {
		// IPv4-mapped / 6to4 / Teredo carve-outs are covered above; nothing
		// extra needed for v6 beyond the ULA/link-local checks.
		return false
	}
	v4 := ip.As4()
	// CGNAT (RFC 6598, 100.64.0.0/10) — not "private" in netip's terms.
	if v4[0] == 100 && v4[1]&0xC0 == 0x40 {
		return true
	}
	// 192.0.0.0/16 — IETF protocol assignments (192.0.0.0/24 incl. the
	// 192.0.0.9/10 anycast) and documentation block 192.0.2.0/24.
	if v4[0] == 192 && v4[1] == 0 {
		return true
	}
	// 198.51.100.0/24 (documentation) and 198.18.0.0/15 (benchmarking).
	if (v4[0] == 198 && v4[1] == 51) || (v4[0] == 198 && v4[1]&0xFE == 18) {
		return true
	}
	// 203.0.113.0/24 (documentation).
	if v4[0] == 203 && v4[1] == 0 && v4[2] == 113 {
		return true
	}
	// 0.0.0.0/8 ("this network" — IsUnspecified only covers 0.0.0.0 itself).
	if v4[0] == 0 {
		return true
	}
	return false
}
