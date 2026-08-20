package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/agenthub/edge-server/internal/adapters/sdk"
)

func TestBuildConfigAcceptsRuntimeManifestFlag(t *testing.T) {
	cfg, err := buildConfig([]string{
		"--runtime-manifest", "custom-runtime.json",
		"--runtime-manifest", "other-runtime.json",
	})
	if err != nil {
		t.Fatalf("buildConfig: %v", err)
	}
	if got := []string(cfg.RuntimeManifests); len(got) != 2 || got[0] != "custom-runtime.json" || got[1] != "other-runtime.json" {
		t.Fatalf("RuntimeManifests = %#v", got)
	}
}

func TestRuntimeManifestFixtureReplayRequested(t *testing.T) {
	if !runtimeManifestFixtureReplayRequested([]string{sdk.RuntimeManifestFixtureReplayFlag}) {
		t.Fatal("fixture replay flag should request harmless replay mode")
	}
	if runtimeManifestFixtureReplayRequested([]string{sdk.RuntimeManifestFixtureReplayFlag, "--extra"}) {
		t.Fatal("fixture replay mode should only accept the exact replay flag")
	}
	if runtimeManifestFixtureReplayRequested([]string{"--runtime-manifest", "runtime.json"}) {
		t.Fatal("normal edge flags should not request fixture replay mode")
	}
}

func TestBuildAdapterRegistryRegistersRuntimeManifest(t *testing.T) {
	dir := t.TempDir()
	success := true
	fixturePath := filepath.Join(dir, "fixture.json")
	fixture := sdk.SDKFixtureStream{
		Provider: "custom-runtime-fixture",
		Events: []sdk.SDKFixtureEvent{
			{ID: "evt_result", Type: "terminal_result", Success: &success, Summary: "fixture complete"},
		},
	}
	fixtureBytes, err := json.Marshal(fixture)
	if err != nil {
		t.Fatalf("marshal fixture: %v", err)
	}
	if err := os.WriteFile(fixturePath, fixtureBytes, 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}

	manifestPath := filepath.Join(dir, "runtime.json")
	manifest := map[string]any{
		"schema":  sdk.RuntimeManifestV1Schema,
		"id":      "custom-fixture",
		"name":    "Custom Fixture",
		"kind":    "custom",
		"command": "fixture-runner",
		"fixture": map[string]any{
			"type": "fixture-file",
			"path": fixturePath,
		},
	}
	manifestBytes, err := json.Marshal(manifest)
	if err != nil {
		t.Fatalf("marshal manifest: %v", err)
	}
	if err := os.WriteFile(manifestPath, manifestBytes, 0o600); err != nil {
		t.Fatalf("write manifest: %v", err)
	}

	reg := buildAdapterRegistry(config{RuntimeManifests: repeatedString{manifestPath}, AgentDefault: "custom-fixture"})
	adapter, ok := reg.Get("custom-fixture")
	if !ok {
		t.Fatal("custom runtime manifest adapter was not registered")
	}
	if adapter.Metadata().Name != "Custom Fixture" {
		t.Fatalf("metadata = %#v", adapter.Metadata())
	}
	resolved, err := reg.Resolve("")
	if err != nil {
		t.Fatalf("Resolve default: %v", err)
	}
	if resolved.Metadata().ID != "custom-fixture" {
		t.Fatalf("default adapter = %q", resolved.Metadata().ID)
	}
}
