// Package codex — codex-acp adapter tests.
//
// These tests verify the codex-acp registry registration, command shape, and
// the full ParseStream path against a mock ACP peer over real io.Pipe wire.
// No real `npx @agentclientprotocol/codex-acp` process is spawned — that
// requires a Node.js/npx environment with Codex auth + registry network
// access, which is a TODO for environment verification (see codex_acp.go).
package codex

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

// ── 测试桩：自根包测试文件随 codex 家族下沉的副本（#1760 codex/opencode
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

func TestCodexACPadapterMetadata(t *testing.T) {
	a := NewCodexACPadapter("")
	if a.Metadata().ID != "codex-acp" {
		t.Errorf("ID = %q, want codex-acp", a.Metadata().ID)
	}
	if a.Metadata().Name != "Codex (ACP)" {
		t.Errorf("Name = %q, want Codex (ACP)", a.Metadata().Name)
	}
	if !strings.Contains(a.Metadata().Version, codexACPVersionPin) {
		t.Errorf("Version = %q, want pinned codex-acp %s visible", a.Metadata().Version, codexACPVersionPin)
	}
}

// TestCodexAdapterMetadataIsNotEmpty 校验 codex 家族内置适配器均有非空
// metadata（根包 TestAdapterMetadataIsNotEmpty 的 codex 行随家族迁入，
// #1760 codex/opencode 增量）。
func TestCodexAdapterMetadataIsNotEmpty(t *testing.T) {
	adapters := []struct {
		name     string
		metadata AdapterMetadata
	}{
		{"CodexACP", NewCodexACPadapter("").Metadata()},
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

// TestCodexACPadapterCapabilities asserts the ACP adapter's streaming and
// tool capabilities (Streaming: true, the ACP switch payoff).
func TestCodexACPadapterCapabilities(t *testing.T) {
	acp := NewCodexACPadapter("")
	if !acp.Capabilities().Streaming {
		t.Error("codex-acp must advertise Streaming: true (ACP streaming over stdio)")
	}
	for _, field := range []struct {
		name string
		ok   bool
	}{
		{"ToolCalls", acp.Capabilities().ToolCalls},
		{"FileChanges", acp.Capabilities().FileChanges},
		{"PermissionHooks", acp.Capabilities().PermissionHooks},
		{"MultiTurn", acp.Capabilities().MultiTurn},
	} {
		if !field.ok {
			t.Errorf("codex-acp Capabilities.%s = false, want true", field.name)
		}
	}
}

func TestCodexACPadapterBuildCommand(t *testing.T) {
	a := NewCodexACPadapter("")
	cmdPath, args, env, workDir := a.BuildCommand(RunProcessContext{
		Prompt:  "secret prompt that must NOT appear in argv",
		WorkDir: `C:\work\proj`,
	})

	wantPath := acp.DefaultNpxPath()
	if cmdPath != wantPath {
		t.Errorf("cmdPath = %q, want %q", cmdPath, wantPath)
	}
	wantArgs := []string{"-y", codexACPPackageSpec}
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
		t.Errorf("env = %v, want nil when no OPENAI_* vars set", env)
	}
}

func TestCodexACPadapterBuildCommandEnvPassthrough(t *testing.T) {
	t.Setenv("OPENAI_API_KEY", "sk-test-key")
	t.Setenv("OPENAI_BASE_URL", "https://gateway.example/v1")

	a := NewCodexACPadapter("npx.cmd")
	cmdPath, _, env, _ := a.BuildCommand(RunProcessContext{Prompt: "p", WorkDir: `C:\w`})

	if cmdPath != "npx.cmd" {
		t.Errorf("cmdPath = %q, want npx.cmd (explicit launcher respected)", cmdPath)
	}
	joined := strings.Join(env, "\n")
	for _, want := range []string{"OPENAI_API_KEY=sk-test-key", "OPENAI_BASE_URL=https://gateway.example/v1"} {
		if !strings.Contains(joined, want) {
			t.Errorf("env missing %q: %v", want, env)
		}
	}
}

func TestCodexACPadapterDefaultNpxPath(t *testing.T) {
	got := acp.DefaultNpxPath()
	if got != "npx.cmd" && got != "npx" {
		t.Fatalf("DefaultNpxPath = %q, want platform npx launcher", got)
	}
}

// TestCodexACPadapterPreflightFailsFast asserts the launcher-missing path
// fails before spawn.
func TestCodexACPadapterPreflightFailsFast(t *testing.T) {
	a := &ACPAdapter{
		AcpAdapter: acp.NewAcpAdapterConfig(acp.AcpAdapterConfig{
			ID:            codexACPadapterID,
			Binary:        "",
			DisplayName:   "Codex (ACP)",
			VersionLabel:  "codex-acp " + codexACPVersionPin + " (npx)",
			EnvKeys:       []string{"OPENAI_API_KEY", "OPENAI_BASE_URL"},
			LauncherLabel: "codex-acp",
			InstallHint:   "install Node.js/npx",
		}),
	}
	if a.Available() {
		t.Fatal("empty binary must not be available")
	}
	if err := a.PreflightCheck(); err == nil {
		t.Fatal("PreflightCheck must fail when the launcher is unresolvable")
	} else if !strings.Contains(err.Error(), "codex-acp launcher") {
		t.Errorf("PreflightCheck error = %v, want launcher hint", err)
	}
}

func TestCodexACPadapterRegistryRegistration(t *testing.T) {
	reg := adapters.NewRegistry()
	a := NewCodexACPadapter("")

	if err := reg.Register(a); err != nil {
		t.Fatalf("Register: %v", err)
	}
	got, ok := reg.Get("codex-acp")
	if !ok {
		t.Fatal("Get(codex-acp) not found after registration")
	}
	if got.Metadata().ID != "codex-acp" {
		t.Errorf("registered ID = %q, want codex-acp", got.Metadata().ID)
	}

	// Duplicate registration must be rejected.
	if err := reg.Register(NewCodexACPadapter("")); err == nil {
		t.Error("duplicate codex-acp registration must be rejected")
	}

	// The generic "acp" adapter ID remains free — concrete configs do not
	// collide with the generic experimental adapter.
	if _, ok := reg.Get("acp"); ok {
		t.Error("generic acp adapter unexpectedly registered")
	}
	if err := reg.Register(acp.NewAcpAdapterConfig(acp.AcpAdapterConfig{ID: "acp", Binary: "fake-agent", DisplayName: "Fake"})); err != nil {
		t.Errorf("generic acp registration should coexist with codex-acp: %v", err)
	}
	if !containsString(reg.ListIDs(), "codex-acp") {
		t.Errorf("ListIDs missing codex-acp: %v", reg.ListIDs())
	}
}

// TestCodexACPadapterParseStreamWithMockACPPeer drives the full adapter path
// — adapter.ParseStream → runACPSession → SDK client ↔ fake ACP agent over
// real JSON-RPC wire — and asserts the streamed updates surface as
// run.agent.* events (the Streaming upgrade over the legacy batch parser).
func TestCodexACPadapterParseStreamWithMockACPPeer(t *testing.T) {
	adapter := NewCodexACPadapter("")
	emitter := &recordingEmitter{}
	run := store.Run{ID: "run-codex-acp-1", ProjectID: "proj-codex-acp", ThreadID: "thread-codex-acp"}

	clientToAgentR, clientToAgentW := io.Pipe()
	agentToClientR, agentToClientW := io.Pipe()
	t.Cleanup(func() {
		clientToAgentR.Close()
		agentToClientW.Close()
	})

	notifications := [][]byte{
		sessionUpdateLine("sess-codex-acp",
			`{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"Codex ACP streaming answer."}}`),
		sessionUpdateLine("sess-codex-acp",
			`{"sessionUpdate":"agent_thought_chunk","content":{"type":"text","text":"codex reasoning..."}}`),
	}

	agent := newFakeACPAgent()
	go agent.run(t, clientToAgentR, agentToClientW, notifications)

	ctx := adapters.SDKAdapterContext(context.Background(), RunProcessContext{
		Prompt:  "hello codex",
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
	if got[0].payload.(map[string]any)["content"] != "Codex ACP streaming answer." {
		t.Errorf("text_delta content = %v, want streamed answer", got[0].payload)
	}
	if got[2].payload.(map[string]any)["stop_reason"] != "end_turn" {
		t.Errorf("result stop_reason = %v, want end_turn", got[2].payload)
	}
}
