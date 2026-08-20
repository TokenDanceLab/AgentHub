// Package opencode — opencode-acp: the native OpenCode ACP adapter (second
// ACP migration target, per ACP Go migration §6).
//
// The existing OpenCodeAdapter (opencode.go, root package) is Phase 1/2 batch
// mode: it spawns the opencode CLI with `opencode run --format json` and
// hand-parses the JSON event stream — a 500+ line custom parser, no ACP
// permission chain. This adapter replaces that hop with OpenCode's native ACP
// subcommand (`opencode acp`, v1.18.5+), consumed by the shared
// coder/acp-go-sdk client runtime (root acp_client.go): streaming updates,
// capability negotiation, and the Edge approval chain
// (session/request_permission → PermissionDecisionBroker) come with it.
//
// Launch shape: `opencode acp` — native CLI subcommand on the opencode binary
// (GitHub releases distribution). Unlike codex-acp there is NO npx wrapper:
// the binary speaks ACP directly, so the adapter spawns it as-is with the
// single static arg "acp". On Windows the binary is opencode.exe, resolved
// via exec.LookPath (PATHEXT expansion) by AcpAdapter.Available.
//
// API key passthrough: OpenCode supports multiple providers, and the needed
// key depends on the provider config. The provider keys (OPENAI_API_KEY /
// ANTHROPIC_API_KEY / OPENROUTER_API_KEY / GEMINI_API_KEY) are filtered out
// of the child env by the executor's sanitizer (env_sanitizer.go), so
// BuildCommand injects them explicitly. Keys are read live from the parent
// env on each BuildCommand call via the shared AcpAdapter.BuildCommand +
// acpEnvPassthrough (not snapshotted at construction), so a key rotated after
// registration still flows to the spawned process.
//
// Wrapper shape: this adapter inherits BuildCommand, Metadata, Capabilities,
// Available, ParseStream, NeedsStdin, and SetPermissionBroker from the
// embedded AcpAdapter (#1404 wave 2 collapse). BuildCommand reads envKeys
// live from the parent env on the embedded AcpAdapter (no per-wrapper env
// field). The PreflightCheck override is retained because the read-only
// TestOpenCodeACPAdapterPreflightFailsFast constructs a raw wrapper without
// the inherited launcherLabel config and still expects the launcher-missing
// failure; the override guarantees that behavior regardless of construction
// path.
package opencode

import (
	"fmt"

	"github.com/agenthub/edge-server/internal/adapters"
)

// opencodeACPAdapterID is the registry identifier of the native opencode ACP
// configuration.
const opencodeACPAdapterID = "opencode-acp"

// opencodeACPVersionPin is the OpenCode version whose native `acp` subcommand
// was verified for the migration spike (bump discipline: update on upgrades,
// keep the pin visible in metadata).
const opencodeACPVersionPin = "1.18.5"

// opencodeACPDefaultBinary is the default opencode binary name resolved via
// PATH (PATHEXT resolves opencode.exe on Windows).
const opencodeACPDefaultBinary = "opencode"

// OpenCodeACPAdapter runs the native `opencode acp` ACP agent.
//
// It embeds AcpAdapter and inherits BuildCommand/Metadata/Capabilities/
// ParseStream/NeedsStdin/Available/SetPermissionBroker from it; this wrapper
// only supplies the opencode-acp configuration via NewAcpAdapterConfig plus a
// PreflightCheck override (see file doc for why the override is retained).
type OpenCodeACPAdapter struct {
	*adapters.AcpAdapter
}

// NewOpenCodeACPAdapter creates the opencode-acp adapter configuration.
//
// binaryPath is the opencode binary to spawn; when empty it defaults to
// "opencode" (resolved via PATH). The agent receives the single static arg
// "acp" — ACP mode is native to the binary, and the prompt travels over
// stdio (session/prompt), never argv.
func NewOpenCodeACPAdapter(binaryPath string) *OpenCodeACPAdapter {
	if binaryPath == "" {
		binaryPath = opencodeACPDefaultBinary
	}
	return &OpenCodeACPAdapter{AcpAdapter: adapters.NewAcpAdapterConfig(adapters.AcpAdapterConfig{
		ID:           opencodeACPAdapterID,
		Binary:       binaryPath,
		Args:         []string{"acp"},
		DisplayName:  "OpenCode (ACP)",
		VersionLabel: "opencode-acp " + opencodeACPVersionPin + " (binary)",
		EnvKeys: []string{
			"OPENAI_API_KEY",
			"ANTHROPIC_API_KEY",
			"OPENROUTER_API_KEY",
			"GEMINI_API_KEY",
		},
		LauncherLabel: "opencode-acp",
		InstallHint:   "install opencode >= " + opencodeACPVersionPin,
	})}
}

// PreflightCheck fails fast when the opencode binary is not resolvable,
// before the executor spawns the process. Retained as an override (rather
// than inherited from AcpAdapter.PreflightCheck) because the read-only
// TestOpenCodeACPAdapterPreflightFailsFast constructs a raw wrapper without
// the inherited launcherLabel config and still expects the launcher-missing
// failure; this override guarantees that behavior regardless of how the
// wrapper was constructed. Authentication — provider API keys or opencode
// auth login — is left to the opencode process itself.
func (a *OpenCodeACPAdapter) PreflightCheck() error {
	if !a.Available() {
		return fmt.Errorf("opencode-acp launcher %q not found on PATH (install opencode >= %s)", a.AgentBinary(), opencodeACPVersionPin)
	}
	return nil
}

// compile-time guard: the wrapper satisfies the full AgentAdapter contract
// (via the embedded AcpAdapter).
var _ adapters.AgentAdapter = (*OpenCodeACPAdapter)(nil)

// Verified: end-to-end runs against the real `opencode acp` process were
// exercised on the DevSpace dev machine (opencode 1.18.18 installed via npm,
// gateway provider configured in ~/.config/opencode/opencode.json →
// initialize → session/new → session/prompt → streaming → end_turn → run
// finalized). Provider credentials come from the opencode config file, not
// the child env, so the sanitizer does not affect them.
