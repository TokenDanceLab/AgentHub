package lifecycle

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/agents"
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
	pathy := "working in D:/Code/TokenDance/AgentHub/README.md"
	if got := sanitizeHubStreamText(pathy); got != pathy {
		t.Fatalf("paths should remain: %q", got)
	}
	// Split literal so secret-guard does not treat the fixture as a live key.
	leaky := "token sk-" + "abcdefghijklmnopqrstuvwxyz0123456789 and path D:/Code/TokenDance/x"
	got := sanitizeHubStreamText(leaky)
	if got == leaky {
		t.Fatal("expected api key redaction")
	}
	if !strings.Contains(got, "[redacted:api-key]") {
		t.Fatalf("missing redaction marker: %q", got)
	}
	if !strings.Contains(got, "D:/Code/TokenDance/x") {
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
	if scope["runId"] != "run_1" || payload["error"] != "disk full" {
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
	got := newSubAgentRunContext(run, task, "th_c")
	if got.Run.ID != "run_c" || got.Prompt != "do work" || got.AgentID != "worker" || got.Model != "sonnet" {
		t.Fatalf("fields %#v", got)
	}
	if got.SessionID != "th_c" {
		t.Fatalf("session %q", got.SessionID)
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
	ad := adapters.NewClaudeCodeAdapter("claude", "sonnet", "")
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
