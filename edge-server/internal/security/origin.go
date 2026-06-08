package security

import (
	"fmt"
	"net"
	"net/url"
	"regexp"
	"strings"
)

// NormalizeShellCommand strips extra whitespace and removes comments from a
// shell command string before dangerous-pattern matching. This prevents
// trivial evasion via whitespace padding or inline comments.
func NormalizeShellCommand(cmd string) string {
	cmd = strings.TrimSpace(cmd)
	// Collapse multiple whitespace characters into a single space.
	cmd = regexp.MustCompile(`\s+`).ReplaceAllString(cmd, " ")
	// Remove bash-style comments (# ...) that are not inside quotes.
	// Simple heuristic: strip from unquoted # to end of line.
	cmd = regexp.MustCompile(`(?:^|\s)#.*$`).ReplaceAllString(cmd, "")
	cmd = strings.TrimSpace(cmd)
	return cmd
}

// IsTrustedLocalHost reports whether a host (with optional port) is a trusted
// loopback address. Used to allow non-browser WebSocket clients that do not
// send an Origin header when connecting from localhost.
func IsTrustedLocalHost(host string) bool {
	host = strings.ToLower(host)
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	switch host {
	case "localhost", "127.0.0.1", "::1", "tauri.localhost":
		return true
	default:
		ip := net.ParseIP(host)
		return ip != nil && ip.IsLoopback()
	}
}

// IsTrustedLocalOrigin reports whether a browser Origin can control Local Edge.
func IsTrustedLocalOrigin(origin string) bool {
	return IsTrustedOrigin(origin, false)
}

// IsTrustedOrigin reports whether a browser Origin can control Edge.
// When remoteMode is true, only localhost origins are trusted by default.
// Remote browser origins must be passed through IsAllowedOrigin with an
// explicit allowlist.
func IsTrustedOrigin(origin string, remoteMode bool) bool {
	return IsAllowedOrigin(origin, remoteMode, nil)
}

// IsAllowedOrigin reports whether a browser Origin can control Edge under the
// supplied runtime mode and remote-origin allowlist.
func IsAllowedOrigin(origin string, remoteMode bool, allowedOrigins []string) bool {
	// Reject empty Origin: non-browser clients (curl, scripts) send no
	// Origin header, and the browser CORS spec always sends Origin for
	// cross-origin requests. Accepting empty Origin would bypass CORS.
	if origin == "" {
		return false
	}

	u, err := url.Parse(origin)
	if err != nil {
		return false
	}

	scheme := strings.ToLower(u.Scheme)
	host := strings.ToLower(u.Hostname())

	if scheme == "tauri" {
		return host == "" || host == "localhost" || host == "tauri.localhost"
	}

	if scheme != "http" && scheme != "https" {
		return false
	}

	switch host {
	case "localhost", "127.0.0.1", "::1", "tauri.localhost":
		return true
	}

	if !remoteMode {
		return false
	}

	normalizedOrigin := normalizeHTTPOrigin(u)
	for _, allowed := range allowedOrigins {
		if normalizedAllowed, ok := normalizeAllowedHTTPOrigin(allowed); ok && normalizedAllowed == normalizedOrigin {
			return true
		}
	}
	return false
}

func normalizeAllowedHTTPOrigin(origin string) (string, bool) {
	origin = strings.TrimSpace(origin)
	if origin == "" {
		return "", false
	}
	u, err := url.Parse(origin)
	if err != nil {
		return "", false
	}
	scheme := strings.ToLower(u.Scheme)
	if scheme != "http" && scheme != "https" {
		return "", false
	}
	if u.Host == "" || u.Path != "" || u.RawQuery != "" || u.Fragment != "" {
		return "", false
	}
	return normalizeHTTPOrigin(u), true
}

func normalizeHTTPOrigin(u *url.URL) string {
	return strings.ToLower(u.Scheme) + "://" + strings.ToLower(u.Host)
}

// ValidateLocalListenAddr rejects wildcard or non-loopback listen addresses.
// Local Edge exposes process-control APIs, so remote binding must wait for an
// explicit authenticated remote mode instead of relying on browser Origin checks.
func ValidateLocalListenAddr(addr string) error {
	return validateListenAddr(addr, false)
}

// ValidateRemoteListenAddr allows wildcard and non-loopback listen addresses
// for authenticated remote Edge deployments (SSH tunnel, Tailscale, cloud VM).
// Remote mode requires authentication to be configured.
func ValidateRemoteListenAddr(addr string) error {
	return validateListenAddr(addr, true)
}

func validateListenAddr(addr string, remoteMode bool) error {
	addr = strings.TrimSpace(addr)
	if addr == "" {
		return fmt.Errorf("listen address is required")
	}

	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return fmt.Errorf("listen address %q must be host:port: %w", addr, err)
	}
	host = strings.TrimSpace(strings.ToLower(host))
	if host == "" {
		if remoteMode {
			return nil // 0.0.0.0 is allowed in remote mode
		}
		return fmt.Errorf("listen address %q uses a wildcard host; use 127.0.0.1, ::1, or localhost", addr)
	}
	if host == "localhost" || host == "tauri.localhost" {
		return nil
	}

	ip := net.ParseIP(host)
	if ip == nil {
		if remoteMode {
			return nil // DNS hostnames allowed in remote mode
		}
		return fmt.Errorf("listen address %q host must be loopback, got %q", addr, host)
	}
	if !ip.IsLoopback() && !remoteMode {
		return fmt.Errorf("listen address %q host must be loopback, got %q", addr, host)
	}
	return nil
}
