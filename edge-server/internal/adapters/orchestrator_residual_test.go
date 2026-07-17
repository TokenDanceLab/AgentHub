package adapters

import (
	"strings"
	"testing"
	"time"

	"github.com/agenthub/edge-server/internal/agents"
	"github.com/agenthub/edge-server/internal/store"
)

func TestParseDispatchEvents(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		text string
		want int
	}{
		{
			name: "empty",
			text: "",
			want: 0,
		},
		{
			name: "noise lines",
			text: "hello\nnot json\n{short}\n",
			want: 0,
		},
		{
			name: "single dispatch",
			text: `{"action":"dispatch","agent":"coder","task":"implement feature"}`,
			want: 1,
		},
		{
			name: "multi line with noise",
			text: "plan follows\n" +
				`{"action":"dispatch","agent":"coder","task":"write tests"}` + "\n" +
				"commentary\n" +
				`{"action":"other","agent":"x","task":"y"}` + "\n" +
				`{"action":"dispatch","agent":"reviewer","task":"review PR"}` + "\n",
			want: 2,
		},
		{
			name: "missing agent skipped",
			text: `{"action":"dispatch","agent":"","task":"no agent here"}`,
			want: 0,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := parseDispatchEvents(tt.text)
			if len(got) != tt.want {
				t.Fatalf("len(events)=%d want %d", len(got), tt.want)
			}
		})
	}
}

func TestMatchDecisionKeyword(t *testing.T) {
	t.Parallel()
	tests := []struct {
		in   string
		want bool
	}{
		{"yes", true},
		{"approve", true},
		{"rejected", true},
		{"maybe", false},
		{strings.Repeat("approve ", 10), false},
	}
	for _, tt := range tests {
		if got := matchDecisionKeyword(tt.in); got != tt.want {
			t.Fatalf("matchDecisionKeyword(%q)=%v want %v", tt.in, got, tt.want)
		}
	}
}

func TestAllSameAgent(t *testing.T) {
	t.Parallel()
	if allSameAgent(nil) {
		t.Fatal("nil should be false")
	}
	if allSameAgent([]dispatchEvent{{Agent: "a"}}) {
		t.Fatal("single should be false")
	}
	if !allSameAgent([]dispatchEvent{{Agent: "a"}, {Agent: "a"}}) {
		t.Fatal("same agents should be true")
	}
	if allSameAgent([]dispatchEvent{{Agent: "a"}, {Agent: "b"}}) {
		t.Fatal("different agents should be false")
	}
}

func TestAttachSiblingContexts(t *testing.T) {
	t.Parallel()
	events := []dispatchEvent{
		{Agent: "a", Task: "t1", TargetFiles: []string{"a.go"}},
		{Agent: "b", Task: "t2"},
	}
	got := attachSiblingContexts(events)
	if len(got[0].siblings) != 1 || got[0].siblings[0].AgentName != "b" {
		t.Fatalf("event0 siblings=%v", got[0].siblings)
	}
	if len(got[1].siblings) != 1 || got[1].siblings[0].AgentName != "a" {
		t.Fatalf("event1 siblings=%v", got[1].siblings)
	}
}

func TestCloneDispatchForAgent(t *testing.T) {
	t.Parallel()
	orig := dispatchEvent{
		Action: "dispatch", Agent: "old", Task: "do work", Role: "worker",
		ThreadID: "th", Model: "m", SubtaskID: "s", TargetFiles: []string{"f"}, DependsOn: []string{"x"},
	}
	got := cloneDispatchForAgent(orig, "alt")
	if got.Agent != "alt" || got.Task != orig.Task || got.Action != "dispatch" {
		t.Fatalf("unexpected clone: %+v", got)
	}
	if got.SubtaskID != orig.SubtaskID || got.Model != orig.Model {
		t.Fatalf("fields not copied: %+v", got)
	}
}

func TestFormatResultSummary(t *testing.T) {
	t.Parallel()
	if got := formatResultSummary(nil); got != "(no output)" {
		t.Fatalf("nil: %q", got)
	}
	if got := formatResultSummary(map[string]any{"result": "ok"}); got != "ok" {
		t.Fatalf("result: %q", got)
	}
	long := strings.Repeat("a", 600)
	got := formatResultSummary(map[string]any{"result": long})
	if !strings.HasSuffix(got, "...") || len(got) != 503 {
		t.Fatalf("truncate: len=%d got=%q", len(got), got[:20])
	}
}

