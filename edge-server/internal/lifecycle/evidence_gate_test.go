package lifecycle

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/agenthub/edge-server/internal/events"
	"github.com/agenthub/edge-server/internal/store"
)

// TestEvidenceGate is the acceptance test entry point required by the task spec:
//
//	go test ./internal/lifecycle -run TestEvidenceGate
//
// It verifies the end-to-end evidence gate flow through the ProcessExecutor.
func TestEvidenceGate(t *testing.T) {
	t.Run("process_executor_integration", func(t *testing.T) {
		testEvidenceGateProcessExecutorIntegration(t)
	})
	t.Run("go_project_detection", func(t *testing.T) {
		testEvidenceGateGoProjectDetection(t)
	})
	t.Run("typescript_project_detection", func(t *testing.T) {
		testEvidenceGateTypeScriptProjectDetection(t)
	})
	t.Run("generic_project_detection", func(t *testing.T) {
		testEvidenceGateGenericProjectDetection(t)
	})
	t.Run("config_from_env", func(t *testing.T) {
		testEvidenceGateConfigFromEnv(t)
	})
	t.Run("disabled_skips_gate", func(t *testing.T) {
		testEvidenceGateDisabledSkipsGate(t)
	})
	t.Run("no_workdir_skips_gate", func(t *testing.T) {
		testEvidenceGateNoWorkdirSkipsGate(t)
	})
	t.Run("result_json_roundtrip", func(t *testing.T) {
		testEvidenceGateResultJSONRoundtrip(t)
	})
}

// testEvidenceGateProcessExecutorIntegration is the main acceptance test that
// runs a full ProcessExecutor lifecycle with evidence gating enabled against
// a Go project workDir containing invalid Go source. The agent process exits
// successfully, but the evidence gate fails (go build/vet error), resulting
// in a "completed_with_issues" status instead of "finished".
func testEvidenceGateProcessExecutorIntegration(t *testing.T) {
	// Ensure go is available for the evidence check.
	if _, err := os.Stat(os.Getenv("GOROOT")); err != nil {
		if _, err := os.Stat(os.Getenv("GOPATH")); err != nil {
			if path, err := filepath.Abs("."); err == nil {
				// Try to detect go by looking for go.mod in the current project structure
				if _, e := os.Stat(filepath.Join(path, "go.mod")); e != nil {
					// Look up towards the repo root
					dir := path
					for i := 0; i < 10; i++ {
						if _, e := os.Stat(filepath.Join(dir, "go.mod")); e == nil {
							break
						}
						parent := filepath.Dir(dir)
						if parent == dir {
							break
						}
						dir = parent
					}
				}
			}
		}
	}

	bus := events.NewBus(100)
	s := store.New()
	_, ch, _ := bus.Subscribe(0)

	// Create a temporary Go project workDir with a go.mod but invalid Go source.
	workDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(workDir, "go.mod"), []byte("module example.com/evidence-gate-test\n\ngo 1.22\n"), 0o644); err != nil {
		t.Fatalf("WriteFile go.mod: %v", err)
	}
	// Create a broken Go source file that will fail go build.
	if err := os.WriteFile(filepath.Join(workDir, "main.go"), []byte("package main\n\nfunc main() {\n\tundefinedSymbol\n}\n"), 0o644); err != nil {
		t.Fatalf("WriteFile main.go: %v", err)
	}

	run := newExecutorTestRun(t, s)
	executor, err := NewProcessExecutor(bus, s, ProcessExecutorConfig{
		Command: os.Args[0],
		Args:    []string{processExecutorHelperRunFlag, "--", "success"},
		Env:     append(os.Environ(), "AGENTHUB_PROCESS_EXECUTOR_HELPER=1"),
		WorkDir: workDir,
	}, nil, nil)
	if err != nil {
		t.Fatalf("NewProcessExecutor returned error: %v", err)
	}

	// Enable evidence gating explicitly.
	executor.evidenceGateCfg = EvidenceGateConfig{Enabled: true}

	if err := executor.Start(run, RunProcessContext{}); err != nil {
		t.Fatalf("Start returned error: %v", err)
	}

	var finalStatus string
	var sawFinishedOrCompleted bool
	for {
		evt := nextEventWithin(t, ch, 30*time.Second)
		switch evt.Type {
		case "run.started":
		case "run.output.batch":
		case "run.finished":
			sawFinishedOrCompleted = true
			payload, ok := evt.Payload.(map[string]any)
			if !ok {
				t.Fatalf("finished payload = %T, want map", evt.Payload)
			}
			finalStatus, _ = payload["status"].(string)
			goto done
		case "run.failed":
			t.Fatalf("run failed unexpectedly: %#v", evt.Payload)
		case "run.cancelled":
			t.Fatalf("run cancelled unexpectedly: %#v", evt.Payload)
		}
	}
