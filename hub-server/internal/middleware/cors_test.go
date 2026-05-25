package middleware

import (
	"strings"
	"testing"
)

func TestCORSRejectsProductionLoopbackOrigin(t *testing.T) {
	t.Setenv("AGENTHUB_ENV", "production")
	t.Setenv("GIN_MODE", "")
	t.Setenv("AGENTHUB_CORS_ORIGINS", "https://hub.vectorcontrol.tech,http://localhost:5173")

	defer func() {
		if recovered := recover(); recovered == nil {
			t.Fatal("expected CORS startup to reject localhost origin in production")
		}
	}()

	CORS()
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
