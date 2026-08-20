// Package adapters — ACP client runtime on github.com/coder/acp-go-sdk (v0.13.5).
//
// #1404 Phase 2 spike: replace the hand-rolled bufio+encoding/json JSON-RPC
// loop (removed from acp.go) with the official-schema typed client runtime.
// Protocol boundary stays 100% official — a real adapter binary (e.g.
// `npx -y @agentclientprotocol/codex-acp`, or native `opencode acp`,
// `gemini --experimental-acp`) is spawned by ProcessExecutor via
// AcpAdapter.BuildCommand; this file only talks JSON-RPC to it.
//
// Reference: ACP Go migration option C'.
package acp

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"strings"
	"sync/atomic"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/store"
	"github.com/coder/acp-go-sdk"
)

// acpSDKVersion is the pinned SDK version this client skeleton was verified
// against (bump discipline: update on SDK upgrades).
const acpSDKVersion = "v0.13.5"

// errACPEndpointNotWired is returned by client handler methods that the spike
// deliberately leaves unwired (fs/terminal frame design): the agent receives
// a JSON-RPC error instead of a silent hang. session/request_permission no
// longer goes through this sentinel — it is bridged to the Edge approval
// chain via adapters.PermissionDecisionBroker.
var errACPEndpointNotWired = errors.New("acp: endpoint not wired (TODO #1743 (follow-up of #1404): frame design)")

// acpClientHandler is the coder/acp-go-sdk client side. The SDK dispatches
// inbound JSON-RPC to the acp.Client interface methods:
//
//	notification session/update          → SessionUpdate
//	request     session/request_permission → RequestPermission
//	request     fs/read_text_file        → ReadTextFile
//	request     fs/write_text_file       → WriteTextFile
//	request     terminal/*               → CreateTerminal / KillTerminal /
//	                                        TerminalOutput / ReleaseTerminal /
//	                                        WaitForTerminalExit
//
// No JSON-RPC framing, message classification, or response matching is
// written here — the SDK connection layer owns all of it.
type acpClientHandler struct {
	emitter EventEmitter
	run     store.Run
	// sessionID is written in runACPSession after session/new and read
	// concurrently by RequestPermission (the SDK dispatches inbound requests
	// during Prompt). Guarded by atomic.Pointer so the read observes the
	// write without a data race (the SDK may dispatch on a separate
	// goroutine). nil means no session has been established yet.
	sessionID atomic.Pointer[acp.SessionId]

	// broker bridges session/request_permission to the Edge approval chain
	// (adapters.PermissionDecisionBroker → POST /v1/permissions/decide, see
	// control_protocol.go). nil = auto-approve fallback, mirroring
	// DefaultPermissionHandler when no decider/broker is configured.
	broker *adapters.PermissionDecisionBroker

	// runCtx is the ParseStream context for this turn; it is cancelled when
	// the run is torn down. Waiters select on it so parked permission
	// requests are recycled on run cancellation even before the agent
	// process exits (the SDK dispatch ctx only cancels on connection close
	// or $/cancel_request).
	runCtx context.Context

	// permSeq generates unique per-run broker request ids.
	permSeq atomic.Uint64
}

// compile-time check: the handler must satisfy the full acp.Client interface
// (the SDK dispatch calls these methods directly).
var _ acp.Client = (*acpClientHandler)(nil)

func newACPClientHandler(emitter EventEmitter, run store.Run, broker *adapters.PermissionDecisionBroker, runCtx context.Context) *acpClientHandler {
	return &acpClientHandler{emitter: emitter, run: run, broker: broker, runCtx: runCtx}
}

// SessionUpdate handles the agent's session/update notification: typed
// SessionNotification → mapACPSessionUpdate (acp_events.go, pure) →
// run.agent.* bus events.
func (h *acpClientHandler) SessionUpdate(ctx context.Context, params acp.SessionNotification) error {
	for _, ev := range mapACPSessionUpdate(params.Update) {
		h.emitter.Emit(ev.EventType, acpRunScope(h.run), ev.Payload)
	}
	return nil
}

