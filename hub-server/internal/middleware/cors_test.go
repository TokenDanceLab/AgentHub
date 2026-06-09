package middleware

import (
	"strings"
	"testing"
)

func TestCORSRejectsProductionLoopbackOrigin(t *testing.T) {
	t.Setenv("AGENTHUB_ENV", "production")
	t.Setenv("AGENTHUB_CORS_ORIGINS", "http://localhost:5173")

	mw, err := CORS()
	if err == nil {
		t.Fatal("expected CORS() to return error for loopback in production")
	}
	if mw != nil {
		t.Fatal("expected nil middleware on error")
	}
	if !strings.Contains(err.Error(), "CORS configuration error") {
		t.Fatalf("error should mention CORS configuration error, got: %v", err)
	}
}

func TestCORSReturnsMiddlewareOnValidConfig(t *testing.T) {
	t.Setenv("AGENTHUB_ENV", "development")
	t.Setenv("AGENTHUB_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")

	mw, err := CORS()
	if err != nil {
		t.Fatalf("CORS() returned unexpected error: %v", err)
	}
	if mw == nil {
		t.Fatal("expected non-nil middleware")
	}
}

func TestValidateCORSOriginsForEnvironmentRejectsLoopbackInProduction(t *testing.T) {
	origins := []string{
		"https://hub.vectorcontrol.tech",
		"http://localhost:5173",
	}

	err := validateCORSOriginsForEnvironment("production", origins)
	if err == nil {
		t.Fatal("expected production CORS validation to reject localhost origin")
	}
	if !strings.Contains(err.Error(), "localhost") {
		t.Fatalf("error %q should mention rejected origin", err)
	}
}

func TestValidateCORSOriginsForEnvironmentAllowsLoopbackOutsideProduction(t *testing.T) {
	origins := []string{
		"https://hub.vectorcontrol.tech",
		"http://127.0.0.1:5173",
		"http://[::1]:5173",
	}

	if err := validateCORSOriginsForEnvironment("development", origins); err != nil {
		t.Fatalf("development CORS validation returned error: %v", err)
	}
}
