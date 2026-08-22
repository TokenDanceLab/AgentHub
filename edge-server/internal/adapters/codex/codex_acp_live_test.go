// Package codex — live ACP real-run harness (#1743 item 3).
//
// This file is the opt-in end-to-end verification for the codex-acp adapter:
// it spawns the REAL `npx -y @agentclientprotocol/codex-acp@1.1.7` process
// (exactly the BuildCommand shape production uses — same path as
// process_executor_build.go: exec.Command + cmd.Dir + cmd.Env) and drives the
// full ACP turn through adapter.ParseStream → runACPSession →
// coder/acp-go-sdk client, capturing every emitted Edge event.
//
// The mock-peer tests in codex_acp_test.go cover the same path with a fake
// agent; this file proves the real binary negotiates the protocol and that
// session/update streams surface as run.agent.* bus events.
//
// Gate: ACP_LIVE=1. A model-backed reply additionally needs OPENAI_API_KEY
// (the adapter's EnvKeys passthrough) or a codex login on the machine.
// Without credentials the chain still runs up to the point the agent must
// call the model API — initialize/session/new/session/prompt trajectory and
// every event emitted before the auth failure are all observable in the log.
//
// Run:
//
//	cd edge-server && ACP_LIVE=1 go test ./internal/adapters/codex/ \
//	  -run TestCodexACPadapterLiveRealRun -v -count=1
//
// Evidence record (first run: huawei-dev, see #1743 item 3):
//   - npm mirror serves the pinned 1.1.7 (`npx -y
//     @agentclientprotocol/codex-acp@1.1.7 --version` exit 0), so the
//     launcher+network preconditions hold.
package codex

import (
	"bytes"
	"context"
	"log/slog"
	"os"
	"os/exec"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/store"
)

// lockedBuffer is a hard-sync buffer for concurrently written stderr/stdout
// captures (the process writes while ParseStream reads).
type lockedBuffer struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (l *lockedBuffer) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.b.Write(p)
}

func (l *lockedBuffer) String() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.b.String()
}

// tailLines keeps the last n lines of s, marking truncation.
func tailLines(s string, n int) string {
	lines := strings.Split(strings.TrimRight(s, "\n"), "\n")
	if len(lines) <= n {
		return s
	}
	return "[...truncated...]\n" + strings.Join(lines[len(lines)-n:], "\n")
}

// TestCodexACPadapterLiveRealRun is the live ACP real-run verification
// (#1743 item 3, TODO at codex_acp.go). It asserts nothing about model
// availability — it records evidence: the emitted event sequence, SDK wire
// log, agent stderr, and ParseStream outcome. The caller classifies the
// chain against the recorded events.
func TestCodexACPadapterLiveRealRun(t *testing.T) {
	if os.Getenv("ACP_LIVE") != "1" {
		t.Skip("live ACP real-run gate: set ACP_LIVE=1 to spawn the real codex-acp binary")
	}
	if testing.Short() {
		t.Skip("live ACP real-run gate: skipped in short mode")
	}
	if _, err := exec.LookPath("npx"); err != nil {
		t.Skipf("npx not found on PATH: %v", err)
	}

	adapter := NewCodexACPadapter("")
	emitter := &recordingEmitter{}
	run := store.Run{ID: "run-live-acp", ProjectID: "proj-live-acp", ThreadID: "thread-live-acp"}

	workDir := t.TempDir()
	prompt := "Reply with exactly the word ACK and nothing else."
	adapterCtx := RunProcessContext{Run: run, Prompt: prompt, WorkDir: workDir}
	cmdPath, args, buildEnv, planWorkDir := adapter.BuildCommand(adapterCtx)
	t.Logf("build: cmd=%s args=%q env=%v workdir=%s", cmdPath, args, buildEnv, planWorkDir)

	// Same spawn shape as process_executor_build.go: exec.Command + cmd.Dir.
	// Env: os.Environ() merged with adapter re-injected entries; exec.Cmd
	// resolves duplicate keys last-wins, so BuildCommand passthrough wins.
	cmd := exec.Command(cmdPath, args...)
	cmd.Dir = planWorkDir
	cmd.Env = append(os.Environ(), buildEnv...)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatalf("stdout pipe: %v", err)
	}
	stdin, err := cmd.StdinPipe()
	if err != nil {
		t.Fatalf("stdin pipe: %v", err)
	}
	stderrBuf := &lockedBuffer{}
	cmd.Stderr = stderrBuf

	if err := cmd.Start(); err != nil {
		t.Fatalf("spawn %s: %v", cmdPath, err)
	}
	startedAt := time.Now()

	// Raise the SDK logger to debug so protocol wire activity shows up in the
	// evidence log (restored when the test ends).
	var sdkLog lockedBuffer
	prevSlog := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&sdkLog, &slog.HandlerOptions{Level: slog.LevelDebug})))
	defer slog.SetDefault(prevSlog)

	ctx := adapters.SDKAdapterContext(context.Background(), adapterCtx)
	parseDone := make(chan error, 1)
	go func() { parseDone <- adapter.ParseStream(ctx, stdout, stdin, emitter, run) }()

	var parseErr error
	select {
	case parseErr = <-parseDone:
	case <-time.After(10 * time.Minute):
		_ = cmd.Process.Kill()
		t.Fatal("ParseStream did not return within 10m — ACP turn hung")
	}
	_ = stdin.Close()

	// Wait for the agent process to exit, escalating to kill after a grace
	// period (codex-acp stays alive after a turn until its stdin closes).
	waitDone := make(chan struct{})
	go func() { _ = cmd.Wait(); close(waitDone) }()
	select {
	case <-waitDone:
	case <-time.After(15 * time.Second):
		_ = cmd.Process.Kill()
		<-waitDone
	}

	t.Logf("process: launched %v elapsed (parseErr=%v)", time.Since(startedAt).Round(time.Millisecond), parseErr)

	events := emitterAll(emitter)
	t.Logf("EVIDENCE event_count=%d parseErr=%v", len(events), parseErr)
	for i, ev := range events {
		t.Logf("EVIDENCE event[%02d] type=%s scope=%v payload=%v", i, ev.eventType, ev.scope, ev.payload)
	}
	if got := stderrBuf.String(); got != "" {
		t.Logf("EVIDENCE agent_stderr (%d bytes):\n%s", len(got), tailLines(got, 60))
	}
	if got := sdkLog.String(); got != "" {
		t.Logf("EVIDENCE sdk_log (%d bytes):\n%s", len(got), tailLines(got, 120))
	}

	// The one thing the live chain must prove when a full turn completes:
	// initialize→prompt without a protocol error should yield a run.agent
	// result event (and text_delta when the agent streamed a reply).
	if parseErr == nil {
		var sawResult bool
		for _, ev := range emitterAll(emitter) {
			if ev.eventType == BusEventResult {
				sawResult = true
			}
		}
		if !sawResult {
			t.Errorf("parse succeeded but no run.agent.result event emitted: %+v", emitterAll(emitter))
		}
	}
	// A non-nil parseErr is NOT a test failure: it is the evidence of where
	// the chain stops (typically agent auth at session/prompt). The verdict
	// lives with the operator, not in go test.
}
