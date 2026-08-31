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
package acp

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"runtime"
	"strings"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/store"
)

// acpExperimentalVersion is the Metadata.Version surfaced by the generic
// experimental AcpAdapter (no concrete agent pin).
const acpExperimentalVersion = "acp-experimental"

// AcpAdapterConfig fully describes a concrete ACP agent configuration. It is
// the single entry point for registering an ACP-backed agent (codex-acp,
// claude-acp, opencode-acp, …), so env passthrough, version label, and
// preflight messaging are sourced from one place instead of being
// re-implemented per wrapper.
type AcpAdapterConfig struct {
	// ID is the registry identifier (e.g. "codex-acp", "claude-acp").
	ID string

	// Binary is the path or command name of the ACP agent executable.
	Binary string

	// Args are extra arguments passed to the agent binary beyond the ACP
	// protocol flag (e.g. ["-y","@agentclientprotocol/codex-acp"]).
	Args []string

	// DisplayName is shown in agent listings (Metadata.Name).
	DisplayName string

	// VersionLabel is surfaced in Metadata.Version for operations (e.g.
	// "codex-acp 1.1.7 (npx)"). Empty falls back to acpExperimentalVersion.
	VersionLabel string

	// EnvKeys are parent-env variables filtered out by the executor's
	// sanitizer that must be re-injected into the child env at
	// BuildCommand time. Read live via os.Getenv on each BuildCommand call
	// (not snapshotted at construction) so a key rotated after adapter
	// registration still flows to the spawned process.
	EnvKeys []string

	// ModelEnvKey is the environment variable used to pass the resolved
	// model to the ACP agent process (e.g. "ANTHROPIC_MODEL" for claude-acp).
	// The ACP protocol's session/new carries no model field, so the model
	// must travel through the child env. Empty disables model injection.
	ModelEnvKey string

	// DefaultModel is the fallback model injected when the run request does
	// not specify one (sourced from --agent-model). Empty leaves model
	// selection to the agent's own config (settings.json / CLI defaults).
	DefaultModel string

	// LauncherLabel is the human-facing name used in the PreflightCheck
	// error when the binary is unresolvable (e.g. "codex-acp launcher").
	// Empty disables PreflightCheck (returns nil) for the generic
	// experimental adapter, preserving its prior no-preflight behavior.
	LauncherLabel string

	// InstallHint is appended to the PreflightCheck error to guide the
	// operator (e.g. "install Node.js/npx", "install opencode >= 1.18.5").
	InstallHint string
}

// AcpAdapter implements AgentAdapter for ACP-compatible agent binaries.
//
// ACP = Agent Client Protocol (agentclientprotocol.com), JSON-RPC 2.0 over
// stdio. The adapter spawns an ACP agent binary (BuildCommand), performs the
// initialize handshake, creates a session, prompts, and streams updates —
// all through the coder/acp-go-sdk client runtime (acp_client.go).
//
// Reference: #1404, ACP spike analysis, ACP Go migration (option C').
type AcpAdapter struct {
	// id is the registry identifier for this adapter instance. The generic
	// "acp" entry and concrete agent configs (e.g. codex-acp) each use their
	// own IDs so multiple ACP agents can coexist in the registry.
	id string

	// agentBinary is the path or command name of the ACP agent executable.
	agentBinary string

	// agentArgs are extra arguments passed to the agent binary beyond
	// the ACP protocol flag (e.g. --experimental-acp).
	agentArgs []string

	// metadata carries the static adapter identification.
	metadata AdapterMetadata

	// envKeys are parent-env variables re-injected into the child env at
	// BuildCommand time (see AcpAdapterConfig.EnvKeys).
	envKeys []string

	// modelEnvKey / defaultModel parameterize model injection into the child
	// env at BuildCommand time (see AcpAdapterConfig.ModelEnvKey/DefaultModel).
	modelEnvKey  string
	defaultModel string

	// launcherLabel / installHint parameterize PreflightCheck so concrete
	// agent configs share one inherited method instead of overriding it.
	launcherLabel string
	installHint   string

	// permissionBroker bridges session/request_permission to the Edge
	// approval chain. nil = auto-approve fallback (see
	// acpClientHandler.RequestPermission).
	permissionBroker *adapters.PermissionDecisionBroker
}

// NewAcpAdapterConfig builds an AcpAdapter from a fully-specified concrete
// agent configuration. This is the preferred entry point for codex-acp,
// claude-acp, opencode-acp, …: env passthrough, version label, and preflight
// messaging are all sourced from cfg instead of being re-implemented per
// wrapper.
func NewAcpAdapterConfig(cfg AcpAdapterConfig) *AcpAdapter {
	version := cfg.VersionLabel
	if strings.TrimSpace(version) == "" {
		version = acpExperimentalVersion
	}
	return &AcpAdapter{
		id:            cfg.ID,
		agentBinary:   cfg.Binary,
		agentArgs:     cfg.Args,
		envKeys:       cfg.EnvKeys,
		modelEnvKey:   cfg.ModelEnvKey,
		defaultModel:  cfg.DefaultModel,
		launcherLabel: cfg.LauncherLabel,
		installHint:   cfg.InstallHint,
		metadata: AdapterMetadata{
			ID:          cfg.ID,
			Name:        cfg.DisplayName,
			Version:     version,
			Description: "ACP agent (experimental — JSON-RPC 2.0 over stdio)",
		},
	}
}

