package lifecycle

import (
	"os"
	"strconv"
	"strings"
	"time"
)

// FaultEscalationConfig holds configuration for the fault auto-retry chain.
//
// Auto-retry: when a run fails, retry up to MaxRetries times with the same
// agent before surfacing the failure. Error review and plan regeneration are
// delegated to the agent itself in-context (the model reviews its own error
// output and self-corrects) instead of a separate external state machine.
type FaultEscalationConfig struct {
	// Enabled controls whether fault auto-retry is active. Defaults to true
	// via AGENTHUB_FAULT_ESCALATION_ENABLED env var (case-insensitive "false"/"0"/"no"/"off" disables).
	Enabled bool

	// MaxRetries is the maximum number of auto-retry attempts.
	// Defaults to 1 via AGENTHUB_MAX_RETRIES env var. Set to 0 to disable retries.
	MaxRetries int

	// EscalationTimeout is the per-attempt timeout.
	// Defaults to 30s via AGENTHUB_ESCALATION_TIMEOUT env var (Go duration string).
	EscalationTimeout time.Duration
}

// DefaultFaultEscalationConfig returns the recommended default configuration.
func DefaultFaultEscalationConfig() FaultEscalationConfig {
	return FaultEscalationConfig{
		Enabled:           true,
		MaxRetries:        1,
		EscalationTimeout: 30 * time.Second,
	}
}

// FaultEscalationConfigFromEnv reads fault escalation configuration from environment variables.
func FaultEscalationConfigFromEnv() FaultEscalationConfig {
	cfg := DefaultFaultEscalationConfig()

	if v := strings.ToLower(strings.TrimSpace(os.Getenv("AGENTHUB_FAULT_ESCALATION_ENABLED"))); v == "false" || v == "0" || v == "no" || v == "off" {
		cfg.Enabled = false
	}

	if v := strings.TrimSpace(os.Getenv("AGENTHUB_MAX_RETRIES")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			cfg.MaxRetries = n
		}
	}

	if v := strings.TrimSpace(os.Getenv("AGENTHUB_ESCALATION_TIMEOUT")); v != "" {
		if d, err := time.ParseDuration(v); err == nil && d > 0 {
			cfg.EscalationTimeout = d
		}
	}

	return cfg
}

// ShouldRetry returns true when the run is eligible for auto-retry.
// Retries are allowed when escalation is enabled and the retry count has not
// exceeded MaxRetries.
func (cfg FaultEscalationConfig) ShouldRetry(currentRetryCount int) bool {
	if !cfg.Enabled {
		return false
	}
	if cfg.MaxRetries <= 0 {
		return false
	}
	return currentRetryCount < cfg.MaxRetries
}
