package model

import (
	"testing"
	"time"
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

// --- ComputeLinkHash tests (#1541 content-authenticated chain) ---

func TestComputeLinkHash_Deterministic(t *testing.T) {
	e := &AuditEvent{ID: "event-1", UserID: "user-1", EventType: "login", Severity: "info", Summary: "s", PrevHash: "prev-hash-abc"}
	h1 := ComputeLinkHash(e)
	h2 := ComputeLinkHash(e)
	if h1 != h2 {
		t.Fatalf("ComputeLinkHash not deterministic: %q != %q", h1, h2)
	}
}

func TestComputeLinkHash_DifferentInputsProduceDifferentOutputs(t *testing.T) {
	base := func() *AuditEvent { return &AuditEvent{ID: "event-1", UserID: "user-1", EventType: "login", Severity: "info", Summary: "s", PrevHash: "prev-hash"} }
	h1 := ComputeLinkHash(base())

	diffID := base()
	diffID.ID = "event-2"
	if h2 := ComputeLinkHash(diffID); h2 == h1 {
		t.Fatal("different IDs should produce different hashes")
	}

	diffPrev := base()
	diffPrev.PrevHash = "prev-hash-b"
	if h3 := ComputeLinkHash(diffPrev); h3 == h1 {
		t.Fatal("different prevHashes should produce different hashes")
	}
}

// TestComputeLinkHash_ContentSensitive is the core #1541 fix: the link hash
// must cover the event content, so tampering with any field (while keeping
// id and prev_hash) changes the hash.
func TestComputeLinkHash_ContentSensitive(t *testing.T) {
	base := func() *AuditEvent {
		pid := "profile-1"
		tid := "target-1"
		return &AuditEvent{
			ID: "event-1", UserID: "user-1", ProfileID: &pid, TargetID: &tid,
			EventType: "login", Severity: "info", Summary: "s", Details: `{"a":1}`,
			ClientIP: "1.2.3.4", PrevHash: "prev-hash", CreatedAt: time.Unix(1700000000, 0),
		}
	}
	mutations := map[string]func(*AuditEvent){
		"user_id":    func(e *AuditEvent) { e.UserID = "user-2" },
		"profile_id": func(e *AuditEvent) { e.ProfileID = nil },
		"target_id":  func(e *AuditEvent) { *e.TargetID = "target-2" },
		"event_type": func(e *AuditEvent) { e.EventType = "logout" },
		"severity":   func(e *AuditEvent) { e.Severity = "high" },
		"summary":    func(e *AuditEvent) { e.Summary = "changed" },
		"details":    func(e *AuditEvent) { e.Details = `{"b":2}` },
		"client_ip":  func(e *AuditEvent) { e.ClientIP = "9.9.9.9" },
		"created_at": func(e *AuditEvent) { e.CreatedAt = time.Unix(1700000001, 0) },
	}
	baseline := ComputeLinkHash(base())
	for name, mutate := range mutations {
		e := base()
		mutate(e)
		if h := ComputeLinkHash(e); h == baseline {
			t.Errorf("content field %q mutation did not change the link hash — content not authenticated", name)
		}
	}
}

func TestComputeLinkHash_GenesisNil(t *testing.T) {
	if h := ComputeLinkHash(nil); h != "" {
		t.Fatalf("genesis (nil prev) hash should be empty, got %q", h)
	}
}

// TestCanonicalContent_LengthPrefixUnambiguous proves two events with
// different field boundaries (e.g. "ab" vs "a"+"b") do not collide.
func TestCanonicalContent_LengthPrefixUnambiguous(t *testing.T) {
	a := &AuditEvent{ID: "x", UserID: "ab", EventType: "t", Severity: "i", Summary: "s", PrevHash: ""}
	b := &AuditEvent{ID: "x", UserID: "a", EventType: "tb", Severity: "i", Summary: "s", PrevHash: ""}
	if canonicalContent(a) == canonicalContent(b) {
		t.Fatal("length-prefixed encoding must distinguish field boundaries")
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
	expected := ComputeLinkHash(e)
	if entry.Hash != expected {
		t.Errorf("entry.Hash = %q, want %q", entry.Hash, expected)
	}
	if entry.UserID != e.UserID {
		t.Errorf("entry.UserID = %q, want %q", entry.UserID, e.UserID)
	}
}

// --- VerifyChain tests ---

func TestVerifyChain_ValidChain(t *testing.T) {
	genesis := AuditEvent{ID: "evt-0", UserID: "u", EventType: "t", Severity: "i", Summary: "s", PrevHash: ""}
	evt1 := AuditEvent{ID: "evt-1", UserID: "u", EventType: "t", Severity: "i", Summary: "s", PrevHash: ComputeLinkHash(&genesis)}
	evt2 := AuditEvent{ID: "evt-2", UserID: "u", EventType: "t", Severity: "i", Summary: "s", PrevHash: ComputeLinkHash(&evt1)}

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

// TestVerifyChain_ContentTamperDetected is the #1541 regression test: an
// attacker edits the summary of evt-1 while keeping id and prev_hash intact.
// The old chain (hash over id+prev_hash only) verified clean; the
// content-authenticated chain must report the break.
func TestVerifyChain_ContentTamperDetected(t *testing.T) {
	genesis := AuditEvent{ID: "evt-0", UserID: "u", EventType: "t", Severity: "i", Summary: "genesis", PrevHash: ""}
	evt1 := AuditEvent{ID: "evt-1", UserID: "u", EventType: "t", Severity: "i", Summary: "original", PrevHash: ComputeLinkHash(&genesis)}
	evt2 := AuditEvent{ID: "evt-2", UserID: "u", EventType: "t", Severity: "i", Summary: "tail", PrevHash: ComputeLinkHash(&evt1)}

	chain := []AuditEvent{genesis, evt1, evt2}
	if idx := VerifyChain(chain); idx != -1 {
		t.Fatalf("clean chain must verify, got break at %d", idx)
	}

	// Tamper with evt-1's content only — id/prev_hash untouched.
	chain[1].Summary = "ATTACKER EDITED THIS"

	idx := VerifyChain(chain)
	if idx != 2 {
		t.Fatalf("content tamper must break the chain at index 2 (evt2's prev_hash no longer matches), got %d", idx)
	}
}

func TestVerifyChain_TamperedEvent(t *testing.T) {
	genesis := AuditEvent{ID: "evt-0", UserID: "u", EventType: "t", Severity: "i", Summary: "s", PrevHash: ""}
	evt1 := AuditEvent{ID: "evt-1", UserID: "u", EventType: "t", Severity: "i", Summary: "s", PrevHash: ComputeLinkHash(&genesis)}

	// Tamper with evt-1's PrevHash (simulating data modification).
	tamperedEvt1 := evt1
	tamperedEvt1.PrevHash = "tampered-hash"

	// Rebuild evt-2's PrevHash based on the tampered evt-1.
	tamperedEvt2 := AuditEvent{ID: "evt-2", UserID: "u", EventType: "t", Severity: "i", Summary: "s", PrevHash: ComputeLinkHash(&tamperedEvt1)}

	chain := []AuditEvent{genesis, tamperedEvt1, tamperedEvt2}
	idx := VerifyChain(chain)
	if idx != 1 {
		t.Fatalf("tampered chain should detect break at index 1, got %d", idx)
	}
}

func TestVerifyChain_BrokenLink(t *testing.T) {
	genesis := AuditEvent{ID: "evt-0", UserID: "u", EventType: "t", Severity: "i", Summary: "s", PrevHash: ""}
	evt1 := AuditEvent{ID: "evt-1", UserID: "u", EventType: "t", Severity: "i", Summary: "s", PrevHash: "wrong-hash-not-matching-genesis"}

	chain := []AuditEvent{genesis, evt1}
	idx := VerifyChain(chain)
	if idx != 1 {
		t.Fatalf("broken link should be detected at index 1, got %d", idx)
	}
}

