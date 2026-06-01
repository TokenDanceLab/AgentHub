package middleware

import (
	"strings"
	"testing"
)

func TestCORSRejectsProductionLoopbackOrigin(t *testing.T) {
	// CORS uses log.Fatalf for init-time config validation, which exits the
	// process. This cannot be tested directly via recover(). The underlying
	// validation function is covered by TestValidateCORSOriginsForEnvironmentRejectsLoopbackInProduction.
	t.Skip("CORS middleware uses log.Fatalf (os.Exit) on config errors; cannot test via recover()")
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
