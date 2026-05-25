package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/agenthub/edge-server/internal/store"
)

func TestBuildConfigDefaultsToMemoryStore(t *testing.T) {
	cfg, err := buildConfig(nil)
	if err != nil {
		t.Fatalf("buildConfig returned error: %v", err)
	}

	if cfg.Addr != "127.0.0.1:3210" {
		t.Fatalf("Addr = %q, want default listen address", cfg.Addr)
	}
	if cfg.StoreFile != "" {
		t.Fatalf("StoreFile = %q, want empty", cfg.StoreFile)
	}
	if cfg.RunnerProfile != "" {
		t.Fatalf("RunnerProfile = %q, want empty", cfg.RunnerProfile)
	}
	if cfg.RunnerCommand != "" {
		t.Fatalf("RunnerCommand = %q, want empty", cfg.RunnerCommand)
	}
	if cfg.RunnerWorkDir != "" {
		t.Fatalf("RunnerWorkDir = %q, want empty", cfg.RunnerWorkDir)
	}
	if len(cfg.RunnerArgs) != 0 {
		t.Fatalf("RunnerArgs = %#v, want empty", cfg.RunnerArgs)
	}
	if len(cfg.RunnerEnv) != 0 {
		t.Fatalf("RunnerEnv = %#v, want empty", cfg.RunnerEnv)
	}
	if cfg.LocalAuthToken != "" {
		t.Fatalf("LocalAuthToken = %q, want empty", cfg.LocalAuthToken)
	}
}

func TestBuildConfigParsesStoreFile(t *testing.T) {
	cfg, err := buildConfig([]string{
		"--addr", "127.0.0.1:4321",
		"--store-file", "edge-store.json",
		"--runner-command", "claude",
		"--runner-workdir", "workspace",
		"--runner-arg", "--mock",
		"--runner-arg", "--addr=127.0.0.1:0",
		"--runner-env", "AGENTHUB_PROFILE_RUN={{run.id}}",
		"--runner-env", "AGENTHUB_PROFILE_THREAD={{run.threadId}}",
	})
	if err != nil {
		t.Fatalf("buildConfig returned error: %v", err)
	}

	if cfg.Addr != "127.0.0.1:4321" {
		t.Fatalf("Addr = %q, want parsed address", cfg.Addr)
	}
	if cfg.StoreFile != "edge-store.json" {
		t.Fatalf("StoreFile = %q, want parsed path", cfg.StoreFile)
	}
	if cfg.RunnerCommand != "claude" {
		t.Fatalf("RunnerCommand = %q, want parsed command", cfg.RunnerCommand)
	}
	if cfg.RunnerWorkDir != "workspace" {
		t.Fatalf("RunnerWorkDir = %q, want parsed path", cfg.RunnerWorkDir)
	}
	if got, want := []string(cfg.RunnerArgs), []string{"--mock", "--addr=127.0.0.1:0"}; strings.Join(got, "\x00") != strings.Join(want, "\x00") {
		t.Fatalf("RunnerArgs = %#v, want %#v", got, want)
	}
	if got, want := []string(cfg.RunnerEnv), []string{"AGENTHUB_PROFILE_RUN={{run.id}}", "AGENTHUB_PROFILE_THREAD={{run.threadId}}"}; strings.Join(got, "\x00") != strings.Join(want, "\x00") {
		t.Fatalf("RunnerEnv = %#v, want %#v", got, want)
	}
}

func TestBuildConfigAppliesRunnerProfilePreset(t *testing.T) {
	cfg, err := buildConfig([]string{"--runner-profile", "agenthub-runner-mock"})
	if err != nil {
		t.Fatalf("buildConfig returned error: %v", err)
	}

	if cfg.RunnerProfile != "agenthub-runner-mock" {
		t.Fatalf("RunnerProfile = %q, want preset name", cfg.RunnerProfile)
	}
	// Mock profile no longer sets RunnerCommand — it uses the built-in MockExecutor
	if cfg.RunnerCommand != "" {
		t.Fatalf("RunnerCommand = %q, want empty (mock executor is built-in)", cfg.RunnerCommand)
	}
	if len(cfg.RunnerArgs) != 0 {
		t.Fatalf("RunnerArgs = %#v, want empty", cfg.RunnerArgs)
	}
}

