package security

import (
	"strings"
	"testing"
)

func TestNormalizeShellCommand(t *testing.T) {
	tests := []struct {
		name string
		cmd  string
		want string
	}{
		{"trims whitespace", "  pnpm   test  ", "pnpm test"},
		{"collapses newlines and tabs", "go\ttest\n./...", "go test ./..."},
		{"strips trailing comment", "rm -rf ./tmp # cleanup", "rm -rf ./tmp"},
		{"strips full line comment", "# ignored", ""},
		{"keeps hash inside token", "echo value#tag", "echo value#tag"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := NormalizeShellCommand(tt.cmd); got != tt.want {
				t.Fatalf("NormalizeShellCommand(%q) = %q, want %q", tt.cmd, got, tt.want)
			}
		})
	}
}

func TestIsTrustedLocalOrigin(t *testing.T) {
	tests := []struct {
		name   string
		origin string
		want   bool
	}{
		{"empty origin rejected (non-browser client)", "", false},
		{"vite localhost", "http://localhost:5199", true},
		{"vite default port", "http://localhost:5173", true},
		{"loopback ip", "http://127.0.0.1:5199", true},
		{"ipv6 loopback", "http://[::1]:5199", true},
		{"tauri scheme", "tauri://localhost", true},
		{"tauri empty host", "tauri://", true},
		{"uppercase trusted origin", "HTTP://LOCALHOST:5173", true},
		{"tauri localhost host", "http://tauri.localhost", true},
		{"remote https", "https://example.com", false},
		{"remote subdomain", "https://localhost.example.com", false},
		{"file scheme", "file:///tmp/index.html", false},
		{"chrome extension scheme", "chrome-extension://abc", false},
		{"tauri remote host", "tauri://example.com", false},
		{"invalid url", "://bad", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := IsTrustedLocalOrigin(tt.origin)
			if got != tt.want {
				t.Fatalf("IsTrustedLocalOrigin(%q) = %v, want %v", tt.origin, got, tt.want)
			}
		})
	}
}

func TestIsTrustedLocalHost(t *testing.T) {
	tests := []struct {
		name string
		host string
		want bool
	}{
		{"localhost", "localhost", true},
		{"localhost with port", "localhost:3210", true},
		{"ipv4 loopback", "127.0.0.1:3210", true},
		{"ipv6 loopback", "[::1]:3210", true},
		{"tauri localhost", "tauri.localhost", true},
		{"uppercase localhost", "LOCALHOST:3210", true},
		{"lan ip", "192.168.1.20:3210", false},
		{"remote hostname", "edge.example.com:3210", false},
		{"empty host", "", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := IsTrustedLocalHost(tt.host)
			if got != tt.want {
				t.Fatalf("IsTrustedLocalHost(%q) = %v, want %v", tt.host, got, tt.want)
			}
		})
	}
}

func TestIsTrustedOriginRemoteMode(t *testing.T) {
	tests := []struct {
		name   string
		origin string
		want   bool
	}{
		{"https remote not trusted by default", "https://edge.example.com", false},
		{"http remote not trusted by default", "http://edge.example.com:3210", false},
		{"localhost not trusted by default", "http://localhost:5173", false},
		{"loopback ip not trusted by default", "http://127.0.0.1:5173", false},
		{"ipv6 loopback not trusted by default", "http://[::1]:5173", false},
		{"tauri localhost host not trusted by default", "https://tauri.localhost", false},
		{"empty origin rejected", "", false},
		{"invalid url rejected", "://bad", false},
		{"file scheme rejected", "file:///tmp/index.html", false},
		{"extension scheme rejected", "chrome-extension://abc", false},
		{"tauri local scheme rejected", "tauri://localhost", false},
		{"tauri remote host rejected", "tauri://edge.example.com", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := IsTrustedOrigin(tt.origin, true)
			if got != tt.want {
				t.Fatalf("IsTrustedOrigin(%q, true) = %v, want %v", tt.origin, got, tt.want)
			}
		})
	}
}

