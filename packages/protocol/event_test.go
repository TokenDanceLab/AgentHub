package protocol_test

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/agenthub/agenthub/packages/protocol"
)

func TestEventEnvelopeUsesStableJSONContract(t *testing.T) {
	event := protocol.EventEnvelope{
		Version: "v1",
		ID:      "evt_1",
		Seq:     42,
		Type:    "edge.heartbeat",
		Scope: protocol.EventScope{
			EdgeID: "edge_1",
		},
		TraceID: "trace_1",
		SentAt:  time.Date(2026, 5, 22, 12, 0, 0, 0, time.UTC),
		Payload: map[string]string{"status": "online"},
	}

	data, err := json.Marshal(event)
	if err != nil {
		t.Fatalf("Marshal returned error: %v", err)
	}

	var body map[string]any
	if err := json.Unmarshal(data, &body); err != nil {
		t.Fatalf("event JSON is invalid: %v", err)
	}
	if body["version"] != "v1" || body["id"] != "evt_1" || body["type"] != "edge.heartbeat" {
		t.Fatalf("event body = %v", body)
	}
	if body["sentAt"] != "2026-05-22T12:00:00Z" {
		t.Fatalf("sentAt = %v, want RFC3339 UTC", body["sentAt"])
	}
}

func TestEventEnvelopeValidateRejectsInvalidEnvelope(t *testing.T) {
	event := protocol.EventEnvelope{
		Version: "v1",
		ID:      "evt_1",
		Seq:     0,
		Type:    "edge.heartbeat",
		SentAt:  time.Now().UTC(),
		Payload: map[string]any{},
	}

	if err := event.Validate(); err == nil {
		t.Fatal("Validate returned nil, want seq validation error")
	}
}
