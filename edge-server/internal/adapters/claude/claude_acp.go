// Package adapters — claude-acp: the official Claude Code ACP adapter (third
// ACP migration target, per ACP Go migration §6).
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
// Launch shape: `npx -y @agentclientprotocol/claude-agent-acp@0.67.0` (npx
// distribution with the version pin applied via claudeACPPackageSpec). On
// Windows the launcher must be npx.cmd — a bare "npx" command in PATH is
// resolved by exec.Command only via PATHEXT expansion, and naming the .cmd
// explicitly avoids ambiguity. The agent args are static (-y + pinned
// package), so the .cmd %* argument-forwarding quirk that corrupts multiline
// prompts does not apply here: the user prompt travels over the ACP stdio
// protocol, never as argv.
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
//
// #1760 acp 增量：共享 ACP 机制随 acp 家族归组到子包 adapters/acp
// （AcpAdapter/NewAcpAdapterConfig/DefaultNpxPath），经 acp.Xxx 限定引用。
package claude

import (
	"fmt"

	"github.com/agenthub/edge-server/internal/adapters/acp"
)

// claudeACPAdapterID is the registry identifier of the official claude-agent-acp
// configuration.
const claudeACPAdapterID = "claude-acp"

// claudeACPPackage is the official ACP adapter npm package.
const claudeACPPackage = "@agentclientprotocol/claude-agent-acp"

// claudeACPVersionPin is the npm version verified end-to-end on a live
// dev machine (initialize handshake, session/new, session/prompt, end_turn,
// model passthrough via ANTHROPIC_MODEL). Bump discipline: update on
// upgrades, keep the pin visible in metadata AND in the npx package spec —
// an unpinned `npx -y <pkg>` silently drifts to latest (previously 0.62.0
// metadata vs 0.67.0 actually installed).
const claudeACPVersionPin = "0.67.0"

// claudeACPPackageSpec is the npx install spec with the version pin applied.
const claudeACPPackageSpec = claudeACPPackage + "@" + claudeACPVersionPin

// ACPAdapter runs the official claude-agent-acp ACP agent binary.
//
// It embeds AcpAdapter and inherits BuildCommand/Metadata/Capabilities/
// ParseStream/NeedsStdin/Available/SetPermissionBroker from it; this wrapper
// only supplies the claude-acp configuration via NewAcpAdapterConfig plus a
// PreflightCheck override (see file doc for why the override is retained).
type ACPAdapter struct {
	*acp.AcpAdapter
}

// NewClaudeACPAdapter creates the claude-agent-acp adapter configuration.
//
// npxPath is the launcher to spawn; when empty it defaults to "npx.cmd" on
// Windows and "npx" elsewhere (shared acp.DefaultNpxPath). The agent
// receives no run-time args beyond `-y` + the pinned package spec
// (claudeACPPackageSpec): ACP mode is implicit in the package, and the
// prompt travels over stdio.
//
// model is the default model injected as ANTHROPIC_MODEL when a run does not
// specify one (sourced from --agent-model). Empty leaves model selection to
// the agent's own settings.json. ANTHROPIC_AUTH_TOKEN / ANTHROPIC_BASE_URL
// are also passed through so a cc-switch-style gateway (token + base URL)
// authenticates the same way the legacy claude-code adapter does.
func NewClaudeACPAdapter(npxPath, model string) *ACPAdapter {
	if npxPath == "" {
		npxPath = acp.DefaultNpxPath()
	}
	return &ACPAdapter{AcpAdapter: acp.NewAcpAdapterConfig(acp.AcpAdapterConfig{
		ID:            claudeACPAdapterID,
		Binary:        npxPath,
		Args:          []string{"-y", claudeACPPackageSpec},
		DisplayName:   "Claude Code (ACP)",
		VersionLabel:  "claude-acp " + claudeACPVersionPin + " (npx)",
		EnvKeys:       []string{"ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL"},
		ModelEnvKey:   "ANTHROPIC_MODEL",
		DefaultModel:  model,
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
func (a *ACPAdapter) PreflightCheck() error {
	if !a.Available() {
		return fmt.Errorf("claude-acp launcher %q not found on PATH (install Node.js/npx)", a.AgentBinary())
	}
	return nil
}

// compile-time guard: the wrapper satisfies the full AgentAdapter contract
// (via the embedded AcpAdapter).
var _ AgentAdapter = (*ACPAdapter)(nil)

// Verified: end-to-end runs against the real `npx -y
// @agentclientprotocol/claude-agent-acp@0.67.0` process were exercised on the
// dev host (initialize → session/new → session/prompt →
// streaming updates → end_turn → run finalized; ANTHROPIC_MODEL passthrough
// confirmed). The version pin must stay in sync with claudeACPVersionPin.
