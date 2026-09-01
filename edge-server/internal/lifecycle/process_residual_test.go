package lifecycle

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/adapters/claude"
	"github.com/agenthub/edge-server/internal/agents"
	"github.com/agenthub/edge-server/internal/events"
	"github.com/agenthub/edge-server/internal/hub"
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
	if errP["error"] != "sub-agent execution failed" {
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

func TestAggregatorOutput(t *testing.T) {
	t.Parallel()
	raw := "secret raw"
	sanitized := "redacted"
	if got := aggregatorOutput(raw, sanitized, ""); got != raw {
		t.Fatalf("unchanged reason -> %v, want raw", got)
	}
	if got := aggregatorOutput(raw, sanitized, "api-keys-redacted"); got != sanitized {
		t.Fatalf("with reason -> %v, want sanitized", got)
	}
}

func TestNewSubAgentInstance(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 7, 18, 1, 2, 3, 0, time.UTC)
	task := adapters.SubAgentTask{AgentID: "worker", Depth: 2}
	inst := newSubAgentInstance("run_parent", "agent_child", "run_child", "th_child", task, now)
	if inst == nil {
		t.Fatal("expected instance")
	}
	if inst.ID != "agent_child" || inst.Name != "worker" || inst.AdapterID != "worker" {
		t.Fatalf("ids %#v", inst)
	}
	if inst.Role != "sub-agent" || inst.Status != agents.StatusIdle {
		t.Fatalf("role/status %#v", inst)
	}
	if inst.RunID != "run_child" || inst.ThreadID != "th_child" || inst.ParentID != "run_parent" {
		t.Fatalf("linkage %#v", inst)
	}
	if inst.Depth != 2 || inst.AgentPath != "/run_parent/agent_child" {
		t.Fatalf("depth/path %#v", inst)
	}
	if !inst.CreatedAt.Equal(now) || !inst.LastSeen.Equal(now) {
		t.Fatalf("timestamps created=%v last=%v", inst.CreatedAt, inst.LastSeen)
	}
}

