package api

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/agenthub/edge-server/internal/sessionindex"
)

func TestGetRuntimeSessionsList(t *testing.T) {
	prev := listRuntimeSessions
	t.Cleanup(func() { listRuntimeSessions = prev })

	listRuntimeSessions = func(limit int, runtimes []sessionindex.RuntimeID) ([]sessionindex.SessionSummary, error) {
		if limit != 10 {
			t.Fatalf("limit=%d", limit)
		}
		if len(runtimes) != 1 || runtimes[0] != sessionindex.RuntimeCodex {
			t.Fatalf("runtimes=%v", runtimes)
		}
		return []sessionindex.SessionSummary{{
			Runtime:    sessionindex.RuntimeCodex,
			ID:         "sess-1",
			Title:      "observed title",
			Path:       "/tmp/fixture.jsonl",
			UpdatedAt:  "2026-07-16T10:00:00Z",
			SourceMode: sessionindex.SourceModeImport,
		}}, nil
	}

	server, _ := newTestServer(t)
	defer server.Close()

	var body map[string]any
	code := getJSON(t, server.URL+"/v1/runtime-sessions?limit=10&runtime=codex", &body)
	if code != http.StatusOK {
		t.Fatalf("status %d body=%v", code, body)
	}
	if body["code"] != "ok" {
		t.Fatalf("envelope %v", body)
	}
	data, _ := body["data"].(map[string]any)
	items, _ := data["items"].([]any)
	if len(items) != 1 {
		t.Fatalf("items=%v", items)
	}
	raw, _ := json.Marshal(items[0])
	var item sessionindex.SessionSummary
	if err := json.Unmarshal(raw, &item); err != nil {
		t.Fatal(err)
	}
	if item.SourceMode != sessionindex.SourceModeImport || item.ID != "sess-1" {
		t.Fatalf("item %+v", item)
	}
}

func TestGetRuntimeSessionsBadLimit(t *testing.T) {
	server, _ := newTestServer(t)
	defer server.Close()

	var body map[string]any
	code := getJSON(t, server.URL+"/v1/runtime-sessions?limit=0", &body)
	if code != http.StatusBadRequest {
		t.Fatalf("status %d body=%v", code, body)
	}
}

func TestGetRuntimeSessionsMethodNotAllowed(t *testing.T) {
	server, _ := newTestServer(t)
	defer server.Close()

	resp, err := http.Post(server.URL+"/v1/runtime-sessions", "application/json", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("status %d", resp.StatusCode)
	}
}
