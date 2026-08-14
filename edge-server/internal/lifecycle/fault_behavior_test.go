package lifecycle

import (
	"testing"
	"time"
)

// ── Behavioral tests for FaultEscalationConfigFromEnv ──────────────────────
// These tests use os.Setenv to configure the process environment and verify
// that FaultEscalationConfigFromEnv reads the correct values. They complement
// the unit-level ShouldRetry decision tests with real env-var-driven scenarios.

func TestFaultEscalationConfigFromEnv_Behavior_DefaultsWhenEnvEmpty(t *testing.T) {
	// No env vars set — returns DefaultFaultEscalationConfig.
	cfg := FaultEscalationConfigFromEnv()

	if !cfg.Enabled {
		t.Error("Enabled should default to true")
	}
	if cfg.MaxRetries != 1 {
		t.Errorf("MaxRetries = %d, want 1", cfg.MaxRetries)
	}
	if cfg.EscalationTimeout != 30*time.Second {
		t.Errorf("EscalationTimeout = %v, want 30s", cfg.EscalationTimeout)
	}
}

func TestFaultEscalationConfigFromEnv_Behavior_ExplicitlyDisabled_False(t *testing.T) {
	t.Setenv("AGENTHUB_FAULT_ESCALATION_ENABLED", "false")
	cfg := FaultEscalationConfigFromEnv()

	if cfg.Enabled {
		t.Error("Enabled should be false when env is 'false'")
	}
}

func TestFaultEscalationConfigFromEnv_Behavior_ExplicitlyDisabled_Zero(t *testing.T) {
	t.Setenv("AGENTHUB_FAULT_ESCALATION_ENABLED", "0")
	cfg := FaultEscalationConfigFromEnv()

	if cfg.Enabled {
		t.Error("Enabled should be false when env is '0'")
	}
}

func TestFaultEscalationConfigFromEnv_Behavior_ExplicitlyDisabled_No(t *testing.T) {
	t.Setenv("AGENTHUB_FAULT_ESCALATION_ENABLED", "no")
	cfg := FaultEscalationConfigFromEnv()

	if cfg.Enabled {
		t.Error("Enabled should be false when env is 'no'")
	}
}

func TestFaultEscalationConfigFromEnv_Behavior_ExplicitlyDisabled_Off(t *testing.T) {
	t.Setenv("AGENTHUB_FAULT_ESCALATION_ENABLED", "off")
	cfg := FaultEscalationConfigFromEnv()

	if cfg.Enabled {
		t.Error("Enabled should be false when env is 'off'")
	}
}

func TestFaultEscalationConfigFromEnv_Behavior_DisabledCaseInsensitive(t *testing.T) {
	variants := []string{"FALSE", "False", "NO", "No", "OFF", "Off"}

	for _, v := range variants {
		t.Run("variant="+v, func(t *testing.T) {
			t.Setenv("AGENTHUB_FAULT_ESCALATION_ENABLED", v)
			cfg := FaultEscalationConfigFromEnv()

			if cfg.Enabled {
				t.Errorf("Enabled should be false for env=%q", v)
			}
		})
	}
}

func TestFaultEscalationConfigFromEnv_Behavior_EnabledWithWhitespace(t *testing.T) {
	// Whitespace is trimmed, so padded "false" should still disable.
	t.Setenv("AGENTHUB_FAULT_ESCALATION_ENABLED", "  false  ")
	cfg := FaultEscalationConfigFromEnv()

	if cfg.Enabled {
		t.Error("Enabled should be false when env is '  false  ' (whitespace trimmed)")
	}
}

func TestFaultEscalationConfigFromEnv_Behavior_EnabledStaysTrue_ForNonFalseValues(t *testing.T) {
	// Any value other than false/0/no/off leaves Enabled as the default (true).
	nonFalseValues := []string{"true", "yes", "1", "enabled", "anything", "", "   "}

	for _, v := range nonFalseValues {
		t.Run("value="+v, func(t *testing.T) {
			t.Setenv("AGENTHUB_FAULT_ESCALATION_ENABLED", v)
			cfg := FaultEscalationConfigFromEnv()

			// Empty and whitespace-only are trimmed to "", which does not
			// match any false variant, so Enabled stays true (default).
			if !cfg.Enabled {
				t.Errorf("Enabled should be true for env=%q", v)
			}
		})
	}
}

func TestFaultEscalationConfigFromEnv_Behavior_CustomMaxRetries(t *testing.T) {
	t.Setenv("AGENTHUB_MAX_RETRIES", "5")
	cfg := FaultEscalationConfigFromEnv()

	if cfg.MaxRetries != 5 {
		t.Errorf("MaxRetries = %d, want 5", cfg.MaxRetries)
	}
}

func TestFaultEscalationConfigFromEnv_Behavior_ZeroRetries(t *testing.T) {
	t.Setenv("AGENTHUB_MAX_RETRIES", "0")
	cfg := FaultEscalationConfigFromEnv()

	if cfg.MaxRetries != 0 {
		t.Errorf("MaxRetries = %d, want 0", cfg.MaxRetries)
	}
}