func TestSanitizeHubStreamText(t *testing.T) {
	t.Parallel()
	if got := sanitizeHubStreamText(""); got != "" {
		t.Fatalf("empty -> %q", got)
	}
	pathy := "working in /workspace/AgentHub/README.md"
	if got := sanitizeHubStreamText(pathy); got != pathy {
		t.Fatalf("paths should remain: %q", got)
	}
	// Split literal so secret-guard does not treat the fixture as a live key.
	leaky := "token sk-" + "abcdefghijklmnopqrstuvwxyz0123456789 and path /workspace/x"
	got := sanitizeHubStreamText(leaky)
	if got == leaky {
		t.Fatal("expected api key redaction")
	}
	if !strings.Contains(got, "[redacted:api-key]") {
		t.Fatalf("missing redaction marker: %q", got)
	}
	if !strings.Contains(got, "/workspace/x") {
		t.Fatalf("path should remain in hub stream: %q", got)
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
	if scope["runId"] != "run_1" || payload["error"] != "persistence error" {
		t.Fatalf("%#v %#v", scope, payload)
	}
}

func TestRunStatusHelpers(t *testing.T) {
	t.Parallel()
	if !isQueuedRunStatus("queued") {
		t.Fatal("queued should be startable")
	}
	if isQueuedRunStatus("started") {
		t.Fatal("started should not be queued")
	}
	for _, st := range []string{"queued", "started", "cancelling"} {
		if !isCancellableRunStatus(st) {
			t.Fatalf("%s should be cancellable", st)
		}
	}
	if isCancellableRunStatus("finished") {
		t.Fatal("finished should not be cancellable")
	}
}

func TestShouldCloseStdinEagerly(t *testing.T) {
	t.Parallel()
	if !shouldCloseStdinEagerly(false, false) {
		t.Fatal("neither needs stdin nor decision loop -> close")
	}
	if shouldCloseStdinEagerly(true, false) {
		t.Fatal("adapter needs stdin -> keep open")
	}
	if shouldCloseStdinEagerly(false, true) {
		t.Fatal("decision loop -> keep open")
	}
}

func TestShouldRetrySessionConflict(t *testing.T) {
	t.Parallel()
	err := errors.New("Session ID abc is already in use")
	if !shouldRetrySessionConflict(err, "", 0, time.Second) {
		t.Fatal("expected retry")
	}
	if shouldRetrySessionConflict(err, "", 1, time.Second) {
		t.Fatal("attempt 1 should not retry")
	}
	if shouldRetrySessionConflict(err, "", 0, sessionRetryWindow) {
		t.Fatal("elapsed at window should not retry")
	}
	if shouldRetrySessionConflict(nil, "is already in use", 0, time.Second) {
		t.Fatal("nil err should not retry")
	}
	if !shouldRetrySessionConflict(errors.New("exit status 1"), "No conversation found with session ID", 0, time.Second) {
		t.Fatal("stderr conflict should retry")
	}
}

func TestRecoverableParseStreamError(t *testing.T) {
	t.Parallel()
	if _, ok := recoverableParseStreamError(nil); ok {
		t.Fatal("nil not recoverable")
	}
	if _, ok := recoverableParseStreamError(errors.New("plain")); ok {
		t.Fatal("plain error not recoverable")
	}
	if _, ok := recoverableParseStreamError(adapters.NewNonRecoverableParseError(errors.New("pipe"))); ok {
		t.Fatal("non-recoverable parse should fail closed")
	}
	ps, ok := recoverableParseStreamError(adapters.NewRecoverableParseError(errors.New("malformed")))
	if !ok || ps == nil {
		t.Fatal("expected recoverable parse error")
	}
	if ps.Unwrap().Error() != "malformed" {
		t.Fatalf("unwrap %v", ps.Unwrap())
	}
}

func TestFaultEscalationHelpers(t *testing.T) {
	t.Parallel()
	if faultEscalationActive(FaultEscalationConfig{Enabled: false, MaxRetries: 3}) {
		t.Fatal("disabled should be inactive")
	}
	if faultEscalationActive(FaultEscalationConfig{Enabled: true, MaxRetries: 0}) {
		t.Fatal("zero max should be inactive")
	}
	cfg := FaultEscalationConfig{Enabled: true, MaxRetries: 2}
	if !faultEscalationActive(cfg) {
		t.Fatal("expected active")
	}
	if !shouldFaultEscalateRetry(cfg, 0) || !shouldFaultEscalateRetry(cfg, 1) {
		t.Fatal("retry under max")
	}
	if shouldFaultEscalateRetry(cfg, 2) {
		t.Fatal("at max should not retry")
	}
}

func TestWithParserContextValues(t *testing.T) {
	t.Parallel()
	budget := runnerctx.NewContextBudget(1000)
	runCtx := RunProcessContext{
		Run:     store.Run{ID: "run_1"},
		Prompt:  "hi",
		WorkDir: "D:/tmp/ws",
		Budget:  budget,
		Model:   "m",
		AgentID: "claude",
	}
	ctx := withParserContextValues(context.Background(), runCtx)
	if got, ok := ctx.Value(adapters.CtxBudgetKey).(*runnerctx.ContextBudget); !ok || got != budget {
		t.Fatalf("budget missing: %v %v", got, ok)
	}
	if got, ok := ctx.Value(adapters.CtxWorkDir).(string); !ok || got != "D:/tmp/ws" {
		t.Fatalf("workdir missing: %v %v", got, ok)
	}
	rc, ok := adapters.RunProcessContextFromContext(ctx)
	if !ok {
		t.Fatal("SDK run context missing")
	}
	if rc.Prompt != "hi" || rc.Model != "m" || rc.AgentID != "claude" {
		t.Fatalf("sdk ctx %#v", rc)
	}
}

func TestNewSubAgentRunContext(t *testing.T) {
	t.Parallel()
	run := store.Run{ID: "run_c", ProjectID: "p", ThreadID: "th_c"}
	parentBudget := runnerctx.NewContextBudget(10000)
	task := adapters.SubAgentTask{
		AgentID: "worker",
		Prompt:  "do work",
		Depth:   1,
		Model:   "sonnet",
		Budget:  parentBudget,
	}
	got := newSubAgentRunContext(run, task)
	if got.Run.ID != "run_c" || got.Prompt != "do work" || got.AgentID != "worker" || got.Model != "sonnet" {
		t.Fatalf("fields %#v", got)
	}
	// The CC session must be a fresh UUID, not the hierarchical thread path
	// (claude-code rejects non-UUID --session-id values).
	if got.SessionID == "th_c" || !uuidLike(got.SessionID) {
		t.Fatalf("session %q, want a fresh UUID (not the thread path)", got.SessionID)
	}
	if got.Budget == nil || got.Budget == parentBudget {
		t.Fatal("expected isolated child budget")
	}
}

func TestWithSiblingSystemPrompt(t *testing.T) {
	t.Parallel()
	if got := withSiblingSystemPrompt("base", nil); got != "base" {
		t.Fatalf("nil siblings %q", got)
	}
	siblings := []adapters.SiblingInfo{{AgentName: "codex", TaskDesc: "write tests", TargetFiles: []string{"a.go"}}}
	got := withSiblingSystemPrompt("base", siblings)
	if !strings.Contains(got, "codex") || !strings.Contains(got, "base") {
		t.Fatalf("got %q", got)
	}
	if !strings.HasPrefix(got, adapters.BuildSiblingContextPrompt(siblings)) {
		t.Fatalf("prefix missing: %q", got)
	}
}

func TestHubDoneResultHelpers(t *testing.T) {
	t.Parallel()
	if got := hubDoneFinalContent(""); got != "Run finished" {
		t.Fatalf("empty -> %q", got)
	}
	if got := hubDoneFinalContent("hello"); got != "hello" {
		t.Fatalf("content -> %q", got)
	}
	res := hubTaskDoneResult("run_1", "")
	if res.RunID != "run_1" || res.FinalContent != "Run finished" {
		t.Fatalf("%#v", res)
	}
	_ = hub.TaskResult{}
}

func TestNeedsAdapterStdinAndMetricsLabel(t *testing.T) {
	t.Parallel()
	if needsAdapterStdin(nil) {
		t.Fatal("nil adapter")
	}
	if got := resolveAdapterMetricsLabel(nil); got != "none" {
		t.Fatalf("nil label %q", got)
	}
	ad := claude.NewClaudeCodeAdapter("claude", "sonnet", "")
	if got := resolveAdapterMetricsLabel(ad); got == "" || got == "none" {
		t.Fatalf("adapter label %q", got)
	}
	_ = needsAdapterStdin(ad)
	_ = fmt.Sprintf("%v", ad != nil)
}

func TestCanStartRun(t *testing.T) {
	t.Parallel()
	if err := canStartRun(0, 0, false); err != nil {
		t.Fatalf("empty map should start: %v", err)
	}
	if err := canStartRun(defaultMaxConcurrentRuns, 0, false); !errors.Is(err, ErrTooManyConcurrentRuns) {
		t.Fatalf("at default max -> %v", err)
	}
	if err := canStartRun(0, 3, true); !errors.Is(err, ErrRunAlreadyStarted) {
		t.Fatalf("already running -> %v", err)
	}
	if err := canStartRun(2, 3, false); err != nil {
		t.Fatalf("under custom max -> %v", err)
	}
}

func TestShouldResolveAdapter(t *testing.T) {
	t.Parallel()
	if shouldResolveAdapter(false, "a", true) {
		t.Fatal("no registry")
	}
	if !shouldResolveAdapter(true, "a", false) {
		t.Fatal("agent id should resolve")
	}
	if !shouldResolveAdapter(true, "", true) {
		t.Fatal("default adapter should resolve")
	}
	if shouldResolveAdapter(true, "", false) {
		t.Fatal("no agent and no default")
	}
}

func TestSanitizePermissionMode(t *testing.T) {
	t.Parallel()
	mode, forbidden := sanitizePermissionMode("bypassPermissions")
	if !forbidden || mode != "default" {
		t.Fatalf("forbidden -> %q %v", mode, forbidden)
	}
	mode, forbidden = sanitizePermissionMode("acceptEdits")
	if forbidden || mode != "acceptEdits" {
		t.Fatalf("allowed -> %q %v", mode, forbidden)
	}
}

func TestEnvForAdapterOrProfile(t *testing.T) {
	t.Parallel()
	run := store.Run{ID: "run_1", ProjectID: "p", ThreadID: "th"}
	adapterEnv := envForAdapterOrProfile(run, true, []string{"ANTHROPIC_API_KEY=x"}, []string{"EXTRA=1"})
	joined := strings.Join(adapterEnv, "\n")
	if !strings.Contains(joined, "AGENTHUB_RUN_ID=run_1") {
		t.Fatalf("adapter mode missing runtime vars: %#v", adapterEnv)
	}
	if !strings.Contains(joined, "EXTRA=1") || !strings.Contains(joined, "ANTHROPIC_API_KEY=x") {
		t.Fatalf("adapter mode missing overlay: %#v", adapterEnv)
	}
	profileEnv := envForAdapterOrProfile(run, false, []string{"CUSTOM=1"}, []string{"EXTRA=2"})
	joined = strings.Join(profileEnv, "\n")
	if !strings.Contains(joined, "CUSTOM=1") || !strings.Contains(joined, "EXTRA=2") {
		t.Fatalf("profile mode %#v", profileEnv)
	}
	if !strings.Contains(joined, "AGENTHUB_THREAD_ID=th") {
		t.Fatalf("profile mode missing runtime: %#v", profileEnv)
	}
}

func TestWithFreshSessionAndCancelPredicates(t *testing.T) {
	t.Parallel()
	runCtx := RunProcessContext{SessionID: "old", ContinueLast: true}
	got := withFreshSession(runCtx, "new")
	if got.SessionID != "new" || got.ContinueLast {
		t.Fatalf("%#v", got)
	}
	if !shouldTreatAsCancelled(context.Canceled, "started") {
		t.Fatal("ctx cancel")
	}
	if !shouldTreatAsCancelled(nil, "cancelling") {
		t.Fatal("status cancelling")
	}
	if shouldTreatAsCancelled(nil, "started") {
		t.Fatal("running should not cancel")
	}
	if !shouldSurfaceRunArtifacts(true, "finished") {
		t.Fatal("finished should surface")
	}
	if shouldSurfaceRunArtifacts(false, "finished") || shouldSurfaceRunArtifacts(true, "failed") {
		t.Fatal("non-finished should not surface")
	}
}

func TestAgentFailurePersistenceHelpers(t *testing.T) {
	t.Parallel()
	if _, ok := trimAgentFailureContent("  \n"); ok {
		t.Fatal("blank content")
	}
	got, ok := trimAgentFailureContent("  boom  ")
	if !ok || got != "boom" {
		t.Fatalf("%q %v", got, ok)
	}
	items := []store.Item{
		{RunID: "run_1", Type: "user_message"},
		{RunID: "run_2", Type: "agent_message"},
	}
	if hasAgentMessageForRun(items, "run_1") {
		t.Fatal("user message is not agent_message")
	}
	if !hasAgentMessageForRun(items, "run_2") {
		t.Fatal("expected existing agent_message")
	}
}

func TestApplyParentWorkDirMemory(t *testing.T) {
	t.Parallel()
	base := RunProcessContext{Prompt: "hi"}
	if got := applyParentWorkDirMemory(base, "", "th", "agent"); got.WorkDir != "" {
		t.Fatalf("empty parent %#v", got)
	}
	// Empty workDir yields empty memory; still copies workdir when provided.
	got := applyParentWorkDirMemory(base, "D:/tmp/ws", "th", "agent")
	if got.WorkDir != "D:/tmp/ws" {
		t.Fatalf("workdir %#v", got)
	}
}

func TestSubAgentDeliveryPredicates(t *testing.T) {
	t.Parallel()
	if shouldDeliverSubAgentResult(false, true) || shouldDeliverSubAgentResult(true, false) {
		t.Fatal("both registry and queue required")
	}
	if !shouldDeliverSubAgentResult(true, true) {
		t.Fatal("expected delivery ready")
	}
	if shouldRouteSubAgentToParent(false, "p") || shouldRouteSubAgentToParent(true, "") {
		t.Fatal("parent required")
	}
	if !shouldRouteSubAgentToParent(true, "parent") {
		t.Fatal("expected route")
	}
	if !shouldRecordHubTask("task_1") || shouldRecordHubTask("") {
		t.Fatal("hub task predicate")
	}
}

func TestParserContextAndSecurityHooks(t *testing.T) {
	t.Parallel()
	if _, ok := budgetFromParserContext(context.Background()); ok {
		t.Fatal("empty ctx")
	}
	budget := runnerctx.NewContextBudget(100)
	ctx := context.WithValue(context.Background(), adapters.CtxBudgetKey, budget)
	got, ok := budgetFromParserContext(ctx)
	if !ok || got != budget {
		t.Fatalf("budget %v %v", got, ok)
	}
	if _, ok := allowedToolsFromParserContext(context.Background()); ok {
		t.Fatal("no tools")
	}
	rcCtx := adapters.SDKAdapterContext(context.Background(), adapters.RunProcessContext{
		AllowedTools: []string{"Read", "Edit"},
	})
	tools, ok := allowedToolsFromParserContext(rcCtx)
	if !ok || len(tools) != 2 {
		t.Fatalf("tools %#v %v", tools, ok)
	}
	hooks := buildProcessSecurityHooks(nil, adapters.NewBusEventEmitter(nil), map[string]any{"runId": "r"})
	if len(hooks) != 1 {
		t.Fatalf("security-only hooks %d", len(hooks))
	}
	hooks = buildProcessSecurityHooks([]string{"Read"}, adapters.NewBusEventEmitter(nil), map[string]any{"runId": "r"})
	if len(hooks) != 2 {
		t.Fatalf("allowlist+security hooks %d", len(hooks))
	}
	msg := recoverableParseWarningMessage(errors.New("malformed"))
	if !strings.Contains(msg, "malformed") || !strings.HasPrefix(msg, "Recoverable stream parse error:") {
		t.Fatalf("msg %q", msg)
	}
}

func TestCancelResultHelpers(t *testing.T) {
	t.Parallel()
	if got := cancelResultNotFound(); got.Found || got.Status != "not_found" {
		t.Fatalf("not found %#v", got)
	}
	if got := cancelResultNotRunning(); got.Found || got.Status != "not_running" {
		t.Fatalf("not running %#v", got)
	}
	run := store.Run{ID: "run_1", Status: "started"}
	got := cancelResultWithRun(run)
	if !got.Found || got.Status != "started" || got.Run.ID != "run_1" {
		t.Fatalf("with run %#v", got)
	}
	if interruptRequestID("run_9") != "interrupt-run_9" {
		t.Fatalf("interrupt id %q", interruptRequestID("run_9"))
	}
}

func TestWorkDirAndCompactionPredicates(t *testing.T) {
	t.Parallel()
	if shouldTrackWorkDir("") {
		t.Fatal("empty workdir")
	}
	if !shouldTrackWorkDir("D:/tmp/ws") {
		t.Fatal("non-empty workdir")
	}
	if shouldEmitContextCompaction(nil) {
		t.Fatal("nil budget")
	}
	// ReservedTokens defaults to 10k, so use a large maxTokens window.
	budget := runnerctx.NewContextBudget(100_000)
	if shouldEmitContextCompaction(budget) {
		t.Fatal("unused budget should not compact")
	}
	// Usable = 90_000; 85% threshold ≈ 76_500.
	budget.UsedTokens.Store(80_000)
	if !shouldEmitContextCompaction(budget) {
		t.Fatal("over-threshold budget should compact")
	}
	if budget.ShouldCompact() != shouldEmitContextCompaction(budget) {
		t.Fatal("predicate must mirror budget.ShouldCompact")
	}
}

func TestHubCallbackAndStreamHelpers(t *testing.T) {
	t.Parallel()
	if shouldFireHubCallback(false, "t1") || shouldFireHubCallback(true, "") {
		t.Fatal("callback requires both sides")
	}
	if !shouldFireHubCallback(true, "task") {
		t.Fatal("expected fire")
	}
	if _, ok := prepareHubStreamContent(""); ok {
		t.Fatal("empty content")
	}
	got, ok := prepareHubStreamContent("hello")
	if !ok || got != "hello" {
		t.Fatalf("plain %q %v", got, ok)
	}
	// Split literal so secret-guard does not treat the fixture as a live key.
	leaky := "token sk-" + "abcdefghijklmnopqrstuvwxyz0123456789"
	sanitized, ok := prepareHubStreamContent(leaky)
	if !ok {
		t.Fatal("expected sanitized content")
	}
	if sanitized == leaky || !strings.Contains(sanitized, "[redacted:api-key]") {
		t.Fatalf("sanitize failed: %q", sanitized)
	}
}

func TestPreflightAndEmitterHelpers(t *testing.T) {
	t.Parallel()
	if _, ok := asPreflightAdapter(nil); ok {
		t.Fatal("nil adapter")
	}
	ad := claude.NewClaudeCodeAdapter("claude", "sonnet", "")
	// Claude adapter may or may not implement PreflightAdapter; just ensure no panic.
	_, _ = asPreflightAdapter(ad)

	base := adapters.NewBusEventEmitter(nil)
	if coalesceEmitter(base, nil) != base {
		t.Fatal("nil next keeps current")
	}
	next := adapters.NewBusEventEmitter(nil)
	if coalesceEmitter(base, next) != next {
		t.Fatal("non-nil next preferred")
	}
}

func TestSpawnAndEvidenceHelpers(t *testing.T) {
	t.Parallel()
	if !shouldReleaseReservedSpawnSlot(errors.New("x"), true) {
		t.Fatal("error+reserved")
	}
	if shouldReleaseReservedSpawnSlot(nil, true) || shouldReleaseReservedSpawnSlot(errors.New("x"), false) {
		t.Fatal("only error with reserved")
	}
	if !shouldUnregisterOnStartFailure(true) || shouldUnregisterOnStartFailure(false) {
		t.Fatal("unregister predicate")
	}
	now := time.Date(2026, 7, 18, 4, 5, 6, 0, time.UTC)
	res := buildSubAgentResult("a1", "worker", "run_1", "finished", "ok", now)
	if res.AgentID != "a1" || res.AgentName != "worker" || res.RunID != "run_1" {
		t.Fatalf("ids %#v", res)
	}
	if res.Status != "finished" || res.Output != "ok" || !res.CompletedAt.Equal(now) {
		t.Fatalf("fields %#v", res)
	}
	if got := resolveEvidenceFinalStatus(false, false); got != "finished" {
		t.Fatalf("disabled gate -> %q", got)
	}
	if got := resolveEvidenceFinalStatus(true, true); got != "finished" {
		t.Fatalf("pass -> %q", got)
	}
	if got := resolveEvidenceFinalStatus(true, false); got != "completed_with_issues" {
		t.Fatalf("fail -> %q", got)
	}
}

func TestRequireProcessExecutorDepsAndWorkDir(t *testing.T) {
	t.Parallel()
	if err := requireProcessExecutorDeps(nil, store.New()); !errors.Is(err, ErrProcessBusRequired) {
		t.Fatalf("nil bus -> %v", err)
	}
	bus := events.NewBus(10)
	if err := requireProcessExecutorDeps(bus, nil); !errors.Is(err, ErrProcessStoreRequired) {
		t.Fatalf("nil store -> %v", err)
	}
	if err := requireProcessExecutorDeps(bus, store.New()); err != nil {
		t.Fatalf("valid deps -> %v", err)
	}

	if err := validateConfiguredWorkDir("", nil, errors.New("unused")); err != nil {
		t.Fatalf("empty workdir -> %v", err)
	}
	if err := validateConfiguredWorkDir("D:/missing", nil, os.ErrNotExist); err == nil {
		t.Fatal("missing workdir should error")
	}
	info, err := os.Stat(".")
	if err != nil {
		t.Fatalf("stat cwd: %v", err)
	}
	if err := validateConfiguredWorkDir(".", info, nil); err != nil {
		t.Fatalf("cwd dir -> %v", err)
	}
	self := "process_residual_test.go"
	if fi, err := os.Stat(self); err == nil {
		if err := validateConfiguredWorkDir(self, fi, nil); err == nil {
			t.Fatal("file path should not be a directory")
		}
	}
}

func TestMetricsAndStartCancelPredicates(t *testing.T) {
	t.Parallel()
	if got := resolveMetricsAdapterLabel(false, nil); got != "" {
		t.Fatalf("no metrics -> %q", got)
	}
	if got := resolveMetricsAdapterLabel(true, nil); got != "none" {
		t.Fatalf("metrics nil adapter -> %q", got)
	}
	if shouldRecordRunFinishMetrics(time.Time{}) {
		t.Fatal("zero start should not record")
	}
	if !shouldRecordRunFinishMetrics(time.Now()) {
		t.Fatal("non-zero start should record")
	}
	if !shouldCloseStdinAfterStart(true, false, false) {
		t.Fatal("open stdin without needs/decision should close")
	}
	if shouldCloseStdinAfterStart(false, false, false) {
		t.Fatal("no stdin should not close")
	}
	if shouldCloseStdinAfterStart(true, true, false) {
		t.Fatal("adapter needs stdin")
	}
	if !shouldTreatStartFailureAsCancelled(context.Canceled) || shouldTreatStartFailureAsCancelled(nil) {
		t.Fatal("start failure cancel predicate")
	}
	if !shouldKillStartedProcessOnCancel(context.Canceled) || shouldKillStartedProcessOnCancel(nil) {
		t.Fatal("kill started cancel predicate")
	}
}

func TestWaitFailureAndOutputPredicates(t *testing.T) {
	t.Parallel()
	cfg := FaultEscalationConfig{Enabled: true, MaxRetries: 2}
	if !shouldAttemptFaultEscalation(errors.New("x"), cfg) {
		t.Fatal("wait err + active cfg")
	}
	if shouldAttemptFaultEscalation(nil, cfg) {
		t.Fatal("nil wait err")
	}
	if shouldAttemptFaultEscalation(errors.New("x"), FaultEscalationConfig{}) {
		t.Fatal("inactive cfg")
	}
	if !shouldPublishTerminalWaitFailure(errors.New("x")) || shouldPublishTerminalWaitFailure(nil) {
		t.Fatal("terminal wait failure")
	}
	if !shouldPublishOutputChunk(1, false) || !shouldPublishOutputChunk(0, true) || shouldPublishOutputChunk(0, false) {
		t.Fatal("output chunk predicate")
	}
	if !shouldLogStderrLines("stderr", "x") || shouldLogStderrLines("stdout", "x") || shouldLogStderrLines("stderr", "") {
		t.Fatal("stderr log predicate")
	}
	if !shouldForwardStdoutToHub("stdout", "x") || shouldForwardStdoutToHub("stderr", "x") || shouldForwardStdoutToHub("stdout", "") {
		t.Fatal("stdout hub predicate")
	}
	if !shouldWriteRunOutputStore(true, 1) || shouldWriteRunOutputStore(false, 1) || shouldWriteRunOutputStore(true, 0) {
		t.Fatal("write store predicate")
	}
}

func TestPublishAndSpawnPredicates(t *testing.T) {
	t.Parallel()
	if !shouldPersistClassifiedFailure(&RunError{Message: "x"}) || shouldPersistClassifiedFailure(nil) {
		t.Fatal("classified failure")
	}
	if !shouldCascadeAgentShutdown(true) || shouldCascadeAgentShutdown(false) {
		t.Fatal("cascade")
	}
	if !shouldStoreSubAgentAggregatorResult(true) || shouldStoreSubAgentAggregatorResult(false) {
		t.Fatal("aggregator")
	}
	if !shouldFlushTranscriptEmitter(true) || shouldFlushTranscriptEmitter(false) {
		t.Fatal("flush transcript")
	}
	if !shouldReserveSpawnSlot(true) || shouldReserveSpawnSlot(false) {
		t.Fatal("reserve")
	}
	if !shouldRegisterSubAgentInstance(true) || shouldRegisterSubAgentInstance(false) {
		t.Fatal("register")
	}
	if !shouldWrapHubCallbackEmitter(true, true) || shouldWrapHubCallbackEmitter(false, true) || shouldWrapHubCallbackEmitter(true, false) {
		t.Fatal("hub wrap")
	}
}

func TestLookupCancelAndErrorBuilders(t *testing.T) {
	t.Parallel()
	run := store.Run{ID: "run_1", Status: "cancelling"}
	got := lookupCancelResult(run, true)
	if !got.Found || got.Status != "cancelling" {
		t.Fatalf("found %#v", got)
	}
	got = lookupCancelResult(store.Run{}, false)
	if got.Found || got.Status != "not_found" {
		t.Fatalf("missing %#v", got)
	}
	if err := pipeOpenError("stdout", errors.New("boom")); err == nil || !strings.Contains(err.Error(), "open stdout pipe") {
		t.Fatalf("pipe %v", err)
	}
	if err := adapterPreflightFailed(errors.New("no key")); err == nil || !strings.Contains(err.Error(), "adapter preflight failed") {
		t.Fatalf("preflight %v", err)
	}
	if err := structuredOutputParseFailed(errors.New("bad json")); err == nil || !strings.Contains(err.Error(), "structured output parse error") {
		t.Fatalf("parse %v", err)
	}
	if cancelledFailReason() != "run cancelled" {
		t.Fatalf("cancel reason %q", cancelledFailReason())
	}
}

func TestBuildSubAgentResultMessage(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 7, 18, 5, 6, 7, 0, time.UTC)
	msg := buildSubAgentResultMessage("run_1", "a1", "worker", "parent", "finished", "ok", "", now)
	if msg.ID != "msg_run_1" || msg.FromAgentID != "a1" || msg.ToAgentID != "parent" {
		t.Fatalf("ids %#v", msg)
	}
	if msg.Type != agents.MsgTypeResult || !msg.TriggerTurn || !msg.Timestamp.Equal(now) {
		t.Fatalf("fields %#v", msg)
	}
	payload, ok := msg.Payload.(map[string]any)
	if !ok || payload["status"] != "finished" || payload["agentName"] != "worker" {
		t.Fatalf("payload %#v", msg.Payload)
	}
	errMsg := buildSubAgentResultMessage("run_2", "a2", "worker", "parent", "failed", "boom", "api-keys-redacted", now)
	if errMsg.Type != agents.MsgTypeError {
		t.Fatalf("failed type %q", errMsg.Type)
	}
}