// RequestPermission handles session/request_permission — a blocking RPC: the
// agent pauses until the client responds.
//
// Approval chain: the request is registered with the shared
// adapters.PermissionDecisionBroker (keyed by runID + generated requestID), a
// run.agent.permission_requested event is emitted upstream so Desktop can
// render the approval UI, and the handler blocks until either
//   - POST /v1/permissions/decide resolves the broker entry (allow/deny), or
//   - the wait context is cancelled (agent process exit / $/cancel_request /
//     run teardown), which recycles the parked entry and answers 'cancelled'.
//
// When no broker is configured the request is auto-approved (mirrors
// DefaultPermissionHandler's no-decider fallback); the permission_requested /
// permission_decided events are still emitted for observability.
func (h *acpClientHandler) RequestPermission(ctx context.Context, params acp.RequestPermissionRequest) (acp.RequestPermissionResponse, error) {
	if expected := h.sessionID.Load(); params.SessionId != "" && expected != nil && params.SessionId != *expected {
		slog.Warn("acp: request_permission for unexpected session",
			"run_id", h.run.ID, "session_id", string(params.SessionId), "expected", string(*expected))
	}
	if len(params.Options) == 0 {
		// Validate() only rejects a nil slice, so guard the empty case here:
		// without options there is nothing to select — answer with an error
		// instead of hanging the agent.
		return acp.RequestPermissionResponse{}, fmt.Errorf("acp: request_permission without options (%w)", errACPEndpointNotWired)
	}

	requestID := fmt.Sprintf("acp-%s-%d", h.run.ID, h.permSeq.Add(1))
	toolName := acpPermissionToolName(params)
	toolUseID := string(params.ToolCall.ToolCallId)

	// 1. Register with the broker before emitting, so /v1/permissions/decide
	// can resolve the request as soon as Desktop sees the event.
	var waitForBrokerDecision func(context.Context) adapters.PermissionDecision
	registerFailed := false
	if h.broker != nil {
		var ok bool
		waitForBrokerDecision, ok = h.broker.Begin(adapters.PermissionScope{
			ProjectID: h.run.ProjectID,
			ThreadID:  h.run.ThreadID,
			RunID:     h.run.ID,
		}, adapters.PermissionRequest{
			RequestID: requestID,
			ToolName:  toolName,
			ToolUseID: toolUseID,
			Input:     params.ToolCall.RawInput,
		})
		registerFailed = !ok
	}

	// 2. Emit permission_requested so Desktop can display the approval UI.
	scope := acpRunScope(h.run)
	h.emitter.Emit(BusEventPermissionRequested, scope, map[string]any{
		"requestId": requestID,
		"toolName":  toolName,
		"toolUseId": toolUseID,
		"input":     params.ToolCall.RawInput,
		"riskLevel": string(adapters.ClassifyToolRisk(toolName)),
	})

	// 3. Wait for the decision: broker blocks until Desktop responds (the
	// broker waiter returns a safe deny on cancellation and recycles the
	// parked entry); without a broker, fall back to auto-approve.
	var decision adapters.PermissionDecision
	switch {
	case waitForBrokerDecision != nil:
		waitCtx, stop := h.permissionWaitCtx(ctx)
		decision = waitForBrokerDecision(waitCtx)
		stop() // unregister the runCtx hook once the wait completes
	case registerFailed:
		decision = adapters.PermissionDecision{
			Behavior: "deny",
			Message:  "permission request could not be registered for approval",
		}
	default:
		decision = adapters.PermissionDecision{Behavior: "allow"}
	}
	decision = adapters.NormalizePermissionDecision(decision)

	// 4. Emit permission_decided for observability (mirrors
	// DefaultPermissionHandler.handleCanUseTool).
	h.emitter.Emit(BusEventPermissionDecided, scope, map[string]any{
		"requestId": requestID,
		"toolName":  toolName,
		"toolUseId": toolUseID,
		"decision":  decision.Behavior,
	})

	// 5. Map the broker decision to the ACP response outcome.
	return acp.RequestPermissionResponse{Outcome: acpOutcomeForDecision(decision, params.Options)}, nil
}

