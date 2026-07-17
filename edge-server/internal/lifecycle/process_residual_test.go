package lifecycle

import (
	"errors"
	"testing"
	"time"

	"github.com/agenthub/edge-server/internal/agents"
	"github.com/agenthub/edge-server/internal/runnerctx"
	"github.com/agenthub/edge-server/internal/store"
)

func TestResolvePositiveDuration(t *testing.T) {
	t.Parallel()
	if got := resolvePositiveDuration(0, time.Minute); got != time.Minute {
		t.Fatalf("zero -> %v, want fallback", got)
	}
	if got := resolvePositiveDuration(-1, time.Second); got != time.Second {
		t.Fatalf("negative -> %v, want fallback", got)
	}
	if got := resolvePositiveDuration(5*time.Second, time.Minute); got != 5*time.Second {
		t.Fatalf("positive -> %v", got)
	}
}

func TestResolveMaxConcurrentRuns(t *testing.T) {
	t.Parallel()
	if got := resolveMaxConcurrentRuns(0); got != defaultMaxConcurrentRuns {
		t.Fatalf("zero -> %d, want default %d", got, defaultMaxConcurrentRuns)
	}
	if got := resolveMaxConcurrentRuns(12); got != 12 {
		t.Fatalf("positive -> %d", got)
	}
}

func TestProcessIDs(t *testing.T) {
	t.Parallel()
	if got := subAgentRunID("t1"); got != "run_t1" {
		t.Fatalf("run id %q", got)
	}
	if got := subAgentInstanceID("t1"); got != "agent_t1" {
		t.Fatalf("instance id %q", got)
	}
	if got := subAgentMessageID("run_t1"); got != "msg_run_t1" {
		t.Fatalf("message id %q", got)
	}
	if got := subAgentPath("run_p", "agent_c"); got != "/run_p/agent_c" {
		t.Fatalf("path %q", got)
	}
}

func TestResolveSubAgentThreadID(t *testing.T) {
	t.Parallel()
	if got := resolveSubAgentThreadID("th_parent", "run_c", ""); got != "th_parent/sub/run_c" {
		t.Fatalf("derived %q", got)
	}
	if got := resolveSubAgentThreadID("th_parent", "run_c", "th_explicit"); got != "th_explicit" {
		t.Fatalf("explicit %q", got)
	}
}

func TestAppendSystemPromptPrefix(t *testing.T) {
	t.Parallel()
	if got := appendSystemPromptPrefix("base", ""); got != "base" {
		t.Fatalf("empty prefix %q", got)
	}
	if got := appendSystemPromptPrefix("", "pre"); got != "pre" {
		t.Fatalf("empty existing %q", got)
	}
	if got := appendSystemPromptPrefix("base", "pre"); got != "pre\n\nbase" {
		t.Fatalf("both %q", got)
	}
}

func TestPermissionModeHelpers(t *testing.T) {
	t.Parallel()
	if !isForbiddenPermissionMode("bypassPermissions") {
		t.Fatal("expected forbidden")
	}
	if isForbiddenPermissionMode("default") {
		t.Fatal("default should be allowed")
	}
	if got := normalizePermissionMode("bypassPermissions"); got != "default" {
		t.Fatalf("normalize forbidden -> %q", got)
	}
	if got := normalizePermissionMode("acceptEdits"); got != "acceptEdits" {
		t.Fatalf("normalize allowed -> %q", got)
	}
}

func TestEvidenceGateFinalStatus(t *testing.T) {
	t.Parallel()
	if got := evidenceGateFinalStatus(true); got != "finished" {
		t.Fatalf("pass -> %q", got)
	}
	if got := evidenceGateFinalStatus(false); got != "completed_with_issues" {
		t.Fatalf("fail -> %q", got)
	}
}

func TestSubAgentResultMsgType(t *testing.T) {
	t.Parallel()
	if got := subAgentResultMsgType("failed"); got != agents.MsgTypeError {
		t.Fatalf("failed -> %q", got)
	}
	if got := subAgentResultMsgType("cancelled"); got != agents.MsgTypeError {
		t.Fatalf("cancelled -> %q", got)
	}
	if got := subAgentResultMsgType("finished"); got != agents.MsgTypeResult {
		t.Fatalf("finished -> %q", got)
	}
	if got := subAgentResultMsgType("completed_with_issues"); got != agents.MsgTypeResult {
		t.Fatalf("completed_with_issues -> %q", got)
	}
}