func TestHubCallbackEventClassification(t *testing.T) {
	t.Parallel()
	if classifyHubCallbackEvent(adapters.BusEventTextDelta) != hubCallbackStream {
		t.Fatal("delta stream")
	}
	if classifyHubCallbackEvent(adapters.BusEventTextBlock) != hubCallbackStream {
		t.Fatal("block stream")
	}
	if classifyHubCallbackEvent(adapters.BusEventResult) != hubCallbackFallback {
		t.Fatal("result fallback")
	}
	if classifyHubCallbackEvent(adapters.BusEventToolCall) != hubCallbackNone {
		t.Fatal("tool none")
	}
	text, effect := hubCallbackTextForEvent(adapters.BusEventTextDelta, map[string]any{"text": "hi"})
	if effect != hubCallbackStream || text != "hi" {
		t.Fatalf("text event %q %v", text, effect)
	}
	text, effect = hubCallbackTextForEvent(adapters.BusEventResult, map[string]any{"content": "done"})
	if effect != hubCallbackFallback || text != "done" {
		t.Fatalf("result event %q %v", text, effect)
	}
	text, effect = hubCallbackTextForEvent(adapters.BusEventToolCall, map[string]any{"text": "x"})
	if effect != hubCallbackNone || text != "" {
		t.Fatalf("none event %q %v", text, effect)
	}
}