// permissionWaitCtx returns a wait context that cancels when either the SDK
// dispatch ctx (connection close, $/cancel_request) or the run ctx (run
// teardown) is done, plus a stop func that unregisters the runCtx hook once
// the wait completes (call it when the broker waiter returns). The broker
// waiter selects on the context and recycles the parked permission entry on
// cancellation.
func (h *acpClientHandler) permissionWaitCtx(ctx context.Context) (context.Context, func()) {
	if h.runCtx == nil {
		return ctx, func() {}
	}
	waitCtx, cancel := context.WithCancelCause(ctx)
	stop := context.AfterFunc(h.runCtx, func() { cancel(context.Cause(h.runCtx)) })
	return waitCtx, func() { stop() }
}

// acpPermissionToolName derives a tool name for the permission event payload.
// ACP identifies the tool call by id/kind/title; prefer the human-readable
// title, falling back to the kind, then "unknown".
func acpPermissionToolName(params acp.RequestPermissionRequest) string {
	if params.ToolCall.Title != nil {
		if t := strings.TrimSpace(*params.ToolCall.Title); t != "" {
			return t
		}
	}
	if params.ToolCall.Kind != nil {
		return string(*params.ToolCall.Kind)
	}
	return "unknown"
}

// acpOutcomeForDecision maps an Edge broker decision to the ACP response
// outcome:
//
//	allow → the first non-reject option the agent offered (preferring
//	        allow_once, then allow_always, then any other non-reject option)
//	deny  → the first reject_* option the agent offered, else 'cancelled'
//	        (there is no bare deny outcome in ACP — without a reject option,
//	        'cancelled' is the closest denial signal)
func acpOutcomeForDecision(decision adapters.PermissionDecision, options []acp.PermissionOption) acp.RequestPermissionOutcome {
	if decision.Behavior == "allow" {
		if id, ok := firstPermissionOption(options, acp.PermissionOptionKindAllowOnce, acp.PermissionOptionKindAllowAlways); ok {
			return acp.NewRequestPermissionOutcomeSelected(id)
		}
		for _, opt := range options {
			if opt.Kind != acp.PermissionOptionKindRejectOnce && opt.Kind != acp.PermissionOptionKindRejectAlways {
				return acp.NewRequestPermissionOutcomeSelected(opt.OptionId)
			}
		}
		return acp.NewRequestPermissionOutcomeCancelled()
	}

	if id, ok := firstPermissionOption(options, acp.PermissionOptionKindRejectOnce, acp.PermissionOptionKindRejectAlways); ok {
		return acp.NewRequestPermissionOutcomeSelected(id)
	}
	return acp.NewRequestPermissionOutcomeCancelled()
}

func firstPermissionOption(options []acp.PermissionOption, kinds ...acp.PermissionOptionKind) (acp.PermissionOptionId, bool) {
	for _, k := range kinds {
		for _, opt := range options {
			if opt.Kind == k {
				return opt.OptionId, true
			}
		}
	}
	return "", false
}

// ── Unwired endpoint stubs (#1404) ────────────────────────────────────────
//
// STUB INVENTORY (single source of the "not wired" list — update both the
// methods below and TestUnwiredACPEndpointsFailClosed when #1743 lands):
//
//	fs/read_text_file     → ReadTextFile        (fs frame design + allowlist)
//	fs/write_text_file    → WriteTextFile       (fs frame design + allowlist)
//	terminal/create       → CreateTerminal      (terminal frame design)
//	terminal/kill         → KillTerminal        (terminal frame design)
//	terminal/output       → TerminalOutput      (terminal frame design)
//	terminal/release      → ReleaseTerminal     (terminal frame design)
//	terminal/wait_for_exit → WaitForTerminalExit (terminal frame design)
//
// Wired endpoints (not stubs): session/update (SessionUpdate) and
// session/request_permission (RequestPermission → Edge approval chain).
//
// Every stub fails closed with errACPEndpointNotWired — a JSON-RPC error the
// agent can surface — never a silent hang, never a fake success. The
// capabilities are still advertised in initialize (runACPSession) so the
// agent can discover them; removing the advertisement is a #1743 follow-up,
// not something a stub should silently do.
//
// ReadTextFile handles fs/read_text_file.
func (h *acpClientHandler) ReadTextFile(ctx context.Context, params acp.ReadTextFileRequest) (acp.ReadTextFileResponse, error) {
	return acp.ReadTextFileResponse{}, fsEndpointError("fs/read_text_file", params.Path)
}

