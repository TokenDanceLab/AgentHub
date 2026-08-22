// Package codex — codex-acp: the official Codex ACP adapter (first ACP
// migration target, per ACP Go migration §6).
//
// The existing CodexAdapter (codex.go, root package) is Phase 1 batch mode:
// it spawns the codex CLI with `exec --json` and hand-parses JSONL output —
// no streaming (Streaming: false), no ACP permission chain. This adapter
// replaces that hop with the official ACP adapter binary
// `@agentclientprotocol/codex-acp`, which speaks the Agent Client Protocol
// (JSON-RPC 2.0) over stdio and is consumed by the shared coder/acp-go-sdk
// client runtime (adapters/acp acp_client.go): streaming updates, capability
// negotiation, and the Edge approval chain
// (session/request_permission → PermissionDecisionBroker) come with it.
//
// Launch shape: `npx -y @agentclientprotocol/codex-acp` (npx distribution,
// version-pinned per the migration report). On Windows the launcher must be
// npx.cmd — a bare "npx" command in PATH is resolved by exec.Command only via
// PATHEXT expansion, and naming the .cmd explicitly avoids ambiguity. The
// agent args are static (-y + package), so the .cmd %* argument-forwarding
// quirk that corrupts multiline prompts does not apply here: the user prompt
// travels over the ACP stdio protocol, never as argv.
//
// API key passthrough: OPENAI_API_KEY / OPENAI_BASE_URL are filtered out of
// the child env by the executor's sanitizer (env_sanitizer.go), so
// BuildCommand injects them explicitly — the same passthrough pattern the
// legacy CodexAdapter uses (codex.go BuildCommand). The keys are read live
// from the parent env on each BuildCommand call (not snapshotted at adapter
// construction) so a key rotated after registration still flows to the spawn.
//
// This file is now a thin configuration shim over the acp subpackage
// AcpAdapter: every behavior (BuildCommand env passthrough, Metadata version
// pin, PreflightCheck launcher-missing error, ParseStream via runACPSession,
// capabilities, permission broker) is inherited from AcpAdapter via embedding
// + a single AcpAdapterConfig. The earlier near-copy of the codex/claude/
// opencode ACP wrappers has been collapsed into shared AcpAdapter logic
// (#1404 wave 2).
package codex

import (
	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/adapters/acp"
)

// codexACPadapterID is the registry identifier of the official codex-acp
// configuration.
const codexACPadapterID = "codex-acp"

// codexACPPackage is the official ACP adapter npm package.
const codexACPPackage = "@agentclientprotocol/codex-acp"

// codexACPVersionPin is the npm version for the migration spike (bump
// discipline: update on upgrades, keep the pin visible in metadata AND in
// the npx package spec — an unpinned `npx -y <pkg>` silently drifts to
// latest).
const codexACPVersionPin = "1.1.7"

// codexACPPackageSpec is the npx install spec with the version pin applied.
const codexACPPackageSpec = codexACPPackage + "@" + codexACPVersionPin

// ACPAdapter runs the official codex-acp ACP agent binary.
//
// It embeds AcpAdapter and inherits the full AgentAdapter contract
// (BuildCommand, Metadata, Capabilities, Available, PreflightCheck,
// ParseStream, NeedsStdin, SetPermissionBroker) from it; this wrapper only
// supplies the codex-acp configuration (binary, args, env keys, version pin,
// preflight labels) via NewAcpAdapterConfig.
type ACPAdapter struct {
	*acp.AcpAdapter
}

// NewCodexACPadapter creates the codex-acp adapter configuration.
//
// npxPath is the launcher to spawn; when empty it defaults to "npx.cmd" on
// Windows and "npx" elsewhere (shared acp.DefaultNpxPath). The agent
// receives no run-time args beyond `-y @agentclientprotocol/codex-acp`: ACP
// mode is implicit in the package, and the prompt travels over stdio.
func NewCodexACPadapter(npxPath string) *ACPAdapter {
	if npxPath == "" {
		npxPath = acp.DefaultNpxPath()
	}
	return &ACPAdapter{AcpAdapter: acp.NewAcpAdapterConfig(acp.AcpAdapterConfig{
		ID:            codexACPadapterID,
		Binary:        npxPath,
		Args:          []string{"-y", codexACPPackageSpec},
		DisplayName:   "Codex (ACP)",
		VersionLabel:  "codex-acp " + codexACPVersionPin + " (npx)",
		EnvKeys:       []string{"OPENAI_API_KEY", "OPENAI_BASE_URL"},
		LauncherLabel: "codex-acp",
		InstallHint:   "install Node.js/npx",
	})}
}

// compile-time guard: the wrapper satisfies the full AgentAdapter contract
// (via the embedded AcpAdapter).
var _ adapters.AgentAdapter = (*ACPAdapter)(nil)

// TODO(#1404 真跑验证): an end-to-end run against the real `npx -y
// @agentclientprotocol/codex-acp` process requires a Node.js/npx environment
// with Codex authentication (OPENAI_API_KEY or ChatGPT login) and network
// access to the npm registry. Not present in this workspace — verification is
// limited to the registry registration, command shape, and a mock ACP peer
// (codex_acp_test.go / acp/acp_client_test.go). Before cutover: verify on a
// machine with npx + keys, and confirm the npm mirror serves 1.1.7.
