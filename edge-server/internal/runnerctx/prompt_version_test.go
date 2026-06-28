package runnerctx

import (
	"testing"
	"time"
)

func TestComputePromptChecksum(t *testing.T) {
	checksum := ComputePromptChecksum("hello")
	if checksum == "" {
		t.Fatal("checksum should not be empty")
	}
	if len(checksum) != 64 {
		t.Fatalf("checksum length = %d, want 64", len(checksum))
	}
}

func TestComputePromptChecksumDeterministic(t *testing.T) {
	prompt := "You are a helpful assistant."
	c1 := ComputePromptChecksum(prompt)
	c2 := ComputePromptChecksum(prompt)
	if c1 != c2 {
		t.Fatalf("checksums differ for same input: %q vs %q", c1, c2)
	}
}

func TestComputePromptChecksumDifferent(t *testing.T) {
	c1 := ComputePromptChecksum("prompt A")
	c2 := ComputePromptChecksum("prompt B")
	if c1 == c2 {
		t.Fatal("checksums should differ for different inputs")
	}
}

func TestPromptVersionDisplay(t *testing.T) {
	created := time.Date(2026, 6, 25, 12, 0, 0, 0, time.UTC)
	pv := PromptVersion{
		ID:          "orchestrator-v3",
		Version:     3,
		Created:     created,
		Author:      "agent-hub/edge-server",
		ModelTarget: "any",
		Checksum:    ComputePromptChecksum("orchestrator prompt text"),
	}
	want := "orchestrator-v3 (v3, 2026-06-25T12:00:00Z)"
	if got := pv.VersionDisplay(); got != want {
		t.Fatalf("VersionDisplay() = %q, want %q", got, want)
	}
}

func TestPromptVersionFields(t *testing.T) {
	pv := PromptVersion{
		ID:          "reviewer-v1",
		Version:     1,
		Created:     time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC),
		Author:      "agent-hub/edge-server",
		ModelTarget: "claude-opus-4-8",
		Checksum:    "abc123",
	}
	if pv.ID != "reviewer-v1" {
		t.Fatalf("ID = %q, want reviewer-v1", pv.ID)
	}
	if pv.Version != 1 {
		t.Fatalf("Version = %d, want 1", pv.Version)
	}
}
