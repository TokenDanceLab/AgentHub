package lifecycle

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// EvidenceGateConfig holds configuration for the evidence gate subsystem.
type EvidenceGateConfig struct {
	// Enabled controls whether evidence gating is active. Defaults to true
	// via AGENTHUB_EVIDENCE_GATE_ENABLED env var (case-insensitive "false"/"0"/"no"/"off" disables).
	Enabled bool
}

// EvidenceGateConfigFromEnv reads evidence gate configuration from environment variables.
func EvidenceGateConfigFromEnv() EvidenceGateConfig {
	cfg := EvidenceGateConfig{Enabled: true}
	if v := strings.ToLower(strings.TrimSpace(os.Getenv("AGENTHUB_EVIDENCE_GATE_ENABLED"))); v == "false" || v == "0" || v == "no" || v == "off" {
		cfg.Enabled = false
	}
	return cfg
}

// EvidenceGateCheck represents a single verification check.
type EvidenceGateCheck struct {
	Name    string `json:"name"`
	Command string `json:"command"`
	Passed  bool   `json:"passed"`
	Output  string `json:"output,omitempty"`
	Error   string `json:"error,omitempty"`
}

// EvidenceGateResult holds the complete evidence gate verification result.
type EvidenceGateResult struct {
	Passed      bool                `json:"passed"`
	ProjectType string              `json:"projectType"`
	Checks      []EvidenceGateCheck `json:"checks"`
	Summary     string              `json:"summary,omitempty"`
}

// evidenceCheckTimeout is the maximum time a single evidence check may run.
const evidenceCheckTimeout = 2 * time.Minute

// projectTypeDetectable identifies project type from workDir contents.
type projectTypeDetectable string

const (
	projectTypeGo         projectTypeDetectable = "go"
	projectTypeTypeScript projectTypeDetectable = "typescript"
	projectTypeGeneric    projectTypeDetectable = "generic"
)

// detectProjectType inspects the workDir and returns the likely project type.
func detectProjectType(workDir string) projectTypeDetectable {
	if workDir == "" {
		return projectTypeGeneric
	}

	// Go projects: look for go.mod
	if _, err := os.Stat(filepath.Join(workDir, "go.mod")); err == nil {
		return projectTypeGo
	}

	// TypeScript projects: look for package.json + pnpm-lock.yaml or tsconfig.json
	hasPackageJSON := false
	if _, err := os.Stat(filepath.Join(workDir, "package.json")); err == nil {
		hasPackageJSON = true
	}
	if hasPackageJSON {
		if _, err := os.Stat(filepath.Join(workDir, "pnpm-lock.yaml")); err == nil {
			return projectTypeTypeScript
		}
		if _, err := os.Stat(filepath.Join(workDir, "tsconfig.json")); err == nil {
			return projectTypeTypeScript
		}
	}

	return projectTypeGeneric
}

// isEvidenceGateEnabledForRun returns true when evidence gating is active for the given run.
// Evidence gating is skipped when the run has no workDir (standalone agent runs).
func isEvidenceGateEnabledForRun(cfg EvidenceGateConfig, workDir string) bool {
	if !cfg.Enabled {
		return false
	}
	if workDir == "" {
		return false
	}
	return true
}

// runEvidenceGate executes verification commands based on project type and
// returns the full EvidenceGateResult. This function is designed to be called
// from the process executor's run loop before marking a run as finished.
func runEvidenceGate(workDir string) EvidenceGateResult {
	pt := detectProjectType(workDir)
	result := EvidenceGateResult{
		Passed:      true,
		ProjectType: string(pt),
	}

	switch pt {
	case projectTypeGo:
		result.Checks = runGoEvidenceChecks(workDir)
	case projectTypeTypeScript:
		result.Checks = runTypeScriptEvidenceChecks(workDir)
	case projectTypeGeneric:
		result.Checks = runGenericEvidenceChecks(workDir)
	default:
		result.Checks = runGenericEvidenceChecks(workDir)
	}

	for _, check := range result.Checks {
		if !check.Passed {
			result.Passed = false
			break
		}
	}

	if !result.Passed {
		result.Summary = "Evidence gate verification failed — run marked as completed_with_issues"
	} else {
		result.Summary = "Evidence gate verification passed"
	}

	return result
}

// runGoEvidenceChecks runs go build and go vet against the workDir.
func runGoEvidenceChecks(workDir string) []EvidenceGateCheck {
	checks := make([]EvidenceGateCheck, 0, 2)

	// go build ./...
	buildCheck := runEvidenceCheck("go build ./...", workDir, "go", "build", "./...")
	checks = append(checks, buildCheck)

	// go vet ./...
	vetCheck := runEvidenceCheck("go vet ./...", workDir, "go", "vet", "./...")
	checks = append(checks, vetCheck)

	return checks
}

