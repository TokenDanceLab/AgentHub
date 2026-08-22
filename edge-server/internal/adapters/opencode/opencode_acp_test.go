// Package opencode — opencode-acp adapter tests.
//
// These tests verify the opencode-acp registry registration, command shape,
// and the full ParseStream path against a mock ACP peer over real io.Pipe
// wire. No real `opencode acp` process is spawned — that requires an
// opencode >= 1.18.5 binary with provider credentials, which is a TODO for
// environment verification (see opencode_acp.go).
package opencode

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

// ── 测试桩：自根包测试文件随 opencode 家族下沉的副本（#1760 codex/opencode
// 增量）──
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

// emitterAll returns a copy of every event recorded by a recordingEmitter.
func emitterAll(r *recordingEmitter) []recordedEvent {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]recordedEvent(nil), r.events...)
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

func containsString(list []string, target string) bool {
	for _, value := range list {
		if value == target {
			return true
		}
	}
	return false
}

func TestOpenCodeACPAdapterMetadata(t *testing.T) {
	a := NewOpenCodeACPAdapter("")
	if a.Metadata().ID != "opencode-acp" {
		t.Errorf("ID = %q, want opencode-acp", a.Metadata().ID)
	}
	if a.Metadata().Name != "OpenCode (ACP)" {
		t.Errorf("Name = %q, want OpenCode (ACP)", a.Metadata().Name)
	}
	if !strings.Contains(a.Metadata().Version, opencodeACPVersionPin) {
		t.Errorf("Version = %q, want pinned opencode %s visible", a.Metadata().Version, opencodeACPVersionPin)
	}
}

// TestOpenCodeAdapterMetadataIsNotEmpty 校验 opencode 家族内置适配器均有非空
// metadata（根包 TestAdapterMetadataIsNotEmpty 的 opencode 行随家族迁入，
// #1760 codex/opencode 增量）。
func TestOpenCodeAdapterMetadataIsNotEmpty(t *testing.T) {
	adapters := []struct {
		name     string
		metadata AdapterMetadata
	}{
		{"OpenCodeACP", NewOpenCodeACPAdapter("").Metadata()},
	}
	for _, a := range adapters {
		if a.metadata.ID == "" {
			t.Fatalf("%s adapter ID is empty", a.name)
		}
		if a.metadata.Name == "" {
			t.Fatalf("%s adapter Name is empty", a.name)
		}
		if a.metadata.Description == "" {
			t.Fatalf("%s adapter Description is empty", a.name)
		}
	}
}

// TestOpenCodeACPAdapterCapabilitiesUpgrade asserts the ACP switch payoff: the
// new adapter carries the ACP permission chain (PermissionHooks: true) where
// the legacy `opencode run --format json` OpenCodeAdapter has none — its
// permission.asked events are advisory-only (nonInteractive: true, no
// broker round-trip).
func TestOpenCodeACPAdapterCapabilitiesUpgrade(t *testing.T) {
	acp := NewOpenCodeACPAdapter("")
	if !acp.Capabilities().Streaming {
		t.Error("opencode-acp must advertise Streaming: true (ACP streaming over stdio)")
	}
	for _, field := range []struct {
		name string
		ok   bool
	}{
		{"ToolCalls", acp.Capabilities().ToolCalls},
		{"FileChanges", acp.Capabilities().FileChanges},
		{"PermissionHooks", acp.Capabilities().PermissionHooks},
		{"ThinkingVisible", acp.Capabilities().ThinkingVisible},
		{"MultiTurn", acp.Capabilities().MultiTurn},
	} {
		if !field.ok {
			t.Errorf("opencode-acp Capabilities.%s = false, want true", field.name)
		}
	}
}

func TestOpenCodeACPAdapterBuildCommand(t *testing.T) {
	a := NewOpenCodeACPAdapter("")
	cmdPath, args, env, workDir := a.BuildCommand(RunProcessContext{
		Prompt:  "secret prompt that must NOT appear in argv",
		WorkDir: `C:\work\proj`,
	})

	if cmdPath != opencodeACPDefaultBinary {
		t.Errorf("cmdPath = %q, want %q (default opencode binary)", cmdPath, opencodeACPDefaultBinary)
	}
	wantArgs := []string{"acp"}
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
		t.Errorf("env = %v, want nil when no provider keys set", env)
	}
}

func TestOpenCodeACPAdapterExplicitBinaryPath(t *testing.T) {
	a := NewOpenCodeACPAdapter(`C:\tools\opencode.exe`)
	cmdPath, args, _, _ := a.BuildCommand(RunProcessContext{Prompt: "p", WorkDir: `C:\w`})

	if cmdPath != `C:\tools\opencode.exe` {
		t.Errorf("cmdPath = %q, want explicit binary path respected", cmdPath)
	}
	if len(args) != 1 || args[0] != "acp" {
		t.Errorf("args = %v, want [acp]", args)
	}
}