func TestBuildConfigRunnerProfileAllowsCommandOverride(t *testing.T) {
	cfg, err := buildConfig([]string{
		"--runner-profile", "agenthub-runner-mock",
		"--runner-command", "custom-runner",
	})
	if err != nil {
		t.Fatalf("buildConfig returned error: %v", err)
	}

	if cfg.RunnerCommand != "custom-runner" {
		t.Fatalf("RunnerCommand = %q, want custom command", cfg.RunnerCommand)
	}
	if len(cfg.RunnerArgs) != 0 {
		t.Fatalf("RunnerArgs = %#v, want empty", cfg.RunnerArgs)
	}
}

func TestBuildConfigRunnerProfileAppliesClaudeCodePreset(t *testing.T) {
	cfg, err := buildConfig([]string{"--runner-profile", "claude-code"})
	if err != nil {
		t.Fatalf("buildConfig returned error: %v", err)
	}

	if cfg.RunnerCommand != "claude" {
		t.Fatalf("RunnerCommand = %q, want claude", cfg.RunnerCommand)
	}
	if cfg.AgentDefault != "claude-code" {
		t.Fatalf("AgentDefault = %q, want claude-code", cfg.AgentDefault)
	}
}

func TestBuildConfigRunnerProfilePreservesUserArgOrder(t *testing.T) {
	cfg, err := buildConfig([]string{
		"--runner-profile", "agenthub-runner-mock",
		"--runner-command", "custom-runner",
		"--runner-arg", "--addr=127.0.0.1:0",
	})
	if err != nil {
		t.Fatalf("buildConfig returned error: %v", err)
	}

	if got, want := []string(cfg.RunnerArgs), []string{"--addr=127.0.0.1:0"}; strings.Join(got, "\x00") != strings.Join(want, "\x00") {
		t.Fatalf("RunnerArgs = %#v, want %#v", got, want)
	}
}

func TestBuildConfigRunnerProfileValidatesUserEnvTemplate(t *testing.T) {
	cfg, err := buildConfig([]string{
		"--runner-profile", "agenthub-runner-mock",
		"--runner-command", "custom-runner",
		"--runner-env", "PROFILE_RUN={{run.id}}",
	})
	if err != nil {
		t.Fatalf("buildConfig returned error: %v", err)
	}

	if got, want := []string(cfg.RunnerEnv), []string{"PROFILE_RUN={{run.id}}"}; strings.Join(got, "\x00") != strings.Join(want, "\x00") {
		t.Fatalf("RunnerEnv = %#v, want %#v", got, want)
	}
}

func TestBuildConfigRunnerProfileRejectsInvalidUserEnvTemplate(t *testing.T) {
	_, err := buildConfig([]string{
		"--runner-profile", "agenthub-runner-mock",
		"--runner-command", "custom-runner",
		"--runner-env", "BAD={{unknown}}",
	})
	if err == nil || !strings.Contains(err.Error(), "--runner-env") || !strings.Contains(err.Error(), "unknown placeholder") {
		t.Fatalf("buildConfig error = %v, want runner env unknown placeholder error", err)
	}
}

func TestBuildConfigRejectsUnknownRunnerProfile(t *testing.T) {
	_, err := buildConfig([]string{"--runner-profile", "missing-profile"})
	if err == nil || !strings.Contains(err.Error(), "unknown --runner-profile") {
		t.Fatalf("buildConfig error = %v, want unknown runner profile error", err)
	}
}

func TestBuildConfigRejectsUnexpectedArguments(t *testing.T) {
	_, err := buildConfig([]string{"unexpected"})
	if err == nil || !strings.Contains(err.Error(), "unexpected positional arguments") {
		t.Fatalf("buildConfig error = %v, want unexpected positional arguments error", err)
	}
}

func TestBuildConfigRejectsRunnerArgsWithoutCommand(t *testing.T) {
	_, err := buildConfig([]string{"--runner-arg", "--mock"})
	if err == nil || !strings.Contains(err.Error(), "--runner-arg requires --runner-command") {
		t.Fatalf("buildConfig error = %v, want runner command requirement", err)
	}
}

func TestBuildConfigRejectsRunnerEnvWithoutCommand(t *testing.T) {
	_, err := buildConfig([]string{"--runner-env", "AGENTHUB_PROFILE_RUN={{run.id}}"})
	if err == nil || !strings.Contains(err.Error(), "--runner-env requires --runner-command") {
		t.Fatalf("buildConfig error = %v, want runner command requirement", err)
	}
}