// runTypeScriptEvidenceChecks runs pnpm typecheck (or tsc --noEmit) and pnpm test.
func runTypeScriptEvidenceChecks(workDir string) []EvidenceGateCheck {
	checks := make([]EvidenceGateCheck, 0, 2)

	// pnpm typecheck — try pnpm typecheck first, fall back to npx tsc --noEmit
	typecheckCheck := runEvidenceCheck("pnpm typecheck", workDir, "pnpm", "typecheck")
	if !typecheckCheck.Passed {
		// Fall back to tsc --noEmit if pnpm typecheck script doesn't exist
		typecheckCheck = runEvidenceCheck("npx tsc --noEmit", workDir, "npx", "tsc", "--noEmit")
		typecheckCheck.Name = "typecheck (tsc --noEmit)"
	}
	checks = append(checks, typecheckCheck)

	// pnpm test
	testCheck := runEvidenceCheck("pnpm test", workDir, "pnpm", "test")
	checks = append(checks, testCheck)

	return checks
}

// runGenericEvidenceChecks verifies that key project files exist.
func runGenericEvidenceChecks(workDir string) []EvidenceGateCheck {
	checks := make([]EvidenceGateCheck, 0, 4)

	keyFiles := []string{
		"README.md",
		"readme.md",
		"README",
		"main.go",
		"index.js",
		"index.ts",
		"src/index.ts",
		"src/main.go",
		"requirements.txt",
		"pyproject.toml",
		"Cargo.toml",
		"CMakeLists.txt",
		"Makefile",
		"Dockerfile",
		"package.json",
		"go.mod",
	}

	foundAny := false
	for _, file := range keyFiles {
		path := filepath.Join(workDir, file)
		info, err := os.Stat(path)
		if err != nil {
			continue
		}
		if info.IsDir() {
			continue
		}
		foundAny = true
		checks = append(checks, EvidenceGateCheck{
			Name:    fmt.Sprintf("file_exists: %s", file),
			Command: fmt.Sprintf("stat %s", file),
			Passed:  true,
			Output:  fmt.Sprintf("Found: %s (%d bytes)", file, info.Size()),
		})
	}

	if !foundAny {
		// If no key files found, list the directory contents as evidence
		entries, err := os.ReadDir(workDir)
		if err == nil && len(entries) > 0 {
			var names []string
			for _, e := range entries {
				names = append(names, e.Name())
				if len(names) >= 10 {
					break
				}
			}
			checks = append(checks, EvidenceGateCheck{
				Name:    "directory_not_empty",
				Command: "ls",
				Passed:  true,
				Output:  fmt.Sprintf("Directory contents (first 10): %s", strings.Join(names, ", ")),
			})
		} else {
			checks = append(checks, EvidenceGateCheck{
				Name:    "directory_not_empty",
				Command: "ls",
				Passed:  false,
				Error:   "No recognizable project files found and directory is empty",
			})
		}
	}

	return checks
}

// runEvidenceCheck executes a single command with a timeout and returns the result.
func runEvidenceCheck(name, workDir string, command string, args ...string) EvidenceGateCheck {
	check := EvidenceGateCheck{
		Name:    name,
		Command: fmt.Sprintf("%s %s", command, strings.Join(args, " ")),
	}

	ctx, cancel := context.WithTimeout(context.Background(), evidenceCheckTimeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, command, args...)
	cmd.Dir = workDir
	cmd.Env = os.Environ()

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := cmd.Run()
	if err != nil {
		check.Passed = false
		combined := strings.TrimSpace(stdout.String() + "\n" + stderr.String())
		check.Output = strings.TrimSpace(combined)
		if ctx.Err() != nil {
			check.Error = fmt.Sprintf("timed out after %s", evidenceCheckTimeout)
		} else {
			check.Error = fmt.Sprintf("command failed: %v", err)
		}
		return check
	}

	check.Passed = true
	check.Output = strings.TrimSpace(stdout.String())
	return check
}

// evidenceGateResultJSON serializes the evidence gate result to JSON.
func evidenceGateResultJSON(result EvidenceGateResult) string {
	data, err := json.Marshal(result)
	if err != nil {
		return `{"passed":false,"projectType":"unknown","checks":[],"summary":"failed to marshal result"}`
	}
	return string(data)
}
