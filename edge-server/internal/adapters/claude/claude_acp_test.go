// Package claude — claude-acp adapter tests.
//
// These tests verify the claude-acp registry registration, command shape, and
// the full ParseStream path against a mock ACP peer over real io.Pipe wire
// (reusing the fakeACPAgent harness, copied here from root
// acp_client_test.go — 根包测试符号不可跨包引用). No real `npx
// @agentclientprotocol/claude-agent-acp` process is spawned — that requires a
// Node.js/npx environment with Claude auth + registry network access, which is
// a TODO for environment verification (see claude_acp.go).
package claude

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/adapters/acp"
	"github.com/agenthub/edge-server/internal/store"
)

// ── 测试桩：自根包测试文件随 claude 家族下沉的副本（#1760 claude 增量） ──
// fakeACPAgent / sessionUpdateLine / recordingEmitter / emitterAll /
// containsString 与根包 acp_client_test.go、event_emitter_test.go、
// adapter_test.go 中的同名声明的行为保持一致，改动需两侧同步。

// fakeACPAgent simulates an ACP agent over two pipes. It reads client
// requests from reqR (the client's stdin side) and writes responses and
// notifications to respW (the client's stdout side). The wire format is real
// line-delimited JSON-RPC 2.0, so the test exercises the SDK's framing,
// parsing, and dispatch for real.
type fakeACPAgent struct {
	mu      sync.Mutex
	methods []string // client→agent request methods, in order

	// responses carries every JSON-RPC response line the agent receives.
	// Buffered so the agent goroutine never blocks on it.
	responses chan string
}

func newFakeACPAgent() *fakeACPAgent {
	return &fakeACPAgent{responses: make(chan string, 8)}
}

func (f *fakeACPAgent) recordMethod(m string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.methods = append(f.methods, m)
}

func (f *fakeACPAgent) gotMethods() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.methods...)
}

// run answers requests until reqR hits EOF. notifications (JSON-RPC lines)
// are injected after a session/prompt request, before its response.
func (f *fakeACPAgent) run(t *testing.T, reqR io.Reader, respW io.Writer, notifications [][]byte) {
	t.Helper()
	scanner := bufio.NewScanner(reqR)
	for scanner.Scan() {
		var msg struct {
			ID     json.RawMessage `json:"id"`
			Method string          `json:"method"`
		}
		if err := json.Unmarshal(scanner.Bytes(), &msg); err != nil {
			t.Errorf("fake agent: unparseable client line: %v", err)
			return
		}

		// Record the request BEFORE answering it: the client returns as
		// soon as it reads our response, so recording afterwards races
		// with the test's gotMethods() assertion and can drop the last
		// method (observed flaky on session/prompt).
		f.recordMethod(msg.Method)

		switch msg.Method {
		case "":
			// JSON-RPC response (e.g. to a session/request_permission request).
			f.responses <- string(scanner.Bytes())

		case "initialize":
			f.write(t, respW, f.result(msg.ID, `{"protocolVersion":1,"agentCapabilities":{},"authMethods":[]}`))

		case "session/new":
			f.write(t, respW, f.result(msg.ID, `{"sessionId":"sess-mock-1"}`))

		case "session/prompt":
			for _, n := range notifications {
				f.write(t, respW, n)
			}
			f.write(t, respW, f.result(msg.ID, `{"stopReason":"end_turn"}`))

		default:
			// session/request_permission and anything else: no result —
			// the response (possibly an error) is written by the SDK.
		}
	}
}

func (f *fakeACPAgent) result(id json.RawMessage, result string) []byte {
	return []byte(fmt.Sprintf(`{"jsonrpc":"2.0","id":%s,"result":%s}`, id, result))
}

func (f *fakeACPAgent) write(t *testing.T, w io.Writer, b []byte) {
	t.Helper()
	if _, err := w.Write(append(append([]byte(nil), b...), '\n')); err != nil {
		t.Errorf("fake agent: write: %v", err)
	}
}

// sessionUpdateLine builds a wire-format session/update notification.
// The update JSON must carry the official "sessionUpdate" discriminator.
func sessionUpdateLine(sessionID, update string) []byte {
	return []byte(fmt.Sprintf(
		`{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":%q,"update":%s}}`,
		sessionID, update))
}

// recordingEmitter is a mock EventEmitter that records all emitted events.
type recordingEmitter struct {
	mu     sync.Mutex
	events []recordedEvent
}

type recordedEvent struct {
	eventType string
	scope     map[string]any
	payload   any
}

func (r *recordingEmitter) Emit(eventType string, scope map[string]any, payload any) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.events = append(r.events, recordedEvent{eventType, scope, payload})
}

// emitterAll returns a copy of every event recorded by a recordingEmitter.
func emitterAll(r *recordingEmitter) []recordedEvent {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]recordedEvent(nil), r.events...)
}

