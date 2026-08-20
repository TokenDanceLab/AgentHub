// Package adapters — codex-acp adapter tests.
//
// These tests verify the codex-acp registry registration, command shape, and
// the full ParseStream path against a mock ACP peer over real io.Pipe wire
// (reusing the fakeACPAgent from acp_client_test.go). No real `npx
// @agentclientprotocol/codex-acp` process is spawned — that requires a
// Node.js/npx environment with Codex auth + registry network access, which is
// a TODO for environment verification (see codex_acp.go).
package adapters

import (
	"context"
	"errors"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/agenthub/edge-server/internal/store"
)

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

	wantPath := DefaultNpxPath()
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
	got := DefaultNpxPath()
	if got != "npx.cmd" && got != "npx" {
		t.Fatalf("DefaultNpxPath = %q, want platform npx launcher", got)
	}
}

func TestAcpBinaryAvailable(t *testing.T) {
	found := func(string) (string, error) { return "npx.cmd", nil }
	missing := func(string) (string, error) { return "", errors.New("executable file not found") }

	if !acpBinaryAvailable("npx.cmd", found) {
		t.Error("resolvable binary should be available")
	}
	if acpBinaryAvailable("npx.cmd", missing) {
		t.Error("unresolvable binary must be unavailable")
	}
	if acpBinaryAvailable("", found) {
		t.Error("empty binary must be unavailable")
	}
	if acpBinaryAvailable("  ", missing) {
		t.Error("blank binary must be unavailable")
	}
}

// TestCodexACPadapterPreflightFailsFast asserts the launcher-missing path
// fails before spawn.
func TestCodexACPadapterPreflightFailsFast(t *testing.T) {
	a := &CodexACPadapter{
		AcpAdapter: NewAcpAdapterConfig(AcpAdapterConfig{
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
	reg := NewRegistry()
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
	if err := reg.Register(NewAcpAdapter("fake-agent", nil, "Fake")); err != nil {
		t.Errorf("generic acp registration should coexist with codex-acp: %v", err)
	}
	if !containsString(reg.ListIDs(), "codex-acp") {
		t.Errorf("ListIDs missing codex-acp: %v", reg.ListIDs())
	}
}

func TestValidateCLIAdapterIDAcceptsCodexACPadapter(t *testing.T) {
	if err := ValidateCLIAdapterID("codex-acp"); err != nil {
		t.Fatalf("ValidateCLIAdapterID(codex-acp) = %v, want nil", err)
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

	ctx := SDKAdapterContext(context.Background(), RunProcessContext{
		Prompt:  "hello codex",
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
	if got[0].payload.(map[string]any)["content"] != "Codex ACP streaming answer." {
		t.Errorf("text_delta content = %v, want streamed answer", got[0].payload)
	}
	if got[2].payload.(map[string]any)["stop_reason"] != "end_turn" {
		t.Errorf("result stop_reason = %v, want end_turn", got[2].payload)
	}
}
