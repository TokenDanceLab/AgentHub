package agentevent

import (
	"encoding/json"
	"testing"
)

func stampTaskID(t *testing.T, content string) string {
	t.Helper()
	var obj map[string]json.RawMessage
	if err := json.Unmarshal([]byte(content), &obj); err != nil {
		t.Fatalf("stamped content is not a json object: %v", err)
	}
	var ref struct {
		TaskID string `json:"task_id"`
	}
	raw, ok := obj["agent_task"]
	if !ok {
		t.Fatalf("agent_task ref missing in %s", content)
	}
	if err := json.Unmarshal(raw, &ref); err != nil {
		t.Fatalf("agent_task ref unreadable: %v", err)
	}
	return ref.TaskID
}

func TestStampAgentTaskRefObjectContent(t *testing.T) {
	out := StampAgentTaskRef(`{"content":"B-1 final answer"}`, "task-1")
	if got := stampTaskID(t, out); got != "task-1" {
		t.Fatalf("task_id = %q, want task-1", got)
	}
	// the visible text must survive untouched
	var obj map[string]any
	if err := json.Unmarshal([]byte(out), &obj); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if obj["content"] != "B-1 final answer" {
		t.Fatalf("content reshaped: %v", obj["content"])
	}
}

func TestStampAgentTaskRefNeverReshapesNonObjects(t *testing.T) {
	for _, in := range []string{`["a","b"]`, `"plain"`, `42`, `null`, `not json`} {
		if out := StampAgentTaskRef(in, "task-1"); out != in {
			t.Fatalf("non-object content reshaped: in=%s out=%s", in, out)
		}
	}
}

func TestStampAgentTaskRefNoOpEdges(t *testing.T) {
	if out := StampAgentTaskRef(`{"content":"x"}`, ""); out != `{"content":"x"}` {
		t.Fatalf("empty task id must be a no-op, got %s", out)
	}
	if out := StampAgentTaskRef("", "task-1"); out != "" {
		t.Fatalf("empty content must be a no-op, got %s", out)
	}
}

func TestStampAgentTaskRefPreservesExistingRef(t *testing.T) {
	in := `{"content":"x","agent_task":{"task_id":"original","status":"done"}}`
	if out := StampAgentTaskRef(in, "task-1"); stampTaskID(t, out) != "original" {
		t.Fatalf("existing agent_task ref was overwritten: %s", out)
	}
}