func TestBuildConfigRejectsInvalidRunnerEnv(t *testing.T) {
	tests := []string{"AGENTHUB_PROFILE_RUN", "=value"}
	for _, value := range tests {
		t.Run(value, func(t *testing.T) {
			_, err := buildConfig([]string{"--runner-command", "claude", "--runner-env", value})
			if err == nil || !strings.Contains(err.Error(), "--runner-env") {
				t.Fatalf("buildConfig error = %v, want runner env validation error", err)
			}
		})
	}
}

func TestBuildConfigRejectsRunnerWorkDirWithoutCommand(t *testing.T) {
	_, err := buildConfig([]string{"--runner-workdir", "workspace"})
	if err == nil || !strings.Contains(err.Error(), "--runner-workdir requires --runner-command") {
		t.Fatalf("buildConfig error = %v, want runner command requirement", err)
	}
}

func TestNewStoreFromConfigUsesMemoryStoreByDefault(t *testing.T) {
	repository, err := newStoreFromConfig(config{})
	if err != nil {
		t.Fatalf("newStoreFromConfig returned error: %v", err)
	}
	if _, ok := repository.(*store.Store); !ok {
		t.Fatalf("repository type = %T, want *store.Store", repository)
	}
}

func TestNewStoreFromConfigUsesFileStore(t *testing.T) {
	path := filepath.Join(t.TempDir(), "edge-store.json")

	repository, err := newStoreFromConfig(config{StoreFile: path})
	if err != nil {
		t.Fatalf("newStoreFromConfig returned error: %v", err)
	}
	fileStore, ok := repository.(*store.FileStore)
	if !ok {
		t.Fatalf("repository type = %T, want *store.FileStore", repository)
	}

	_, _ = fileStore.CreateProject("proj_test", "Test Project")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("store file was not written: %v", err)
	}
}

func TestNewStoreFromConfigReturnsFileStoreErrors(t *testing.T) {
	path := filepath.Join(t.TempDir(), "edge-store.json")
	if err := os.WriteFile(path, []byte("{not json"), 0o644); err != nil {
		t.Fatalf("WriteFile returned error: %v", err)
	}

	_, err := newStoreFromConfig(config{StoreFile: path})
	if err == nil {
		t.Fatal("newStoreFromConfig returned nil error for invalid file store")
	}
	if !strings.Contains(err.Error(), "open store file") || !strings.Contains(err.Error(), "decode store snapshot") {
		t.Fatalf("newStoreFromConfig error = %v, want clear store file decode error", err)
	}
}

// --- buildAdapterRegistry tests ---

func TestBuildAdapterRegistryEmpty(t *testing.T) {
	reg := buildAdapterRegistry(config{})
	if reg == nil {
		t.Fatal("buildAdapterRegistry should not return nil")
	}
	adapters := reg.List()
	if len(adapters) != 0 {
		t.Fatalf("expected 0 adapters with empty config, got %d", len(adapters))
	}
}

func TestBuildAdapterRegistryWithClaudeCode(t *testing.T) {
	reg := buildAdapterRegistry(config{
		ClaudeCodePath: "claude",
		AgentModel:     "sonnet",
	})
	if reg == nil {
		t.Fatal("buildAdapterRegistry should not return nil")
	}
	a, ok := reg.Get("claude-code")
	if !ok {
		t.Fatal("claude-code adapter should be registered")
	}
	if a.Metadata().ID != "claude-code" {
		t.Fatalf("adapter ID = %q, want claude-code", a.Metadata().ID)
	}
}

func TestBuildAdapterRegistryWithCodex(t *testing.T) {
	reg := buildAdapterRegistry(config{
		CodexPath: "codex",
	})
	if reg == nil {
		t.Fatal("buildAdapterRegistry should not return nil")
	}
	a, ok := reg.Get("codex")
	if !ok {
		t.Fatal("codex adapter should be registered")
	}
	if a.Metadata().ID != "codex" {
		t.Fatalf("adapter ID = %q, want codex", a.Metadata().ID)
	}
}

