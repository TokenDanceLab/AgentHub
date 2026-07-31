// Package adapters — ACP (Agent Client Protocol) adapter (experimental).
//
// This adapter implements the AgentAdapter interface for ACP-compatible
// agents (JSON-RPC 2.0 over stdio). It is part of the #1404 spike.
//
// Protocol layer: this file no longer contains a hand-rolled JSON-RPC loop —
// the connection layer and typed dispatch come from the official-schema Go
// client runtime github.com/coder/acp-go-sdk (v0.13.5, see acp_client.go).
// Protocol boundary stays 100% official adapter binaries.
//
// Once validated with a real ACP agent binary, the "experimental" tag
// will be removed and this adapter will join the production registry.
package adapters

import (
	"context"
	"io"
	"os"

	"github.com/agenthub/edge-server/internal/store"
)

// acpAdapterID is the registry identifier for the experimental ACP adapter.
const acpAdapterID = "acp"

// AcpAdapter implements AgentAdapter for ACP-compatible agent binaries.
//
// ACP = Agent Client Protocol (agentclientprotocol.com), JSON-RPC 2.0 over
// stdio. The adapter spawns an ACP agent binary (BuildCommand), performs the
// initialize handshake, creates a session, prompts, and streams updates —
// all through the coder/acp-go-sdk client runtime (acp_client.go).
//
// Reference: #1404, docs/analysis/acp-spike-phase1.md,
// docs/analysis/agenthub-acp-go-migration.md (option C').
type AcpAdapter struct {
	// agentBinary is the absolute path to the ACP agent executable.
	agentBinary string

	// agentArgs are extra arguments passed to the agent binary beyond
	// the ACP protocol flag (e.g. --experimental-acp).
	agentArgs []string

	// metadata carries the static adapter identification.
	metadata AdapterMetadata

	// permissionBroker bridges session/request_permission to the Edge
	// approval chain. nil = auto-approve fallback (see
	// acpClientHandler.RequestPermission).
	permissionBroker *PermissionDecisionBroker
}

// NewAcpAdapter creates an experimental ACP adapter for the given agent binary.
//
// agentBinary must be an absolute path to an ACP-compatible executable.
// agentArgs are appended after the ACP protocol flag.
// displayName is shown in agent listings.
func NewAcpAdapter(agentBinary string, agentArgs []string, displayName string) *AcpAdapter {
	return &AcpAdapter{
		agentBinary:      agentBinary,
		agentArgs:        agentArgs,
		permissionBroker: nil,
		metadata: AdapterMetadata{
			ID:          acpAdapterID,
			Name:        displayName,
			Version:     "acp-experimental",
			Description: "ACP agent (experimental — JSON-RPC 2.0 over stdio)",
		},
	}
}

// SetPermissionBroker installs the shared PermissionDecisionBroker that
// session/request_permission requests are bridged to (mirrors
// ClaudeCodeAdapter.SetPermissionBroker; the API layer's
// installPermissionBrokerLocked calls this automatically once the adapter is
// registered).
func (a *AcpAdapter) SetPermissionBroker(broker *PermissionDecisionBroker) {
	a.permissionBroker = broker
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

// ParseStream runs one ACP turn via the coder/acp-go-sdk client runtime:
// initialize handshake → session/new → session/prompt → session/update
// stream → prompt response. See runACPSession in acp_client.go for the
// full flow and the TODO list (fs/terminal frames, live adapter
// verification). session/request_permission is bridged to the Edge
// approval chain via the permission broker installed by
// SetPermissionBroker.
func (a *AcpAdapter) ParseStream(ctx context.Context, stdout io.Reader, stdin io.Writer, emitter EventEmitter, run store.Run) error {
	return runACPSession(ctx, stdout, stdin, emitter, run, a.permissionBroker)
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