func TestSubAgentRegistryTerminalStatus(t *testing.T) {
	t.Parallel()
	st, ok := subAgentRegistryTerminalStatus("failed")
	if !ok || st != agents.StatusError {
		t.Fatalf("failed -> %q %v", st, ok)
	}
	st, ok = subAgentRegistryTerminalStatus("completed_with_issues")
	if !ok || st != agents.StatusCompleted {
		t.Fatalf("completed_with_issues -> %q %v", st, ok)
	}
	if _, ok := subAgentRegistryTerminalStatus("started"); ok {
		t.Fatal("started should not update registry")
	}
}

func TestContextCompactionPayload(t *testing.T) {
	t.Parallel()
	p := contextCompactionPayload("run_1", 0.9, 100, 10)
	if p["runId"] != "run_1" || p["threshold"] != runnerctx.CompactionThreshold {
		t.Fatalf("payload %#v", p)
	}
}

func TestRunOutputBatchPayload(t *testing.T) {
	t.Parallel()
	p := runOutputBatchPayload("run_1", "stdout", "hi", 3, false, 0, 0)
	if p["stream"] != "stdout" {
		t.Fatalf("stream %v", p["stream"])
	}
	if _, ok := p["truncated"]; ok {
		t.Fatal("truncated key should be absent")
	}
	p2 := runOutputBatchPayload("run_1", "stderr", "x", 0, true, 9, 100)
	if p2["truncated"] != true || p2["maxBytes"] != int64(100) {
		t.Fatalf("truncated payload %#v", p2)
	}
}

func TestSubAgentErrorAndQueuePayload(t *testing.T) {
	t.Parallel()
	errP := subAgentErrorPayload(errors.New("boom"))
	if errP["error"] != "boom" {
		t.Fatalf("error payload %#v", errP)
	}
	q := subAgentResultQueuePayload("run_1", "finished", "a1", "worker", "ok", "redacted")
	if q["_sanitized"] != true || q["_sanitized_reason"] != "redacted" {
		t.Fatalf("queue %#v", q)
	}
	q2 := subAgentResultQueuePayload("run_1", "finished", "a1", "worker", "ok", "")
	if q2["_sanitized"] != false {
		t.Fatalf("unsanitized %#v", q2)
	}
}

func TestAgentFailureItemAndItemScope(t *testing.T) {
	t.Parallel()
	run := store.Run{ID: "run_1", ProjectID: "p", ThreadID: "th"}
	item := agentFailureItem(run, "item_1", "failed hard")
	if item.Type != "agent_message" || item.Status != "failed" || item.Content != "failed hard" {
		t.Fatalf("item %#v", item)
	}
	scope := itemEventScope(item)
	if scope["itemId"] != "item_1" || scope["runId"] != "run_1" {
		t.Fatalf("scope %#v", scope)
	}
}

func TestAdapterMetricsLabel(t *testing.T) {
	t.Parallel()
	if got := adapterMetricsLabel("", false); got != "none" {
		t.Fatalf("no adapter %q", got)
	}
	if got := adapterMetricsLabel("claude", true); got != "claude" {
		t.Fatalf("adapter %q", got)
	}
}

func TestStderrLogLines(t *testing.T) {
	t.Parallel()
	if stderrLogLines("") != nil {
		t.Fatal("empty should be nil")
	}
	got := stderrLogLines("a\r\nb\n\n c \n")
	if len(got) != 3 || got[0] != "a" || got[1] != "b" || got[2] != " c " {
		t.Fatalf("got %#v", got)
	}
}

func TestFaultEscalationPayloads(t *testing.T) {
	t.Parallel()
	r := faultEscalationRetryPayload("run_1", 2, 5)
	if r["retryCount"] != 2 || r["maxRetries"] != 5 {
		t.Fatalf("%#v", r)
	}
	e := faultEscalationExhaustedPayload("run_1", 5)
	if e["maxRetries"] != 5 {
		t.Fatalf("%#v", e)
	}
}

func TestRunFailedAndPersistencePayloads(t *testing.T) {
	t.Parallel()
	classified := &RunError{Code: ErrCodeUnknown, Message: "x"}
	p := runFailedEventPayload("run_1", "failed", classified)
	if p["error"] != classified || p["status"] != "failed" {
		t.Fatalf("%#v", p)
	}
	scope, payload := persistenceErrorScopePayload("run_1", errors.New("disk full"))
	if scope["runId"] != "run_1" || payload["error"] != "disk full" {
		t.Fatalf("%#v %#v", scope, payload)
	}
}
