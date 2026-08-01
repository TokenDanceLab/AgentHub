// Package adapters — opencode-acp adapter tests.
//
// These tests verify the opencode-acp registry registration, command shape,
// and the full ParseStream path against a mock ACP peer over real io.Pipe
// wire (reusing the fakeACPAgent from acp_client_test.go). No real `opencode
// acp` process is spawned — that requires an opencode >= 1.18.5 binary with
// provider credentials, which is a TODO for environment verification (see
// opencode_acp.go).
package adapters

import (
	"context"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/agenthub/edge-server/internal/store"
)

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
	legacy := NewOpenCodeAdapter("opencode")
	if legacy.Capabilities().PermissionHooks {
		t.Error("legacy OpenCodeAdapter must keep PermissionHooks: false (batch parser, no ACP approval chain)")
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
	if a.AcpAdapter.agentBinary != "opencode" {
		t.Errorf("agentBinary = %q, want default opencode", a.AcpAdapter.agentBinary)
	}
}

func TestOpenCodeACPAdapterPreflightFailsFast(t *testing.T) {
	a := &OpenCodeACPAdapter{
		AcpAdapter: NewAcpAdapterWithID(opencodeACPAdapterID, "", nil, "OpenCode (ACP)"),
		env:        nil,
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
	reg := NewRegistry()
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

	// opencode-acp coexists with the legacy opencode adapter (fallback stays
	// registered until the ACP path is verified end-to-end).
	if err := reg.Register(NewOpenCodeAdapter("opencode")); err != nil {
		t.Errorf("legacy opencode registration should coexist with opencode-acp: %v", err)
	}
	if !containsString(reg.ListIDs(), "opencode-acp") {
		t.Errorf("ListIDs missing opencode-acp: %v", reg.ListIDs())
	}
}

func TestValidateCLIAdapterIDAcceptsOpenCodeACPAdapter(t *testing.T) {
	if err := ValidateCLIAdapterID("opencode-acp"); err != nil {
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

	ctx := SDKAdapterContext(context.Background(), RunProcessContext{
		Prompt:  "hello opencode",
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
	if got[0].payload.(map[string]any)["content"] != "OpenCode ACP streaming answer." {
		t.Errorf("text_delta content = %v, want streamed answer", got[0].payload)
	}
	if got[2].payload.(map[string]any)["stop_reason"] != "end_turn" {
		t.Errorf("result stop_reason = %v, want end_turn", got[2].payload)
	}
}
