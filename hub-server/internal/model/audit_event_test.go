package model

import (
	"testing"
)

func validAuditEvent() *AuditEvent {
	return &AuditEvent{
		UserID:    "00000000-0000-0000-0000-000000000001",
		EventType: "login",
		Severity:  "info",
		Summary:   "User logged in",
		Details:   `{"method":"password"}`,
		ClientIP:  "192.168.1.1",
	}
}

func TestAuditEvent_Validate_Valid(t *testing.T) {
	e := validAuditEvent()
	if err := e.Validate(); err != nil {
		t.Fatalf("expected valid audit event to pass validation, got: %v", err)
	}
}

func TestAuditEvent_Validate_DetailsNotObject(t *testing.T) {
	e := validAuditEvent()
	e.Details = `"not_an_object"`
	if err := e.Validate(); err == nil {
		t.Fatal("expected error for details not being a JSON object, got nil")
	}
}

func TestAuditEvent_Validate_EmptyDetails(t *testing.T) {
	e := validAuditEvent()
	e.Details = ""
	if err := e.Validate(); err != nil {
		t.Fatalf("expected empty details to pass validation, got: %v", err)
	}
}

func TestAuditEvent_Validate_WithAllOptionalFields(t *testing.T) {
	profileID := "00000000-0000-0000-0000-000000000002"
	targetID := "00000000-0000-0000-0000-000000000003"
	e := validAuditEvent()
	e.ProfileID = &profileID
	e.TargetID = &targetID
	if err := e.Validate(); err != nil {
		t.Fatalf("expected valid audit event with all optional fields to pass validation, got: %v", err)
	}
}

// --- ComputeHash tests ---

func TestComputeHash_Deterministic(t *testing.T) {
	h1 := ComputeHash("event-1", "prev-hash-abc")
	h2 := ComputeHash("event-1", "prev-hash-abc")
	if h1 != h2 {
		t.Fatalf("ComputeHash not deterministic: %q != %q", h1, h2)
	}
}

func TestComputeHash_DifferentInputsProduceDifferentOutputs(t *testing.T) {
	h1 := ComputeHash("event-1", "prev-hash")
	h2 := ComputeHash("event-2", "prev-hash")
	if h1 == h2 {
		t.Fatalf("different IDs should produce different hashes, both = %q", h1)
	}

	h3 := ComputeHash("event-1", "prev-hash-a")
	h4 := ComputeHash("event-1", "prev-hash-b")
	if h3 == h4 {
		t.Fatalf("different prevHashes should produce different hashes, both = %q", h3)
	}
}

func TestComputeHash_GenesisEmptyInputs(t *testing.T) {
	h := ComputeHash("", "")
	if h == "" {
		t.Fatal("genesis hash should not be empty")
	}
	if len(h) != 64 {
		t.Fatalf("SHA-256 hex length should be 64, got %d", len(h))
	}
}

// --- HashChainEntry tests ---

func TestHashChainEntry_ComputesCorrectHash(t *testing.T) {
	e := &AuditEvent{
		ID:        "evt-001",
		UserID:    "user-1",
		EventType: "login",
		Severity:  "info",
		Summary:   "User logged in",
		PrevHash:  "abc123",
	}
	entry := e.HashChainEntry()

	if entry.ID != e.ID {
		t.Errorf("entry.ID = %q, want %q", entry.ID, e.ID)
	}
	if entry.PrevHash != e.PrevHash {
		t.Errorf("entry.PrevHash = %q, want %q", entry.PrevHash, e.PrevHash)
	}
	expected := ComputeHash(e.ID, e.PrevHash)
	if entry.Hash != expected {
		t.Errorf("entry.Hash = %q, want %q", entry.Hash, expected)
	}
	if entry.UserID != e.UserID {
		t.Errorf("entry.UserID = %q, want %q", entry.UserID, e.UserID)
	}
}

// --- VerifyChain tests ---

func TestVerifyChain_ValidChain(t *testing.T) {
	genesis := AuditEvent{ID: "evt-0", PrevHash: ""}
	hash0 := ComputeHash(genesis.ID, genesis.PrevHash)

	evt1 := AuditEvent{ID: "evt-1", PrevHash: hash0}
	hash1 := ComputeHash(evt1.ID, evt1.PrevHash)

	evt2 := AuditEvent{ID: "evt-2", PrevHash: hash1}

	chain := []AuditEvent{genesis, evt1, evt2}
	if idx := VerifyChain(chain); idx != -1 {
		t.Fatalf("valid chain should return -1, got %d", idx)
	}
}

func TestVerifyChain_SingleEvent(t *testing.T) {
	chain := []AuditEvent{{ID: "evt-0", PrevHash: ""}}
	if idx := VerifyChain(chain); idx != -1 {
		t.Fatalf("single-event chain should return -1, got %d", idx)
	}
}

func TestVerifyChain_EmptyChain(t *testing.T) {
	if idx := VerifyChain(nil); idx != -1 {
		t.Fatalf("empty chain should return -1, got %d", idx)
	}
}

func TestVerifyChain_TamperedEvent(t *testing.T) {
	genesis := AuditEvent{ID: "evt-0", PrevHash: ""}
	hash0 := ComputeHash(genesis.ID, genesis.PrevHash)

	evt1 := AuditEvent{ID: "evt-1", PrevHash: hash0}

	// Tamper with evt-1's PrevHash (simulating data modification).
	tamperedEvt1 := evt1
	tamperedEvt1.PrevHash = "tampered-hash"

	// Rebuild evt-2's PrevHash based on the tampered evt-1.
	tamperedHash1 := ComputeHash(tamperedEvt1.ID, tamperedEvt1.PrevHash)
	tamperedEvt2 := AuditEvent{ID: "evt-2", PrevHash: tamperedHash1}

	chain := []AuditEvent{genesis, tamperedEvt1, tamperedEvt2}
	idx := VerifyChain(chain)
	if idx != 1 {
		t.Fatalf("tampered chain should detect break at index 1, got %d", idx)
	}
}

func TestVerifyChain_BrokenLink(t *testing.T) {
	genesis := AuditEvent{ID: "evt-0", PrevHash: ""}
	evt1 := AuditEvent{ID: "evt-1", PrevHash: "wrong-hash-not-matching-genesis"}

	chain := []AuditEvent{genesis, evt1}
	idx := VerifyChain(chain)
	if idx != 1 {
		t.Fatalf("broken link should be detected at index 1, got %d", idx)
	}
}

func TestAuditEvent_TableName(t *testing.T) {
	e := AuditEvent{}
	if e.TableName() != "audit_events" {
		t.Errorf("TableName() = %q, want audit_events", e.TableName())
	}
}