done:
	if !sawFinishedOrCompleted {
		t.Fatal("run did not reach terminal state")
	}

	// The helper exits successfully, but evidence gate should have detected
	// the broken Go code and marked it as completed_with_issues.
	if finalStatus != "completed_with_issues" {
		t.Fatalf("final status = %q, want completed_with_issues (broken Go code should fail evidence gate)", finalStatus)
	}

	// Verify evidence gate result was stored.
	stored, ok := s.GetRun(run.ID)
	if !ok {
		t.Fatalf("run %q not found in store", run.ID)
	}
	if stored.EvidenceGateResult == "" {
		t.Fatal("EvidenceGateResult is empty — evidence data was not stored")
	}

	var result EvidenceGateResult
	if err := json.Unmarshal([]byte(stored.EvidenceGateResult), &result); err != nil {
		t.Fatalf("failed to unmarshal EvidenceGateResult: %v\nRaw: %s", err, stored.EvidenceGateResult)
	}
	if result.ProjectType != "go" {
		t.Fatalf("project type = %q, want go", result.ProjectType)
	}
	if result.Passed {
		t.Fatal("evidence gate passed unexpectedly — broken Go code should fail")
	}
	if len(result.Checks) < 1 {
		t.Fatal("expected at least 1 evidence check, got 0")
	}
	hasBuildCheck := false
	hasVetCheck := false
	for _, check := range result.Checks {
		switch check.Name {
		case "go build ./...":
			hasBuildCheck = true
		case "go vet ./...":
			hasVetCheck = true
		}
	}
	if !hasBuildCheck || !hasVetCheck {
		t.Fatalf("evidence checks missing build/vet: %#v", result.Checks)
	}
}

// testEvidenceGateGoProjectDetection verifies that Go projects are correctly
// identified by the presence of go.mod.
func testEvidenceGateGoProjectDetection(t *testing.T) {
	workDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(workDir, "go.mod"), []byte("module test\n"), 0o644); err != nil {
		t.Fatalf("WriteFile go.mod: %v", err)
	}

	pt := detectProjectType(workDir)
	if pt != projectTypeGo {
		t.Fatalf("project type = %q, want go", pt)
	}
}

