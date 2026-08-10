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
// explicitly. The key is read live from the parent env on each BuildCommand
// call via the shared AcpAdapter.BuildCommand + acpEnvPassthrough (not
// snapshotted at construction), so a key rotated after registration still
// flows to the spawned process.
//
// Wrapper shape: this adapter inherits BuildCommand, Metadata, Capabilities,
// Available, ParseStream, NeedsStdin, and SetPermissionBroker from the
// embedded AcpAdapter (#1404 wave 2 collapse). BuildCommand reads envKeys
// live from the parent env on the embedded AcpAdapter (no per-wrapper env
// field). The PreflightCheck override is retained because the read-only
// TestClaudeACPAdapterPreflightFailsFast constructs a raw wrapper without the
// inherited launcherLabel config and still expects the launcher-missing
// failure; the override guarantees that behavior regardless of construction
// path.
package adapters

import "fmt"

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
// It embeds AcpAdapter and inherits BuildCommand/Metadata/Capabilities/
// ParseStream/NeedsStdin/Available/SetPermissionBroker from it; this wrapper
// only supplies the claude-acp configuration via NewAcpAdapterConfig plus a
// PreflightCheck override (see file doc for why the override is retained).
type ClaudeACPAdapter struct {
	*AcpAdapter
}

// NewClaudeACPAdapter creates the claude-agent-acp adapter configuration.
//
// npxPath is the launcher to spawn; when empty it defaults to "npx.cmd" on
// Windows and "npx" elsewhere (shared defaultNpxPath). The agent receives no
// run-time args beyond `-y @agentclientprotocol/claude-agent-acp`: ACP mode
// is implicit in the package, and the prompt travels over stdio.
func NewClaudeACPAdapter(npxPath string) *ClaudeACPAdapter {
	if npxPath == "" {
		npxPath = defaultNpxPath()
	}
	return &ClaudeACPAdapter{AcpAdapter: NewAcpAdapterConfig(AcpAdapterConfig{
		ID:            claudeACPAdapterID,
		Binary:        npxPath,
		Args:          []string{"-y", claudeACPPackage},
		DisplayName:   "Claude Code (ACP)",
		VersionLabel:  "claude-acp " + claudeACPVersionPin + " (npx)",
		EnvKeys:       []string{"ANTHROPIC_API_KEY"},
		LauncherLabel: "claude-acp",
		InstallHint:   "install Node.js/npx",
	})}
}

// PreflightCheck fails fast when the npx launcher is not resolvable, before
// the executor spawns the process. Retained as an override (rather than
// inherited from AcpAdapter.PreflightCheck) because the read-only
// TestClaudeACPAdapterPreflightFailsFast constructs a raw wrapper without the
// inherited launcherLabel config and still expects the launcher-missing
// failure; this override guarantees that behavior regardless of how the
// wrapper was constructed. Authentication — ANTHROPIC_API_KEY env or Claude
// Code login — is left to the claude-agent-acp process itself.
func (a *ClaudeACPAdapter) PreflightCheck() error {
	if !a.Available() {
		return fmt.Errorf("claude-acp launcher %q not found on PATH (install Node.js/npx)", a.agentBinary)
	}
	return nil
}

// compile-time guard: the wrapper satisfies the full AgentAdapter contract
// (via the embedded AcpAdapter).
var _ AgentAdapter = (*ClaudeACPAdapter)(nil)

// TODO(#1404 真跑验证): an end-to-end run against the real `npx -y
// @agentclientprotocol/claude-agent-acp` process requires a Node.js/npx
// environment with Claude authentication (ANTHROPIC_API_KEY or Claude Code
// login) and network access to the npm registry. Not present in this
// workspace — verification is limited to the registry registration, command
// shape, and a mock ACP peer (claude_acp_test.go / acp_client_test.go).
// Before cutover: verify on a machine with npx + keys, and confirm the npm
// mirror serves 0.62.0.
