package adapters

import "testing"

func TestSessionMetricsPayloadSkipsEmpty(t *testing.T) {
	_, ok := SessionMetricsPayload(nil)
	if ok {
		t.Fatal("expected nil msg to skip emit")
	}
	_, ok = SessionMetricsPayload(&claudeSDKMessage{})
	if ok {
		t.Fatal("expected empty msg to skip emit")
	}
}

func TestSessionMetricsPayloadIncludesTokensAndCost(t *testing.T) {
	msg := &claudeSDKMessage{
		Model:        "claude-3",
		TotalCostUSD: 0.05,
		Usage:        &claudeUsage{InputTokens: 100, OutputTokens: 50},
	}
	payload, ok := SessionMetricsPayload(msg)
	if !ok {
		t.Fatal("expected emit=true when usage+cost present")
	}
	if payload["inputTokens"] != int64(100) {
		t.Fatalf("inputTokens = %v", payload["inputTokens"])
	}
	if payload["outputTokens"] != int64(50) {
		t.Fatalf("outputTokens = %v", payload["outputTokens"])
	}
	if payload["totalCostUsd"] != 0.05 {
		t.Fatalf("totalCostUsd = %v", payload["totalCostUsd"])
	}
	if payload["model"] != "claude-3" {
		t.Fatalf("model = %v", payload["model"])
	}
}

func TestSessionMetricsPayloadCostOnly(t *testing.T) {
	msg := &claudeSDKMessage{TotalCostUSD: 0.01}
	payload, ok := SessionMetricsPayload(msg)
	if !ok {
		t.Fatal("expected emit=true when cost-only")
	}
	if payload["totalCostUsd"] != 0.01 {
		t.Fatalf("totalCostUsd = %v", payload["totalCostUsd"])
	}
	if _, has := payload["inputTokens"]; has {
		t.Fatal("unexpected inputTokens when usage nil")
	}
}
