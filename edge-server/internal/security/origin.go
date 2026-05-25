package security

import (
	"fmt"
	"net"
	"net/url"
	"strings"
)

// IsTrustedLocalOrigin reports whether a browser Origin can control Local Edge.
func IsTrustedLocalOrigin(origin string) bool {
	if origin == "" {
		return true
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
	default:
		return false
	}
}

// ValidateLocalListenAddr rejects wildcard or non-loopback listen addresses.
// Local Edge exposes process-control APIs, so remote binding must wait for an
// explicit authenticated remote mode instead of relying on browser Origin checks.
func ValidateLocalListenAddr(addr string) error {
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
		return fmt.Errorf("listen address %q uses a wildcard host; use 127.0.0.1, ::1, or localhost", addr)
	}
	if host == "localhost" || host == "tauri.localhost" {
		return nil
	}

	ip := net.ParseIP(host)
	if ip == nil {
		return fmt.Errorf("listen address %q host must be loopback, got %q", addr, host)
	}
	if !ip.IsLoopback() {
		return fmt.Errorf("listen address %q host must be loopback, got %q", addr, host)
	}
	return nil
}
