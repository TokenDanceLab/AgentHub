package security

import (
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