func TestBuildAdapterRegistryWithOpenCode(t *testing.T) {
	reg := buildAdapterRegistry(config{
		OpenCodePath: "opencode",
	})
	if reg == nil {
		t.Fatal("buildAdapterRegistry should not return nil")
	}
	a, ok := reg.Get("opencode")
	if !ok {
		t.Fatal("opencode adapter should be registered")
	}
	if a.Metadata().ID != "opencode" {
		t.Fatalf("adapter ID = %q, want opencode", a.Metadata().ID)
	}
}

func TestBuildAdapterRegistryAllAdapters(t *testing.T) {
	reg := buildAdapterRegistry(config{
		ClaudeCodePath: "claude",
		CodexPath:      "codex",
		OpenCodePath:   "opencode",
	})
	adapters := reg.List()
	if len(adapters) != 3 {
		t.Fatalf("expected 3 adapters, got %d", len(adapters))
	}
}

// --- applyRunnerProfile additional profile tests ---

func TestBuildConfigRunnerProfileAppliesCodexPreset(t *testing.T) {
	cfg, err := buildConfig([]string{"--runner-profile", "codex"})
	if err != nil {
		t.Fatalf("buildConfig returned error: %v", err)
	}

	if cfg.RunnerCommand != "codex" {
		t.Fatalf("RunnerCommand = %q, want codex", cfg.RunnerCommand)
	}
	if cfg.AgentDefault != "codex" {
		t.Fatalf("AgentDefault = %q, want codex", cfg.AgentDefault)
	}
}

func TestBuildConfigRunnerProfileAppliesOpenCodePreset(t *testing.T) {
	cfg, err := buildConfig([]string{"--runner-profile", "opencode"})
	if err != nil {
		t.Fatalf("buildConfig returned error: %v", err)
	}

	if cfg.RunnerCommand != "opencode" {
		t.Fatalf("RunnerCommand = %q, want opencode", cfg.RunnerCommand)
	}
	if cfg.AgentDefault != "opencode" {
		t.Fatalf("AgentDefault = %q, want opencode", cfg.AgentDefault)
	}
}

func TestBuildConfigRunnerProfileCodexPreservesCommandOverride(t *testing.T) {
	cfg, err := buildConfig([]string{
		"--runner-profile", "codex",
		"--runner-command", "custom-codex",
		"--agent-default", "custom-agent",
	})
	if err != nil {
		t.Fatalf("buildConfig returned error: %v", err)
	}

	if cfg.RunnerCommand != "custom-codex" {
		t.Fatalf("RunnerCommand = %q, want custom-codex", cfg.RunnerCommand)
	}
	if cfg.AgentDefault != "custom-agent" {
		t.Fatalf("AgentDefault = %q, want custom-agent", cfg.AgentDefault)
	}
}

func TestBuildConfigRunnerProfileOpenCodePreservesCommandOverride(t *testing.T) {
	cfg, err := buildConfig([]string{
		"--runner-profile", "opencode",
		"--runner-command", "custom-opencode",
		"--agent-default", "custom-agent",
	})
	if err != nil {
		t.Fatalf("buildConfig returned error: %v", err)
	}

	if cfg.RunnerCommand != "custom-opencode" {
		t.Fatalf("RunnerCommand = %q, want custom-opencode", cfg.RunnerCommand)
	}
	if cfg.AgentDefault != "custom-agent" {
		t.Fatalf("AgentDefault = %q, want custom-agent", cfg.AgentDefault)
	}
}

func TestRepeatedString(t *testing.T) {
	var rs repeatedString
	if rs.String() != "[]" {
		t.Fatalf("String() = %q, want []", rs.String())
	}

	if err := rs.Set("first"); err != nil {
		t.Fatalf("Set: %v", err)
	}
	if err := rs.Set("second"); err != nil {
		t.Fatalf("Set: %v", err)
	}

	if got := rs.String(); got != "[first second]" {
		t.Fatalf("String() = %q, want [first second]", got)
	}

	if len(rs) != 2 {
		t.Fatalf("len = %d, want 2", len(rs))
	}
	if rs[0] != "first" || rs[1] != "second" {
		t.Fatalf("values = %v, want [first second]", []string(rs))
	}
}