// WriteTextFile handles fs/write_text_file. Stub, see the STUB INVENTORY above.
func (h *acpClientHandler) WriteTextFile(ctx context.Context, params acp.WriteTextFileRequest) (acp.WriteTextFileResponse, error) {
	return acp.WriteTextFileResponse{}, fsEndpointError("fs/write_text_file", params.Path)
}

func fsEndpointError(method, path string) error {
	return fmt.Errorf("acp: %s %q not wired (TODO #1743 (follow-up of #1404): Edge fs frame design + allowlist): %w",
		method, path, errACPEndpointNotWired)
}

// CreateTerminal handles terminal/create. Stub, see the STUB INVENTORY above.
func (h *acpClientHandler) CreateTerminal(ctx context.Context, params acp.CreateTerminalRequest) (acp.CreateTerminalResponse, error) {
	return acp.CreateTerminalResponse{}, terminalEndpointError("terminal/create")
}

// KillTerminal handles terminal/kill. Stub, see the STUB INVENTORY above.
func (h *acpClientHandler) KillTerminal(ctx context.Context, params acp.KillTerminalRequest) (acp.KillTerminalResponse, error) {
	return acp.KillTerminalResponse{}, terminalEndpointError("terminal/kill")
}

// TerminalOutput handles terminal/output. Stub, see the STUB INVENTORY above.
func (h *acpClientHandler) TerminalOutput(ctx context.Context, params acp.TerminalOutputRequest) (acp.TerminalOutputResponse, error) {
	return acp.TerminalOutputResponse{}, terminalEndpointError("terminal/output")
}

// ReleaseTerminal handles terminal/release. Stub, see the STUB INVENTORY above.
func (h *acpClientHandler) ReleaseTerminal(ctx context.Context, params acp.ReleaseTerminalRequest) (acp.ReleaseTerminalResponse, error) {
	return acp.ReleaseTerminalResponse{}, terminalEndpointError("terminal/release")
}

// WaitForTerminalExit handles terminal/wait_for_exit. See ReadTextFile for the TODO.
func (h *acpClientHandler) WaitForTerminalExit(ctx context.Context, params acp.WaitForTerminalExitRequest) (acp.WaitForTerminalExitResponse, error) {
	return acp.WaitForTerminalExitResponse{}, terminalEndpointError("terminal/wait_for_exit")
}

func terminalEndpointError(method string) error {
	return fmt.Errorf("acp: %s not wired (TODO #1743 (follow-up of #1404): Edge terminal frame design): %w", method, errACPEndpointNotWired)
}

