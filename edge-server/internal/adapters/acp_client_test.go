// Package adapters — ACP SDK client runtime tests (mock JSON-RPC peer).
//
// These tests run the coder/acp-go-sdk (v0.13.5) client connection against a
// fake ACP agent over real io.Pipe wire: line-delimited JSON-RPC 2.0 with
// the official wire format (sessionUpdate discriminators, typed fields).
// They prove the SDK client can parse session/update notifications, dispatch
// them to acpClientHandler, and that acp_events.go maps them to run.agent.*
// — without spawning a real adapter binary (no npx/keys in this env).
//
// Real-adapter end-to-end run (`npx -y @agentclientprotocol/codex-acp`) is a
// TODO for environment verification (see runACPSession).
package adapters

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

	"github.com/agenthub/edge-server/internal/store"
)

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
		f.recordMethod(msg.Method)
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

// testACPContext builds a ParseStream-style ctx carrying RunProcessContext.
func testACPContext(prompt, workDir string) context.Context {
	return SDKAdapterContext(context.Background(), RunProcessContext{
		Prompt:  prompt,
		WorkDir: workDir,
	})
}

func TestRunACPSession_MockAgentStreamsTypedUpdates(t *testing.T) {
	emitter := &recordingEmitter{}
	run := store.Run{ID: "run-acp-1", ProjectID: "proj-acp", ThreadID: "thread-acp"}

	clientToAgentR, clientToAgentW := io.Pipe()
	agentToClientR, agentToClientW := io.Pipe()
	t.Cleanup(func() {
		clientToAgentR.Close()
		agentToClientW.Close()
	})

	notifications := [][]byte{
		sessionUpdateLine("sess-mock-1",
			`{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"Hello"}}`),
		sessionUpdateLine("sess-mock-1",
			`{"sessionUpdate":"agent_thought_chunk","content":{"type":"text","text":"reasoning..."}}`),
		sessionUpdateLine("sess-mock-1",
			`{"sessionUpdate":"tool_call","toolCallId":"tc_mock","title":"read file","kind":"read","status":"completed","rawOutput":{"ok":true}}`),
		sessionUpdateLine("sess-mock-1",
			`{"sessionUpdate":"usage_update","size":100000,"used":42}`),
	}

	agent := newFakeACPAgent()
	go agent.run(t, clientToAgentR, agentToClientW, notifications)

	err := runACPSession(testACPContext("hello agent", `C:\work`), agentToClientR, clientToAgentW, emitter, run)
	if err != nil {
		t.Fatalf("runACPSession: %v", err)
	}

	// Handshake sequence: initialize → session/new → session/prompt.
	if got := strings.Join(agent.gotMethods(), ","); got != "initialize,session/new,session/prompt" {
		t.Errorf("request sequence = %q, want initialize,session/new,session/prompt", got)
	}

	// Streamed updates, in order, mapped to run.agent.* events.
	want := []struct {
		typ     string
		payload map[string]any
	}{
		{BusEventTextDelta, map[string]any{"content": "Hello"}},
		{BusEventThinking, map[string]any{"content": "reasoning...", "status": "delta"}},
		{BusEventToolCall, map[string]any{"tool_call_id": "tc_mock", "title": "read file", "kind": "read", "status": "completed"}},
		{BusEventToolResult, map[string]any{"tool_call_id": "tc_mock", "status": "completed", "raw_output": `{"ok":true}`}},
		{BusEventContextUsage, map[string]any{"tokens_used": 42, "context_size": 100000}},
		{BusEventResult, map[string]any{"stop_reason": "end_turn"}},
	}
	got := emitterAll(emitter)
	if len(got) != len(want) {
		t.Fatalf("emitted %d events, want %d: %+v", len(got), len(want), got)
	}
	for i, w := range want {
		if got[i].eventType != w.typ {
			t.Errorf("event[%d] type = %q, want %q", i, got[i].eventType, w.typ)
		}
		for k, v := range w.payload {
			if got[i].payload == nil || got[i].payload.(map[string]any)[k] != v {
				t.Errorf("event[%d] (%s) payload[%s] = %v, want %v (payload=%+v)",
					i, w.typ, k, got[i].payload.(map[string]any)[k], v, got[i].payload)
			}
		}
		// Scope mirrors lifecycle.runScope shape.
		for k, v := range map[string]any{
			"projectId": "proj-acp",
			"threadId":  "thread-acp",
			"runId":     "run-acp-1",
		} {
			if got[i].scope[k] != v {
				t.Errorf("event[%d] scope[%s] = %v, want %v", i, k, got[i].scope[k], v)
			}
		}
	}
}