func TestBuildConfigAgentFlags(t *testing.T) {
	cfg, err := buildConfig([]string{
		"--claude-code-path", "/usr/local/bin/claude",
		"--codex-path", "/usr/local/bin/codex",
		"--opencode-path", "/usr/local/bin/opencode",
		"--agent-model", "claude-sonnet-4-6",
		"--agent-default", "claude-code",
	})
	if err != nil {
		t.Fatalf("buildConfig returned error: %v", err)
	}

	if cfg.ClaudeCodePath != "/usr/local/bin/claude" {
		t.Fatalf("ClaudeCodePath = %q", cfg.ClaudeCodePath)
	}
	if cfg.CodexPath != "/usr/local/bin/codex" {
		t.Fatalf("CodexPath = %q", cfg.CodexPath)
	}
	if cfg.OpenCodePath != "/usr/local/bin/opencode" {
		t.Fatalf("OpenCodePath = %q", cfg.OpenCodePath)
	}
	if cfg.AgentModel != "claude-sonnet-4-6" {
		t.Fatalf("AgentModel = %q", cfg.AgentModel)
	}
	if cfg.AgentDefault != "claude-code" {
		t.Fatalf("AgentDefault = %q", cfg.AgentDefault)
	}
}

// --- Environment variable fallback tests ---

func TestBuildConfigEnvVarAddr(t *testing.T) {
	t.Setenv("AGENTHUB_ADDR", "127.0.0.1:4321")
	cfg, err := buildConfig(nil)
	if err != nil {
		t.Fatalf("buildConfig returned error: %v", err)
	}
	if cfg.Addr != "127.0.0.1:4321" {
		t.Fatalf("Addr = %q, want 127.0.0.1:4321 from env", cfg.Addr)
	}
}

func TestBuildConfigRejectsNonLoopbackAddr(t *testing.T) {
	tests := []struct {
		name string
		args []string
		env  string
	}{
		{"flag wildcard", []string{"--addr", ":4321"}, ""},
		{"env wildcard", nil, ":4321"},
		{"ipv4 wildcard", []string{"--addr", "0.0.0.0:4321"}, ""},
		{"ipv6 wildcard", []string{"--addr", "[::]:4321"}, ""},
		{"lan ip", []string{"--addr", "192.168.1.10:4321"}, ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.env != "" {
				t.Setenv("AGENTHUB_ADDR", tt.env)
			}
			if _, err := buildConfig(tt.args); err == nil {
				t.Fatalf("buildConfig(%v) returned nil error", tt.args)
			}
		})
	}
}

func TestBuildConfigEnvVarStoreFile(t *testing.T) {
	t.Setenv("AGENTHUB_STORE_FILE", "env-store.json")
	cfg, err := buildConfig(nil)
	if err != nil {
		t.Fatalf("buildConfig returned error: %v", err)
	}
	if cfg.StoreFile != "env-store.json" {
		t.Fatalf("StoreFile = %q, want env-store.json from env", cfg.StoreFile)
	}
}

func TestBuildConfigEnvVarRunnerProfile(t *testing.T) {
	t.Setenv("AGENTHUB_RUNNER_PROFILE", "claude-code")
	cfg, err := buildConfig(nil)
	if err != nil {
		t.Fatalf("buildConfig returned error: %v", err)
	}
	if cfg.RunnerCommand != "claude" {
		t.Fatalf("RunnerCommand = %q, want claude from claude-code profile via env", cfg.RunnerCommand)
	}
	if cfg.AgentDefault != "claude-code" {
		t.Fatalf("AgentDefault = %q, want claude-code from env profile", cfg.AgentDefault)
	}
}

func TestBuildConfigEnvVarRunnerCommand(t *testing.T) {
	t.Setenv("AGENTHUB_RUNNER_COMMAND", "my-runner")
	t.Setenv("AGENTHUB_RUNNER_WORKDIR", "my-workspace")
	cfg, err := buildConfig(nil)
	if err != nil {
		t.Fatalf("buildConfig returned error: %v", err)
	}
	if cfg.RunnerCommand != "my-runner" {
		t.Fatalf("RunnerCommand = %q, want my-runner from env", cfg.RunnerCommand)
	}
	if cfg.RunnerWorkDir != "my-workspace" {
		t.Fatalf("RunnerWorkDir = %q, want my-workspace from env", cfg.RunnerWorkDir)
	}
}