func containsString(list []string, target string) bool {
	for _, value := range list {
		if value == target {
			return true
		}
	}
	return false
}

// ── claude-acp adapter tests ────────────────────────────────────────────────

func TestClaudeACPAdapterMetadata(t *testing.T) {
	a := NewClaudeACPAdapter("", "")
	if a.Metadata().ID != "claude-acp" {
		t.Errorf("ID = %q, want claude-acp", a.Metadata().ID)
	}
	if a.Metadata().Name != "Claude Code (ACP)" {
		t.Errorf("Name = %q, want Claude Code (ACP)", a.Metadata().Name)
	}
	if !strings.Contains(a.Metadata().Version, claudeACPVersionPin) {
		t.Errorf("Version = %q, want pinned claude-agent-acp %s visible", a.Metadata().Version, claudeACPVersionPin)
	}
	if !strings.Contains(a.Metadata().Version, "npx") {
		t.Errorf("Version = %q, want npx distribution surfaced", a.Metadata().Version)
	}
}

// TestClaudeACPAdapterCapabilities asserts the ACP switch payoff for Claude
// Code: the new adapter speaks the official ACP protocol with the standard
// AcpAdapter → PermissionDecisionBroker approval bridge (the same path as
// codex-acp / opencode-acp), replacing the hand-parsed NDJSON stream-json
// parser. The legacy ClaudeCodeAdapter is retained as a fallback/control and
// must keep its full capability set — claude is the one migration where the
// legacy parser was already mature (approval chain wired), so the payoff is
// protocol standardization + unified broker, not a capability upgrade.
func TestClaudeACPAdapterCapabilities(t *testing.T) {
	acp := NewClaudeACPAdapter("", "")
	for _, field := range []struct {
		name string
		ok   bool
	}{
		{"Streaming", acp.Capabilities().Streaming},
		{"ToolCalls", acp.Capabilities().ToolCalls},
		{"FileChanges", acp.Capabilities().FileChanges},
		{"PermissionHooks", acp.Capabilities().PermissionHooks},
		{"ThinkingVisible", acp.Capabilities().ThinkingVisible},
		{"MultiTurn", acp.Capabilities().MultiTurn},
	} {
		if !field.ok {
			t.Errorf("claude-acp Capabilities.%s = false, want true", field.name)
		}
	}

	legacy := NewClaudeCodeAdapter("claude", "", "")
	if !legacy.Capabilities().Streaming {
		t.Error("legacy ClaudeCodeAdapter must keep Streaming: true (retained fallback/control)")
	}
	if !legacy.Capabilities().PermissionHooks {
		t.Error("legacy ClaudeCodeAdapter must keep PermissionHooks: true (retained fallback/control)")
	}
}

func TestClaudeACPAdapterBuildCommand(t *testing.T) {
	a := NewClaudeACPAdapter("", "")
	cmdPath, args, env, workDir := a.BuildCommand(RunProcessContext{
		Prompt:  "secret prompt that must NOT appear in argv",
		WorkDir: `C:\work\proj`,
	})

	wantPath := acp.DefaultNpxPath()
	if cmdPath != wantPath {
		t.Errorf("cmdPath = %q, want %q", cmdPath, wantPath)
	}
	// The npm package must be version-pinned so `npx -y <pkg>` cannot drift.
	wantArgs := []string{"-y", claudeACPPackageSpec}
	if len(args) != len(wantArgs) {
		t.Fatalf("args = %v, want %v", args, wantArgs)
	}
	for i := range wantArgs {
		if args[i] != wantArgs[i] {
			t.Errorf("args[%d] = %q, want %q (full: %v)", i, args[i], wantArgs[i], args)
		}
	}
	// The prompt travels over ACP stdio (session/prompt) — never argv.
	for _, arg := range args {
		if strings.Contains(arg, "secret prompt") {
			t.Fatalf("prompt leaked into argv: %v", args)
		}
	}
	if workDir != `C:\work\proj` {
		t.Errorf("workDir = %q, want C:\\work\\proj", workDir)
	}
	// env is nil unless the passthrough keys are set.
	if env != nil {
		t.Errorf("env = %v, want nil when no ANTHROPIC_* vars set", env)
	}
}

func TestClaudeACPAdapterBuildCommandEnvPassthrough(t *testing.T) {
	t.Setenv("ANTHROPIC_API_KEY", "sk-ant-test-key")

	a := NewClaudeACPAdapter("npx.cmd", "")
	cmdPath, _, env, _ := a.BuildCommand(RunProcessContext{Prompt: "p", WorkDir: `C:\w`})

	if cmdPath != "npx.cmd" {
		t.Errorf("cmdPath = %q, want npx.cmd (explicit launcher respected)", cmdPath)
	}
	joined := strings.Join(env, "\n")
	for _, want := range []string{"ANTHROPIC_API_KEY=sk-ant-test-key"} {
		if !strings.Contains(joined, want) {
			t.Errorf("env missing %q: %v", want, env)
		}
	}
}