func TestRunACPSession_RequestPermissionGetsErrorResponse(t *testing.T) {
	emitter := &recordingEmitter{}
	run := store.Run{ID: "run-acp-2", ProjectID: "proj-acp", ThreadID: "thread-acp"}

	clientToAgentR, clientToAgentW := io.Pipe()
	agentToClientR, agentToClientW := io.Pipe()
	t.Cleanup(func() {
		clientToAgentR.Close()
		agentToClientW.Close()
	})

	// The agent asks permission mid-turn (blocking request with an id).
	// Options must be present (RequestPermissionRequest.Validate requires it).
	permReq := []byte(
		`{"jsonrpc":"2.0","id":900,"method":"session/request_permission",` +
			`"params":{"sessionId":"sess-mock-1","options":[],` +
			`"toolCall":{"toolCallId":"tc_perm","title":"Bash"}}}`)

	notifications := [][]byte{
		permReq,
		sessionUpdateLine("sess-mock-1",
			`{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"after permission"}}`),
	}

	agent := newFakeACPAgent()
	go agent.run(t, clientToAgentR, agentToClientW, notifications)

	err := runACPSession(testACPContext("hello agent", `C:\work`), agentToClientR, clientToAgentW, emitter, run)
	if err != nil {
		t.Fatalf("runACPSession: %v", err)
	}

	// The spike handler answers with a JSON-RPC error (no silent hang). The
	// error response is written by the SDK's concurrent request-handler
	// goroutine, which may outlive the turn — wait for the agent to see it.
	select {
	case permResp := <-agent.responses:
		if !strings.Contains(permResp, `"error"`) {
			t.Fatalf("expected JSON-RPC error response for request_permission, got: %s", permResp)
		}
		if !strings.Contains(permResp, "not wired") {
			t.Errorf("error response should mention the unwired endpoint, got: %s", permResp)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("fake agent never received a response for session/request_permission")
	}

	// The error response must not kill the stream: text after the permission
	// request is still delivered, then the result event.
	got := emitterAll(emitter)
	if len(got) != 2 {
		t.Fatalf("emitted %d events, want [text_delta, result]: %+v", len(got), got)
	}
	if got[0].eventType != BusEventTextDelta || got[0].payload.(map[string]any)["content"] != "after permission" {
		t.Errorf("event[0] = %+v, want text_delta 'after permission'", got[0])
	}
	if got[1].eventType != BusEventResult {
		t.Errorf("event[1] = %+v, want result", got[1])
	}
}

func TestRunACPSession_RequiresPromptAndWorkDir(t *testing.T) {
	emitter := &recordingEmitter{}
	run := store.Run{ID: "run-acp-3"}

	// No RunProcessContext attached → non-recoverable error.
	err := runACPSession(context.Background(), strings.NewReader(""), io.Discard, emitter, run)
	if err == nil || !isNonRecoverable(err) {
		t.Fatalf("missing RunProcessContext: got %v, want non-recoverable ParseStreamError", err)
	}

	// Empty workdir → non-recoverable error.
	err = runACPSession(testACPContext("prompt", ""), strings.NewReader(""), io.Discard, emitter, run)
	if err == nil || !isNonRecoverable(err) {
		t.Fatalf("empty workdir: got %v, want non-recoverable ParseStreamError", err)
	}
}

// isNonRecoverable reports whether err wraps a non-recoverable ParseStreamError.
func isNonRecoverable(err error) bool {
	ps, ok := err.(*ParseStreamError)
	return ok && !ps.Recoverable()
}