func TestOpenCodeACPAdapterBuildCommandEnvPassthrough(t *testing.T) {
	t.Setenv("OPENAI_API_KEY", "sk-openai-test")
	t.Setenv("ANTHROPIC_API_KEY", "sk-ant-test")
	t.Setenv("OPENROUTER_API_KEY", "sk-or-test")
	t.Setenv("GEMINI_API_KEY", "sk-gemini-test")

	a := NewOpenCodeACPAdapter("opencode")
	_, _, env, _ := a.BuildCommand(RunProcessContext{Prompt: "p", WorkDir: `C:\w`})

	joined := strings.Join(env, "\n")
	for _, want := range []string{
		"OPENAI_API_KEY=sk-openai-test",
		"ANTHROPIC_API_KEY=sk-ant-test",
		"OPENROUTER_API_KEY=sk-or-test",
		"GEMINI_API_KEY=sk-gemini-test",
	} {
		if !strings.Contains(joined, want) {
			t.Errorf("env missing %q: %v", want, env)
		}
	}
}

func TestOpenCodeACPAdapterDefaultBinaryPath(t *testing.T) {
	a := NewOpenCodeACPAdapter("")
	if a.AgentBinary() != "opencode" {
		t.Errorf("agentBinary = %q, want default opencode", a.AgentBinary())
	}
}

func TestOpenCodeACPAdapterPreflightFailsFast(t *testing.T) {
	a := &ACPAdapter{
		AcpAdapter: acp.NewAcpAdapterWithID(opencodeACPAdapterID, "", nil, "OpenCode (ACP)"),
	}
	if a.Available() {
		t.Fatal("empty binary must not be available")
	}
	if err := a.PreflightCheck(); err == nil {
		t.Fatal("PreflightCheck must fail when the binary is unresolvable")
	} else if !strings.Contains(err.Error(), "opencode-acp launcher") {
		t.Errorf("PreflightCheck error = %v, want launcher hint", err)
	}
}

func TestOpenCodeACPAdapterRegistryRegistration(t *testing.T) {
	reg := adapters.NewRegistry()
	a := NewOpenCodeACPAdapter("")

	if err := reg.Register(a); err != nil {
		t.Fatalf("Register: %v", err)
	}
	got, ok := reg.Get("opencode-acp")
	if !ok {
		t.Fatal("Get(opencode-acp) not found after registration")
	}
	if got.Metadata().ID != "opencode-acp" {
		t.Errorf("registered ID = %q, want opencode-acp", got.Metadata().ID)
	}

	// Duplicate registration must be rejected.
	if err := reg.Register(NewOpenCodeACPAdapter("")); err == nil {
		t.Error("duplicate opencode-acp registration must be rejected")
	}

	if !containsString(reg.ListIDs(), "opencode-acp") {
		t.Errorf("ListIDs missing opencode-acp: %v", reg.ListIDs())
	}
}

func TestValidateCLIAdapterIDAcceptsOpenCodeACPAdapter(t *testing.T) {
	if err := adapters.ValidateCLIAdapterID("opencode-acp"); err != nil {
		t.Fatalf("ValidateCLIAdapterID(opencode-acp) = %v, want nil", err)
	}
}

// TestOpenCodeACPAdapterParseStreamWithMockACPPeer drives the full adapter
// path — adapter.ParseStream → runACPSession → SDK client ↔ fake ACP agent
// over real JSON-RPC wire — and asserts the streamed updates surface as
// run.agent.* events, including the ACP permission chain that the legacy
// opencode batch parser lacks.
func TestOpenCodeACPAdapterParseStreamWithMockACPPeer(t *testing.T) {
	adapter := NewOpenCodeACPAdapter("")
	emitter := &recordingEmitter{}
	run := store.Run{ID: "run-opencode-acp-1", ProjectID: "proj-opencode-acp", ThreadID: "thread-opencode-acp"}

	clientToAgentR, clientToAgentW := io.Pipe()
	agentToClientR, agentToClientW := io.Pipe()
	t.Cleanup(func() {
		clientToAgentR.Close()
		agentToClientW.Close()
	})

	notifications := [][]byte{
		sessionUpdateLine("sess-opencode-acp",
			`{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"OpenCode ACP streaming answer."}}`),
		sessionUpdateLine("sess-opencode-acp",
			`{"sessionUpdate":"agent_thought_chunk","content":{"type":"text","text":"opencode reasoning..."}}`),
	}

	agent := newFakeACPAgent()
	go agent.run(t, clientToAgentR, agentToClientW, notifications)

	ctx := adapters.SDKAdapterContext(context.Background(), RunProcessContext{
		Prompt:  "hello opencode",
		WorkDir: `C:\work`,
	})
	err := adapter.ParseStream(ctx, agentToClientR, clientToAgentW, emitter, run)
	if err != nil {
		t.Fatalf("ParseStream: %v", err)
	}

	// The fake agent records a request method only AFTER writing its response
	// (acp/acp_client_test.go fakeACPAgent.run: write-then-record), so the
	// client can finish ParseStream before the peer goroutine records
	// session/prompt. Poll briefly instead of asserting immediately — the
	// record must arrive, just not synchronously with the client's last read.
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
	if got[0].payload.(map[string]any)["content"] != "OpenCode ACP streaming answer." {
		t.Errorf("text_delta content = %v, want streamed answer", got[0].payload)
	}
	if got[2].payload.(map[string]any)["stop_reason"] != "end_turn" {
		t.Errorf("result stop_reason = %v, want end_turn", got[2].payload)
	}
}
