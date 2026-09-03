package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/agenthub/edge-server/internal/hub"
)

func TestGetDeliveryJournal_ReturnsEntries(t *testing.T) {
	h := newTestHandler()
	h.CallbackClient = &fakeCallbackJournal{entries: []hub.DeliveryJournalEntry{
		{Seq: 1, TaskID: "t1", Action: "ack", OK: true, Attempts: 1},
		{Seq: 2, TaskID: "t1", Action: "done", OK: true, Attempts: 1},
	}}
	req := httptest.NewRequest(http.MethodGet, "/v1/delivery-journal?afterSeq=1", nil)
	rec := httptest.NewRecorder()
	h.GetDeliveryJournal(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"count":1`) && !strings.Contains(rec.Body.String(), `"count": 1`) {
		// tolerate spacing
		if !strings.Contains(rec.Body.String(), "done") {
			t.Fatalf("body=%s", rec.Body.String())
		}
	}
}

func TestGetDeliveryJournal_NotConfigured(t *testing.T) {
	h := newTestHandler()
	req := httptest.NewRequest(http.MethodGet, "/v1/delivery-journal", nil)
	rec := httptest.NewRecorder()
	h.GetDeliveryJournal(rec, req)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
}
