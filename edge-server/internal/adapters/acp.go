// Package adapters — ACP (Agent Client Protocol) adapter (experimental).
//
// This adapter implements the AgentAdapter interface for ACP-compatible
// agents (JSON-RPC 2.0 over stdio). It is part of the #1404 spike and
// currently a skeleton — the JSON-RPC loop and event mapping are stubbed.
//
// Once validated with a real ACP agent binary, the "experimental" tag
// will be removed and this adapter will join the production registry.
package adapters

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"os"

	"github.com/agenthub/edge-server/internal/store"
)

// acpAdapterID is the registry identifier for the experimental ACP adapter.
const acpAdapterID = "acp"

// AcpAdapter implements AgentAdapter for ACP-compatible agent binaries.
//
// ACP = Agent Client Protocol (agentclientprotocol.com), JSON-RPC 2.0 over
// stdio. The adapter spawns an ACP agent binary, performs the initialize
// handshake, creates a session, and then loops reading JSON-RPC
// notifications (streaming content) and requests (permission gates) from
// stdout, writing responses to stdin.
//
// Reference: #1404, docs/analysis/acp-spike-phase1.md.
type AcpAdapter struct {
	// agentBinary is the absolute path to the ACP agent executable.
	agentBinary string

	// agentArgs are extra arguments passed to the agent binary beyond
	// the ACP protocol flag (e.g. --experimental-acp).
	agentArgs []string

	// metadata carries the static adapter identification.
	metadata AdapterMetadata
}

// NewAcpAdapter creates an experimental ACP adapter for the given agent binary.
//
// agentBinary must be an absolute path to an ACP-compatible executable.
// agentArgs are appended after the ACP protocol flag.
// displayName is shown in agent listings.
func NewAcpAdapter(agentBinary string, agentArgs []string, displayName string) *AcpAdapter {
	return &AcpAdapter{
		agentBinary: agentBinary,
		agentArgs:   agentArgs,
		metadata: AdapterMetadata{
			ID:          acpAdapterID,
			Name:        displayName,
			Version:     "acp-experimental",
			Description: "ACP agent (experimental — JSON-RPC 2.0 over stdio)",
		},
	}
}

// Metadata returns static adapter identification.
func (a *AcpAdapter) Metadata() AdapterMetadata { return a.metadata }

// Capabilities reports the feature set. ACP agents advertise their actual
// capabilities at runtime via the initialize handshake; these are the
// protocol-level maximums the adapter can relay.
func (a *AcpAdapter) Capabilities() AgentCapabilities {
	return AgentCapabilities{
		Streaming:       true,
		ToolCalls:       true,
		FileChanges:     true,
		PermissionHooks: true,
		ThinkingVisible: true,
		MultiTurn:       true,
		MCPIntegration:  true,
		SubAgentSpawn:   true,
	}
}

// BuildCommand constructs the exec.Cmd for spawning the ACP agent.
//
// ACP agents communicate over stdio — no special flags beyond what the
// agent binary requires to enter ACP mode (e.g. --experimental-acp).
func (a *AcpAdapter) BuildCommand(ctx RunProcessContext) (cmdPath string, args []string, env []string, workDir string) {
	return a.agentBinary, a.agentArgs, nil, ctx.WorkDir
}

// NeedsStdin reports true — ACP requires a writable stdin for
// initialize, session/prompt, and permission responses.
func (a *AcpAdapter) NeedsStdin() bool { return true }

// Available reports whether the agent binary exists and is executable.
func (a *AcpAdapter) Available() bool {
	fi, err := os.Stat(a.agentBinary)
	return err == nil && !fi.IsDir() && fi.Mode()&0o111 != 0
}