// runACPSession runs one ACP turn with the SDK client runtime: initialize
// handshake → session/new → session/prompt → stream session/update
// notifications → prompt response. Returns when the turn completes; the
// connection is torn down by the SDK when the peer (agent process) closes
// stdout or ctx is cancelled.
//
// broker, when non-nil, is the shared adapters.PermissionDecisionBroker that
// session/request_permission is bridged to (see RequestPermission); nil
// falls back to auto-approve.
//
// Prompt and workdir come from the RunProcessContext attached to ctx via
// SDKAdapterContext (same pattern as the anthropic/openai SDK adapters).
//
// Verified on the DevSpace dev machine: live end-to-end runs against the
// real claude-agent-acp 0.67.0 (and native opencode acp 1.18.18) — initialize
// → session/new → session/prompt → streaming session/update → end_turn →
// run finalized — plus the session/request_permission approval chain
// (dangerous tool → broker → POST /v1/permissions/decide allow → tool
// executed). The SDK connection layer and typed dispatch are also exercised
// by acp_client_test.go with a mock JSON-RPC peer.
func runACPSession(ctx context.Context, stdout io.Reader, stdin io.Writer, emitter EventEmitter, run store.Run, broker *adapters.PermissionDecisionBroker) error {
	rc, ok := adapters.RunProcessContextFromContext(ctx)
	if !ok || rc.Prompt == "" {
		return adapters.NewNonRecoverableParseError(fmt.Errorf("acp: RunProcessContext with prompt required in ctx (use SDKAdapterContext)"))
	}
	if rc.WorkDir == "" {
		return adapters.NewNonRecoverableParseError(fmt.Errorf("acp: workdir required for session/new (got %q)", rc.WorkDir))
	}

	handler := newACPClientHandler(emitter, run, broker, ctx)
	conn := acp.NewClientSideConnection(handler, stdin, stdout)
	conn.SetLogger(slog.With("component", "acp-sdk", "sdk", acpSDKVersion, "run_id", run.ID))

	// 1. initialize handshake. Capabilities: fs read/write + terminal are
	// advertised; the endpoints answer with errors until the fs/terminal
	// frame design lands (#1743; see handler TODO comments). Tool permission
	// gates use session/request_permission, which is bridged to the Edge
	// approval chain.
	initResp, err := conn.Initialize(ctx, acp.InitializeRequest{
		ProtocolVersion: acp.ProtocolVersionNumber,
		ClientCapabilities: acp.ClientCapabilities{
			Fs:       acp.FileSystemCapabilities{ReadTextFile: true, WriteTextFile: true},
			Terminal: true,
		},
		ClientInfo: &acp.Implementation{
			Name:    "agenthub-edge",
			Version: "acp-spike",
		},
	})
	if err != nil {
		return adapters.NewNonRecoverableParseError(fmt.Errorf("acp: initialize failed: %w", err))
	}
	if initResp.ProtocolVersion != acp.ProtocolVersionNumber {
		return adapters.NewNonRecoverableParseError(fmt.Errorf("acp: protocol version mismatch: agent %d, client %d",
			initResp.ProtocolVersion, acp.ProtocolVersionNumber))
	}

	// 2. session/new. MCP server config from the run profile is not yet wired
	// into the ACP session (frame design deferred (#1743, follow-up of #1404)). When a profile
	// declares MCP servers, surface the gap as a visible status-change event
	// + warning log so the user sees *why* MCP tools are unavailable instead
	// of a silent absence.
	if rc.MCPConfig != "" {
		slog.Warn("acp: MCP config present but not wired into ACP session; MCP tools will be unavailable",
			"run_id", run.ID, "reason", "acp_mcp_not_wired")
		emitter.Emit(BusEventStatusChange, acpRunScope(run), map[string]any{
			"status":  "degraded",
			"reason":  "acp_mcp_not_wired",
			"message": "MCP servers configured in this profile are not available in the ACP execution path",
		})
	}
	sessResp, err := conn.NewSession(ctx, acp.NewSessionRequest{
		Cwd:        rc.WorkDir,
		McpServers: []acp.McpServer{}, // TODO(#1743): wire RunProcessContext.MCPConfig
	})
	if err != nil {
		return adapters.NewNonRecoverableParseError(fmt.Errorf("acp: session/new failed: %w", err))
	}
	handler.sessionID.Store(&sessResp.SessionId)

	// 3. session/prompt. During this call the SDK dispatches all inbound
	// session/update notifications (→ SessionUpdate → run.agent.*) and
	// blocking requests (→ handler #1743) concurrently.
	slog.Debug("acp: sending session/prompt", "run_id", run.ID, "session_id", sessResp.SessionId)
	promptResp, err := conn.Prompt(ctx, acp.PromptRequest{
		SessionId: sessResp.SessionId,
		Prompt:    []acp.ContentBlock{acp.TextBlock(rc.Prompt)},
	})
	slog.Debug("acp: session/prompt returned", "run_id", run.ID, "stop_reason", promptResp.StopReason, "err", err)
	if err != nil {
		return adapters.NewNonRecoverableParseError(fmt.Errorf("acp: session/prompt failed: %w", err))
	}

	// 4. Prompt response (StopReason) → run.agent.result.
	if ev := mapACPPromptResult(promptResp); ev != nil {
		emitter.Emit(ev.EventType, acpRunScope(run), ev.Payload)
	}
	return nil
}
