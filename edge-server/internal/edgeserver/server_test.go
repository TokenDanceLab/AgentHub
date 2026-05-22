package edgeserver_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/agenthub/agenthub/edge-server/internal/edgeserver"
)

func TestHealthReportsEdgeServiceIdentity(t *testing.T) {
	server := edgeserver.New(edgeserver.Config{Addr: ":0", Version: "test", EdgeID: "edge_local"})

	req := httptest.NewRequest(http.MethodGet, "/v1/health", nil)
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var body struct {
		Status  string `json:"status"`
		Service string `json:"service"`
		Version string `json:"version"`
		EdgeID  string `json:"edgeId"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response is not JSON: %v", err)
	}
	if body.Status != "ok" || body.Service != "edge-server" || body.Version != "test" || body.EdgeID != "edge_local" {
		t.Fatalf("health body = %+v", body)
	}
}

func TestUnknownRouteUsesErrorEnvelope(t *testing.T) {
	server := edgeserver.New(edgeserver.Config{Addr: ":0", Version: "test", EdgeID: "edge_local"})

	req := httptest.NewRequest(http.MethodGet, "/v1/missing", nil)
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusNotFound, rec.Body.String())
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