func TestAsStoreWriter(t *testing.T) {
	t.Parallel()
	s := store.New()
	if _, ok := asStoreWriter(s); !ok {
		t.Fatal("in-memory store should implement Writer")
	}
	var runStore store.RunLifecycleStore
	if _, ok := asStoreWriter(runStore); ok {
		t.Fatal("nil store should not implement Writer")
	}
}

func TestResolveProcessExecutorTimeoutsAndWorkDir(t *testing.T) {
	t.Parallel()
	runTO, grace, force := resolveProcessExecutorTimeouts(ProcessExecutorConfig{})
	if runTO != defaultRunTimeout || grace != defaultShutdownGracePeriod || force != defaultShutdownForceTimeout {
		t.Fatalf("defaults run=%v grace=%v force=%v", runTO, grace, force)
	}
	runTO, grace, force = resolveProcessExecutorTimeouts(ProcessExecutorConfig{
		RunTimeout:           2 * time.Minute,
		ShutdownGracePeriod:  3 * time.Second,
		ShutdownForceTimeout: 4 * time.Second,
	})
	if runTO != 2*time.Minute || grace != 3*time.Second || force != 4*time.Second {
		t.Fatalf("custom run=%v grace=%v force=%v", runTO, grace, force)
	}
	if shouldStatConfiguredWorkDir("") {
		t.Fatal("empty workdir should not stat")
	}
	if !shouldStatConfiguredWorkDir("D:/tmp/ws") {
		t.Fatal("non-empty workdir should stat")
	}
}

func TestBuildProcessExecutor(t *testing.T) {
	t.Parallel()
	bus := events.NewBus(8)
	st := store.New()
	profile, err := NewGenericRunnerProfile("echo", nil, nil, nil, "")
	if err != nil {
		t.Fatalf("profile: %v", err)
	}
	exec := buildProcessExecutor(
		bus,
		st,
		profile,
		nil,
		nil,
		defaultRunTimeout,
		defaultShutdownGracePeriod,
		defaultShutdownForceTimeout,
		EvidenceGateConfig{},
		FaultEscalationConfig{},
	)
	if exec == nil {
		t.Fatal("expected executor")
	}
	if exec.bus != bus || exec.store != st {
		t.Fatal("deps not wired")
	}
	if exec.maxConcurrentRuns != defaultMaxConcurrentRuns {
		t.Fatalf("max concurrent %d", exec.maxConcurrentRuns)
	}
	if exec.running == nil || exec.stdins == nil || exec.processes == nil || exec.callbackSem == nil {
		t.Fatal("maps/sem not initialized")
	}
	if cap(exec.callbackSem) != 10 {
		t.Fatalf("callback sem cap %d", cap(exec.callbackSem))
	}
}

func TestCancelAndFinishPredicates(t *testing.T) {
	t.Parallel()
	if shouldWriteInterruptStdin(false) || !shouldWriteInterruptStdin(true) {
		t.Fatal("interrupt stdin predicate")
	}
	if shouldStartGracefulProcessShutdown(nil) {
		t.Fatal("nil process should not escalate")
	}
	if !shouldPerformTerminalFinish(true) || shouldPerformTerminalFinish(false) {
		t.Fatal("terminal finish predicate")
	}
	if !shouldAttachFinishMetricsDefer(true) || shouldAttachFinishMetricsDefer(false) {
		t.Fatal("finish metrics defer")
	}
	if !shouldRecordRunStartMetrics(true) || shouldRecordRunStartMetrics(false) {
		t.Fatal("start metrics")
	}
	if !shouldUseAdapterCommand(true) || shouldUseAdapterCommand(false) {
		t.Fatal("adapter command")
	}
	if !shouldPublishCLIInvocationPlan(true) || shouldPublishCLIInvocationPlan(false) {
		t.Fatal("cli plan")
	}
	if !shouldUseStructuredOutputParser(true) || shouldUseStructuredOutputParser(false) {
		t.Fatal("structured parser")
	}
	if !shouldReadOutputStoreCapture(true) || shouldReadOutputStoreCapture(false) {
		t.Fatal("output store capture")
	}
	if !shouldBreakSessionRetryOnWaitError(errors.New("x")) || shouldBreakSessionRetryOnWaitError(nil) {
		t.Fatal("session retry break")
	}
	if !shouldHandleStructuredParseError(errors.New("x")) || shouldHandleStructuredParseError(nil) {
		t.Fatal("parse error handle")
	}
	if !shouldLogEvidenceGateFailure(false) || shouldLogEvidenceGateFailure(true) {
		t.Fatal("evidence gate log")
	}
	if !shouldPublishStatusTransition(true) || shouldPublishStatusTransition(false) {
		t.Fatal("status transition")
	}
	if !shouldProcessOutputRead(3) || shouldProcessOutputRead(0) {
		t.Fatal("output read")
	}
	if !shouldLogRunOutputTruncation(true) || shouldLogRunOutputTruncation(false) {
		t.Fatal("truncation log")
	}
	if !shouldStopOutputRead(io.EOF) || shouldStopOutputRead(nil) {
		t.Fatal("stop output read")
	}
	if !shouldEmitPersistenceError(errors.New("disk")) || shouldEmitPersistenceError(nil) {
		t.Fatal("persist error emit")
	}
	if !shouldCloseCancelDoneChannel(true) || shouldCloseCancelDoneChannel(false) {
		t.Fatal("cancel done channel")
	}
	if !shouldCloseTrackedRunOutput(true) || shouldCloseTrackedRunOutput(false) {
		t.Fatal("tracked output close")
	}
	if shouldSurfaceWithSnapshot(nil) {
		t.Fatal("nil snapshot")
	}
	if !shouldApplyBudgetAwareEmitter(true) || shouldApplyBudgetAwareEmitter(false) {
		t.Fatal("budget emitter")
	}
	if !shouldClearRunAgentMappingOnStartFailure(errors.New("x")) || shouldClearRunAgentMappingOnStartFailure(nil) {
		t.Fatal("clear run mapping")
	}
	if nextFaultEscalationRetryCount(2) != 3 {
		t.Fatal("retry count")
	}
	if !shouldKillProcessAfterCancel(&os.Process{}) || shouldKillProcessAfterCancel(nil) {
		t.Fatal("kill after cancel")
	}
	if !shouldWaitProcessAfterCancel(&os.Process{}) || shouldWaitProcessAfterCancel(nil) {
		t.Fatal("wait after cancel")
	}
	if !shouldLogInterruptWriteFailure(errors.New("x")) || shouldLogInterruptWriteFailure(nil) {
		t.Fatal("interrupt write log")
	}
	if !shouldLogProcessWaitAfterKill(errors.New("x")) || shouldLogProcessWaitAfterKill(nil) {
		t.Fatal("wait after kill log")
	}
	if !shouldLogRunOutputStoreCreateFailure(errors.New("x")) || shouldLogRunOutputStoreCreateFailure(nil) {
		t.Fatal("output store create log")
	}
	if !shouldTrackRunOutputStore(nil) || shouldTrackRunOutputStore(errors.New("x")) {
		t.Fatal("track output store")
	}
	if !shouldCloseStdinPipe(true) || shouldCloseStdinPipe(false) {
		t.Fatal("close stdin pipe")
	}
	if !shouldResetSessionRetryStatus(true) || shouldResetSessionRetryStatus(false) {
		t.Fatal("session retry reset")
	}
}