func TestFaultEscalationConfigFromEnv_Behavior_NegativeRetries_Defaults(t *testing.T) {
	// Negative value is rejected by the n >= 0 guard; default (1) is used.
	t.Setenv("AGENTHUB_MAX_RETRIES", "-1")
	cfg := FaultEscalationConfigFromEnv()

	if cfg.MaxRetries != 1 {
		t.Errorf("MaxRetries = %d, want 1 (default for invalid value)", cfg.MaxRetries)
	}
}

func TestFaultEscalationConfigFromEnv_Behavior_NonNumericRetries_Defaults(t *testing.T) {
	t.Setenv("AGENTHUB_MAX_RETRIES", "abc")
	cfg := FaultEscalationConfigFromEnv()

	if cfg.MaxRetries != 1 {
		t.Errorf("MaxRetries = %d, want 1 (default for non-numeric value)", cfg.MaxRetries)
	}
}

func TestFaultEscalationConfigFromEnv_Behavior_WhitespaceRetries_Parses(t *testing.T) {
	t.Setenv("AGENTHUB_MAX_RETRIES", "  3  ")
	cfg := FaultEscalationConfigFromEnv()

	if cfg.MaxRetries != 3 {
		t.Errorf("MaxRetries = %d, want 3 (whitespace trimmed)", cfg.MaxRetries)
	}
}

func TestFaultEscalationConfigFromEnv_Behavior_CustomTimeout_Seconds(t *testing.T) {
	t.Setenv("AGENTHUB_ESCALATION_TIMEOUT", "60s")
	cfg := FaultEscalationConfigFromEnv()

	if cfg.EscalationTimeout != 60*time.Second {
		t.Errorf("EscalationTimeout = %v, want 60s", cfg.EscalationTimeout)
	}
}

func TestFaultEscalationConfigFromEnv_Behavior_CustomTimeout_Minutes(t *testing.T) {
	t.Setenv("AGENTHUB_ESCALATION_TIMEOUT", "5m")
	cfg := FaultEscalationConfigFromEnv()

	if cfg.EscalationTimeout != 5*time.Minute {
		t.Errorf("EscalationTimeout = %v, want 5m", cfg.EscalationTimeout)
	}
}

func TestFaultEscalationConfigFromEnv_Behavior_CustomTimeout_Milliseconds(t *testing.T) {
	t.Setenv("AGENTHUB_ESCALATION_TIMEOUT", "500ms")
	cfg := FaultEscalationConfigFromEnv()

	if cfg.EscalationTimeout != 500*time.Millisecond {
		t.Errorf("EscalationTimeout = %v, want 500ms", cfg.EscalationTimeout)
	}
}

func TestFaultEscalationConfigFromEnv_Behavior_InvalidTimeout_Defaults(t *testing.T) {
	t.Setenv("AGENTHUB_ESCALATION_TIMEOUT", "not-a-duration")
	cfg := FaultEscalationConfigFromEnv()

	if cfg.EscalationTimeout != 30*time.Second {
		t.Errorf("EscalationTimeout = %v, want 30s (default for invalid value)", cfg.EscalationTimeout)
	}
}

func TestFaultEscalationConfigFromEnv_Behavior_ZeroTimeout_Defaults(t *testing.T) {
	// Zero or negative durations are rejected by the d > 0 guard.
	t.Setenv("AGENTHUB_ESCALATION_TIMEOUT", "0s")
	cfg := FaultEscalationConfigFromEnv()

	if cfg.EscalationTimeout != 30*time.Second {
		t.Errorf("EscalationTimeout = %v, want 30s (default for zero value)", cfg.EscalationTimeout)
	}
}

func TestFaultEscalationConfigFromEnv_Behavior_NegativeTimeout_Defaults(t *testing.T) {
	t.Setenv("AGENTHUB_ESCALATION_TIMEOUT", "-1s")
	cfg := FaultEscalationConfigFromEnv()

	if cfg.EscalationTimeout != 30*time.Second {
		t.Errorf("EscalationTimeout = %v, want 30s (default for negative value)", cfg.EscalationTimeout)
	}
}

func TestFaultEscalationConfigFromEnv_Behavior_WhitespaceTimeout_Parses(t *testing.T) {
	t.Setenv("AGENTHUB_ESCALATION_TIMEOUT", "  90s  ")
	cfg := FaultEscalationConfigFromEnv()

	if cfg.EscalationTimeout != 90*time.Second {
		t.Errorf("EscalationTimeout = %v, want 90s (whitespace trimmed)", cfg.EscalationTimeout)
	}
}

func TestFaultEscalationConfigFromEnv_Behavior_AllEnvVarsSetTogether(t *testing.T) {
	// Set all three env vars together.
	t.Setenv("AGENTHUB_FAULT_ESCALATION_ENABLED", "true")
	t.Setenv("AGENTHUB_MAX_RETRIES", "3")
	t.Setenv("AGENTHUB_ESCALATION_TIMEOUT", "45s")

	cfg := FaultEscalationConfigFromEnv()

	if !cfg.Enabled {
		t.Error("Enabled should be true")
	}
	if cfg.MaxRetries != 3 {
		t.Errorf("MaxRetries = %d, want 3", cfg.MaxRetries)
	}
	if cfg.EscalationTimeout != 45*time.Second {
		t.Errorf("EscalationTimeout = %v, want 45s", cfg.EscalationTimeout)
	}
}

