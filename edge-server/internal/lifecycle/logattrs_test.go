package lifecycle

import (
	"testing"

	"github.com/agenthub/pkg/otelids"
)

func TestRunLogAttrsContainsBothCases(t *testing.T) {
	attrs := RunLogAttrs("r1", "a1")
	keys := map[string]string{}
	for _, a := range attrs {
		keys[a.Key] = a.Value.String()
	}
	for _, want := range []string{"run_id", "runId", "agent_id", "agentId"} {
		if v, ok := keys[want]; !ok || v == "" {
			t.Errorf("missing or empty key %q in attrs", want)
		}
	}
	if keys["run_id"] != "r1" || keys["agent_id"] != "a1" {
		t.Fatalf("unexpected values: %+v", keys)
	}
}

func TestRunLogAttrsWithTraceAddsTraceID(t *testing.T) {
	attrs := RunLogAttrsWithTrace("r1", "a1", "deadbeefdeadbeefdeadbeefdeadbeef")
	found := false
	for _, a := range attrs {
		if a.Key == "trace_id" {
			found = true
			if a.Value.String() != "deadbeefdeadbeefdeadbeefdeadbeef" {
				t.Fatalf("trace_id value = %q", a.Value.String())
			}
		}
	}
	if !found {
		t.Fatal("trace_id attr missing when traceID non-empty")
	}
}

func TestRunLogAttrsWithTraceOmitsEmpty(t *testing.T) {
	attrs := RunLogAttrsWithTrace("r1", "a1", "")
	for _, a := range attrs {
		if a.Key == "trace_id" {
			t.Fatal("trace_id attr should be omitted when empty")
		}
	}
	_ = otelids.NewTraceID // ensure import used
}
