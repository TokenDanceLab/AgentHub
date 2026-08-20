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
	"errors"
	"fmt"
	"io"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/agenthub/edge-server/internal/store"
	"github.com/coder/acp-go-sdk"
)

// TestUnwiredACPEndpointsFailClosed locks the STUB INVENTORY in acp_client.go:
// every deliberately unwired ACP endpoint (#1404 fs/terminal frame design)
// must answer with an error wrapping errACPEndpointNotWired — a JSON-RPC
// error the agent can surface — and must never return a nil error (silent
// hang from the agent's perspective) or a fabricated success response. When
// #1404 wires an endpoint, remove it from this table and from the inventory.
func TestUnwiredACPEndpointsFailClosed(t *testing.T) {
	handler := newACPClientHandler(nil, store.Run{ID: "run_test"}, nil, context.Background())
	ctx := context.Background()

	stubs := []struct {
		name string
		call func() error
	}{
		{"fs/read_text_file", func() error {
			_, err := handler.ReadTextFile(ctx, acp.ReadTextFileRequest{})
			return err
		}},
		{"fs/write_text_file", func() error {
			_, err := handler.WriteTextFile(ctx, acp.WriteTextFileRequest{})
			return err
		}},
		{"terminal/create", func() error {
			_, err := handler.CreateTerminal(ctx, acp.CreateTerminalRequest{})
			return err
		}},
		{"terminal/kill", func() error {
			_, err := handler.KillTerminal(ctx, acp.KillTerminalRequest{})
			return err
		}},
		{"terminal/output", func() error {
			_, err := handler.TerminalOutput(ctx, acp.TerminalOutputRequest{})
			return err
		}},
		{"terminal/release", func() error {
			_, err := handler.ReleaseTerminal(ctx, acp.ReleaseTerminalRequest{})
			return err
		}},
		{"terminal/wait_for_exit", func() error {
			_, err := handler.WaitForTerminalExit(ctx, acp.WaitForTerminalExitRequest{})
			return err
		}},
	}

	for _, stub := range stubs {
		t.Run(stub.name, func(t *testing.T) {
			err := stub.call()
			if err == nil {
				t.Fatalf("%s returned nil error — stub must fail closed, not hang", stub.name)
			}
			if !errors.Is(err, errACPEndpointNotWired) {
				t.Fatalf("%s error = %v, want errACPEndpointNotWired", stub.name, err)
			}
		})
	}
}

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

	err := runACPSession(testACPContext("hello agent", `C:\work`), agentToClientR, clientToAgentW, emitter, run, nil)
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

