package sdk

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"github.com/agenthub/edge-server/internal/adapters"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/agenthub/edge-server/internal/store"
)

const RuntimeManifestV1Schema = "agenthub-runtime-manifest-v1"

const (
	runtimeManifestFixtureFile       = "fixture-file"
	runtimeManifestFixtureSubprocess = "fixture-subprocess"
)

const RuntimeManifestFixtureReplayFlag = "--agenthub-runtime-fixture-replay"

type RuntimeManifestV1 struct {
	Schema       string                 `json:"schema"`
	ID           string                 `json:"id"`
	Name         string                 `json:"name"`
	Kind         string                 `json:"kind"`
	Command      string                 `json:"command"`
	Args         []string               `json:"args,omitempty"`
	EnvNames     []string               `json:"envNames,omitempty"`
	Stdin        bool                   `json:"stdin,omitempty"`
	Capabilities AgentCapabilities      `json:"capabilities,omitempty"`
	Models       []RuntimeManifestModel `json:"models,omitempty"`
	Icons        RuntimeManifestIcons   `json:"icons,omitempty"`
	Fixture      RuntimeManifestFixture `json:"fixture"`
	manifestDir  string
}

type RuntimeManifestModel struct {
	ID       string `json:"id"`
	Label    string `json:"label,omitempty"`
	Provider string `json:"provider,omitempty"`
	Default  bool   `json:"default,omitempty"`
}

type RuntimeManifestIcons struct {
	Runtime  string `json:"runtime,omitempty"`
	Provider string `json:"provider,omitempty"`
	Model    string `json:"model,omitempty"`
	Tool     string `json:"tool,omitempty"`
	Fallback string `json:"fallback,omitempty"`
}

type RuntimeManifestFixture struct {
	Type string `json:"type"`
	Path string `json:"path,omitempty"`
}

type RuntimeManifestAdapter struct {
	manifest RuntimeManifestV1
}

func LoadRuntimeManifestFile(path string) (RuntimeManifestV1, error) {
	// #nosec G304 -- manifest path comes from operator config
	data, err := os.ReadFile(path)
	if err != nil {
		return RuntimeManifestV1{}, fmt.Errorf("read runtime manifest %q: %w", path, err)
	}
	var manifest RuntimeManifestV1
	if err := json.Unmarshal(data, &manifest); err != nil {
		return RuntimeManifestV1{}, fmt.Errorf("decode runtime manifest %q: %w", path, err)
	}
	manifest.manifestDir = filepath.Dir(path)
	if err := manifest.validate(); err != nil {
		return RuntimeManifestV1{}, fmt.Errorf("runtime manifest %q: %w", path, err)
	}
	return manifest, nil
}

func NewRuntimeManifestAdapter(manifest RuntimeManifestV1) *RuntimeManifestAdapter {
	return &RuntimeManifestAdapter{manifest: manifest}
}

func (a *RuntimeManifestAdapter) Metadata() AdapterMetadata {
	return AdapterMetadata{
		ID:          a.manifest.ID,
		Name:        a.manifest.Name,
		Description: firstNonEmpty(a.manifest.Kind, "custom") + " runtime manifest fixture adapter",
	}
}

func (a *RuntimeManifestAdapter) Capabilities() AgentCapabilities {
	return a.manifest.Capabilities
}

func (a *RuntimeManifestAdapter) CapabilityHealthMetadata() map[string]any {
	capabilities := a.manifest.Capabilities
	healthState := "available"
	if !a.Available() {
		healthState = "unavailable"
	}
	metadata := map[string]any{
		"adapterId":           a.manifest.ID,
		"runtimeKind":         a.manifest.Kind,
		"fixtureOnly":         true,
		"noSpendDefault":      true,
		"transport":           a.manifest.Fixture.Type,
		"healthState":         healthState,
		"workspacePathPolicy": "runtime-workdir-runtime-managed; fixture payloads basename-redacted",
		"rawSdkObjectPolicy":  "never-expose-above-edge-adapter",
		"capabilities": map[string]bool{
			"streaming":       capabilities.Streaming,
			"toolCalls":       capabilities.ToolCalls,
			"fileChanges":     capabilities.FileChanges,
			"permissionHooks": capabilities.PermissionHooks,
			"thinkingVisible": capabilities.ThinkingVisible,
			"multiTurn":       capabilities.MultiTurn,
			"mcpIntegration":  capabilities.MCPIntegration,
			"subAgentSpawn":   capabilities.SubAgentSpawn,
		},
	}
	if len(a.manifest.Models) > 0 {
		models := make([]string, 0, len(a.manifest.Models))
		for _, model := range a.manifest.Models {
			if strings.TrimSpace(model.ID) != "" {
				models = append(models, model.ID)
			}
		}
		metadata["models"] = models
	}
	if strings.TrimSpace(a.manifest.Icons.Fallback) != "" {
		metadata["iconFallback"] = a.manifest.Icons.Fallback
	}
	return metadata
}

func (a *RuntimeManifestAdapter) BuildCommand(ctx RunProcessContext) (string, []string, []string, string) {
	// Empty workDir is rejected at REST/MCP gates (#854). Do not fall back to
	// UserHomeDir/DefaultWorkDir; keep empty and let the process CWD stay unset
	// if a bypass path reaches BuildCommand.
	workDir := strings.TrimSpace(ctx.WorkDir)
	if a.manifest.Fixture.Type == runtimeManifestFixtureFile {
		cmdPath, args := runtimeManifestFixtureReplayCommand()
		return cmdPath, args, nil, workDir
	}
	return a.manifest.Command, redactedRuntimeManifestArgs(a.manifest.Args), adapters.EnvNamesOnly(a.manifest.EnvNames), workDir
}