func TestRunStatusFromLookupAndFailureRepository(t *testing.T) {
	t.Parallel()
	if got := runStatusFromLookup(store.Run{}, false); got != "" {
		t.Fatalf("missing -> %q", got)
	}
	if got := runStatusFromLookup(store.Run{Status: "started"}, true); got != "started" {
		t.Fatalf("found -> %q", got)
	}
	s := store.New()
	if _, ok := asAgentFailureRepository(s); !ok {
		t.Fatal("in-memory store should implement failure repository")
	}
	var runStore store.RunLifecycleStore
	if _, ok := asAgentFailureRepository(runStore); ok {
		t.Fatal("nil store should not implement failure repository")
	}
	if _, ok := asPersistErrorSource(s); ok {
		// in-memory store may not expose LastPersistError; just ensure no panic
		_ = ok
	}
}

func TestContextCompactionSnapshot(t *testing.T) {
	t.Parallel()
	usage, used, remaining := contextCompactionSnapshot(nil)
	if usage != 0 || used != 0 || remaining != 0 {
		t.Fatalf("nil budget %v %v %v", usage, used, remaining)
	}
	budget := runnerctx.NewContextBudget(100_000)
	budget.UsedTokens.Store(1_000)
	usage, used, remaining = contextCompactionSnapshot(budget)
	if used != 1_000 || remaining != budget.Remaining() || usage != budget.UsagePercent() {
		t.Fatalf("snapshot usage=%v used=%v remaining=%v", usage, used, remaining)
	}
}

func TestValidateStartAndCancelPrechecks(t *testing.T) {
	t.Parallel()
	if err := validateStartRunState(false, "queued"); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("missing run: %v", err)
	}
	if err := validateStartRunState(true, "started"); !errors.Is(err, ErrRunAlreadyStarted) {
		t.Fatalf("non-queued: %v", err)
	}
	if err := validateStartRunState(true, "queued"); err != nil {
		t.Fatalf("queued ok: %v", err)
	}

	run := store.Run{ID: "r1", Status: "finished"}
	res, proceed := cancelPrecheck(run, false)
	if proceed || res.Found || res.Status != "not_found" {
		t.Fatalf("missing precheck %#v proceed=%v", res, proceed)
	}
	res, proceed = cancelPrecheck(run, true)
	if proceed || !res.Found || res.Status != "finished" {
		t.Fatalf("terminal precheck %#v proceed=%v", res, proceed)
	}
	run.Status = "started"
	res, proceed = cancelPrecheck(run, true)
	if !proceed || res.Found {
		t.Fatalf("cancellable precheck %#v proceed=%v", res, proceed)
	}

	res, proceed = cancelRunningLookup(false)
	if proceed || res.Found || res.Status != "not_running" {
		t.Fatalf("not running %#v proceed=%v", res, proceed)
	}
	res, proceed = cancelRunningLookup(true)
	if !proceed || res.Found {
		t.Fatalf("running lookup %#v proceed=%v", res, proceed)
	}
}

func TestFaultEscalationAndSpawnPureHelpers(t *testing.T) {
	t.Parallel()
	if !shouldRecordFinishMetricsForRun(true) || shouldRecordFinishMetricsForRun(false) {
		t.Fatal("finish metrics found")
	}
	if !shouldRunEvidenceGate(true) || shouldRunEvidenceGate(false) {
		t.Fatal("evidence gate")
	}
	cfg := FaultEscalationConfig{Enabled: true, MaxRetries: 2}
	if !shouldAcceptFaultEscalationRetry(true, cfg, 0) {
		t.Fatal("accept retry")
	}
	if shouldAcceptFaultEscalationRetry(false, cfg, 0) {
		t.Fatal("missing run reject")
	}
	if shouldAcceptFaultEscalationRetry(true, cfg, 2) {
		t.Fatal("exhausted reject")
	}
	run := store.Run{ID: "r1", Status: "started"}
	got := applyFaultEscalationQueuedStatus(run, true)
	if got.Status != "queued" {
		t.Fatalf("requeued status %q", got.Status)
	}
	got = applyFaultEscalationQueuedStatus(run, false)
	if got.Status != "started" {
		t.Fatalf("not requeued status %q", got.Status)
	}
	if !shouldInvokeOldCancelOnEscalationHandoff(true) || shouldInvokeOldCancelOnEscalationHandoff(false) {
		t.Fatal("old cancel handoff")
	}
	if !shouldLogRunOutputStoreWriteFailure(errors.New("x")) || shouldLogRunOutputStoreWriteFailure(nil) {
		t.Fatal("output write log")
	}
	if !shouldLogAgentFailurePersistError(errors.New("x")) || shouldLogAgentFailurePersistError(nil) {
		t.Fatal("failure persist log")
	}
	if !shouldLogRunOutputStoreCloseFailure(errors.New("x")) || shouldLogRunOutputStoreCloseFailure(nil) {
		t.Fatal("output close log")
	}
	if !shouldLogSpawnSlotRejection(errors.New("x")) || shouldLogSpawnSlotRejection(nil) {
		t.Fatal("spawn slot log")
	}
	if !shouldLogSubAgentCreateFailure(errors.New("x")) || shouldLogSubAgentCreateFailure(nil) {
		t.Fatal("spawn create log")
	}
	if !shouldLogSubAgentRegisterFailure(errors.New("x")) || shouldLogSubAgentRegisterFailure(nil) {
		t.Fatal("spawn register log")
	}
	runID, agentID := subAgentSpawnIDs("task_9")
	if runID != "run_task_9" || agentID != "agent_task_9" {
		t.Fatalf("spawn ids %q %q", runID, agentID)
	}
	if !shouldLookupSubAgentMapping(true) || shouldLookupSubAgentMapping(false) {
		t.Fatal("subagent mapping")
	}
	if !shouldHaveHubOutputCollector(true) || shouldHaveHubOutputCollector(false) {
		t.Fatal("hub collector")
	}
	if !shouldLogHubCallbackFailure(errors.New("x")) || shouldLogHubCallbackFailure(nil) {
		t.Fatal("hub callback log")
	}
}

func TestCancelTransitionAndPublishPureHelpers(t *testing.T) {
	t.Parallel()
	run := store.Run{ID: "r1", Status: "cancelling"}
	res, needLookup := cancelTransitionResult(run, true)
	if needLookup || !res.Found || res.Status != "cancelling" {
		t.Fatalf("transitioned %#v needLookup=%v", res, needLookup)
	}
	res, needLookup = cancelTransitionResult(run, false)
	if !needLookup || res.Found {
		t.Fatalf("need lookup %#v needLookup=%v", res, needLookup)
	}

	ctx := RunProcessContext{PermissionMode: "bypassPermissions"}
	sanitized, forbidden := applyPermissionModeSanitization(ctx)
	if !forbidden || sanitized.PermissionMode != "default" {
		t.Fatalf("forbidden sanitize %#v forbidden=%v", sanitized, forbidden)
	}
	ctx.PermissionMode = "acceptEdits"
	sanitized, forbidden = applyPermissionModeSanitization(ctx)
	if forbidden || sanitized.PermissionMode != "acceptEdits" {
		t.Fatalf("allowed sanitize %#v forbidden=%v", sanitized, forbidden)
	}
	if !shouldLogForbiddenPermissionMode(true) || shouldLogForbiddenPermissionMode(false) {
		t.Fatal("forbidden mode log")
	}

	if !shouldFailNewRunnerProfile(errors.New("x")) || shouldFailNewRunnerProfile(nil) {
		t.Fatal("profile fail")
	}
	if !shouldPublishAdapterResolveFailure(errors.New("x")) || shouldPublishAdapterResolveFailure(nil) {
		t.Fatal("adapter resolve fail")
	}
	if !shouldPublishPreflightFailure(errors.New("x")) || shouldPublishPreflightFailure(nil) {
		t.Fatal("preflight fail")
	}
	if !shouldPublishCommandBuildFailure(errors.New("x")) || shouldPublishCommandBuildFailure(nil) {
		t.Fatal("command build fail")
	}
	if !shouldPublishPipeFailure(errors.New("x")) || shouldPublishPipeFailure(nil) {
		t.Fatal("pipe fail")
	}
	if !shouldPersistAgentFailureContent(true) || shouldPersistAgentFailureContent(false) {
		t.Fatal("persist content")
	}
	if !shouldUseAgentFailureRepository(true) || shouldUseAgentFailureRepository(false) {
		t.Fatal("failure repository")
	}
	if !shouldSkipExistingAgentFailureMessage(true) || shouldSkipExistingAgentFailureMessage(false) {
		t.Fatal("skip existing message")
	}
	if !shouldCheckPersistErrorSource(true) || shouldCheckPersistErrorSource(false) {
		t.Fatal("persist error source")
	}
	if !shouldSurfaceWithWriter(true) || shouldSurfaceWithWriter(false) {
		t.Fatal("surface writer")
	}
	if !shouldRecordStructuredParseError(errors.New("x")) || shouldRecordStructuredParseError(nil) {
		t.Fatal("structured parse record")
	}
	if !shouldMarkSubAgentRegistered(nil) || shouldMarkSubAgentRegistered(errors.New("x")) {
		t.Fatal("mark registered")
	}

	classified := classifyPublishedFailure(errors.New("boom"))
	if classified == nil || classified.Message == "" {
		t.Fatalf("classified %#v", classified)
	}
}