func TestCountChildStatusesAndProgress(t *testing.T) {
	t.Parallel()
	children := []agents.AgentInstance{
		{Status: agents.StatusCompleted},
		{Status: agents.StatusCompleted},
		{Status: agents.StatusBusy},
		{Status: agents.StatusError},
		{Status: agents.StatusIdle},
	}
	c := countChildStatuses(children)
	if c.completed != 2 || c.running != 1 || c.errored != 1 || c.waiting != 1 || c.total != 5 {
		t.Fatalf("counts=%+v", c)
	}
	summary := formatProgressSummaryText(c)
	if !strings.Contains(summary, "3 of 5 sub-agents done") {
		t.Fatalf("summary=%q", summary)
	}
	if !strings.Contains(summary, "2 completed") || !strings.Contains(summary, "1 error") {
		t.Fatalf("parts missing: %q", summary)
	}
}

func TestBuildPendingPlanFromDispatches(t *testing.T) {
	t.Parallel()
	run := store.Run{ID: "run1", ProjectID: "p1", ThreadID: "th1"}
	events := []dispatchEvent{
		{Agent: "coder", Task: "impl", DependsOn: nil},
		{Agent: "reviewer", Task: "review", DependsOn: []string{"coder"}},
	}
	plan := buildPendingPlanFromDispatches(run, events)
	if plan.RunID != "run1" || plan.Mode != "parallel" || len(plan.Tasks) != 2 {
		t.Fatalf("plan=%+v", plan)
	}
	if plan.Tasks[0].DependsOn == nil || len(plan.Tasks[0].DependsOn) != 0 {
		t.Fatalf("nil deps should become empty slice, got %#v", plan.Tasks[0].DependsOn)
	}
	if plan.Status != "pending" || plan.CreatedAt.IsZero() {
		t.Fatalf("status/time: status=%s created=%v", plan.Status, plan.CreatedAt)
	}
	// ensure CreatedAt is recent
	if time.Since(plan.CreatedAt) > time.Minute {
		t.Fatalf("CreatedAt too old: %v", plan.CreatedAt)
	}

	single := buildPendingPlanFromDispatches(run, events[:1])
	if single.Mode != "single" {
		t.Fatalf("single mode=%q", single.Mode)
	}
}

func TestPayloadBuildersKeys(t *testing.T) {
	t.Parallel()
	errP := dispatchErrorPayload("a", "t", "e", "s", "id1")
	for _, k := range []string{"action", "agent", "task", "error", "subtaskId", "agentId"} {
		if _, ok := errP[k]; !ok {
			t.Fatalf("missing key %s in error payload", k)
		}
	}
	if errP["action"] != "dispatch_error" {
		t.Fatalf("action=%v", errP["action"])
	}
	rej := dispatchRejectedPayload("a", "t", "e", "s")
	if rej["action"] != "dispatch_rejected" {
		t.Fatalf("reject action=%v", rej["action"])
	}
	td := taskDispatchedPayload("aid", "a", "t", "worker", "rid", "pid", "th", "m", "sid")
	for _, k := range []string{"agentId", "agent", "task", "role", "runId", "parentId", "threadId", "model", "subtaskId"} {
		if _, ok := td[k]; !ok {
			t.Fatalf("missing key %s in taskDispatched", k)
		}
	}
	st := subAgentStatusPayload("aid", "name", "busy", "dispatched", false, "")
	if st["progress"] != "dispatched" {
		t.Fatalf("progress=%v", st["progress"])
	}
	if _, ok := st["error"]; ok {
		t.Fatal("dispatch status should omit error key")
	}
	stErr := subAgentStatusPayload("aid", "name", "error", "skipped", true, "boom")
	if stErr["error"] != "boom" {
		t.Fatalf("error payload=%v", stErr["error"])
	}
	re := ruleEngineCompletionPayload()
	if re["source"] != "rule_engine" {
		t.Fatalf("source=%v", re["source"])
	}
}

func TestDefaultDispatchRole(t *testing.T) {
	t.Parallel()
	if defaultDispatchRole("") != "worker" {
		t.Fatal("empty should default")
	}
	if defaultDispatchRole("lead") != "lead" {
		t.Fatal("preserve role")
	}
}