func (a *RuntimeManifestAdapter) ParseStream(ctx context.Context, stdout io.Reader, _ io.Writer, emitter EventEmitter, run store.Run) error {
	scope := map[string]any{
		"projectId": run.ProjectID,
		"threadId":  run.ThreadID,
		"runId":     run.ID,
	}
	cmdPath, args, env, workDir := a.BuildCommand(RunProcessContext{})
	plan := adapters.BuildCLIInvocationPlanFromCommand(a, RunProcessContext{}, cmdPath, args, env, workDir)
	emitter.Emit(BusEventCLIInvocationPlan, scope, plan.Payload())

	var data []byte
	var err error
	switch a.manifest.Fixture.Type {
	case runtimeManifestFixtureFile:
		data, err = os.ReadFile(a.fixturePath())
	case runtimeManifestFixtureSubprocess:
		data, err = io.ReadAll(stdout)
	default:
		err = fmt.Errorf("unsupported fixture type %q", a.manifest.Fixture.Type)
	}
	if err != nil {
		return err
	}
	if len(bytes.TrimSpace(data)) == 0 {
		return nil
	}
	stream, err := DecodeSDKFixtureStream(data)
	if err != nil {
		return err
	}
	for _, mapped := range MapSDKFixtureStream(stream, scope) {
		emitter.Emit(mapped.Type, mapped.Scope, mapped.Payload)
	}
	return nil
}

func (a *RuntimeManifestAdapter) NeedsStdin() bool {
	if a.manifest.Fixture.Type == runtimeManifestFixtureFile {
		return false
	}
	return a.manifest.Stdin
}

func (a *RuntimeManifestAdapter) Available() bool {
	if err := a.manifest.validate(); err != nil {
		return false
	}
	if a.manifest.Fixture.Type == runtimeManifestFixtureFile {
		info, err := os.Stat(a.fixturePath())
		return err == nil && !info.IsDir()
	}
	return true
}

func (m RuntimeManifestV1) validate() error {
	if strings.TrimSpace(m.Schema) != RuntimeManifestV1Schema {
		return fmt.Errorf("schema must be %q", RuntimeManifestV1Schema)
	}
	if strings.TrimSpace(m.ID) == "" {
		return fmt.Errorf("id is required")
	}
	if strings.TrimSpace(m.Name) == "" {
		return fmt.Errorf("name is required")
	}
	if strings.TrimSpace(m.Kind) == "" {
		return fmt.Errorf("kind is required")
	}
	if strings.TrimSpace(m.Command) == "" {
		return fmt.Errorf("command is required")
	}
	fixtureType := strings.TrimSpace(m.Fixture.Type)
	if isUnsafeRuntimeManifestTransport(fixtureType) {
		return fmt.Errorf("unsafe or live runtime transport %q is not allowed in fixture manifests; use fixture-file or fixture-subprocess", fixtureType)
	}
	switch fixtureType {
	case runtimeManifestFixtureFile:
		if strings.TrimSpace(m.Fixture.Path) == "" {
			return fmt.Errorf("fixture.path is required for fixture-file")
		}
	case runtimeManifestFixtureSubprocess:
		// The command is intentionally not looked up here; P1 treats this as a
		// fixture contract, not observed runtime evidence.
	default:
		return fmt.Errorf("fixture.type must be fixture-file or fixture-subprocess")
	}
	return nil
}

func (a *RuntimeManifestAdapter) fixturePath() string {
	path := strings.TrimSpace(a.manifest.Fixture.Path)
	if path == "" || filepath.IsAbs(path) || a.manifest.manifestDir == "" {
		return path
	}
	return filepath.Join(a.manifest.manifestDir, path)
}

func runtimeManifestFixtureReplayCommand() (string, []string) {
	executable, err := os.Executable()
	if err != nil || strings.TrimSpace(executable) == "" {
		return "agenthub-runtime-fixture-replay-unavailable", []string{RuntimeManifestFixtureReplayFlag}
	}
	return executable, []string{RuntimeManifestFixtureReplayFlag}
}

func redactedRuntimeManifestArgs(args []string) []string {
	out := make([]string, 0, len(args))
	for _, arg := range args {
		redacted := sanitizeSDKText(arg)
		if isLikelyRuntimeManifestSecretArg(redacted) {
			name, _, ok := strings.Cut(redacted, "=")
			if ok {
				redacted = name + "=[redacted]"
			} else if strings.HasPrefix(redacted, "-") {
				redacted += " [redacted]"
			}
		}
		out = append(out, redacted)
	}
	return out
}

func isLikelyRuntimeManifestSecretArg(value string) bool {
	normalized := strings.ToLower(strings.ReplaceAll(strings.ReplaceAll(value, "_", ""), "-", ""))
	return strings.Contains(normalized, "apikey") ||
		strings.Contains(normalized, "token") ||
		strings.Contains(normalized, "secret") ||
		strings.Contains(normalized, "authorization") ||
		strings.Contains(normalized, "password")
}

func isUnsafeRuntimeManifestTransport(value string) bool {
	normalized := strings.ToLower(strings.TrimSpace(value))
	if normalized == "" || normalized == runtimeManifestFixtureFile || normalized == runtimeManifestFixtureSubprocess {
		return false
	}
	return strings.Contains(normalized, "sdk") ||
		strings.Contains(normalized, "http") ||
		strings.Contains(normalized, "websocket") ||
		strings.Contains(normalized, "stdio") ||
		strings.Contains(normalized, "grpc") ||
		strings.Contains(normalized, "sse") ||
		strings.Contains(normalized, "live") ||
		strings.Contains(normalized, "real") ||
		strings.Contains(normalized, "shell") ||
		strings.Contains(normalized, " ") ||
		strings.ContainsAny(normalized, ";|&`$")
}
