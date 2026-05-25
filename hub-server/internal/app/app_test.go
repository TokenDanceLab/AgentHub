package app

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAdminListenAddrUsesLoopback(t *testing.T) {
	tests := []struct {
		name string
		port int
		want string
	}{
		{name: "default", port: 0, want: "127.0.0.1:6060"},
		{name: "custom", port: 9090, want: "127.0.0.1:9090"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := adminListenAddr(tt.port); got != tt.want {
				t.Fatalf("adminListenAddr(%d) = %q, want %q", tt.port, got, tt.want)
			}
		})
	}
}

func TestAdminMuxRequiresBasicAuthForMetricsAndPprof(t *testing.T) {
	handler := pprofBasicAuth(newAdminMux(), "admin", "secret")

	for _, path := range []string{"/metrics", "/debug/pprof/"} {
		t.Run(path+" without auth", func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, path, nil)
			rec := httptest.NewRecorder()

			handler.ServeHTTP(rec, req)

			if rec.Code != http.StatusUnauthorized {
				t.Fatalf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
			}
			if got := rec.Header().Get("WWW-Authenticate"); got != `Basic realm="pprof"` {
				t.Fatalf("WWW-Authenticate = %q, want pprof realm", got)
			}
		})

		t.Run(path+" with wrong auth", func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, path, nil)
			req.SetBasicAuth("admin", "wrong")
			rec := httptest.NewRecorder()

			handler.ServeHTTP(rec, req)

			if rec.Code != http.StatusUnauthorized {
				t.Fatalf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
			}
		})

		t.Run(path+" with correct auth", func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, path, nil)
			req.SetBasicAuth("admin", "secret")
			rec := httptest.NewRecorder()

			handler.ServeHTTP(rec, req)

			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
			}
		})
	}
}
