package api

import (
	"encoding/json"
	"testing"
)

func TestListResponseFormat(t *testing.T) {
	listResp := listResponse([]string{"a", "b"})
	data, _ := json.Marshal(listResp)

	var body map[string]any
	if err := json.Unmarshal(data, &body); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}

	items, ok := body["items"].([]any)
	if !ok || len(items) != 2 {
		t.Error("expected items array with 2 elements")
	}
}

func TestAcceptedResponseFormat(t *testing.T) {
	data := acceptedResponse(map[string]any{"runId": "run_1", "status": "queued"})
	if data["runId"] != "run_1" {
		t.Errorf("runId = %v, want run_1", data["runId"])
	}
}
