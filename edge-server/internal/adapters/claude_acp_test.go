// Package adapters — claude-acp adapter tests.
//
// These tests verify the claude-acp registry registration, command shape, and
// the full ParseStream path against a mock ACP peer over real io.Pipe wire
// (reusing the fakeACPAgent from acp_client_test.go). No real `npx
// @agentclientprotocol/claude-agent-acp` process is spawned — that requires a
// Node.js/npx environment with Claude auth + registry network access, which is
// a TODO for environment verification (see claude_acp.go).
package adapters

import (
	"context"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/agenthub/edge-server/internal/store"
)

func TestClaudeACPAdapterMetadata(t *testing.T) {
	a := NewClaudeACPAdapter("")
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
	acp := NewClaudeACPAdapter("")
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
	a := NewClaudeACPAdapter("")
	cmdPath, args, env, workDir := a.BuildCommand(RunProcessContext{
		Prompt:  "secret prompt that must NOT appear in argv",
		WorkDir: `C:\work\proj`,
	})

	wantPath := defaultNpxPath()
	if cmdPath != wantPath {
		t.Errorf("cmdPath = %q, want %q", cmdPath, wantPath)
	}
	wantArgs := []string{"-y", claudeACPPackage}
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

	a := NewClaudeACPAdapter("npx.cmd")
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
		AcpAdapter: NewAcpAdapterWithID(claudeACPAdapterID, "", nil, "Claude Code (ACP)"),
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
	reg := NewRegistry()
	a := NewClaudeACPAdapter("")

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
	if err := reg.Register(NewClaudeACPAdapter("")); err == nil {
		t.Error("duplicate claude-acp registration must be rejected")
	}

	// The generic "acp" adapter ID remains free — concrete configs do not
	// collide with the generic experimental adapter.
	if _, ok := reg.Get("acp"); ok {
		t.Error("generic acp adapter unexpectedly registered")
	}
	if err := reg.Register(NewAcpAdapter("fake-agent", nil, "Fake")); err != nil {
		t.Errorf("generic acp registration should coexist with claude-acp: %v", err)
	}
	if !containsString(reg.ListIDs(), "claude-acp") {
		t.Errorf("ListIDs missing claude-acp: %v", reg.ListIDs())
	}
}

func TestValidateCLIAdapterIDAcceptsClaudeACPAdapter(t *testing.T) {
	if err := ValidateCLIAdapterID("claude-acp"); err != nil {
		t.Fatalf("ValidateCLIAdapterID(claude-acp) = %v, want nil", err)
	}
}

// TestClaudeACPAdapterParseStreamWithMockACPPeer drives the full adapter path
// — adapter.ParseStream → runACPSession → SDK client ↔ fake ACP agent over
// real JSON-RPC wire — and asserts the streamed updates surface as
// run.agent.* events (the official-protocol path replacing the legacy NDJSON
// parser).
func TestClaudeACPAdapterParseStreamWithMockACPPeer(t *testing.T) {
	adapter := NewClaudeACPAdapter("")
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

	ctx := SDKAdapterContext(context.Background(), RunProcessContext{
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
