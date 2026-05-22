package httpapi_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/agenthub/agenthub/internal/httpapi"
)

func TestWriteJSONSetsContractHeadersAndBody(t *testing.T) {
	rec := httptest.NewRecorder()

	httpapi.WriteJSON(rec, http.StatusAccepted, map[string]string{"id": "edge_1"})

	if rec.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusAccepted)
	}
	if got := rec.Header().Get("Content-Type"); got != "application/json" {
		t.Fatalf("Content-Type = %q, want application/json", got)
	}

	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response is not JSON: %v", err)
	}
	if body["id"] != "edge_1" {
		t.Fatalf("id = %q, want edge_1", body["id"])
	}
}

func TestWriteErrorUsesAPIErrorEnvelope(t *testing.T) {
	rec := httptest.NewRecorder()

	httpapi.WriteError(rec, http.StatusBadRequest, "bad_request", "请求字段非法", "trace_1", map[string]string{
		"field": "name",
	})

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}

	var body struct {
		Error struct {
			Code    string            `json:"code"`
			Message string            `json:"message"`
			TraceID string            `json:"traceId"`
			Details map[string]string `json:"details"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response is not JSON: %v", err)
	}
	if body.Error.Code != "bad_request" {
		t.Fatalf("code = %q, want bad_request", body.Error.Code)
	}
	if body.Error.TraceID != "trace_1" {
		t.Fatalf("traceId = %q, want trace_1", body.Error.TraceID)
	}
	if body.Error.Details["field"] != "name" {
		t.Fatalf("details.field = %q, want name", body.Error.Details["field"])
	}
}

func TestHandleNotFoundUsesErrorEnvelope(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/v1/missing", nil)
	rec := httptest.NewRecorder()

	httpapi.HandleNotFound(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusNotFound)
	}

	var body struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response is not JSON: %v", err)
	}
	if body.Error.Code != "not_found" {
		t.Fatalf("code = %q, want not_found", body.Error.Code)
	}
}