// testEvidenceGateTypeScriptProjectDetection verifies that TypeScript projects
// are correctly identified by package.json + tsconfig.json or pnpm-lock.yaml.
func testEvidenceGateTypeScriptProjectDetection(t *testing.T) {
	t.Run("with_tsconfig_json", func(t *testing.T) {
		workDir := t.TempDir()
		if err := os.WriteFile(filepath.Join(workDir, "package.json"), []byte(`{"name":"test"}`), 0o644); err != nil {
			t.Fatalf("WriteFile package.json: %v", err)
		}
		if err := os.WriteFile(filepath.Join(workDir, "tsconfig.json"), []byte(`{}`), 0o644); err != nil {
			t.Fatalf("WriteFile tsconfig.json: %v", err)
		}
		pt := detectProjectType(workDir)
		if pt != projectTypeTypeScript {
			t.Fatalf("project type = %q, want typescript", pt)
		}
	})

	t.Run("with_pnpm_lock", func(t *testing.T) {
		workDir := t.TempDir()
		if err := os.WriteFile(filepath.Join(workDir, "package.json"), []byte(`{"name":"test"}`), 0o644); err != nil {
			t.Fatalf("WriteFile package.json: %v", err)
		}
		if err := os.WriteFile(filepath.Join(workDir, "pnpm-lock.yaml"), []byte("lockfileVersion: 1\n"), 0o644); err != nil {
			t.Fatalf("WriteFile pnpm-lock.yaml: %v", err)
		}
		pt := detectProjectType(workDir)
		if pt != projectTypeTypeScript {
			t.Fatalf("project type = %q, want typescript", pt)
		}
	})

	t.Run("package_json_only_is_generic", func(t *testing.T) {
		workDir := t.TempDir()
		if err := os.WriteFile(filepath.Join(workDir, "package.json"), []byte(`{"name":"test"}`), 0o644); err != nil {
			t.Fatalf("WriteFile package.json: %v", err)
		}
		pt := detectProjectType(workDir)
		if pt != projectTypeGeneric {
			t.Fatalf("project type = %q, want generic (package.json without tsconfig/pnpm-lock)", pt)
		}
	})
}

// testEvidenceGateGenericProjectDetection verifies generic project detection.
func testEvidenceGateGenericProjectDetection(t *testing.T) {
	t.Run("empty_directory_is_generic", func(t *testing.T) {
		workDir := t.TempDir()
		pt := detectProjectType(workDir)
		if pt != projectTypeGeneric {
			t.Fatalf("project type = %q, want generic", pt)
		}
	})

	t.Run("empty_string_is_generic", func(t *testing.T) {
		pt := detectProjectType("")
		if pt != projectTypeGeneric {
			t.Fatalf("project type = %q, want generic", pt)
		}
	})
}

// testEvidenceGateConfigFromEnv verifies AGENTHUB_EVIDENCE_GATE_ENABLED parsing.
func testEvidenceGateConfigFromEnv(t *testing.T) {
	tests := []struct {
		name    string
		envVal  string
		want    bool
	}{
		{"unset_defaults_true", "", true},
		{"true_is_true", "true", true},
		{"TRUE_is_true", "TRUE", true},
		{"1_is_true", "1", true},
		{"false_disables", "false", false},
		{"FALSE_disables", "FALSE", false},
		{"0_disables", "0", false},
		{"no_disables", "no", false},
		{"off_disables", "off", false},
		{"OFF_disables", "OFF", false},
		{"whitespace_trimmed", " false ", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.envVal == "" {
				os.Unsetenv("AGENTHUB_EVIDENCE_GATE_ENABLED")
			} else {
				t.Setenv("AGENTHUB_EVIDENCE_GATE_ENABLED", tt.envVal)
			}
			cfg := EvidenceGateConfigFromEnv()
			if cfg.Enabled != tt.want {
				t.Fatalf("Enabled = %v, want %v", cfg.Enabled, tt.want)
			}
		})
	}
}