func TestClaudeACPAdapterBuildCommandInjectsModel(t *testing.T) {
	// Default model (--agent-model) is injected as ANTHROPIC_MODEL when the
	// run does not specify one — the ACP protocol's session/new has no model
	// field, so the model must travel through the child env.
	a := NewClaudeACPAdapter("", "deepseek-v4-pro")
	_, _, env, _ := a.BuildCommand(RunProcessContext{Prompt: "p", WorkDir: `/w`})
	if !strings.Contains(strings.Join(env, "\n"), "ANTHROPIC_MODEL=deepseek-v4-pro") {
		t.Errorf("env missing ANTHROPIC_MODEL=deepseek-v4-pro: %v", env)
	}

	// Run-level model wins over the default.
	_, _, env2, _ := a.BuildCommand(RunProcessContext{Prompt: "p", WorkDir: `/w`, Model: "claude-sonnet-4-6"})
	if !strings.Contains(strings.Join(env2, "\n"), "ANTHROPIC_MODEL=claude-sonnet-4-6") {
		t.Errorf("env missing run-level ANTHROPIC_MODEL override: %v", env2)
	}
}

func TestClaudeACPAdapterVersionPin(t *testing.T) {
	if claudeACPPackage != "@agentclientprotocol/claude-agent-acp" {
		t.Errorf("package = %q, want official @agentclientprotocol/claude-agent-acp", claudeACPPackage)
	}
	if claudeACPVersionPin == "" {
		t.Error("version pin must be set")
	}
}

// TestClaudeACPAdapterPreflightFailsFast asserts the launcher-missing path
// fails before spawn.
func TestClaudeACPAdapterPreflightFailsFast(t *testing.T) {
	a := &ClaudeACPAdapter{
		AcpAdapter: acp.NewAcpAdapterWithID(claudeACPAdapterID, "", nil, "Claude Code (ACP)"),
	}
	if a.Available() {
		t.Fatal("empty binary must not be available")
	}
	if err := a.PreflightCheck(); err == nil {
		t.Fatal("PreflightCheck must fail when the launcher is unresolvable")
	} else if !strings.Contains(err.Error(), "claude-acp launcher") {
		t.Errorf("PreflightCheck error = %v, want launcher hint", err)
	}
}

func TestClaudeACPAdapterRegistryRegistration(t *testing.T) {
	reg := adapters.NewRegistry()
	a := NewClaudeACPAdapter("", "")

	if err := reg.Register(a); err != nil {
		t.Fatalf("Register: %v", err)
	}
	got, ok := reg.Get("claude-acp")
	if !ok {
		t.Fatal("Get(claude-acp) not found after registration")
	}
	if got.Metadata().ID != "claude-acp" {
		t.Errorf("registered ID = %q, want claude-acp", got.Metadata().ID)
	}

	// Duplicate registration must be rejected.
	if err := reg.Register(NewClaudeACPAdapter("", "")); err == nil {
		t.Error("duplicate claude-acp registration must be rejected")
	}

	// The generic "acp" adapter ID remains free — concrete configs do not
	// collide with the generic experimental adapter.
	if _, ok := reg.Get("acp"); ok {
		t.Error("generic acp adapter unexpectedly registered")
	}
	if err := reg.Register(acp.NewAcpAdapter("fake-agent", nil, "Fake")); err != nil {
		t.Errorf("generic acp registration should coexist with claude-acp: %v", err)
	}
	if !containsString(reg.ListIDs(), "claude-acp") {
		t.Errorf("ListIDs missing claude-acp: %v", reg.ListIDs())
	}
}

func TestValidateCLIAdapterIDAcceptsClaudeACPAdapter(t *testing.T) {
	if err := adapters.ValidateCLIAdapterID("claude-acp"); err != nil {
		t.Fatalf("ValidateCLIAdapterID(claude-acp) = %v, want nil", err)
	}
}

