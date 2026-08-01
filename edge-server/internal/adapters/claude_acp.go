// Package adapters — claude-acp: the official Claude Code ACP adapter (third
// ACP migration target, per docs/analysis/agenthub-acp-go-migration.md §6).
//
// The existing ClaudeCodeAdapter (claude_code.go) is a mature NDJSON
// stream-json parser (claude -p --output-format stream-json --verbose) with
// its own brokered permission handler; it is retained as a fallback and
// control (marked DEPRECATED). This adapter replaces that hop with the
// official ACP adapter binary `@agentclientprotocol/claude-agent-acp`
// (formerly @zed-industries/claude-agent-acp), which speaks the Agent Client
// Protocol (JSON-RPC 2.0) over stdio and is consumed by the shared
// coder/acp-go-sdk client runtime (acp_client.go): streaming updates,
// capability negotiation, and the Edge approval chain
// (session/request_permission → PermissionDecisionBroker) come with it.
//
// Launch shape: `npx -y @agentclientprotocol/claude-agent-acp` (npx
// distribution, version-pinned per the migration report). On Windows the
// launcher must be npx.cmd — a bare "npx" command in PATH is resolved by
// exec.Command only via PATHEXT expansion, and naming the .cmd explicitly
// avoids ambiguity. The agent args are static (-y + package), so the .cmd %*
// argument-forwarding quirk that corrupts multiline prompts does not apply
// here: the user prompt travels over the ACP stdio protocol, never as argv.
//
// API key passthrough: ANTHROPIC_API_KEY is filtered out of the child env by
// the executor's sanitizer (env_sanitizer.go), so BuildCommand injects it
// explicitly — the same passthrough pattern the codex-acp / opencode-acp
// adapters use for their provider keys.
package adapters

import (
	"fmt"
	"os"
)

// claudeACPAdapterID is the registry identifier of the official claude-agent-acp
// configuration.
const claudeACPAdapterID = "claude-acp"

// claudeACPPackage is the official ACP adapter npm package.
const claudeACPPackage = "@agentclientprotocol/claude-agent-acp"

// claudeACPVersionPin is the version verified for the migration spike (bump
// discipline: update on upgrades, keep the pin visible in metadata).
const claudeACPVersionPin = "0.62.0"

// ClaudeACPAdapter runs the official claude-agent-acp ACP agent binary.
//
// It embeds AcpAdapter (protocol handling, permission broker, capabilities)
// and overrides only the command surface: BuildCommand injects the Anthropic
// env passthrough (ANTHROPIC_API_KEY), and Metadata() surfaces the version
// pin. Everything else — ParseStream via runACPSession, NeedsStdin,
// Available, SetPermissionBroker — is inherited.
type ClaudeACPAdapter struct {
	*AcpAdapter

	// env carries the Anthropic key passthrough injected in BuildCommand.
	env []string
}

// NewClaudeACPAdapter creates the claude-agent-acp adapter configuration.
//
// npxPath is the launcher to spawn; when empty it defaults to "npx.cmd" on
// Windows and "npx" elsewhere. The agent receives no run-time args beyond
// `-y @agentclientprotocol/claude-agent-acp`: ACP mode is implicit in the
// package, and the prompt travels over stdio.
func NewClaudeACPAdapter(npxPath string) *ClaudeACPAdapter {
	if npxPath == "" {
		npxPath = defaultNpxPath()
	}
	inner := NewAcpAdapterWithID(
		claudeACPAdapterID,
		npxPath,
		[]string{"-y", claudeACPPackage},
		"Claude Code (ACP)",
	)
	return &ClaudeACPAdapter{
		AcpAdapter: inner,
		env:        claudeEnvPassthrough(),
	}
}

// claudeEnvPassthrough captures ANTHROPIC_API_KEY from the parent environment
// so BuildCommand can inject it into the child (the env sanitizer strips it
// from the inherited env).
func claudeEnvPassthrough() []string {
	var env []string
	if key := os.Getenv("ANTHROPIC_API_KEY"); key != "" {
		env = append(env, "ANTHROPIC_API_KEY="+key)
	}
	return env
}

// Metadata returns the adapter identification with the pinned claude-agent-acp
// version surfaced for operations.
func (a *ClaudeACPAdapter) Metadata() AdapterMetadata {
	m := a.AcpAdapter.Metadata()
	m.Version = "claude-acp " + claudeACPVersionPin + " (npx)"
	return m
}

// BuildCommand returns the npx launcher command with the static claude-agent-acp
// args, plus the Anthropic env passthrough. The ACP prompt is NOT part of argv —
// it travels over the stdio protocol (session/prompt).
func (a *ClaudeACPAdapter) BuildCommand(ctx RunProcessContext) (cmdPath string, args []string, env []string, workDir string) {
	cmdPath, args, _, workDir = a.AcpAdapter.BuildCommand(ctx)
	return cmdPath, args, a.env, workDir
}

// PreflightCheck fails fast when the npx launcher is not resolvable, before
// the executor spawns the process. (Authentication — ANTHROPIC_API_KEY env or
// Claude Code login — is left to the claude-agent-acp process itself,
// mirroring the legacy claude CLI behavior.)
func (a *ClaudeACPAdapter) PreflightCheck() error {
	if !a.Available() {
		return fmt.Errorf("claude-acp launcher %q not found on PATH (install Node.js/npx)", a.agentBinary)
	}
	return nil
}

// compile-time guard: the wrapper satisfies the full AgentAdapter contract
// (via the embedded AcpAdapter).
var _ AgentAdapter = (*ClaudeACPAdapter)(nil)

// TODO(真跑验证): an end-to-end run against the real `npx -y
// @agentclientprotocol/claude-agent-acp` process requires a Node.js/npx
// environment with Claude authentication (ANTHROPIC_API_KEY or Claude Code
// login) and network access to the npm registry. Not present in this
// workspace — verification is limited to the registry registration, command
// shape, and a mock ACP peer (claude_acp_test.go / acp_client_test.go).
// Before cutover: verify on a machine with npx + keys, and confirm the npm
// mirror serves 0.62.0.