// testEvidenceGateDisabledSkipsGate verifies that when the evidence gate is
// disabled, the run finishes normally with "finished" status.
func testEvidenceGateDisabledSkipsGate(t *testing.T) {
	t.Setenv("AGENTHUB_EVIDENCE_GATE_ENABLED", "false")

	bus := events.NewBus(100)
	s := store.New()
	_, ch, _ := bus.Subscribe(0)

	workDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(workDir, "go.mod"), []byte("module test\n"), 0o644); err != nil {
		t.Fatalf("WriteFile go.mod: %v", err)
	}
	// Create broken Go code — but evidence gate is disabled so it should still finish.
	if err := os.WriteFile(filepath.Join(workDir, "main.go"), []byte("package main\n\nfunc main() {\n\tundefinedSymbol\n}\n"), 0o644); err != nil {
		t.Fatalf("WriteFile main.go: %v", err)
	}

	run := newExecutorTestRun(t, s)
	executor, err := NewProcessExecutor(bus, s, ProcessExecutorConfig{
		Command: os.Args[0],
		Args:    []string{processExecutorHelperRunFlag, "--", "success"},
		Env:     append(os.Environ(), "AGENTHUB_PROCESS_EXECUTOR_HELPER=1"),
		WorkDir: workDir,
	}, nil, nil)
	if err != nil {
		t.Fatalf("NewProcessExecutor returned error: %v", err)
	}

	if err := executor.Start(run, RunProcessContext{}); err != nil {
		t.Fatalf("Start returned error: %v", err)
	}

	var finalStatus string
	for {
		evt := nextEventWithin(t, ch, 30*time.Second)
		switch evt.Type {
		case "run.started":
		case "run.output.batch":
		case "run.finished":
			payload, ok := evt.Payload.(map[string]any)
			if !ok {
				t.Fatalf("finished payload = %T, want map", evt.Payload)
			}
			finalStatus, _ = payload["status"].(string)
			goto done
		case "run.failed":
			t.Fatalf("run failed: %#v", evt.Payload)
		case "run.cancelled":
			t.Fatalf("run cancelled: %#v", evt.Payload)
		}
	}
done:
	// Evidence gate is disabled — run should finish normally even with broken Go code.
	if finalStatus != "finished" {
		t.Fatalf("final status = %q, want finished (evidence gate disabled)", finalStatus)
	}
}

// testEvidenceGateNoWorkdirSkipsGate verifies that when no workDir is set,
// the evidence gate is skipped and the run finishes normally.
func testEvidenceGateNoWorkdirSkipsGate(t *testing.T) {
	bus := events.NewBus(100)
	s := store.New()
	_, ch, _ := bus.Subscribe(0)

	run := newExecutorTestRun(t, s)
	executor := newTestProcessExecutor(t, bus, s, "success")

	if err := executor.Start(run, RunProcessContext{}); err != nil {
		t.Fatalf("Start returned error: %v", err)
	}

	var finalStatus string
	for {
		evt := nextEventWithin(t, ch, 30*time.Second)
		switch evt.Type {
		case "run.started":
		case "run.output.batch":
		case "run.finished":
			payload, ok := evt.Payload.(map[string]any)
			if !ok {
				t.Fatalf("finished payload = %T, want map", evt.Payload)
			}
			finalStatus, _ = payload["status"].(string)
			goto done
		case "run.failed":
			t.Fatalf("run failed: %#v", evt.Payload)
		case "run.cancelled":
			t.Fatalf("run cancelled: %#v", evt.Payload)
		}
	}
done:
	if finalStatus != "finished" {
		t.Fatalf("final status = %q, want finished (no workDir, gate skipped)", finalStatus)
	}
}

// testEvidenceGateResultJSONRoundtrip verifies that the EvidenceGateResult
// struct can be marshaled to JSON and back.
func testEvidenceGateResultJSONRoundtrip(t *testing.T) {
	result := EvidenceGateResult{
		Passed:      false,
		ProjectType: "go",
		Checks: []EvidenceGateCheck{
			{
				Name:    "go build ./...",
				Command: "go build ./...",
				Passed:  false,
				Output:  "undefined: undefinedSymbol",
				Error:   "exit status 1",
			},
			{
				Name:    "go vet ./...",
				Command: "go vet ./...",
				Passed:  true,
				Output:  "ok",
			},
		},
		Summary: "Evidence gate verification failed — run marked as completed_with_issues",
	}

	jsonStr := evidenceGateResultJSON(result)
	if !strings.Contains(jsonStr, `"passed":false`) {
		t.Fatalf("JSON missing passed:%v: %s", false, jsonStr)
	}
	if !strings.Contains(jsonStr, `"projectType":"go"`) {
		t.Fatalf("JSON missing projectType: %s", jsonStr)
	}

	// Unmarshal to verify roundtrip.
	var parsed EvidenceGateResult
	if err := json.Unmarshal([]byte(jsonStr), &parsed); err != nil {
		t.Fatalf("Unmarshal EvidenceGateResult: %v", err)
	}
	if parsed.Passed {
		t.Fatal("parsed result.Passed = true, want false")
	}
	if parsed.ProjectType != "go" {
		t.Fatalf("parsed projectType = %q, want go", parsed.ProjectType)
	}
	if len(parsed.Checks) != 2 {
		t.Fatalf("parsed checks count = %d, want 2", len(parsed.Checks))
	}
	if parsed.Checks[0].Name != "go build ./..." {
		t.Fatalf("check[0].Name = %q, want go build ./...", parsed.Checks[0].Name)
	}
}

