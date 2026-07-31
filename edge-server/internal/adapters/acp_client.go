// Package adapters — ACP client runtime on github.com/coder/acp-go-sdk (v0.13.5).
//
// #1404 Phase 2 spike: replace the hand-rolled bufio+encoding/json JSON-RPC
// loop (removed from acp.go) with the official-schema typed client runtime.
// Protocol boundary stays 100% official — a real adapter binary (e.g.
// `npx -y @agentclientprotocol/codex-acp`, or native `opencode acp`,
// `gemini --experimental-acp`) is spawned by ProcessExecutor via
// AcpAdapter.BuildCommand; this file only talks JSON-RPC to it.
//
// Reference: docs/analysis/agenthub-acp-go-migration.md option C'.
package adapters

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"

	"github.com/agenthub/edge-server/internal/store"
	"github.com/coder/acp-go-sdk"
)

// acpSDKVersion is the pinned SDK version this client skeleton was verified
// against (bump discipline: update on SDK upgrades).
const acpSDKVersion = "v0.13.5"

// errACPEndpointNotWired is returned by client handler methods that the spike
// deliberately leaves unwired: the agent receives a JSON-RPC error instead of
// a silent hang. All of these are tracked TODOs (approval chain / frame
// design), not production behavior.
var errACPEndpointNotWired = errors.New("acp: endpoint not wired in spike (TODO)")

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
	emitter   EventEmitter
	run       store.Run
	sessionID acp.SessionId
}

// compile-time check: the handler must satisfy the full acp.Client interface
// (the SDK dispatch calls these methods directly).
var _ acp.Client = (*acpClientHandler)(nil)

