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
