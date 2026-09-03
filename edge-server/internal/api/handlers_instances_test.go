package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/agenthub/edge-server/internal/agents"
)

func TestGetAgentInstanceRoute(t *testing.T) {
	h := newTestHandler()
	h.AgentRegistry = agents.NewRegistry()
	if err := h.AgentRegistry.Register(&agents.AgentInstance{
		ID:        "agent_worker_1",
		AdapterID: "codex",
		Name:      "Contract Worker",
		Status:    agents.StatusBusy,
		RunID:     "run_contract",
		ParentID:  "agent_parent",
	}); err != nil {
		t.Fatalf("Register returned error: %v", err)
	}
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/v1/agent-instances/agent_worker_1", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("GET /v1/agent-instances/agent_worker_1 status = %d, want 200 body=%s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode body: %v", err)
	}
	body = unwrapSuccess(body)
	if body["id"] != "agent_worker_1" || body["adapterId"] != "codex" || body["runId"] != "run_contract" {
		t.Fatalf("agent instance body = %#v, want registered instance", body)
	}
}