// ParseStream runs the ACP JSON-RPC event loop.
//
// STUB (Phase 1): this is a skeleton. The full implementation will:
//   1. Write initialize request to stdin
//   2. Read initialize response from stdout
//   3. Write session/new (or resume/load) to stdin
//   4. Write session/prompt to stdin
//   5. Loop reading JSON-RPC messages from stdout:
//      - session/update (notification) → map to run.agent.* events
//      - session/request_permission (request) → emit permission event,
//        wait for response, write to stdin
//      - fs/read, fs/write_text_file, terminal/* (requests) → same pattern
//   6. On prompt response (StopReason) → emit run.agent.result, return
func (a *AcpAdapter) ParseStream(ctx context.Context, stdout io.Reader, stdin io.Writer, emitter EventEmitter, run store.Run) error {
	slog.Warn("acp: ParseStream is a stub — ACP spike Phase 1 skeleton",
		"agent", a.agentBinary,
		"run_id", run.ID,
	)

	scanner := bufio.NewScanner(stdout)
	// ACP messages can be large (tool call payloads). 4 MiB buffer.
	scanner.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)

	for scanner.Scan() {
		if err := ctx.Err(); err != nil {
			return fmt.Errorf("acp: context done: %w", err)
		}

		line := scanner.Text()
		if line == "" {
			continue
		}

		var msg jsonRPCMessage
		if err := json.Unmarshal([]byte(line), &msg); err != nil {
			slog.Warn("acp: failed to parse JSON-RPC message", "line", line, "error", err)
			continue
		}

		// Phase 2 prep: translate notifications and responses into Edge
		// run.agent.* events via the pure mapper. Requests (permission, fs,
		// terminal) are not handled here yet — they need a blocking stdin
		// round-trip which requires the full handshake (Phase 2).
		switch {
		case msg.isNotification() && msg.Method == "session/update":
			var updates []acpSessionUpdateEvent
			if err := json.Unmarshal(msg.Params, &updates); err != nil {
				slog.Warn("acp: failed to decode session/update params", "error", err)
				continue
			}
			for _, u := range updates {
				for _, ev := range mapACPUpdate(u) {
					emitter.Emit(ev.EventType, acpRunScope(run), ev.Payload)
				}
			}

		case msg.isResponse():
			if ev := mapACPPromptResult(msg.Result); ev != nil {
				emitter.Emit(ev.EventType, acpRunScope(run), ev.Payload)
			}

		case msg.isRequest():
			// Blocking request (session/request_permission, fs/*, terminal/*).
			// Phase 2 will emit a permission_requested event and await the
			// response on stdin; for now we log so the spike is observable.
			slog.Debug("acp: unhandled JSON-RPC request (Phase 2)", "method", msg.Method, "id", string(msg.ID))
		}
	}

	if err := scanner.Err(); err != nil {
		return NewNonRecoverableParseError(fmt.Errorf("acp: stdout scan error: %w", err))
	}
	return nil
}

// acpRunScope builds the bus event scope for an ACP run. Mirrors the
// lifecycle.runScope shape so downstream consumers see the same fields.
func acpRunScope(run store.Run) map[string]any {
	return map[string]any{
		"projectId": run.ProjectID,
		"threadId":  run.ThreadID,
		"runId":     run.ID,
	}
}

// jsonRPCMessage is a minimal JSON-RPC 2.0 envelope for message
// classification. Full typed deserialization will use the ACP schema
// types once a Go ACP client library is selected.
type jsonRPCMessage struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method,omitempty"`
	Params  json.RawMessage `json:"params,omitempty"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   json.RawMessage `json:"error,omitempty"`
}

// isRequest reports whether this is a JSON-RPC request (has id and method).
func (m *jsonRPCMessage) isRequest() bool { return len(m.ID) > 0 && m.Method != "" }

// isNotification reports whether this is a JSON-RPC notification (has method, no id).
func (m *jsonRPCMessage) isNotification() bool { return len(m.ID) == 0 && m.Method != "" }

// isResponse reports whether this is a JSON-RPC response (has id, no method).
func (m *jsonRPCMessage) isResponse() bool { return len(m.ID) > 0 && m.Method == "" }
