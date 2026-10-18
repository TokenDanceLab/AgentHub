package lifecycle

import (
	"testing"

	"github.com/agenthub/edge-server/internal/runnerctx"
)

func TestContextCompactionPayload(t *testing.T) {
	payload := contextCompactionPayload("run-1", 87.5, 1750, 250)

	want := map[string]any{
		"runId":           "run-1",
		"usagePercent":    87.5,
		"tokensUsed":      int64(1750),
		"tokensRemaining": int64(250),
		"threshold":       runnerctx.CompactionThreshold,
	}
	for key, value := range want {
		if payload[key] != value {
			t.Errorf("payload[%q] = %v, want %v", key, payload[key], value)
		}
	}
	if len(payload) != len(want) {
		t.Errorf("payload has %d keys, want %d: %v", len(payload), len(want), payload)
	}
}

func TestAdapterMetricsLabel(t *testing.T) {
	if got := adapterMetricsLabel(""); got != "none" {
		t.Errorf("empty adapter label = %q, want none", got)
	}
	if got := adapterMetricsLabel("claude-code"); got != "claude-code" {
		t.Errorf("adapter label = %q, want claude-code", got)
	}
}