func TestCmdStartAndSpawnPureHelpers(t *testing.T) {
	t.Parallel()
	if classifyCmdStartOutcome(nil, nil) != cmdStartOK {
		t.Fatal("start ok")
	}
	if classifyCmdStartOutcome(errors.New("x"), context.Canceled) != cmdStartCancelled {
		t.Fatal("start cancelled")
	}
	if classifyCmdStartOutcome(errors.New("x"), nil) != cmdStartFailed {
		t.Fatal("start failed")
	}

	outcome, psErr := classifyStructuredParseOutcome(nil)
	if outcome != structuredParseNone || psErr != nil {
		t.Fatalf("none %#v %v", outcome, psErr)
	}
	fatalOutcome, _ := classifyStructuredParseOutcome(errors.New("boom"))
	if fatalOutcome != structuredParseFatal {
		t.Fatalf("fatal %v", fatalOutcome)
	}
	if !shouldPublishRecoverableParseWarning(structuredParseRecoverable) || shouldPublishRecoverableParseWarning(structuredParseNone) {
		t.Fatal("recoverable warning predicate")
	}
	if !shouldFailOnStructuredParse(structuredParseFatal) || shouldFailOnStructuredParse(structuredParseRecoverable) {
		t.Fatal("fatal parse predicate")
	}

	args := subprocessStartingLogArgs("run1", "/bin/echo", []string{"-n", "hi"}, 0)
	if len(args) < 10 || args[0] != "runId" || args[1] != "run1" {
		t.Fatalf("starting log args %#v", args)
	}
	started := subprocessStartedLogArgs("run1", nil)
	if processPIDForLog(nil) != 0 || len(started) != 4 {
		t.Fatalf("started log %#v", started)
	}
	if shouldTrackStartedProcess(nil) || !shouldTrackStartedProcess(&os.Process{}) {
		t.Fatal("track process")
	}

	reserved, reject := evaluateSpawnSlotReservation(false, errors.New("x"))
	if reserved || reject != nil {
		t.Fatalf("no registry %#v %v", reserved, reject)
	}
	reserved, reject = evaluateSpawnSlotReservation(true, errors.New("full"))
	if reserved || reject == nil {
		t.Fatalf("reject %#v %v", reserved, reject)
	}
	reserved, reject = evaluateSpawnSlotReservation(true, nil)
	if !reserved || reject != nil {
		t.Fatalf("reserved %#v %v", reserved, reject)
	}

	registered, logFailure := evaluateSubAgentRegistration(false, nil)
	if registered || logFailure {
		t.Fatal("no registry registration")
	}
	registered, logFailure = evaluateSubAgentRegistration(true, errors.New("x"))
	if registered || !logFailure {
		t.Fatal("register failure")
	}
	registered, logFailure = evaluateSubAgentRegistration(true, nil)
	if !registered || logFailure {
		t.Fatal("register ok")
	}
	if slotReservedAfterUnregister(true, true) {
		t.Fatal("clear after unregister")
	}
	if !slotReservedAfterUnregister(false, true) {
		t.Fatal("keep reserved when not registered")
	}

	plan := planEvidenceGateOutcome(false, false)
	if plan.FinalStatus != "finished" || plan.LogFailure {
		t.Fatalf("disabled gate %#v", plan)
	}
	plan = planEvidenceGateOutcome(true, false)
	if plan.FinalStatus != "completed_with_issues" || !plan.LogFailure {
		t.Fatalf("failed gate %#v", plan)
	}
	plan = planEvidenceGateOutcome(true, true)
	if plan.FinalStatus != "finished" || plan.LogFailure {
		t.Fatalf("passed gate %#v", plan)
	}

	if shouldApplyHubCallbackSideEffect("", hubCallbackStream) || !shouldApplyHubCallbackSideEffect("x", hubCallbackStream) {
		t.Fatal("hub side effect apply")
	}
	if !isHubCallbackStreamEffect(hubCallbackStream) || isHubCallbackStreamEffect(hubCallbackFallback) {
		t.Fatal("stream effect")
	}
	if !isHubCallbackFallbackEffect(hubCallbackFallback) || isHubCallbackFallbackEffect(hubCallbackStream) {
		t.Fatal("fallback effect")
	}
	if !shouldClearStdinAfterEagerClose(true) || shouldClearStdinAfterEagerClose(false) {
		t.Fatal("clear stdin")
	}
	keys := finishRunMapKeys()
	if len(keys) < 8 || keys[0] != "running" {
		t.Fatalf("finish keys %#v", keys)
	}
}

func TestResidualPlanPureHelpers989(t *testing.T) {
	t.Parallel()

	// Eager stdin close plan
	plan := planEagerStdinClose(false, false, false)
	if plan.ClosePipe || plan.ClearMap {
		t.Fatalf("closed stdin %#v", plan)
	}
	plan = planEagerStdinClose(true, false, false)
	if !plan.ClosePipe || !plan.ClearMap {
		t.Fatalf("eager close %#v", plan)
	}
	plan = planEagerStdinClose(true, true, false)
	if plan.ClosePipe || plan.ClearMap {
		t.Fatalf("needs stdin %#v", plan)
	}
	plan = planEagerStdinClose(true, false, true)
	if plan.ClosePipe || plan.ClearMap {
		t.Fatalf("decision loop %#v", plan)
	}

	// Post-start cancel plan
	post := planPostStartCancel(nil, &os.Process{})
	if post.Cancel || post.Kill || post.Wait {
		t.Fatalf("no cancel %#v", post)
	}
	post = planPostStartCancel(context.Canceled, &os.Process{})
	if !post.Cancel || !post.Kill || !post.Wait {
		t.Fatalf("cancel with proc %#v", post)
	}
	post = planPostStartCancel(context.Canceled, nil)
	if !post.Cancel || post.Kill || post.Wait {
		t.Fatalf("cancel without proc %#v", post)
	}

	// Session conflict retry plan
	sess := planSessionConflictRetry(nil, "", 0, time.Second, true)
	if sess.Retry || sess.CloseOutput {
		t.Fatalf("no wait err %#v", sess)
	}
	conflict := errors.New("Session ID abc is already in use")
	sess = planSessionConflictRetry(conflict, "", 0, time.Second, true)
	if !sess.Retry || !sess.CloseOutput {
		t.Fatalf("retry with store %#v", sess)
	}
	sess = planSessionConflictRetry(conflict, "", 0, time.Second, false)
	if !sess.Retry || sess.CloseOutput {
		t.Fatalf("retry without store %#v", sess)
	}

	// Spawn start failure cleanup
	fail := planSpawnStartFailureCleanup(nil, true, true)
	if fail.ClearMapping || fail.Unregister || !fail.SlotReserved {
		t.Fatalf("nil start err %#v", fail)
	}
	fail = planSpawnStartFailureCleanup(errors.New("start"), true, true)
	if !fail.ClearMapping || !fail.Unregister || fail.SlotReserved {
		t.Fatalf("registered start fail %#v", fail)
	}
	fail = planSpawnStartFailureCleanup(errors.New("start"), false, true)
	if !fail.ClearMapping || fail.Unregister || !fail.SlotReserved {
		t.Fatalf("unregistered start fail %#v", fail)
	}

	// Sub-agent delivery plan
	del := planSubAgentResultDelivery(false, true, true, true, "parent", "finished", true)
	if del.Deliver {
		t.Fatal("no registry should not deliver")
	}
	del = planSubAgentResultDelivery(true, true, true, true, "parent", "finished", true)
	if !del.Deliver || !del.UpdateRegistry || del.RegistryStatus != agents.StatusCompleted || !del.StoreAgg {
		t.Fatalf("finished delivery %#v", del)
	}
	del = planSubAgentResultDelivery(true, true, true, true, "parent", "failed", false)
	if !del.Deliver || !del.UpdateRegistry || del.RegistryStatus != agents.StatusError || del.StoreAgg {
		t.Fatalf("failed delivery %#v", del)
	}
	del = planSubAgentResultDelivery(true, true, true, true, "parent", "completed_with_issues", true)
	if !del.Deliver || !del.UpdateRegistry || del.RegistryStatus != agents.StatusCompleted {
		t.Fatalf("completed_with_issues %#v", del)
	}
	del = planSubAgentResultDelivery(true, true, false, false, "", "finished", true)
	if del.Deliver {
		t.Fatal("missing mapping")
	}
	del = planSubAgentResultDelivery(true, true, true, true, "", "finished", true)
	if del.Deliver {
		t.Fatal("empty parent should not route")
	}

	// Structured parse post plan
	postParse := planStructuredParsePost(nil, true)
	if postParse.RecordError || !postParse.Flush {
		t.Fatalf("nil parse %#v", postParse)
	}
	postParse = planStructuredParsePost(errors.New("x"), false)
	if !postParse.RecordError || postParse.Flush {
		t.Fatalf("err parse %#v", postParse)
	}

	// Finish cleanup plan
	fin := planFinishCleanup(true, true, false)
	if !fin.Cascade || !fin.CloseCancelDone || fin.CloseRunOutput {
		t.Fatalf("finish plan %#v", fin)
	}

	// Output chunk plan
	chunk := planOutputChunk("run1", "stdout", []byte("hi"), 3, false, 2, 100, true)
	if !chunk.Publish || chunk.Text != "hi" || chunk.NextOffset != 5 || chunk.LogStderr || !chunk.WriteStore || !chunk.ForwardHub {
		t.Fatalf("stdout chunk %#v", chunk)
	}
	chunk = planOutputChunk("run1", "stderr", []byte("err"), 0, true, 3, 10, false)
	if !chunk.Publish || !chunk.LogStderr || chunk.WriteStore || chunk.ForwardHub || !chunk.LogTruncate {
		t.Fatalf("stderr chunk %#v", chunk)
	}
	chunk = planOutputChunk("run1", "stdout", nil, 0, false, 0, 0, true)
	if chunk.Publish {
		t.Fatal("empty non-truncated should not publish")
	}

	// Surface artifacts plan
	snap := &adapters.WorkdirSnapshot{}
	surf := planSurfaceArtifacts(nil, true, "finished", true)
	if surf.Proceed || surf.SkipWriterLog {
		t.Fatalf("nil snap %#v", surf)
	}
	surf = planSurfaceArtifacts(snap, true, "finished", false)
	if surf.Proceed || !surf.SkipWriterLog {
		t.Fatalf("no writer %#v", surf)
	}
	surf = planSurfaceArtifacts(snap, true, "finished", true)
	if !surf.Proceed || surf.SkipWriterLog {
		t.Fatalf("surface ok %#v", surf)
	}
	surf = planSurfaceArtifacts(snap, true, "failed", true)
	if surf.Proceed {
		t.Fatal("failed status should not surface")
	}

	// Misc track plans
	if planCmdStartCancelWait(nil).Wait || !planCmdStartCancelWait(&os.Process{}).Wait {
		t.Fatal("cmd start cancel wait")
	}
	track := planRunOutputStoreTrack(errors.New("x"))
	if !track.LogFailure || track.Track {
		t.Fatalf("store create fail %#v", track)
	}
	track = planRunOutputStoreTrack(nil)
	if track.LogFailure || !track.Track {
		t.Fatalf("store create ok %#v", track)
	}
	if planWorkdirTrack("").Track || !planWorkdirTrack("D:/tmp").Track {
		t.Fatal("workdir track")
	}
	if planHubTaskRecord("").Record || !planHubTaskRecord("task").Record {
		t.Fatal("hub task record")
	}
}

