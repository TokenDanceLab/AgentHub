package security

import "testing"

func TestIsTrustedLocalOrigin(t *testing.T) {
	tests := []struct {
		name   string
		origin string
		want   bool
	}{
		{"empty origin for local tools", "", true},
		{"vite localhost", "http://localhost:5199", true},
		{"vite default port", "http://localhost:5173", true},
		{"loopback ip", "http://127.0.0.1:5199", true},
		{"ipv6 loopback", "http://[::1]:5199", true},
		{"tauri scheme", "tauri://localhost", true},
		{"tauri localhost host", "http://tauri.localhost", true},
		{"remote https", "https://example.com", false},
		{"remote subdomain", "https://localhost.example.com", false},
		{"file scheme", "file:///tmp/index.html", false},
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
