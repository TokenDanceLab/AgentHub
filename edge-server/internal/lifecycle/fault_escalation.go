package lifecycle

import (
	"os"
	"strconv"
	"strings"
	"time"
)

// FaultEscalationConfig holds configuration for the 3-layer fault escalation chain.
//
// Layer 1 (Auto-retry): when a run fails, retry once with the same agent.
// Layer 2 (AI review): when retry also fails, the LLM analyzes error output and
//
//	suggests a fix or reassignment.
//
// Layer 3 (Replan): when AI review cannot fix the failure, trigger plan
//
//	regeneration with error context.
type FaultEscalationConfig struct {
	// Enabled controls whether fault escalation is active. Defaults to true
	// via AGENTHUB_FAULT_ESCALATION_ENABLED env var (case-insensitive "false"/"0"/"no"/"off" disables).
	Enabled bool

	// MaxRetries is the maximum number of auto-retry attempts (Layer 1).
	// Defaults to 1 via AGENTHUB_MAX_RETRIES env var. Set to 0 to disable retries.
	MaxRetries int

	// EscalationTimeout is the per-escalation-phase timeout.
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

// EscalationPhase represents the current phase of the fault escalation chain.
type EscalationPhase string

const (
	EscalationPhaseNone    EscalationPhase = "none"      // no escalation active
	EscalationPhaseRetry   EscalationPhase = "retry"     // Layer 1: auto-retry in progress
	EscalationPhaseReview  EscalationPhase = "review"    // Layer 2: AI analysis of error
	EscalationPhaseReplan  EscalationPhase = "replan"    // Layer 3: plan regeneration
	EscalationPhaseExhaust EscalationPhase = "exhausted" // all layers exhausted
)

// EscalationState tracks the state of the fault escalation chain for a single run.
type EscalationState struct {
	Phase       EscalationPhase `json:"phase"`
	RetryCount  int             `json:"retryCount"`
	MaxRetries  int             `json:"maxRetries"`
	LastError   string          `json:"lastError,omitempty"`
	ReviewNotes string          `json:"reviewNotes,omitempty"`
	ReplanNotes string          `json:"replanNotes,omitempty"`
}

// ShouldRetry returns true when the run is eligible for Layer 1 auto-retry.
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

// ShouldEscalateToReview returns true when retries are exhausted and the failure
// should be escalated to Layer 2 (AI review).
func (cfg FaultEscalationConfig) ShouldEscalateToReview(currentRetryCount int) bool {
	if !cfg.Enabled {
		return false
	}
	return currentRetryCount >= cfg.MaxRetries
}

// NextEscalationPhase determines the next escalation phase based on retry count and
// the error's recoverability classification.
func (cfg FaultEscalationConfig) NextEscalationPhase(retryCount int, isRecoverable bool) EscalationPhase {
	if !cfg.Enabled {
		return EscalationPhaseNone
	}
	if cfg.ShouldRetry(retryCount) {
		return EscalationPhaseRetry
	}
	if cfg.ShouldEscalateToReview(retryCount) {
		if isRecoverable {
			return EscalationPhaseReview
		}
		return EscalationPhaseReplan
	}
	return EscalationPhaseExhaust
}