func newACPClientHandler(emitter EventEmitter, run store.Run) *acpClientHandler {
	return &acpClientHandler{emitter: emitter, run: run}
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
// TODO(审批链迁移, 最大工作项): wire this to the existing
// PermissionDecisionBroker / plan_approval chain and respond via the
// Responder. Semantics to port: agent-side pause semantics, clean rejection
// (cancelled outcome) on disconnect, idempotent PermissionResolved.
// Spike leaves the interface + a JSON-RPC error response only.
func (h *acpClientHandler) RequestPermission(ctx context.Context, params acp.RequestPermissionRequest) (acp.RequestPermissionResponse, error) {
	slog.Warn("acp: session/request_permission received but approval chain not wired (TODO)",
		"run_id", h.run.ID,
		"session_id", string(params.SessionId),
	)
	return acp.RequestPermissionResponse{}, fmt.Errorf("acp: request_permission → PermissionDecisionBroker is TODO (%w)", errACPEndpointNotWired)
}

// ReadTextFile handles fs/read_text_file.
//
// TODO(帧设计): the Edge-side fs frame + allowlist enforcement (see
// tool_allowlist_hook.go) is not designed for ACP yet; for the spike the
// capability is advertised in initialize but the endpoint answers with an
// error so the agent can surface it instead of hanging.
func (h *acpClientHandler) ReadTextFile(ctx context.Context, params acp.ReadTextFileRequest) (acp.ReadTextFileResponse, error) {
	return acp.ReadTextFileResponse{}, fsEndpointError("fs/read_text_file", params.Path)
}

// WriteTextFile handles fs/write_text_file. See ReadTextFile for the TODO.
func (h *acpClientHandler) WriteTextFile(ctx context.Context, params acp.WriteTextFileRequest) (acp.WriteTextFileResponse, error) {
	return acp.WriteTextFileResponse{}, fsEndpointError("fs/write_text_file", params.Path)
}

func fsEndpointError(method, path string) error {
	return fmt.Errorf("acp: %s %q not wired in spike (TODO: fs frame design + approval chain): %w",
		method, path, errACPEndpointNotWired)
}

// CreateTerminal handles terminal/create. See ReadTextFile for the TODO.
func (h *acpClientHandler) CreateTerminal(ctx context.Context, params acp.CreateTerminalRequest) (acp.CreateTerminalResponse, error) {
	return acp.CreateTerminalResponse{}, terminalEndpointError("terminal/create")
}

// KillTerminal handles terminal/kill. See ReadTextFile for the TODO.
func (h *acpClientHandler) KillTerminal(ctx context.Context, params acp.KillTerminalRequest) (acp.KillTerminalResponse, error) {
	return acp.KillTerminalResponse{}, terminalEndpointError("terminal/kill")
}

// TerminalOutput handles terminal/output. See ReadTextFile for the TODO.
func (h *acpClientHandler) TerminalOutput(ctx context.Context, params acp.TerminalOutputRequest) (acp.TerminalOutputResponse, error) {
	return acp.TerminalOutputResponse{}, terminalEndpointError("terminal/output")
}

// ReleaseTerminal handles terminal/release. See ReadTextFile for the TODO.
func (h *acpClientHandler) ReleaseTerminal(ctx context.Context, params acp.ReleaseTerminalRequest) (acp.ReleaseTerminalResponse, error) {
	return acp.ReleaseTerminalResponse{}, terminalEndpointError("terminal/release")
}

// WaitForTerminalExit handles terminal/wait_for_exit. See ReadTextFile for the TODO.
func (h *acpClientHandler) WaitForTerminalExit(ctx context.Context, params acp.WaitForTerminalExitRequest) (acp.WaitForTerminalExitResponse, error) {
	return acp.WaitForTerminalExitResponse{}, terminalEndpointError("terminal/wait_for_exit")
}

func terminalEndpointError(method string) error {
	return fmt.Errorf("acp: %s not wired in spike (TODO: terminal frame design + approval chain): %w", method, errACPEndpointNotWired)
}

// runACPSession runs one ACP turn with the SDK client runtime: initialize
// handshake → session/new → session/prompt → stream session/update
// notifications → prompt response. Returns when the turn completes; the
// connection is torn down by the SDK when the peer (agent process) closes
// stdout or ctx is cancelled.
//
// Prompt and workdir come from the RunProcessContext attached to ctx via
// SDKAdapterContext (same pattern as the anthropic/openai SDK adapters).
//
// TODO(真跑验证): spawning the official adapter binary (`npx -y
// @agentclientprotocol/codex-acp`, version-pinned per the migration report)
// and a live end-to-end run require an environment with npx + agent keys —
// left for environment verification. The SDK connection layer and typed
// dispatch are exercised by acp_client_test.go with a mock JSON-RPC peer.
func runACPSession(ctx context.Context, stdout io.Reader, stdin io.Writer, emitter EventEmitter, run store.Run) error {
	rc, ok := RunProcessContextFromContext(ctx)
	if !ok || rc.Prompt == "" {
		return NewNonRecoverableParseError(fmt.Errorf("acp: RunProcessContext with prompt required in ctx (use SDKAdapterContext)"))
	}
	if rc.WorkDir == "" {
		return NewNonRecoverableParseError(fmt.Errorf("acp: workdir required for session/new (got %q)", rc.WorkDir))
	}

	handler := newACPClientHandler(emitter, run)
	conn := acp.NewClientSideConnection(handler, stdin, stdout)
	conn.SetLogger(slog.With("component", "acp-sdk", "sdk", acpSDKVersion, "run_id", run.ID))

	// 1. initialize handshake. Capabilities: fs read/write + terminal are
	// advertised; the endpoints answer with errors until the approval chain
	// and frame design land (see handler TODO comments).
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
		return NewNonRecoverableParseError(fmt.Errorf("acp: initialize failed: %w", err))
	}
	if initResp.ProtocolVersion != acp.ProtocolVersionNumber {
		return NewNonRecoverableParseError(fmt.Errorf("acp: protocol version mismatch: agent %d, client %d",
			initResp.ProtocolVersion, acp.ProtocolVersionNumber))
	}

	// 2. session/new.
	sessResp, err := conn.NewSession(ctx, acp.NewSessionRequest{
		Cwd:        rc.WorkDir,
		McpServers: []acp.McpServer{}, // TODO: wire RunProcessContext.MCPConfig
	})
	if err != nil {
		return NewNonRecoverableParseError(fmt.Errorf("acp: session/new failed: %w", err))
	}
	handler.sessionID = sessResp.SessionId

	// 3. session/prompt. During this call the SDK dispatches all inbound
	// session/update notifications (→ SessionUpdate → run.agent.*) and
	// blocking requests (→ handler TODOs) concurrently.
	promptResp, err := conn.Prompt(ctx, acp.PromptRequest{
		SessionId: sessResp.SessionId,
		Prompt:    []acp.ContentBlock{acp.TextBlock(rc.Prompt)},
	})
	if err != nil {
		return NewNonRecoverableParseError(fmt.Errorf("acp: session/prompt failed: %w", err))
	}

	// 4. Prompt response (StopReason) → run.agent.result.
	if ev := mapACPPromptResult(promptResp); ev != nil {
		emitter.Emit(ev.EventType, acpRunScope(run), ev.Payload)
	}
	return nil
}