func TestRunACPSession_RequestPermissionAutoAllowWithoutBroker(t *testing.T) {
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
	permReq := permissionRequestLine(900, "sess-mock-1", `[{"kind":"allow_once","name":"Allow","optionId":"opt-allow"}]`,
		`{"toolCallId":"tc_perm","title":"Bash"}`)

	notifications := [][]byte{
		permReq,
		sessionUpdateLine("sess-mock-1",
			`{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"after permission"}}`),
	}

	agent := newFakeACPAgent()
	go agent.run(t, clientToAgentR, agentToClientW, notifications)

	err := runACPSession(testACPContext("hello agent", `C:\work`), agentToClientR, clientToAgentW, emitter, run, nil)
	if err != nil {
		t.Fatalf("runACPSession: %v", err)
	}

	// Without a broker the handler auto-approves: the agent receives a
	// "selected" outcome instead of a JSON-RPC error (no silent hang).
	select {
	case permResp := <-agent.responses:
		if strings.Contains(permResp, `"error"`) {
			t.Fatalf("expected selected outcome for request_permission, got JSON-RPC error: %s", permResp)
		}
		if !strings.Contains(permResp, `"outcome":"selected"`) || !strings.Contains(permResp, "opt-allow") {
			t.Errorf("auto-allow response should select the allow_once option, got: %s", permResp)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("fake agent never received a response for session/request_permission")
	}

	// Events: permission_requested, permission_decided (allow), text_delta,
	// result. The permission events are emitted from the SDK's request
	// handler goroutine and the stream events from the notification
	// goroutine, so absolute order across the two pairs is not guaranteed —
	// assert by type instead.
	got := emitterAll(emitter)
	if len(got) != 4 {
		t.Fatalf("emitted %d events, want [permission_requested, permission_decided, text_delta, result]: %+v", len(got), got)
	}
	byType := map[string]recordedEvent{}
	for _, ev := range got {
		byType[ev.eventType] = ev
	}
	for _, typ := range []string{BusEventPermissionRequested, BusEventPermissionDecided, BusEventTextDelta, BusEventResult} {
		if _, ok := byType[typ]; !ok {
			t.Fatalf("missing event %q in emitted: %+v", typ, got)
		}
	}

	permEvt := byType[BusEventPermissionRequested]
	reqPayload := permEvt.payload.(map[string]any)
	if reqPayload["requestId"] == "" || reqPayload["requestId"] == nil {
		t.Errorf("permission_requested payload missing requestId: %+v", reqPayload)
	}
	if reqPayload["toolName"] != "Bash" || reqPayload["toolUseId"] != "tc_perm" {
		t.Errorf("permission_requested tool fields = %q/%q, want Bash/tc_perm", reqPayload["toolName"], reqPayload["toolUseId"])
	}
	if reqPayload["riskLevel"] == nil || reqPayload["riskLevel"] == "" {
		t.Errorf("permission_requested payload missing riskLevel: %+v", reqPayload)
	}
	for k, v := range map[string]any{"projectId": "proj-acp", "threadId": "thread-acp", "runId": "run-acp-2"} {
		if permEvt.scope[k] != v {
			t.Errorf("permission_requested scope[%s] = %v, want %v", k, permEvt.scope[k], v)
		}
	}
	if byType[BusEventPermissionDecided].payload.(map[string]any)["decision"] != "allow" {
		t.Errorf("permission_decided decision = %v, want allow", byType[BusEventPermissionDecided].payload.(map[string]any)["decision"])
	}
	if byType[BusEventTextDelta].payload.(map[string]any)["content"] != "after permission" {
		t.Errorf("text_delta content = %v, want 'after permission'", byType[BusEventTextDelta].payload.(map[string]any)["content"])
	}
}

// permissionRequestLine builds a wire-format session/request_permission
// request from the agent (JSON-RPC request with an id).
func permissionRequestLine(id int, sessionID, optionsJSON, toolCallJSON string) []byte {
	return []byte(fmt.Sprintf(
		`{"jsonrpc":"2.0","id":%d,"method":"session/request_permission",`+
			`"params":{"sessionId":%q,"options":%s,"toolCall":%s}}`,
		id, sessionID, optionsJSON, toolCallJSON))
}

// TestRunACPSession_PermissionBrokerBlocksThenAllows drives the full chain:
// request_permission → broker.Begin parks the request → permission_requested
// event upstream → POST /v1/permissions/decide (broker.Decide) resolves it →
// the agent receives a "selected" outcome with the allow option id.
func TestRunACPSession_PermissionBrokerBlocksThenAllows(t *testing.T) {
	emitter := &recordingEmitter{}
	run := store.Run{ID: "run-acp-broker-allow", ProjectID: "proj-acp", ThreadID: "thread-acp"}
	broker := NewPermissionDecisionBroker()

	clientToAgentR, clientToAgentW := io.Pipe()
	agentToClientR, agentToClientW := io.Pipe()
	t.Cleanup(func() {
		clientToAgentR.Close()
		agentToClientW.Close()
	})

	permReq := permissionRequestLine(900, "sess-mock-1",
		`[{"kind":"allow_once","name":"Allow","optionId":"opt-allow"},{"kind":"reject_once","name":"Deny","optionId":"opt-deny"}]`,
		`{"toolCallId":"tc_perm","title":"Bash"}`)

	agent := newFakeACPAgent()
	go agent.run(t, clientToAgentR, agentToClientW, [][]byte{permReq})

	err := runACPSession(testACPContext("hello agent", `C:\work`), agentToClientR, clientToAgentW, emitter, run, broker)
	if err != nil {
		t.Fatalf("runACPSession: %v", err)
	}

	// The request must be parked: permission_requested emitted with the
	// broker request id, and the agent must NOT have received a response yet.
	permEvt := waitForEvent(t, emitter, BusEventPermissionRequested, 5*time.Second)
	requestID := permEvt.payload.(map[string]any)["requestId"].(string)
	waitForBrokerPending(t, broker, permissionDecisionKey{runID: run.ID, requestID: requestID}, 5*time.Second)
	select {
	case resp := <-agent.responses:
		t.Fatalf("agent got a response while the permission was still pending: %s", resp)
	case <-time.After(150 * time.Millisecond):
	}

	// Desktop decides allow → broker resolves the parked request.
	pending, ok := broker.Decide(run.ID, requestID, PermissionDecision{Behavior: "allow", DecisionClass: "user_approved"})
	if !ok {
		t.Fatal("broker did not find the pending ACP permission request")
	}
	if pending.ProjectID != "proj-acp" || pending.ThreadID != "thread-acp" || pending.RunID != run.ID {
		t.Fatalf("pending scope = %+v, want proj-acp/thread-acp/%s", pending, run.ID)
	}
	if pending.ToolName != "Bash" || pending.ToolUseID != "tc_perm" {
		t.Fatalf("pending tool = %q/%q, want Bash/tc_perm", pending.ToolName, pending.ToolUseID)
	}

	// The handler responds with the allow_once option selected.
	select {
	case resp := <-agent.responses:
		if strings.Contains(resp, `"error"`) {
			t.Fatalf("expected selected outcome, got JSON-RPC error: %s", resp)
		}
		if !strings.Contains(resp, `"outcome":"selected"`) || !strings.Contains(resp, "opt-allow") {
			t.Errorf("allow decision should select opt-allow, got: %s", resp)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("fake agent never received a response after broker.Decide")
	}

	// A second Decide must miss (entry consumed).
	if _, ok := broker.Decide(run.ID, requestID, PermissionDecision{Behavior: "allow"}); ok {
		t.Error("broker still holds the resolved permission request")
	}

	// permission_decided emitted with the allow decision.
	decidedEvt := waitForEvent(t, emitter, BusEventPermissionDecided, 5*time.Second)
	if decidedEvt.payload.(map[string]any)["decision"] != "allow" {
		t.Errorf("permission_decided decision = %v, want allow", decidedEvt.payload.(map[string]any)["decision"])
	}
}

// TestRunACPSession_PermissionBrokerDenyMapsToRejectOption: a deny decision
// selects the agent's reject option when one exists.
func TestRunACPSession_PermissionBrokerDenyMapsToRejectOption(t *testing.T) {
	emitter := &recordingEmitter{}
	run := store.Run{ID: "run-acp-broker-deny", ProjectID: "proj-acp", ThreadID: "thread-acp"}
	broker := NewPermissionDecisionBroker()

	clientToAgentR, clientToAgentW := io.Pipe()
	agentToClientR, agentToClientW := io.Pipe()
	t.Cleanup(func() {
		clientToAgentR.Close()
		agentToClientW.Close()
	})

	permReq := permissionRequestLine(900, "sess-mock-1",
		`[{"kind":"allow_always","name":"Allow","optionId":"opt-allow"},{"kind":"reject_always","name":"Deny","optionId":"opt-deny"}]`,
		`{"toolCallId":"tc_perm","title":"Bash"}`)

	agent := newFakeACPAgent()
	go agent.run(t, clientToAgentR, agentToClientW, [][]byte{permReq})

	err := runACPSession(testACPContext("hello agent", `C:\work`), agentToClientR, clientToAgentW, emitter, run, broker)
	if err != nil {
		t.Fatalf("runACPSession: %v", err)
	}

	permEvt := waitForEvent(t, emitter, BusEventPermissionRequested, 5*time.Second)
	requestID := permEvt.payload.(map[string]any)["requestId"].(string)

	if _, ok := broker.Decide(run.ID, requestID, PermissionDecision{Behavior: "deny", Message: "blocked by test"}); !ok {
		t.Fatal("broker did not find the pending ACP permission request")
	}

	select {
	case resp := <-agent.responses:
		if strings.Contains(resp, `"error"`) {
			t.Fatalf("expected selected outcome, got JSON-RPC error: %s", resp)
		}
		if !strings.Contains(resp, `"outcome":"selected"`) || !strings.Contains(resp, "opt-deny") {
			t.Errorf("deny decision should select opt-deny, got: %s", resp)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("fake agent never received a response after broker.Decide")
	}

	decidedEvt := waitForEvent(t, emitter, BusEventPermissionDecided, 5*time.Second)
	if decidedEvt.payload.(map[string]any)["decision"] != "deny" {
		t.Errorf("permission_decided decision = %v, want deny", decidedEvt.payload.(map[string]any)["decision"])
	}
}

// TestRunACPSession_PermissionBrokerDenyWithoutRejectOption: when the agent
// offers no reject option, a deny decision answers 'cancelled' — the closest
// ACP denial signal.
func TestRunACPSession_PermissionBrokerDenyWithoutRejectOption(t *testing.T) {
	emitter := &recordingEmitter{}
	run := store.Run{ID: "run-acp-broker-deny-norej", ProjectID: "proj-acp", ThreadID: "thread-acp"}
	broker := NewPermissionDecisionBroker()

	clientToAgentR, clientToAgentW := io.Pipe()
	agentToClientR, agentToClientW := io.Pipe()
	t.Cleanup(func() {
		clientToAgentR.Close()
		agentToClientW.Close()
	})

	permReq := permissionRequestLine(900, "sess-mock-1",
		`[{"kind":"allow_once","name":"Allow","optionId":"opt-allow"}]`,
		`{"toolCallId":"tc_perm","title":"Bash"}`)

	agent := newFakeACPAgent()
	go agent.run(t, clientToAgentR, agentToClientW, [][]byte{permReq})

	err := runACPSession(testACPContext("hello agent", `C:\work`), agentToClientR, clientToAgentW, emitter, run, broker)
	if err != nil {
		t.Fatalf("runACPSession: %v", err)
	}

	permEvt := waitForEvent(t, emitter, BusEventPermissionRequested, 5*time.Second)
	requestID := permEvt.payload.(map[string]any)["requestId"].(string)

	if _, ok := broker.Decide(run.ID, requestID, PermissionDecision{Behavior: "deny", Message: "blocked by test"}); !ok {
		t.Fatal("broker did not find the pending ACP permission request")
	}

	select {
	case resp := <-agent.responses:
		if strings.Contains(resp, `"error"`) {
			t.Fatalf("expected cancelled outcome, got JSON-RPC error: %s", resp)
		}
		if !strings.Contains(resp, `"outcome":"cancelled"`) {
			t.Errorf("deny without reject option should answer cancelled, got: %s", resp)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("fake agent never received a response after broker.Decide")
	}
}

// TestRunACPSession_PermissionBrokerDisconnectRecyclesParked: when the agent
// process exits (stdout EOF), the SDK cancels the dispatch ctx and the parked
// broker entry must be recycled.
func TestRunACPSession_PermissionBrokerDisconnectRecyclesParked(t *testing.T) {
	emitter := &recordingEmitter{}
	run := store.Run{ID: "run-acp-broker-disconnect", ProjectID: "proj-acp", ThreadID: "thread-acp"}
	broker := NewPermissionDecisionBroker()

	clientToAgentR, clientToAgentW := io.Pipe()
	agentToClientR, agentToClientW := io.Pipe()
	t.Cleanup(func() {
		clientToAgentR.Close()
		agentToClientW.Close()
	})

	permReq := permissionRequestLine(900, "sess-mock-1",
		`[{"kind":"allow_once","name":"Allow","optionId":"opt-allow"}]`,
		`{"toolCallId":"tc_perm","title":"Bash"}`)

	agent := newFakeACPAgent()
	go agent.run(t, clientToAgentR, agentToClientW, [][]byte{permReq})

	err := runACPSession(testACPContext("hello agent", `C:\work`), agentToClientR, clientToAgentW, emitter, run, broker)
	if err != nil {
		t.Fatalf("runACPSession: %v", err)
	}

	permEvt := waitForEvent(t, emitter, BusEventPermissionRequested, 5*time.Second)
	requestID := permEvt.payload.(map[string]any)["requestId"].(string)
	key := permissionDecisionKey{runID: run.ID, requestID: requestID}
	waitForBrokerPending(t, broker, key, 5*time.Second)

	// Agent process exit: close its stdout side → SDK receive loop EOF →
	// connection ctx cancelled → waiter recycles the parked entry.
	agentToClientW.Close()

	waitForBrokerMiss(t, broker, permissionDecisionKey{runID: run.ID, requestID: requestID}, 5*time.Second)
}

// TestRunACPSession_PermissionBrokerCancelRequestRecyclesParked: a
// $/cancel_request from the agent (ACP prompt-turn cancellation) cancels the
// in-flight request; the parked entry is recycled and the agent receives the
// 'cancelled' outcome.
func TestRunACPSession_PermissionBrokerCancelRequestRecyclesParked(t *testing.T) {
	emitter := &recordingEmitter{}
	run := store.Run{ID: "run-acp-broker-cancel", ProjectID: "proj-acp", ThreadID: "thread-acp"}
	broker := NewPermissionDecisionBroker()

	clientToAgentR, clientToAgentW := io.Pipe()
	agentToClientR, agentToClientW := io.Pipe()
	t.Cleanup(func() {
		clientToAgentR.Close()
		agentToClientW.Close()
	})

	permReq := permissionRequestLine(900, "sess-mock-1",
		`[{"kind":"allow_once","name":"Allow","optionId":"opt-allow"}]`,
		`{"toolCallId":"tc_perm","title":"Bash"}`)
	// ACP prompt-turn cancellation: the agent cancels its own permission
	// request (id 900) after asking.
	cancelReq := []byte(`{"jsonrpc":"2.0","method":"$/cancel_request","params":{"requestId":900}}`)

	agent := newFakeACPAgent()
	go agent.run(t, clientToAgentR, agentToClientW, [][]byte{permReq, cancelReq})

	err := runACPSession(testACPContext("hello agent", `C:\work`), agentToClientR, clientToAgentW, emitter, run, broker)
	if err != nil {
		t.Fatalf("runACPSession: %v", err)
	}

	permEvt := waitForEvent(t, emitter, BusEventPermissionRequested, 5*time.Second)
	requestID := permEvt.payload.(map[string]any)["requestId"].(string)
	// Note: no waitForBrokerPending here — $/cancel_request may be processed
	// before the handler goroutine parks; either ordering ends with the same
	// observable result (cancelled outcome + no parked entry).

	// The agent receives the 'cancelled' outcome for its own request.
	select {
	case resp := <-agent.responses:
		if strings.Contains(resp, `"error"`) {
			t.Fatalf("expected cancelled outcome, got JSON-RPC error: %s", resp)
		}
		if !strings.Contains(resp, `"outcome":"cancelled"`) {
			t.Errorf("cancelled request should answer cancelled, got: %s", resp)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("fake agent never received a response after $/cancel_request")
	}

	// And the parked entry is recycled.
	waitForBrokerMiss(t, broker, permissionDecisionKey{runID: run.ID, requestID: requestID}, 5*time.Second)
}

// TestRunACPSession_PermissionBrokerRunCancelRecyclesParked: run teardown
// (ParseStream ctx cancelled before the agent process exits) recycles the
// parked entry via the run ctx wired into the wait.
func TestRunACPSession_PermissionBrokerRunCancelRecyclesParked(t *testing.T) {
	emitter := &recordingEmitter{}
	run := store.Run{ID: "run-acp-broker-runcancel", ProjectID: "proj-acp", ThreadID: "thread-acp"}
	broker := NewPermissionDecisionBroker()

	clientToAgentR, clientToAgentW := io.Pipe()
	agentToClientR, agentToClientW := io.Pipe()
	t.Cleanup(func() {
		clientToAgentR.Close()
		agentToClientW.Close()
	})

	permReq := permissionRequestLine(900, "sess-mock-1",
		`[{"kind":"allow_once","name":"Allow","optionId":"opt-allow"}]`,
		`{"toolCallId":"tc_perm","title":"Bash"}`)

	agent := newFakeACPAgent()
	go agent.run(t, clientToAgentR, agentToClientW, [][]byte{permReq})

	runCtx, cancelRun := context.WithCancel(testACPContext("hello agent", `C:\work`))
	defer cancelRun()

	err := runACPSession(runCtx, agentToClientR, clientToAgentW, emitter, run, broker)
	if err != nil {
		t.Fatalf("runACPSession: %v", err)
	}

	permEvt := waitForEvent(t, emitter, BusEventPermissionRequested, 5*time.Second)
	requestID := permEvt.payload.(map[string]any)["requestId"].(string)
	key := permissionDecisionKey{runID: run.ID, requestID: requestID}
	waitForBrokerPending(t, broker, key, 5*time.Second)

	cancelRun()

	waitForBrokerMiss(t, broker, permissionDecisionKey{runID: run.ID, requestID: requestID}, 5*time.Second)
}

// waitForEvent polls the recording emitter until an event of the given type
// appears, then returns it.
func waitForEvent(t *testing.T, r *recordingEmitter, eventType string, timeout time.Duration) recordedEvent {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if evs := r.eventsByType(eventType); len(evs) > 0 {
			return evs[0]
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for event %q (emitted: %+v)", eventType, emitterAll(r))
	return recordedEvent{}
}

// waitForBrokerPending polls until the broker holds the given key (the
// handler registers the request before emitting permission_requested, so the
// requestId from the event is authoritative).
func waitForBrokerPending(t *testing.T, b *PermissionDecisionBroker, key permissionDecisionKey, timeout time.Duration) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		b.mu.Lock()
		_, ok := b.pending[key]
		b.mu.Unlock()
		if ok {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("broker never registered pending key %+v", key)
}

// waitForBrokerMiss polls until the broker no longer holds the key, i.e. the
// parked entry was recycled. Read-only: it never consumes the entry (a
// Decide probe would resolve the parked request and poison the test).
func waitForBrokerMiss(t *testing.T, b *PermissionDecisionBroker, key permissionDecisionKey, timeout time.Duration) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		b.mu.Lock()
		_, ok := b.pending[key]
		b.mu.Unlock()
		if !ok {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("broker entry %+v was never recycled", key)
}

func TestRunACPSession_RequiresPromptAndWorkDir(t *testing.T) {
	emitter := &recordingEmitter{}
	run := store.Run{ID: "run-acp-3"}

	// No RunProcessContext attached → non-recoverable error.
	err := runACPSession(context.Background(), strings.NewReader(""), io.Discard, emitter, run, nil)
	if err == nil || !isNonRecoverable(err) {
		t.Fatalf("missing RunProcessContext: got %v, want non-recoverable ParseStreamError", err)
	}

	// Empty workdir → non-recoverable error.
	err = runACPSession(testACPContext("prompt", ""), strings.NewReader(""), io.Discard, emitter, run, nil)
	if err == nil || !isNonRecoverable(err) {
		t.Fatalf("empty workdir: got %v, want non-recoverable ParseStreamError", err)
	}
}

// isNonRecoverable reports whether err wraps a non-recoverable ParseStreamError.
func isNonRecoverable(err error) bool {
	ps, ok := err.(*ParseStreamError)
	return ok && !ps.Recoverable()
}

// TestAcpBinaryAvailable 校验根包私有助手 acpBinaryAvailable 的解析规则
// （随 codex 家族下沉时留在根包，测试根包基础设施，#1760 codex/opencode
// 增量）。
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
