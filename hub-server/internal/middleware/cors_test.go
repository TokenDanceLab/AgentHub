package middleware

import (
	"strings"
	"testing"
)

func TestCORSRejectsProductionLoopbackOrigin(t *testing.T) {
	t.Setenv("AGENTHUB_CORS_ORIGINS", "http://localhost:5173")

	mw, err := CORS("production")
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
	t.Setenv("AGENTHUB_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")

	mw, err := CORS("development")
	if err != nil {
		t.Fatalf("CORS() returned unexpected error: %v", err)
	}
	if mw == nil {
		t.Fatal("expected non-nil middleware")
	}
}

func TestCORSRejectsWildcardInAllEnvironments(t *testing.T) {
	for _, env := range []string{"development", "staging", "production"} {
		t.Run(env, func(t *testing.T) {
			if err := validateCORSOriginsForEnvironment(env, []string{"*"}); err == nil {
				t.Fatal("wildcard CORS origin must be rejected")
			}
		})
	}
}

func TestCORSRejectsNonOriginShapes(t *testing.T) {
	for _, origin := range []string{
		"https://user@hub.example",
		"https://hub.example/path",
		"https://hub.example/",
		"https://hub.example?query=1",
		"https://hub.example#fragment",
		"file:///tmp/origin",
		"null",
	} {
		t.Run(origin, func(t *testing.T) {
			if err := validateCORSOriginsForEnvironment("development", []string{origin}); err == nil {
				t.Fatalf("non-origin CORS value must be rejected: %s", origin)
			}
		})
	}
}

func TestCORSRejectsDuplicates(t *testing.T) {
	err := validateCORSOriginsForEnvironment("development", []string{
		"http://localhost:5173",
		"http://localhost:5173",
	})
	if err == nil {
		t.Fatal("duplicate CORS origin must be rejected")
	}
}

func TestValidateCORSOriginsForEnvironmentRejectsLoopbackInProduction(t *testing.T) {
	origins := []string{
		"https://hub.vectorcontrol.tech",
		"https://localhost:5173",
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

func TestValidateCORSOriginsForEnvironmentRejectsPrivateProductionOrigins(t *testing.T) {
	for _, origin := range []string{
		"http://hub.example",
		"https://127.0.0.1",
		"https://[::1]",
		"https://10.0.0.1",
		"https://192.168.1.2",
		"https://[fd00::1]",
		"https://169.254.169.254",
		"https://0.0.0.0",
	} {
		t.Run(origin, func(t *testing.T) {
			if err := validateCORSOriginsForEnvironment("production", []string{origin}); err == nil {
				t.Fatalf("unsafe production CORS origin must be rejected: %s", origin)
			}
		})
	}
}

func TestValidateCORSOriginsForEnvironmentAllowsTauriCustomProtocol(t *testing.T) {
	if err := validateCORSOriginsForEnvironment("production", []string{"https://tauri.localhost"}); err != nil {
		t.Fatalf("Tauri custom-protocol origin must be allowed: %v", err)
	}
	if err := validateCORSOriginsForEnvironment("production", []string{"https://other.localhost"}); err == nil {
		t.Fatal("non-Tauri .localhost origin must be rejected in production")
	}
}