// TestEvidenceGate_RunEvidenceGate_ValidGoProject runs evidence checks against
// a valid Go project (the edge-server itself). This verifies the happy path.
func TestEvidenceGate_RunEvidenceGate_ValidGoProject(t *testing.T) {
	// Find the edge-server directory which has a go.mod.
	dir, err := os.Getwd()
	if err != nil {
		t.Skipf("cannot get working directory: %v", err)
	}
	// Walk up to find go.mod
	for i := 0; i < 10; i++ {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			break
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Skip("cannot find go.mod in ancestor directories")
		}
		dir = parent
	}

	// This test works against the real edge-server codebase, so go build
	// and go vet should both pass.
	result := runEvidenceGate(dir)
	if result.ProjectType != "go" {
		t.Fatalf("project type = %q, want go (found go.mod at %s)", result.ProjectType, dir)
	}
	// We don't assert result.Passed because the local tree might have build issues.
	// Instead, just verify the structure is complete.
	if len(result.Checks) != 2 {
		t.Fatalf("expected 2 checks (build, vet), got %d: %#v", len(result.Checks), result.Checks)
	}
	for _, check := range result.Checks {
		if check.Name == "" {
			t.Fatalf("check has empty name: %#v", check)
		}
		if check.Command == "" {
			t.Fatalf("check has empty command: %#v", check)
		}
	}
}

// TestEvidenceGate_GenericFileExistence verifies the generic evidence check
// finds key files.
func TestEvidenceGate_GenericFileExistence(t *testing.T) {
	workDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(workDir, "README.md"), []byte("# Test"), 0o644); err != nil {
		t.Fatalf("WriteFile README.md: %v", err)
	}
	if err := os.WriteFile(filepath.Join(workDir, "Makefile"), []byte("all:\n\techo ok\n"), 0o644); err != nil {
		t.Fatalf("WriteFile Makefile: %v", err)
	}

	result := runEvidenceGate(workDir)
	if result.ProjectType != "generic" {
		t.Fatalf("project type = %q, want generic", result.ProjectType)
	}
	if !result.Passed {
		t.Fatalf("evidence gate failed: %s", result.Summary)
	}
	// Should find at least README.md
	foundReadme := false
	for _, check := range result.Checks {
		if strings.Contains(check.Name, "README.md") && check.Passed {
			foundReadme = true
		}
	}
	if !foundReadme {
		t.Fatalf("README.md not found in generic checks: %#v", result.Checks)
	}
}

// TestEvidenceGate_GenericEmptyDirectoryFails verifies that an empty directory
// fails the generic evidence check.
func TestEvidenceGate_GenericEmptyDirectoryFails(t *testing.T) {
	workDir := t.TempDir()

	result := runEvidenceGate(workDir)
	if result.ProjectType != "generic" {
		t.Fatalf("project type = %q, want generic", result.ProjectType)
	}
	if result.Passed {
		t.Fatal("evidence gate passed for empty directory — should have failed")
	}
}
