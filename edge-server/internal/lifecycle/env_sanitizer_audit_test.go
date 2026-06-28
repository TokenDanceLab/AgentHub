package lifecycle

import (
	"strings"
	"testing"
)

// --- EnvFilterAudit tests ---

func TestEnvFilterAudit_CountsSensitiveVars(t *testing.T) {
	t.Setenv("ANTHROPIC_API_KEY", "sk-ant-secret")
	t.Setenv("OPENAI_API_KEY", "sk-openai-secret")
	t.Setenv("GITHUB_TOKEN", "ghp-secret")
	t.Setenv("JWT_SECRET", "jwt-secret")
	t.Setenv("PATH", "/usr/bin")

	_, audit := SanitizedEnv(nil, nil)

	if audit.SensitiveVars < 4 {
		t.Errorf("SensitiveVars = %d, want >= 4", audit.SensitiveVars)
	}
	if audit.TotalVars < 5 {
		t.Errorf("TotalVars = %d, want >= 5", audit.TotalVars)
	}
}

func TestEnvFilterAudit_CountsNotWhitelisted(t *testing.T) {
	// Set vars that are neither sensitive nor whitelisted.
	t.Setenv("MY_CUSTOM_APP_CONFIG", "/opt/myapp")
	t.Setenv("RANDOM_UNLISTED_VAR", "some-value")

	_, audit := SanitizedEnv(nil, nil)

	if audit.NotWhitelisted < 2 {
		t.Errorf("NotWhitelisted = %d, want >= 2", audit.NotWhitelisted)
	}
}

func TestEnvFilterAudit_PassedEqualsTotalMinusFiltered(t *testing.T) {
	t.Setenv("ANTHROPIC_API_KEY", "sk-ant-secret")
	t.Setenv("MY_UNLISTED_VAR", "value")
	t.Setenv("PATH", "/usr/bin")

	_, audit := SanitizedEnv(nil, nil)

	expectedPassed := audit.TotalVars - audit.SensitiveVars - audit.NotWhitelisted
	if audit.PassedVars != expectedPassed {
		t.Errorf("PassedVars = %d, want %d (total=%d - sensitive=%d - not_whitelisted=%d)",
			audit.PassedVars, expectedPassed, audit.TotalVars, audit.SensitiveVars, audit.NotWhitelisted)
	}
}

func TestEnvFilterAudit_ExtraEnvIncrementsCounts(t *testing.T) {
	extraEnv := []string{
		"EXTRA_A=1",
		"EXTRA_B=2",
		"EXTRA_C=3",
	}

	_, audit := SanitizedEnv(nil, extraEnv)

	// Extra env adds to total and passed counts.
	if audit.TotalVars < 3 {
		t.Errorf("TotalVars = %d, want >= 3 (extra env contributions)", audit.TotalVars)
	}
	if audit.PassedVars < 3 {
		t.Errorf("PassedVars = %d, want >= 3 (extra env contributions)", audit.PassedVars)
	}
}

func TestEnvFilterAudit_ProfileEnv_SetsPassedEqualsTotal(t *testing.T) {
	profileEnv := []string{
		"PATH=/custom/bin",
		"CUSTOM_VAR=hello",
		"MY_TOKEN=should-pass-through",
	}
	extraEnv := []string{"EXTRA=value"}

	_, audit := SanitizedEnv(profileEnv, extraEnv)

	// When profileEnv is non-nil, filtering is bypassed entirely.
	// All vars (profile + extra) count as passed.
	if audit.TotalVars != 4 {
		t.Errorf("TotalVars = %d, want 4 (3 profile + 1 extra)", audit.TotalVars)
	}
	if audit.PassedVars != audit.TotalVars {
		t.Errorf("PassedVars = %d, want %d (all pass through when profileEnv is non-nil)",
			audit.PassedVars, audit.TotalVars)
	}
	if audit.SensitiveVars != 0 {
		t.Errorf("SensitiveVars = %d, want 0 (profile env bypasses filtering)", audit.SensitiveVars)
	}
	if audit.NotWhitelisted != 0 {
		t.Errorf("NotWhitelisted = %d, want 0 (profile env bypasses filtering)", audit.NotWhitelisted)
	}
}

func TestEnvFilterAudit_FilteredKeysNeverContainsValues(t *testing.T) {
	t.Setenv("ANTHROPIC_API_KEY", "sk-ant-very-secret-value-12345")
	t.Setenv("DATABASE_URL", "postgres://user:password@localhost/db")
	t.Setenv("PATH", "/usr/bin")

	_, audit := SanitizedEnv(nil, nil)

	for _, key := range audit.FilteredKeys {
		// Key names are uppercase by convention; values are never in FilteredKeys.
		if strings.Contains(key, "sk-ant") || strings.Contains(key, "postgres") ||
			strings.Contains(key, "password") || strings.Contains(key, "secret-value") {
			t.Errorf("FilteredKeys contains a value, not a key name: %q", key)
		}
	}

	// Verify the sensitive keys appear by name (not value).
	foundAPI := false
	foundDB := false
	for _, key := range audit.FilteredKeys {
		if key == "ANTHROPIC_API_KEY" {
			foundAPI = true
		}
		if key == "DATABASE_URL" {
			foundDB = true
		}
	}
	if !foundAPI {
		t.Error("FilteredKeys does not include ANTHROPIC_API_KEY")
	}
	if !foundDB {
		t.Error("FilteredKeys does not include DATABASE_URL")
	}
}

func TestEnvFilterAudit_ZeroFilteredKeysWhenAllPass(t *testing.T) {
	// The parent environment always has many vars, so we cannot guarantee zero
	// filtered keys. Instead, verify that FilteredKeys contains only key names
	// (uppercase identifiers) and never contains values or '=' characters.
	// Also verify that whitelisted vars we explicitly set do NOT appear in
	// FilteredKeys.

	t.Setenv("PATH", "/usr/bin")
	t.Setenv("HOME", "/home/testuser")
	t.Setenv("USER", "testuser")
	t.Setenv("LANG", "en_US.UTF-8")

	_, audit := SanitizedEnv(nil, nil)

	// Whitelisted vars we set should NOT appear in FilteredKeys.
	for _, key := range audit.FilteredKeys {
		if key == "PATH" || key == "HOME" || key == "USER" || key == "LANG" {
			t.Errorf("whitelisted var %q unexpectedly in FilteredKeys", key)
		}
		// Never contains value data.
		if strings.Contains(key, "=") {
			t.Errorf("FilteredKeys contains value data: %q", key)
		}
	}

	// PassedVars should include our whitelisted vars.
	if audit.PassedVars < 4 {
		t.Errorf("PassedVars = %d, want >= 4 (PATH, HOME, USER, LANG)", audit.PassedVars)
	}
}