// TestClaudeACPAdapterParseStreamWithMockACPPeer drives the full adapter path
// — adapter.ParseStream → runACPSession → SDK client ↔ fake ACP agent over
// real JSON-RPC wire — and asserts the streamed updates surface as
// run.agent.* events (the official-protocol path replacing the legacy NDJSON
// parser).
func TestClaudeACPAdapterParseStreamWithMockACPPeer(t *testing.T) {
	adapter := NewClaudeACPAdapter("", "")
	emitter := &recordingEmitter{}
	run := store.Run{ID: "run-claude-acp-1", ProjectID: "proj-claude-acp", ThreadID: "thread-claude-acp"}

	clientToAgentR, clientToAgentW := io.Pipe()
	agentToClientR, agentToClientW := io.Pipe()
	t.Cleanup(func() {
		clientToAgentR.Close()
		agentToClientW.Close()
	})

	notifications := [][]byte{
		sessionUpdateLine("sess-claude-acp",
			`{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"Claude ACP streaming answer."}}`),
		sessionUpdateLine("sess-claude-acp",
			`{"sessionUpdate":"agent_thought_chunk","content":{"type":"text","text":"claude reasoning..."}}`),
	}

	agent := newFakeACPAgent()
	go agent.run(t, clientToAgentR, agentToClientW, notifications)

	ctx := adapters.SDKAdapterContext(context.Background(), RunProcessContext{
		Prompt:  "hello claude",
		WorkDir: `C:\work`,
	})
	err := adapter.ParseStream(ctx, agentToClientR, clientToAgentW, emitter, run)
	if err != nil {
		t.Fatalf("ParseStream: %v", err)
	}

	// The fake agent records a request method only AFTER writing its response
	// (acp_client_test.go fakeACPAgent.run: write-then-record), so the client
	// can finish ParseStream before the peer goroutine records session/prompt.
	// Poll briefly instead of asserting immediately — the record must arrive,
	// just not synchronously with the client's last read.
	deadline := time.Now().Add(2 * time.Second)
	for {
		if got := strings.Join(agent.gotMethods(), ","); got == "initialize,session/new,session/prompt" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("request sequence = %q, want initialize,session/new,session/prompt", strings.Join(agent.gotMethods(), ","))
		}
		time.Sleep(5 * time.Millisecond)
	}

	got := emitterAll(emitter)
	want := []string{
		BusEventTextDelta,
		BusEventThinking,
		BusEventResult,
	}
	if len(got) != len(want) {
		t.Fatalf("emitted %d events, want %d: %+v", len(got), len(want), got)
	}
	for i, typ := range want {
		if got[i].eventType != typ {
			t.Errorf("event[%d] type = %q, want %q", i, got[i].eventType, typ)
		}
	}
	if got[0].payload.(map[string]any)["content"] != "Claude ACP streaming answer." {
		t.Errorf("text_delta content = %v, want streamed answer", got[0].payload)
	}
	if got[2].payload.(map[string]any)["stop_reason"] != "end_turn" {
		t.Errorf("result stop_reason = %v, want end_turn", got[2].payload)
	}
}

// TestCLIInvocationPlanRedactsPromptEnvAndPaths 自根包 sdk_fixture_mapper_test.go
// 随 claude 家族迁入（#1760 claude 增量）：以 claude-code 适配器为投影主体
// 校验 BuildCLIInvocationPlan 的脱敏契约，逻辑未改。
func TestCLIInvocationPlanRedactsPromptEnvAndPaths(t *testing.T) {
	adapter := NewClaudeCodeAdapter("C:\\Tools\\Claude\\claude.exe", "claude-sonnet-fixture", "default")
	plan := adapters.BuildCLIInvocationPlan(adapter, RunProcessContext{
		Prompt:         "SECRET_PROMPT_SHOULD_NOT_APPEAR",
		AgentID:        "claude-code",
		Model:          "sonnet",
		PermissionMode: "plan",
		WorkDir:        "C:\\Users\\Ding\\private\\workspace",
	})

	if plan.AdapterID != "claude-code" {
		t.Fatalf("AdapterID = %q, want claude-code", plan.AdapterID)
	}
	if plan.CommandName != "claude.exe" {
		t.Fatalf("CommandName = %q, want basename only", plan.CommandName)
	}
	if plan.WorkDir != "workspace" {
		t.Fatalf("WorkDir = %q, want basename-only redaction", plan.WorkDir)
	}
	if !plan.PromptRedacted {
		t.Fatal("PromptRedacted = false, want true")
	}
	if plan.Observed || plan.RealTested {
		t.Fatalf("fixture invocation plan observed/realTested = %v/%v, want false/false", plan.Observed, plan.RealTested)
	}
	encoded, err := json.MarshalIndent(plan.Payload(), "", "  ")
	if err != nil {
		t.Fatalf("marshal invocation plan payload: %v", err)
	}
	if strings.Contains(string(encoded), "SECRET_PROMPT_SHOULD_NOT_APPEAR") || strings.Contains(string(encoded), "C:\\Users\\Ding") {
		t.Fatalf("invocation plan leaked prompt or absolute path:\n%s", encoded)
	}
	if !strings.Contains(string(encoded), `"--permission-mode"`) || !strings.Contains(string(encoded), `"--model"`) {
		t.Fatalf("invocation plan did not retain safe arg flags:\n%s", encoded)
	}
}
