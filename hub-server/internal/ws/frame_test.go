package ws

import (
	"encoding/json"
	"testing"
)

func TestNewFrame(t *testing.T) {
	payload := map[string]string{"text": "hello"}
	f := NewFrame(TypeMessageNew, payload)
	if f.Type != TypeMessageNew {
		t.Fatalf("Type = %q, want message.new", f.Type)
	}
	p, ok := f.Payload.(map[string]string)
	if !ok || p["text"] != "hello" {
		t.Fatal("payload mismatch")
	}
}

func TestMarshalUnmarshalRoundTrip(t *testing.T) {
	original := Frame{
		Type:    TypeMessageNew,
		SeqID:   42,
		Payload: map[string]string{"text": "hello world"},
	}

	data, err := original.Marshal()
	if err != nil {
		t.Fatalf("Marshal failed: %v", err)
	}
	if len(data) == 0 {
		t.Fatal("expected non-empty marshaled data")
	}

	parsed, err := ParseFrame(data)
	if err != nil {
		t.Fatalf("ParseFrame failed: %v", err)
	}
	if parsed.Type != TypeMessageNew {
		t.Fatalf("Type = %q, want message.new", parsed.Type)
	}
	if parsed.SeqID != 42 {
		t.Fatalf("SeqID = %d, want 42", parsed.SeqID)
	}
}

func TestParseFrameInvalidJSON(t *testing.T) {
	_, err := ParseFrame([]byte("not json"))
	if err == nil {
		t.Fatal("expected error for invalid JSON")
	}
}

func TestParseFrameEmpty(t *testing.T) {
	f, err := ParseFrame([]byte("{}"))
	if err != nil {
		t.Fatalf("ParseFrame({}) failed: %v", err)
	}
	if f.Type != "" {
		t.Fatalf("Type = %q, want empty", f.Type)
	}
}

func TestMarshalOmitempty(t *testing.T) {
	f := Frame{Type: TypeTyping}
	data, err := f.Marshal()
	if err != nil {
		t.Fatalf("Marshal failed: %v", err)
	}
	var raw map[string]interface{}
	if err := json.Unmarshal(data, &raw); err != nil {
		t.Fatalf("unmarshal raw: %v", err)
	}
	if _, exists := raw["seq_id"]; exists {
		t.Fatal("seq_id should be omitted when zero")
	}
	if _, exists := raw["payload"]; exists {
		t.Fatal("payload should be omitted when nil")
	}
}

func TestAllFrameTypes(t *testing.T) {
	types := []string{
		TypeAuth, TypeTyping,
		TypeAuthOK, TypeAuthFail,
		TypeMessageNew, TypeMessageRecall, TypeMessagePin, TypeMessageUnpin,
		TypeMessageRead, TypeSessionCreated, TypeSessionDissolved,
		TypeSessionMemberJoined, TypeSessionMemberLeft, TypeSessionInfoUpdated,
		TypeDeviceOnline, TypeDeviceOffline, TypeDeviceKicked,
		TypeAgentDispatch, TypeAgentStream, TypeAgentDone, TypeAgentFailed, TypeAgentCancel,
		TypeNotificationNew, TypeFriendRequest, TypeFriendAccepted,
	}
	for _, typ := range types {
		f := NewFrame(typ, nil)
		data, err := f.Marshal()
		if err != nil {
			t.Errorf("Marshal(%q) failed: %v", typ, err)
			continue
		}
		parsed, err := ParseFrame(data)
		if err != nil {
			t.Errorf("ParseFrame(%q) failed: %v", typ, err)
			continue
		}
		if parsed.Type != typ {
			t.Errorf("round-trip type mismatch: got %q, want %q", parsed.Type, typ)
		}
	}
}

func TestMarshalWithNilPayload(t *testing.T) {
	f := Frame{Type: TypeAuth, SeqID: 1}
	data, err := f.Marshal()
	if err != nil {
		t.Fatalf("Marshal failed: %v", err)
	}
	parsed, err := ParseFrame(data)
	if err != nil {
		t.Fatalf("ParseFrame failed: %v", err)
	}
	if parsed.Type != TypeAuth {
		t.Fatalf("Type = %q", parsed.Type)
	}
	if parsed.SeqID != 1 {
		t.Fatalf("SeqID = %d", parsed.SeqID)
	}
	if parsed.Payload != nil {
		t.Fatalf("expected nil payload")
	}
}

func TestParseFrameNilData(t *testing.T) {
	_, err := ParseFrame(nil)
	if err == nil {
		t.Fatal("expected error for nil data")
	}
}
