package api

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/agenthub/edge-server/internal/hub"
)

// failingCallbackJournal is a CallbackClient whose DurableSnapshot always fails.
// The existing fakeCallbackJournal (handlers_test.go:3742) can only succeed and
// that file is read-only for this change, so the snapshot-failure path gets its
// own fake here. It is a fake for the *dependency*, not for the code under test:
// GetDeliveryJournal itself runs for real.
type failingCallbackJournal struct {
	err error
}

func (f *failingCallbackJournal) DurableSnapshot(afterSeq uint64) ([]hub.DeliveryJournalEntry, error) {
	return nil, f.err
}

// TestGetDeliveryJournal_NotConfigured_CodeMatchesStatus locks the fix for the
// first mutually-exclusive response: 503 says "the server side is not
// configured", while a bad_request code in the same envelope tells the client
// its request was illegal. Clients that branch on status retry/alert; clients
// that branch on code treat the call as invalid. The HTTP status is NOT allowed
// to change here (503 stays 503) — only the code and the source of the status.
func TestGetDeliveryJournal_NotConfigured_CodeMatchesStatus(t *testing.T) {
	h := newTestHandler() // CallbackClient stays nil
	req := httptest.NewRequest(http.MethodGet, "/v1/delivery-journal", nil)
	rec := httptest.NewRecorder()
	h.GetDeliveryJournal(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d (status value must not change)", rec.Code, http.StatusServiceUnavailable)
	}
	assertErrorCode(t, rec.Body.String(), "not_configured")
	if strings.Contains(rec.Body.String(), `"bad_request"`) {
		t.Fatalf("body still carries bad_request next to a 503 status (mutually exclusive instructions): %s", rec.Body.String())
	}
	// The human-readable message is unchanged by this fix.
	if !strings.Contains(rec.Body.String(), "delivery journal not configured") {
		t.Fatalf("message text drifted: %s", rec.Body.String())
	}
}

// TestGetDeliveryJournal_SnapshotFailure_CodeMatchesStatus locks the second
// mutually-exclusive response: a failed DurableSnapshot is a server-side fault
// (500), so the code must be internal_error, not bad_request.
func TestGetDeliveryJournal_SnapshotFailure_CodeMatchesStatus(t *testing.T) {
	h := newTestHandler()
	h.CallbackClient = &failingCallbackJournal{err: errors.New("sqlite: journal table unreadable")}
	req := httptest.NewRequest(http.MethodGet, "/v1/delivery-journal", nil)
	rec := httptest.NewRecorder()
	h.GetDeliveryJournal(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d (status value must not change)", rec.Code, http.StatusInternalServerError)
	}
	assertErrorCode(t, rec.Body.String(), "internal_error")
	if strings.Contains(rec.Body.String(), `"bad_request"`) {
		t.Fatalf("body still carries bad_request next to a 500 status (mutually exclusive instructions): %s", rec.Body.String())
	}
	// The wrapped cause stays visible to operators; only the code changed.
	if !strings.Contains(rec.Body.String(), "journal snapshot: ") {
		t.Fatalf("message text drifted: %s", rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "journal table unreadable") {
		t.Fatalf("underlying cause no longer reported: %s", rec.Body.String())
	}
}