func TestBuildConfigEnvVarAgentFlags(t *testing.T) {
	t.Setenv("AGENTHUB_CLAUDE_CODE_PATH", "/env/claude")
	t.Setenv("AGENTHUB_CODEX_PATH", "/env/codex")
	t.Setenv("AGENTHUB_OPENCODE_PATH", "/env/opencode")
	t.Setenv("AGENTHUB_AGENT_MODEL", "env-model")
	t.Setenv("AGENTHUB_AGENT_DEFAULT", "codex")
	cfg, err := buildConfig(nil)
	if err != nil {
		t.Fatalf("buildConfig returned error: %v", err)
	}
	if cfg.ClaudeCodePath != "/env/claude" {
		t.Fatalf("ClaudeCodePath = %q, want /env/claude", cfg.ClaudeCodePath)
	}
	if cfg.CodexPath != "/env/codex" {
		t.Fatalf("CodexPath = %q, want /env/codex", cfg.CodexPath)
	}
	if cfg.OpenCodePath != "/env/opencode" {
		t.Fatalf("OpenCodePath = %q, want /env/opencode", cfg.OpenCodePath)
	}
	if cfg.AgentModel != "env-model" {
		t.Fatalf("AgentModel = %q, want env-model", cfg.AgentModel)
	}
	if cfg.AgentDefault != "codex" {
		t.Fatalf("AgentDefault = %q, want codex", cfg.AgentDefault)
	}
}

func TestBuildConfigParsesLocalAuthTokenFromFlag(t *testing.T) {
	cfg, err := buildConfig([]string{"--local-auth-token", " edge-secret "})
	if err != nil {
		t.Fatalf("buildConfig returned error: %v", err)
	}
	if cfg.LocalAuthToken != "edge-secret" {
		t.Fatalf("LocalAuthToken = %q, want trimmed token", cfg.LocalAuthToken)
	}
}

func TestBuildConfigEnvVarLocalAuthToken(t *testing.T) {
	t.Setenv("AGENTHUB_EDGE_AUTH_TOKEN", "env-edge-secret")
	cfg, err := buildConfig(nil)
	if err != nil {
		t.Fatalf("buildConfig returned error: %v", err)
	}
	if cfg.LocalAuthToken != "env-edge-secret" {
		t.Fatalf("LocalAuthToken = %q, want env token", cfg.LocalAuthToken)
	}
}

func TestBuildConfigFlagOverridesEnvVar(t *testing.T) {
	t.Setenv("AGENTHUB_ADDR", "127.0.0.1:9999")
	cfg, err := buildConfig([]string{"--addr", "127.0.0.1:4321"})
	if err != nil {
		t.Fatalf("buildConfig returned error: %v", err)
	}
	if cfg.Addr != "127.0.0.1:4321" {
		t.Fatalf("Addr = %q, want 127.0.0.1:4321 (flag should override env)", cfg.Addr)
	}
}

func TestBuildConfigEnvVarDefaultWhenNotSet(t *testing.T) {
	// No env vars set -- defaults should apply
	cfg, err := buildConfig(nil)
	if err != nil {
		t.Fatalf("buildConfig returned error: %v", err)
	}
	if cfg.Addr != "127.0.0.1:3210" {
		t.Fatalf("Addr = %q, want 127.0.0.1:3210", cfg.Addr)
	}
	if cfg.ClaudeCodePath != "claude" {
		t.Fatalf("ClaudeCodePath = %q, want claude", cfg.ClaudeCodePath)
	}
	if cfg.CodexPath != "codex" {
		t.Fatalf("CodexPath = %q, want codex", cfg.CodexPath)
	}
	if cfg.OpenCodePath != "opencode" {
		t.Fatalf("OpenCodePath = %q, want opencode", cfg.OpenCodePath)
	}
}

func TestBuildConfigEnvVarEmptyStringNotUsed(t *testing.T) {
	// Empty env var should fall through to default
	t.Setenv("AGENTHUB_ADDR", "")
	t.Setenv("AGENTHUB_STORE_FILE", "")
	cfg, err := buildConfig(nil)
	if err != nil {
		t.Fatalf("buildConfig returned error: %v", err)
	}
	if cfg.Addr != "127.0.0.1:3210" {
		t.Fatalf("Addr = %q, want default when env is empty", cfg.Addr)
	}
	if cfg.StoreFile != "" {
		t.Fatalf("StoreFile = %q, want empty when env is empty", cfg.StoreFile)
	}
}