func TestResidualPlanPureHelpers1011(t *testing.T) {
	t.Parallel()

	// Command build plan consolidates adapter-vs-profile flags.
	cmd := planCommandBuild(false)
	if cmd.UseAdapter || cmd.PublishCLIPlan || cmd.UseStructuredParser {
		t.Fatalf("no adapter %#v", cmd)
	}
	cmd = planCommandBuild(true)
	if !cmd.UseAdapter || !cmd.PublishCLIPlan || !cmd.UseStructuredParser {
		t.Fatalf("with adapter %#v", cmd)
	}

	// Metrics attach/start + finish record plan.
	metrics := planRunMetrics(false)
	if metrics.AttachFinishDefer || metrics.RecordStart {
		t.Fatalf("no metrics %#v", metrics)
	}
	metrics = planRunMetrics(true)
	if !metrics.AttachFinishDefer || !metrics.RecordStart {
		t.Fatalf("with metrics %#v", metrics)
	}
	fin := planFinishMetricsRecord(time.Time{}, true)
	if fin.Record {
		t.Fatal("zero start time should not record")
	}
	fin = planFinishMetricsRecord(time.Now(), false)
	if fin.Record {
		t.Fatal("missing run should not record")
	}
	fin = planFinishMetricsRecord(time.Now(), true)
	if !fin.Record {
		t.Fatal("started run should record")
	}

	// publishFailed plan: classify only when transition succeeds.
	fail := planPublishFailed(false, errors.New("boom"))
	if fail.Publish || fail.Persist || fail.Classified != nil {
		t.Fatalf("no transition %#v", fail)
	}
	fail = planPublishFailed(true, errors.New("boom"))
	if !fail.Publish || fail.Classified == nil {
		t.Fatalf("transition ok %#v", fail)
	}

	// persistAgentFailure multi-gate
	persist := planPersistAgentFailure(false, true, false)
	if persist.Proceed {
		t.Fatal("bad content")
	}
	persist = planPersistAgentFailure(true, false, false)
	if persist.Proceed {
		t.Fatal("no repo")
	}
	persist = planPersistAgentFailure(true, true, true)
	if persist.Proceed {
		t.Fatal("already exists")
	}
	persist = planPersistAgentFailure(true, true, false)
	if !persist.Proceed {
		t.Fatal("should proceed")
	}

	// persist error emit plan
	pe := planPersistError(false, errors.New("x"))
	if pe.Emit {
		t.Fatal("no source")
	}
	pe = planPersistError(true, nil)
	if pe.Emit {
		t.Fatal("nil err")
	}
	pe = planPersistError(true, errors.New("x"))
	if !pe.Emit {
		t.Fatal("should emit")
	}

	// structured emitter wraps
	wrap := planStructuredEmitterWraps(false)
	if wrap.ApplyBudget {
		t.Fatalf("none %#v", wrap)
	}
	wrap = planStructuredEmitterWraps(true)
	if !wrap.ApplyBudget {
		t.Fatalf("both %#v", wrap)
	}

	// watchRunProcess plans (#988)
	if planWatchProcessEntry(nil).Watch || !planWatchProcessEntry(&os.Process{}).Watch {
		t.Fatal("watch entry")
	}
	if planWatchProcessKill(true).Kill || !planWatchProcessKill(false).Kill {
		t.Fatal("watch kill grace defer")
	}

	// cascade child filter (#1001)
	if shouldCancelCascadeChild("parent", "") || shouldCancelCascadeChild("parent", "parent") {
		t.Fatal("skip empty/self")
	}
	if !shouldCancelCascadeChild("parent", "child") {
		t.Fatal("cancel child")
	}

	// track started process
	track := planTrackStartedProcess(nil)
	if track.Track || track.Watch {
		t.Fatalf("nil proc %#v", track)
	}
	track = planTrackStartedProcess(&os.Process{})
	if !track.Track || !track.Watch {
		t.Fatalf("proc %#v", track)
	}

	// fault escalation handoff (#867)
	cfg := FaultEscalationConfig{Enabled: true, MaxRetries: 2}
	if planFaultEscalationHandoff(false, cfg, 0).Retry {
		t.Fatal("missing run")
	}
	if !planFaultEscalationHandoff(true, cfg, 0).Retry {
		t.Fatal("should retry")
	}
	if planFaultEscalationHandoff(true, cfg, 2).Retry {
		t.Fatal("exhausted")
	}

	// adapter resolve / cancel grace / evidence / session status / log plans
	if planAdapterResolve(false, "a", false).Resolve || !planAdapterResolve(true, "a", false).Resolve {
		t.Fatal("adapter resolve")
	}
	if planCancelGraceArm(nil, false).Arm || !planCancelGraceArm(&os.Process{}, false).Arm {
		t.Fatal("cancel grace arm")
	}
	if planCancelGraceArm(&os.Process{}, true).Arm {
		t.Fatal("cancel grace arm must be idempotent once armed (#2154)")
	}
	if planEvidenceRun(false).RunGate || !planEvidenceRun(true).RunGate {
		t.Fatal("evidence run")
	}
	if planSessionRetryStatus(false).LogReset || !planSessionRetryStatus(true).LogReset {
		t.Fatal("session retry status")
	}
	if planProcessWaitAfterKill(nil).Log || !planProcessWaitAfterKill(errors.New("x")).Log {
		t.Fatal("process wait log")
	}
	if planInterruptWriteLog(nil).Log || !planInterruptWriteLog(errors.New("x")).Log {
		t.Fatal("interrupt write log")
	}
}

func TestResidualPlanPureHelpers1011b(t *testing.T) {
	t.Parallel()

	// Context compaction plan
	if planContextCompaction(nil, "r1").Emit {
		t.Fatal("nil budget")
	}

	// Structured parse handle
	h := planStructuredParseHandleFromErr(nil, "r1")
	if h.WarnRecoverable || h.FailFatal {
		t.Fatalf("none %#v", h)
	}
	h = planStructuredParseHandleFromErr(errors.New("x"), "r1")
	if !h.FailFatal || h.WarnRecoverable {
		t.Fatalf("fatal %#v", h)
	}

	// Permission mode plan
	ctx := RunProcessContext{PermissionMode: "default"}
	perm := planPermissionModeSanitization(ctx)
	if perm.Changed || perm.LogForbidden {
		t.Fatalf("default %#v", perm)
	}
	ctx.PermissionMode = "bypassPermissions"
	perm = planPermissionModeSanitization(ctx)
	if !perm.Changed || !perm.LogForbidden || perm.RunCtx.PermissionMode != "default" {
		t.Fatalf("forbidden %#v", perm)
	}

	// Publish status plan
	if planPublishStatus(false).Publish || !planPublishStatus(true).Publish {
		t.Fatal("publish status")
	}

	// Preflight failure plan
	if planPreflightFailure(nil).Fail || !planPreflightFailure(errors.New("x")).Fail {
		t.Fatal("preflight")
	}
}