func TestIsAllowedOriginRemoteModeUsesExplicitAllowlist(t *testing.T) {
	allowed := []string{"https://app.example.com", "http://edge.example.com:3210", "http://localhost:5173", "https://tauri.localhost"}
	tests := []struct {
		name   string
		origin string
		want   bool
	}{
		{"listed https origin", "https://app.example.com", true},
		{"listed http origin", "http://edge.example.com:3210", true},
		{"listed localhost origin", "http://localhost:5173", true},
		{"listed tauri localhost http origin", "https://tauri.localhost", true},
		{"unlisted https origin", "https://evil.example", false},
		{"unlisted localhost port", "http://localhost:5174", false},
		{"unlisted loopback ip", "http://127.0.0.1:5173", false},
		{"unlisted ipv6 loopback", "http://[::1]:5173", false},
		{"same host different scheme", "http://app.example.com", false},
		{"same host different port", "http://edge.example.com:3211", false},
		{"tauri scheme cannot be allowed by remote http allowlist", "tauri://localhost", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := IsAllowedOrigin(tt.origin, true, allowed)
			if got != tt.want {
				t.Fatalf("IsAllowedOrigin(%q, true, allowed) = %v, want %v", tt.origin, got, tt.want)
			}
		})
	}
}

func TestIsAllowedOriginRemoteModeIgnoresInvalidAllowlistEntries(t *testing.T) {
	allowed := []string{"https://app.example.com/path", "chrome-extension://abc", "https://app.example.com"}

	if got := IsAllowedOrigin("https://app.example.com", true, allowed); !got {
		t.Fatal("IsAllowedOrigin rejected valid origin after invalid allowlist entries")
	}
	if got := IsAllowedOrigin("chrome-extension://abc", true, allowed); got {
		t.Fatal("IsAllowedOrigin accepted invalid allowlist entry")
	}
}

func TestValidateLocalListenAddr(t *testing.T) {
	tests := []struct {
		name       string
		addr       string
		wantErr    bool
		errSnippet string
	}{
		{"default loopback", "127.0.0.1:3210", false, ""},
		{"localhost", "localhost:3210", false, ""},
		{"ipv6 loopback", "[::1]:3210", false, ""},
		{"tauri localhost", "tauri.localhost:3210", false, ""},
		{"trimmed loopback", " 127.0.0.1:3210 ", false, ""},
		{"empty addr", "", true, "required"},
		{"wildcard host", ":3210", true, "wildcard"},
		{"ipv4 wildcard", "0.0.0.0:3210", true, "loopback"},
		{"ipv6 wildcard", "[::]:3210", true, "loopback"},
		{"lan ip", "192.168.1.10:3210", true, "loopback"},
		{"remote hostname", "edge.example.com:3210", true, "must be loopback"},
		{"missing port", "127.0.0.1", true, "host:port"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateLocalListenAddr(tt.addr)
			if tt.wantErr && err == nil {
				t.Fatalf("ValidateLocalListenAddr(%q) returned nil error", tt.addr)
			}
			if tt.errSnippet != "" && (err == nil || !strings.Contains(err.Error(), tt.errSnippet)) {
				t.Fatalf("ValidateLocalListenAddr(%q) error = %v, want snippet %q", tt.addr, err, tt.errSnippet)
			}
			if !tt.wantErr && err != nil {
				t.Fatalf("ValidateLocalListenAddr(%q) returned error: %v", tt.addr, err)
			}
		})
	}
}

func TestValidateRemoteListenAddr(t *testing.T) {
	tests := []struct {
		name       string
		addr       string
		wantErr    bool
		errSnippet string
	}{
		{"wildcard host", ":3210", false, ""},
		{"ipv4 wildcard", "0.0.0.0:3210", false, ""},
		{"ipv6 wildcard", "[::]:3210", false, ""},
		{"lan ip", "192.168.1.10:3210", false, ""},
		{"remote hostname", "edge.example.com:3210", false, ""},
		{"loopback remains valid", "127.0.0.1:3210", false, ""},
		{"empty addr", "", true, "required"},
		{"missing port", "edge.example.com", true, "host:port"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateRemoteListenAddr(tt.addr)
			if tt.wantErr && err == nil {
				t.Fatalf("ValidateRemoteListenAddr(%q) returned nil error", tt.addr)
			}
			if tt.errSnippet != "" && (err == nil || !strings.Contains(err.Error(), tt.errSnippet)) {
				t.Fatalf("ValidateRemoteListenAddr(%q) error = %v, want snippet %q", tt.addr, err, tt.errSnippet)
			}
			if !tt.wantErr && err != nil {
				t.Fatalf("ValidateRemoteListenAddr(%q) returned error: %v", tt.addr, err)
			}
		})
	}
}
