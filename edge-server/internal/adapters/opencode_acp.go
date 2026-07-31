// Package adapters — opencode-acp: the native OpenCode ACP adapter (second
// ACP migration target, per docs/analysis/agenthub-acp-go-migration.md §6).
//
// The existing OpenCodeAdapter (opencode.go) is Phase 1/2 batch mode: it
// spawns the opencode CLI with `opencode run --format json` and hand-parses
// the JSON event stream — a 500+ line custom parser, no ACP permission chain.
// This adapter replaces that hop with OpenCode's native ACP subcommand
// (`opencode acp`, v1.18.5+), consumed by the shared coder/acp-go-sdk client
// runtime (acp_client.go): streaming updates, capability negotiation, and the
// Edge approval chain (session/request_permission → PermissionDecisionBroker)
// come with it.
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
// BuildCommand injects them explicitly — the same passthrough pattern the
// legacy OpenCodeAdapter uses (opencode.go NewOpenCodeAdapter).
package adapters

import (
	"fmt"
	"os"
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
// It embeds AcpAdapter (protocol handling, permission broker, capabilities)
// and overrides only the command surface: BuildCommand spawns
// `<binary> acp` with the OpenCode provider-key passthrough, and Metadata()
// surfaces the version pin. Everything else — ParseStream via runACPSession,
// NeedsStdin, Available, SetPermissionBroker — is inherited.
type OpenCodeACPAdapter struct {
	*AcpAdapter

	// env carries the provider-key passthrough injected in BuildCommand.
	env []string
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
	inner := NewAcpAdapterWithID(
		opencodeACPAdapterID,
		binaryPath,
		[]string{"acp"},
		"OpenCode (ACP)",
	)
	return &OpenCodeACPAdapter{
		AcpAdapter: inner,
		env:        opencodeEnvPassthrough(),
	}
}

// opencodeEnvPassthrough captures the provider keys OpenCode can use from
// the parent environment so BuildCommand can inject them into the child (the
// env sanitizer strips them from the inherited env).
func opencodeEnvPassthrough() []string {
	var env []string
	for _, key := range []string{
		"OPENAI_API_KEY",
		"ANTHROPIC_API_KEY",
		"OPENROUTER_API_KEY",
		"GEMINI_API_KEY",
	} {
		if val := os.Getenv(key); val != "" {
			env = append(env, key+"="+val)
		}
	}
	return env
}

// Metadata returns the adapter identification with the pinned opencode
// version surfaced for operations.
func (a *OpenCodeACPAdapter) Metadata() AdapterMetadata {
	m := a.AcpAdapter.Metadata()
	m.Version = "opencode-acp " + opencodeACPVersionPin + " (binary)"
	return m
}

// BuildCommand returns the opencode binary command with the static ACP arg,
// plus the provider-key passthrough. The ACP prompt is NOT part of argv — it
// travels over the stdio protocol (session/prompt).
func (a *OpenCodeACPAdapter) BuildCommand(ctx RunProcessContext) (cmdPath string, args []string, env []string, workDir string) {
	cmdPath, args, _, workDir = a.AcpAdapter.BuildCommand(ctx)
	return cmdPath, args, a.env, workDir
}

// PreflightCheck fails fast when the opencode binary is not resolvable,
// before the executor spawns the process. (Authentication — provider API
// keys or opencode auth login — is left to the opencode process itself,
// mirroring the legacy opencode CLI behavior.)
func (a *OpenCodeACPAdapter) PreflightCheck() error {
	if !a.Available() {
		return fmt.Errorf("opencode-acp launcher %q not found on PATH (install opencode >= %s)", a.AcpAdapter.agentBinary, opencodeACPVersionPin)
	}
	return nil
}

// compile-time guard: the wrapper satisfies the full AgentAdapter contract
// (via the embedded AcpAdapter).
var _ AgentAdapter = (*OpenCodeACPAdapter)(nil)

// TODO(真跑验证): an end-to-end run against the real `opencode acp` process
// requires an opencode >= 1.18.5 binary on PATH with provider credentials
// (API key or opencode auth login). Not present in this workspace —
// verification is limited to the registry registration, command shape, and a
// mock ACP peer (opencode_acp_test.go / acp_client_test.go). Before cutover:
// verify on a machine with the opencode binary + keys, and confirm the
// binary's `acp` subcommand speaks the pinned protocol version.