func TestResidualPlanPureHelpers1022(t *testing.T) {
	t.Parallel()

	// Constructor plan
	ctor := planNewProcessExecutor(errors.New("x"), "")
	if !ctor.FailProfile || ctor.StatWorkDir {
		t.Fatalf("profile err %#v", ctor)
	}
	ctor = planNewProcessExecutor(nil, "D:/tmp")
	if ctor.FailProfile || !ctor.StatWorkDir {
		t.Fatalf("workdir %#v", ctor)
	}
	ctor = planNewProcessExecutor(nil, "")
	if ctor.FailProfile || ctor.StatWorkDir {
		t.Fatalf("empty workdir %#v", ctor)
	}

	// Cancel / terminal finish
	if planWriteInterruptStdin(false).Write || !planWriteInterruptStdin(true).Write {
		t.Fatal("write interrupt")
	}
	if planTerminalFinish(false).Finish || !planTerminalFinish(true).Finish {
		t.Fatal("terminal finish")
	}

	// Resolve / command / pipe failure gates
	if planAdapterResolveFailure(nil).Fail || !planAdapterResolveFailure(errors.New("x")).Fail {
		t.Fatal("adapter resolve failure")
	}
	if planCommandBuildFailure(nil).Fail || !planCommandBuildFailure(errors.New("x")).Fail {
		t.Fatal("command build failure")
	}
	if planPipeFailure(nil).Fail || !planPipeFailure(errors.New("x")).Fail {
		t.Fatal("pipe failure")
	}

	// Post-wait plans
	if planCancelledRun(nil, "started").Cancelled {
		t.Fatal("not cancelled")
	}
	if !planCancelledRun(context.Canceled, "started").Cancelled {
		t.Fatal("ctx cancelled")
	}
	if !planCancelledRun(nil, "cancelling").Cancelled {
		t.Fatal("status cancelling")
	}
	if planOutputStoreCapture(false).Read || !planOutputStoreCapture(true).Read {
		t.Fatal("output store capture")
	}
	if planSessionRetryBreak(nil).Break || !planSessionRetryBreak(errors.New("x")).Break {
		t.Fatal("session retry break")
	}

	// Fault escalation attempt + cleanup (#867)
	cfg := FaultEscalationConfig{Enabled: true, MaxRetries: 2}
	if planFaultEscalationAttempt(nil, cfg).Attempt {
		t.Fatal("no wait err")
	}
	if !planFaultEscalationAttempt(errors.New("x"), cfg).Attempt {
		t.Fatal("should attempt")
	}
	cleanup := planFaultEscalationCleanup(false, false)
	if cleanup.CloseOutput || cleanup.InvokeOldCancel {
		t.Fatalf("none %#v", cleanup)
	}
	cleanup = planFaultEscalationCleanup(true, true)
	if !cleanup.CloseOutput || !cleanup.InvokeOldCancel {
		t.Fatalf("both %#v", cleanup)
	}
	if planTerminalWaitFailure(nil).Publish || !planTerminalWaitFailure(errors.New("x")).Publish {
		t.Fatal("terminal wait failure")
	}

	// Output read plan
	read := planOutputRead(0, nil)
	if read.Process || read.Stop {
		t.Fatalf("empty %#v", read)
	}
	read = planOutputRead(3, io.EOF)
	if !read.Process || !read.Stop {
		t.Fatalf("data+eof %#v", read)
	}
	if planOutputStoreWriteLog(nil).Log || !planOutputStoreWriteLog(errors.New("x")).Log {
		t.Fatal("output store write log")
	}
	if planAgentFailurePersistLog(nil).Log || !planAgentFailurePersistLog(errors.New("x")).Log {
		t.Fatal("agent failure persist log")
	}
	if planRunOutputCloseLog(nil).Log || !planRunOutputCloseLog(errors.New("x")).Log {
		t.Fatal("run output close log")
	}

	// Spawn residual
	if planSpawnSlotReserve(false).Try || !planSpawnSlotReserve(true).Try {
		t.Fatal("spawn reserve")
	}
	if planSpawnSlotRejectLog(nil).Log || !planSpawnSlotRejectLog(errors.New("x")).Log {
		t.Fatal("spawn reject log")
	}
	if planSpawnSlotRelease(nil, true).Release || !planSpawnSlotRelease(errors.New("x"), true).Release {
		t.Fatal("spawn release")
	}
	if planSpawnSlotRelease(errors.New("x"), false).Release {
		t.Fatal("no release when not reserved")
	}
	if planSubAgentCreateLog(nil).Log || !planSubAgentCreateLog(errors.New("x")).Log {
		t.Fatal("subagent create log")
	}
	if planSubAgentRegister(false).Register || !planSubAgentRegister(true).Register {
		t.Fatal("subagent register")
	}

	// Stdin pipe open follows needsAdapterStdin
	if planStdinPipeOpen(nil).Open {
		t.Fatal("nil adapter stdin")
	}
}

func TestResidualPlanPureHelpers1043(t *testing.T) {
	t.Parallel()

	// Process signal log
	if planProcessSignalLog(nil).Log || !planProcessSignalLog(errors.New("x")).Log {
		t.Fatal("process signal log")
	}

	// Preflight adapter gate
	if planPreflightAdapter(false).Check || !planPreflightAdapter(true).Check {
		t.Fatal("preflight adapter")
	}

	// Sub-agent instance lookup + parent ID
	if planSubAgentInstanceLookup(false, true).Lookup || planSubAgentInstanceLookup(true, false).Lookup {
		t.Fatal("lookup false")
	}
	if !planSubAgentInstanceLookup(true, true).Lookup {
		t.Fatal("lookup true")
	}
	if parentIDFromAgentInstance(nil) != "" {
		t.Fatal("nil parent")
	}
	if parentIDFromAgentInstance(&agents.AgentInstance{ParentID: "p1"}) != "p1" {
		t.Fatal("parent id")
	}

	// Cascade filter (#1001)
	filtered := filterCascadeCancelChildren("parent", []string{"", "parent", "child"})
	if len(filtered) != 1 || filtered[0] != "child" {
		t.Fatalf("filter %#v", filtered)
	}
	if filterCascadeCancelChildren("p", nil) != nil {
		t.Fatal("nil children")
	}

	// Spawn reject plan
	if planSpawnSlotReject(nil).Reject || planSpawnSlotReject(nil).Log {
		t.Fatal("no reject")
	}
	rp := planSpawnSlotReject(errors.New("full"))
	if !rp.Reject || !rp.Log {
		t.Fatalf("reject %#v", rp)
	}

	// Registration outcome
	out := planSubAgentRegistrationOutcome(nil)
	if !out.Registered || out.LogFailure {
		t.Fatalf("ok reg %#v", out)
	}
	out = planSubAgentRegistrationOutcome(errors.New("x"))
	if out.Registered || !out.LogFailure {
		t.Fatalf("fail reg %#v", out)
	}

	// Spawn start log
	if planSpawnStartLog(nil).Log || !planSpawnStartLog(errors.New("x")).Log {
		t.Fatal("spawn start log")
	}

	// Fault escalation exhausted plan (always publish+log at call site)
	ex := planFaultEscalationExhausted()
	if !ex.Publish || !ex.Log {
		t.Fatalf("exhausted %#v", ex)
	}

	// Persist gate
	if planPersistAgentFailureGate(false, true).ScanExists || planPersistAgentFailureGate(true, false).ScanExists {
		t.Fatal("gate closed")
	}
	if !planPersistAgentFailureGate(true, true).ScanExists {
		t.Fatal("gate open")
	}

	// buildSubAgentRunContext composes memory + siblings without panicking
	run := store.Run{ID: "r1", ProjectID: "p1", ThreadID: "t1"}
	task := adapters.SubAgentTask{
		TaskID:  "task-1",
		AgentID: "agent-1",
		Prompt:  "do it",
		Depth:   1,
		SiblingAgents: []adapters.SiblingInfo{
			{AgentName: "sib", TaskDesc: "other"},
		},
	}
	ctx := buildSubAgentRunContext(run, task, "thread-child", "")
	if ctx.Prompt != "do it" || ctx.AgentID != "agent-1" {
		t.Fatalf("basic ctx %#v", ctx)
	}
	// Session is a fresh UUID, not the hierarchical thread path.
	if ctx.SessionID == "thread-child" || !uuidLike(ctx.SessionID) {
		t.Fatalf("basic ctx session %#v", ctx)
	}
	if ctx.AppendSystemPrompt == "" {
		t.Fatal("expected sibling prompt")
	}
	ctx = buildSubAgentRunContext(run, task, "thread-child", "D:/work")
	if ctx.WorkDir != "D:/work" {
		t.Fatalf("workdir %#v", ctx.WorkDir)
	}
}

func TestResidualPlanPureHelpers1054(t *testing.T) {
	t.Parallel()

	// Start admission composes lookup/status + concurrency
	if err := planStartAdmission(false, "queued", 0, 5, false); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("missing run: %v", err)
	}
	if err := planStartAdmission(true, "started", 0, 5, false); !errors.Is(err, ErrRunAlreadyStarted) {
		t.Fatalf("non-queued: %v", err)
	}
	if err := planStartAdmission(true, "queued", 5, 5, false); !errors.Is(err, ErrTooManyConcurrentRuns) {
		t.Fatalf("capacity: %v", err)
	}
	if err := planStartAdmission(true, "queued", 0, 5, true); !errors.Is(err, ErrRunAlreadyStarted) {
		t.Fatalf("already running: %v", err)
	}
	if err := planStartAdmission(true, "queued", 0, 5, false); err != nil {
		t.Fatalf("admit: %v", err)
	}

	// bindRunProcessContext
	run := store.Run{ID: "r-bind", ProjectID: "p", ThreadID: "t"}
	ctx := bindRunProcessContext(RunProcessContext{Prompt: "hi"}, run)
	if ctx.Run.ID != "r-bind" || ctx.Prompt != "hi" {
		t.Fatalf("bind %#v", ctx)
	}

	// tracked close gate
	if shouldApplyTrackedClose(false, true) || shouldApplyTrackedClose(true, false) {
		t.Fatal("tracked close closed")
	}
	if !shouldApplyTrackedClose(true, true) {
		t.Fatal("tracked close open")
	}

	// evidence attempt / result
	attempt := planEvidenceGateAttempt(false)
	if attempt.RunGate || attempt.FinalStatus != "finished" {
		t.Fatalf("disabled gate %#v", attempt)
	}
	attempt = planEvidenceGateAttempt(true)
	if !attempt.RunGate || attempt.FinalStatus != "finished" {
		t.Fatalf("enabled default pass %#v", attempt)
	}
	fail := planEvidenceGateResult(false)
	if fail.FinalStatus == "finished" || !fail.LogFailure {
		t.Fatalf("fail result %#v", fail)
	}
	pass := planEvidenceGateResult(true)
	if pass.FinalStatus != "finished" || pass.LogFailure {
		t.Fatalf("pass result %#v", pass)
	}

	// outbound prep keeps status/message fields
	now := time.Date(2026, 7, 18, 12, 0, 0, 0, time.UTC)
	msg, agg := prepareSubAgentResultOutbound(
		map[string]any{"ok": true},
		"run-x", "agent-x", "Worker", "parent-x", "finished", now,
	)
	if msg.FromAgentID != "agent-x" || msg.ToAgentID != "parent-x" {
		t.Fatalf("msg agents %#v", msg)
	}
	if agg.AgentID != "agent-x" || agg.RunID != "run-x" || agg.Status != "finished" {
		t.Fatalf("agg %#v", agg)
	}
}
