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
