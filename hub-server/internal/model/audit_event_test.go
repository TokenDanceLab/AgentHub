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