func TestFaultEscalationConfigFromEnv_Behavior_DisabledAndZeroRetries(t *testing.T) {
	// Escalation disabled + zero retries.
	t.Setenv("AGENTHUB_FAULT_ESCALATION_ENABLED", "false")
	t.Setenv("AGENTHUB_MAX_RETRIES", "0")

	cfg := FaultEscalationConfigFromEnv()

	if cfg.Enabled {
		t.Error("Enabled should be false")
	}
	if cfg.MaxRetries != 0 {
		t.Errorf("MaxRetries = %d, want 0", cfg.MaxRetries)
	}
}

// ── Behavioral tests for FaultEscalationConfig decision methods ────────────

func TestFaultEscalationConfig_Behavior_ShouldRetry_WhenEnabled(t *testing.T) {
	cfg := FaultEscalationConfig{
		Enabled:    true,
		MaxRetries: 3,
	}

	// Retry count 0, 1, 2: should retry (less than MaxRetries).
	if !cfg.ShouldRetry(0) {
		t.Error("ShouldRetry(0) with MaxRetries=3 should be true")
	}
	if !cfg.ShouldRetry(1) {
		t.Error("ShouldRetry(1) with MaxRetries=3 should be true")
	}
	if !cfg.ShouldRetry(2) {
		t.Error("ShouldRetry(2) with MaxRetries=3 should be true")
	}
	// Retry count 3: max reached, should NOT retry.
	if cfg.ShouldRetry(3) {
		t.Error("ShouldRetry(3) with MaxRetries=3 should be false (max reached)")
	}
	// Retry count 4: exceed max, should NOT retry.
	if cfg.ShouldRetry(4) {
		t.Error("ShouldRetry(4) with MaxRetries=3 should be false (exceeded)")
	}
}

func TestFaultEscalationConfig_Behavior_ShouldRetry_WhenDisabled(t *testing.T) {
	cfg := FaultEscalationConfig{
		Enabled:    false,
		MaxRetries: 3,
	}

	if cfg.ShouldRetry(0) {
		t.Error("ShouldRetry should be false when escalation is disabled")
	}
	if cfg.ShouldRetry(1) {
		t.Error("ShouldRetry should be false when escalation is disabled")
	}
}

func TestFaultEscalationConfig_Behavior_ShouldRetry_WhenMaxRetriesZero(t *testing.T) {
	cfg := FaultEscalationConfig{
		Enabled:    true,
		MaxRetries: 0,
	}

	if cfg.ShouldRetry(0) {
		t.Error("ShouldRetry should be false when MaxRetries=0")
	}
}

func TestFaultEscalationConfig_Behavior_ShouldRetry_WhenMaxRetriesNegative(t *testing.T) {
	// Negative MaxRetries behaves like zero (disabled retries).
	cfg := FaultEscalationConfig{
		Enabled:    true,
		MaxRetries: -1,
	}

	if cfg.ShouldRetry(0) {
		t.Error("ShouldRetry should be false when MaxRetries < 0")
	}
}

func TestFaultEscalationConfig_Behavior_DefaultConfigIsSensible(t *testing.T) {
	cfg := DefaultFaultEscalationConfig()

	// Verify the default config makes sense as a whole:
	// Enabled, with 1 retry, 30s timeout.
	if !cfg.Enabled {
		t.Error("default config should have Enabled=true")
	}
	if cfg.MaxRetries < 1 {
		t.Errorf("default config should have MaxRetries >= 1, got %d", cfg.MaxRetries)
	}
	if cfg.EscalationTimeout <= 0 {
		t.Errorf("default config should have positive EscalationTimeout, got %v", cfg.EscalationTimeout)
	}

	// ShouldRetry should work with default config.
	if !cfg.ShouldRetry(0) {
		t.Error("default config ShouldRetry(0) should be true")
	}
	if cfg.ShouldRetry(1) {
		t.Error("default config ShouldRetry(1) should be false (MaxRetries=1)")
	}
}

func TestFaultEscalationConfig_Behavior_EmptyStruct_IsSafe(t *testing.T) {
	// An empty (zero-value) FaultEscalationConfig should be safe:
	// disabled by default, no retries, zero timeout.
	var cfg FaultEscalationConfig

	if cfg.Enabled {
		t.Error("zero-value FaultEscalationConfig should have Enabled=false")
	}
	if cfg.MaxRetries != 0 {
		t.Errorf("zero-value FaultEscalationConfig should have MaxRetries=0, got %d", cfg.MaxRetries)
	}
	if cfg.EscalationTimeout != 0 {
		t.Errorf("zero-value FaultEscalationConfig should have EscalationTimeout=0, got %v", cfg.EscalationTimeout)
	}

	// All decision methods should return false / 0.
	if cfg.ShouldRetry(0) {
		t.Error("zero-value config ShouldRetry should be false")
	}
}
