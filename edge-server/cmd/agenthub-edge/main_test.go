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
	if cfg.RunnerCommand != "" {
		t.Fatalf("RunnerCommand = %q, want empty", cfg.RunnerCommand)
	}
	if len(cfg.RunnerArgs) != 0 {
		t.Fatalf("RunnerArgs = %#v, want empty", cfg.RunnerArgs)
	}
}

func TestBuildConfigParsesStoreFile(t *testing.T) {
	cfg, err := buildConfig([]string{
		"--addr", "127.0.0.1:4321",
		"--store-file", "edge-store.json",
		"--runner-command", "agenthub-runner",
		"--runner-arg", "--mock",
		"--runner-arg", "--addr=127.0.0.1:0",
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
	if cfg.RunnerCommand != "agenthub-runner" {
		t.Fatalf("RunnerCommand = %q, want parsed command", cfg.RunnerCommand)
	}
	if got, want := []string(cfg.RunnerArgs), []string{"--mock", "--addr=127.0.0.1:0"}; strings.Join(got, "\x00") != strings.Join(want, "\x00") {
		t.Fatalf("RunnerArgs = %#v, want %#v", got, want)
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