// SetPermissionBroker installs the shared adapters.PermissionDecisionBroker that
// session/request_permission requests are bridged to (mirrors
// ClaudeCodeAdapter.SetPermissionBroker; the API layer's
// installPermissionBrokerLocked calls this automatically once the adapter is
// registered).
func (a *AcpAdapter) SetPermissionBroker(broker *adapters.PermissionDecisionBroker) {
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
// agent binary requires to enter ACP mode (e.g. --experimental-acp). Env
// passthrough keys (AcpAdapterConfig.EnvKeys) are read live from the parent
// environment on every call, so a key rotated after adapter registration
// still flows to the spawned process. Returns a nil env slice when no keys
// resolve, preserving the "no env" contract callers rely on.
func (a *AcpAdapter) BuildCommand(ctx RunProcessContext) (cmdPath string, args []string, env []string, workDir string) {
	env = acpEnvPassthrough(a.envKeys)
	if model := a.resolvedModel(ctx); a.modelEnvKey != "" && model != "" {
		env = append(env, a.modelEnvKey+"="+model)
	}
	return a.agentBinary, a.agentArgs, env, ctx.WorkDir
}

// resolvedModel returns the model to inject into the child env: the run's
// explicit model wins, then the adapter default (--agent-model). Empty means
// the agent falls back to its own config (settings.json / CLI defaults).
func (a *AcpAdapter) resolvedModel(ctx RunProcessContext) string {
	if ctx.Model != "" {
		return ctx.Model
	}
	return a.defaultModel
}

// NeedsStdin reports true — ACP requires a writable stdin for
// initialize, session/prompt, and permission responses.
func (a *AcpAdapter) NeedsStdin() bool { return true }

// Available reports whether the agent binary resolves on PATH (or is an
// existing absolute path). A raw stat+executable-bit check is unreliable on
// Windows, where .cmd launchers such as npx.cmd have no executable mode bit,
// so availability is resolved via exec.LookPath (same pattern as the
// claude-code / codex adapters).
func (a *AcpAdapter) Available() bool {
	return acpBinaryAvailable(a.agentBinary, exec.LookPath)
}

// AgentBinary returns the configured ACP agent binary path/name. Exported so
// wrapper packages (adapters/claude, adapters/codex, adapters/opencode) can
// surface it in their own PreflightCheck messages (#1760 各增量).
func (a *AcpAdapter) AgentBinary() string {
	return a.agentBinary
}

// PreflightCheck fails fast when the agent binary is not resolvable, before
// the executor spawns the process. The error message is parameterized by
// LauncherLabel/InstallHint so concrete agent configs (codex-acp,
// claude-acp, opencode-acp) share this one inherited method. When
// LauncherLabel is empty (generic experimental "acp" adapter) the check is
// a no-op (returns nil), preserving the prior no-preflight behavior for the
// generic adapter. Authentication (API keys, login state) is left to the
// agent process itself, mirroring the legacy CLI adapters.
func (a *AcpAdapter) PreflightCheck() error {
	if strings.TrimSpace(a.launcherLabel) == "" {
		return nil
	}
	if !a.Available() {
		return fmt.Errorf("%s launcher %q not found on PATH (%s)", a.launcherLabel, a.agentBinary, a.installHint)
	}
	return nil
}

// acpBinaryAvailable reports whether the agent binary resolves via the given
// lookPath function (injected for testability).
func acpBinaryAvailable(binary string, lookPath func(string) (string, error)) bool {
	if strings.TrimSpace(binary) == "" {
		return false
	}
	_, err := lookPath(binary)
	return err == nil
}

// DefaultNpxPath returns the platform-appropriate npx launcher name. Shared
// by the codex-acp and claude-acp configs (both spawn npx); exported for the
// claude/codex/opencode 子包（#1760 各增量，子包 → adapters 单向依赖）。
func DefaultNpxPath() string {
	if runtime.GOOS == "windows" {
		return "npx.cmd"
	}
	return "npx"
}

// acpEnvPassthrough reads the listed parent-env variables and returns
// "KEY=VALUE" entries for the non-empty ones. Returns nil when none resolve,
// so BuildCommand surfaces a nil env slice (preserving the "no env" contract
// callers and tests rely on) instead of an empty non-nil slice.
func acpEnvPassthrough(keys []string) []string {
	var env []string
	for _, key := range keys {
		if value := os.Getenv(key); value != "" {
			env = append(env, key+"="+value)
		}
	}
	return env
}

// ParseStream runs one ACP turn via the coder/acp-go-sdk client runtime:
// initialize handshake → session/new → session/prompt → session/update
// stream → prompt response. See runACPSession in acp_client.go for the
// full flow and the TODO list (#1743 (follow-up of #1404): fs/terminal frames, live adapter
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

// compile-time guard: the generic AcpAdapter satisfies the full AgentAdapter
// contract on its own (concrete configs embed it and inherit everything).
var _ AgentAdapter = (*AcpAdapter)(nil)
