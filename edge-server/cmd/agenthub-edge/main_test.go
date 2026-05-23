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

	fileStore.CreateProject("proj_test", "Test Project")
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
