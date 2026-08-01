// Package adapters — codex-acp: the official Codex ACP adapter (first ACP
// migration target, per docs/analysis/agenthub-acp-go-migration.md §6).
//
// The existing CodexAdapter (codex.go) is Phase 1 batch mode: it spawns the
// codex CLI with `exec --json` and hand-parses JSONL output — no streaming
// (Streaming: false), no ACP permission chain. This adapter replaces that hop
// with the official ACP adapter binary `@agentclientprotocol/codex-acp`,
// which speaks the Agent Client Protocol (JSON-RPC 2.0) over stdio and is
// consumed by the shared coder/acp-go-sdk client runtime (acp_client.go):
// streaming updates, capability negotiation, and the Edge approval chain
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
// legacy CodexAdapter uses (codex.go BuildCommand).
package adapters

import (
	"fmt"
	"os"
	"runtime"
)

// codexACPAadapterID is the registry identifier of the official codex-acp
// configuration.
const codexACPAadapterID = "codex-acp"

// codexACPPackage is the official ACP adapter npm package.
const codexACPPackage = "@agentclientprotocol/codex-acp"

// codexACPVersionPin is the version verified for the migration spike (bump
// discipline: update on upgrades, keep the pin visible in metadata).
const codexACPVersionPin = "1.1.7"

// CodexACPAadapter runs the official codex-acp ACP agent binary.
//
// It embeds AcpAdapter (protocol handling, permission broker, capabilities)
// and overrides only the command surface: BuildCommand injects the codex env
// passthrough (OPENAI_API_KEY / OPENAI_BASE_URL), and Metadata() surfaces the
// version pin. Everything else — ParseStream via runACPSession, NeedsStdin,
// Available, SetPermissionBroker — is inherited.
type CodexACPAadapter struct {
	*AcpAdapter

	// env carries the codex key/base-url passthrough injected in BuildCommand.
	env []string
}

// NewCodexACPAadapter creates the codex-acp adapter configuration.
//
// npxPath is the launcher to spawn; when empty it defaults to "npx.cmd" on
// Windows and "npx" elsewhere. The agent receives no run-time args beyond
// `-y @agentclientprotocol/codex-acp`: ACP mode is implicit in the package,
// and the prompt travels over stdio.
func NewCodexACPAadapter(npxPath string) *CodexACPAadapter {
	if npxPath == "" {
		npxPath = defaultNpxPath()
	}
	inner := NewAcpAdapterWithID(
		codexACPAadapterID,
		npxPath,
		[]string{"-y", codexACPPackage},
		"Codex (ACP)",
	)
	return &CodexACPAadapter{
		AcpAdapter: inner,
		env:        codexEnvPassthrough(),
	}
}

// defaultNpxPath returns the platform-appropriate npx launcher name.
func defaultNpxPath() string {
	if runtime.GOOS == "windows" {
		return "npx.cmd"
	}
	return "npx"
}

// codexEnvPassthrough captures OPENAI_API_KEY / OPENAI_BASE_URL from the
// parent environment so BuildCommand can inject them into the child (the env
// sanitizer strips them from the inherited env).
func codexEnvPassthrough() []string {
	var env []string
	if key := os.Getenv("OPENAI_API_KEY"); key != "" {
		env = append(env, "OPENAI_API_KEY="+key)
	}
	if url := os.Getenv("OPENAI_BASE_URL"); url != "" {
		env = append(env, "OPENAI_BASE_URL="+url)
	}
	return env
}

// Metadata returns the adapter identification with the pinned codex-acp
// version surfaced for operations.
func (a *CodexACPAadapter) Metadata() AdapterMetadata {
	m := a.AcpAdapter.Metadata()
	m.Version = "codex-acp " + codexACPVersionPin + " (npx)"
	return m
}

// BuildCommand returns the npx launcher command with the static codex-acp
// args, plus the codex env passthrough. The ACP prompt is NOT part of argv —
// it travels over the stdio protocol (session/prompt).
func (a *CodexACPAadapter) BuildCommand(ctx RunProcessContext) (cmdPath string, args []string, env []string, workDir string) {
	cmdPath, args, _, workDir = a.AcpAdapter.BuildCommand(ctx)
	return cmdPath, args, a.env, workDir
}

// PreflightCheck fails fast when the npx launcher is not resolvable, before
// the executor spawns the process. (Authentication — OPENAI_API_KEY env or
// Codex auth.json — is left to the codex-acp process itself, mirroring the
// legacy codex CLI behavior.)
func (a *CodexACPAadapter) PreflightCheck() error {
	if !a.Available() {
		return fmt.Errorf("codex-acp launcher %q not found on PATH (install Node.js/npx)", a.agentBinary)
	}
	return nil
}

// compile-time guard: the wrapper satisfies the full AgentAdapter contract
// (via the embedded AcpAdapter).
var _ AgentAdapter = (*CodexACPAadapter)(nil)

// TODO(真跑验证): an end-to-end run against the real `npx -y
// @agentclientprotocol/codex-acp` process requires a Node.js/npx environment
// with Codex authentication (OPENAI_API_KEY or ChatGPT login) and network
// access to the npm registry. Not present in this workspace — verification is
// limited to the registry registration, command shape, and a mock ACP peer
// (codex_acp_test.go / acp_client_test.go). Before cutover: verify on a
// machine with npx + keys, and confirm the npm mirror serves 1.1.7.
