package lifecycle

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/agenthub/edge-server/internal/adapters/sdk"
)

func TestProcessExecutorHelperRunsFromModeArgument(t *testing.T) {
	cmd := exec.Command(os.Args[0], processExecutorHelperRunFlag, "--", "success")
	cmd.Env = withoutEnvKey(os.Environ(), "AGENTHUB_PROCESS_EXECUTOR_HELPER")
	cmd.Env = append(cmd.Env,
		"AGENTHUB_RUN_ID=run_helper",
		"AGENTHUB_PROJECT_ID=proj_helper",
		"AGENTHUB_THREAD_ID=thread_helper",
	)

	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("helper command returned error: %v\n%s", err, output)
	}
	text := string(output)
	for _, want := range []string{
		"stdout chunk",
		"stderr chunk",
		"run=run_helper",
		"project=proj_helper",
		"thread=thread_helper",
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("helper output = %q, want %q", text, want)
		}
	}
}

func withoutEnvKey(env []string, key string) []string {
	filtered := make([]string, 0, len(env))
	for _, kv := range env {
		name, _, _ := strings.Cut(kv, "=")
		if strings.EqualFold(name, key) {
			continue
		}
		filtered = append(filtered, kv)
	}
	return filtered
}

func TestProcessExecutorHelper(t *testing.T) {
	mode, ok := processExecutorHelperMode()
	if !ok {
		return
	}
	switch mode {
	case "success":
		fmt.Fprintf(
			os.Stdout,
			"stdout chunk\nrun=%s\nproject=%s\nthread=%s\n",
			os.Getenv("AGENTHUB_RUN_ID"),
			os.Getenv("AGENTHUB_PROJECT_ID"),
			os.Getenv("AGENTHUB_THREAD_ID"),
		)
		fmt.Fprint(os.Stderr, "stderr chunk\n")
	case "fail":
		fmt.Fprint(os.Stderr, "failure chunk\n")
		os.Exit(7)
	case "sleep":
		time.Sleep(5 * time.Second)
	case "stdin-read":
		buf := make([]byte, 1024)
		_, err := os.Stdin.Read(buf)
		if err != nil {
			fmt.Fprintf(os.Stderr, "stdin read error: %v\n", err)
			os.Exit(1)
		}
		fmt.Fprintf(os.Stdout, "stdin-ok\n")
	case "pwd":
		cwd, err := os.Getwd()
		if err != nil {
			fmt.Fprintf(os.Stderr, "getwd: %v\n", err)
			os.Exit(3)
		}
		fmt.Fprintf(os.Stdout, "cwd=%s\n", filepath.Clean(cwd))
	case "args":
		fmt.Fprintf(os.Stdout, "args=%s\n", strings.Join(os.Args, "\n"))
	case "env":
		fmt.Fprintf(
			os.Stdout,
			"profileRun=%s\nprofileProject=%s\nprofileThread=%s\n",
			os.Getenv("PROFILE_RUN"),
			os.Getenv("PROFILE_PROJECT"),
			os.Getenv("PROFILE_THREAD"),
		)
	case "inherited-env":
		fmt.Fprintf(os.Stdout, "inherited=%s\n", os.Getenv("AGENTHUB_INHERITED_ENV_FOR_TEST"))
	case "sanitized-env":
		path := os.Getenv("PATH")
		if path == "" {
			fmt.Fprint(os.Stderr, "PATH not inherited (whitelisted var missing)\n")
			os.Exit(1)
		}
		fmt.Fprintf(os.Stdout, "sanitizedPath=%s\n", path)
		randomSecret := os.Getenv("RANDOM_TEST_SECRET_TOKEN")
		if randomSecret != "" {
			fmt.Fprintf(os.Stdout, "randomSecret=%s\n", randomSecret)
		}
		if helper := os.Getenv("AGENTHUB_TEST_EXTRA_ENV"); helper != "" {
			fmt.Fprintf(os.Stdout, "testExtraEnv=%s\n", helper)
		}
		if token := os.Getenv("AGENTHUB_EDGE_AUTH_TOKEN"); token != "" {
			fmt.Fprintf(os.Stdout, "edgeAuthToken=%s\n", token)
		}
		if secret := os.Getenv("AGENTHUB_JWT_SECRET"); secret != "" {
			fmt.Fprintf(os.Stdout, "jwtSecret=%s\n", secret)
		}
		if password := os.Getenv("AGENTHUB_DB_PASSWORD"); password != "" {
			fmt.Fprintf(os.Stdout, "dbPassword=%s\n", password)
		}
	case "sdk-fixture-json":
		success := true
		stream := sdk.SDKFixtureStream{
			Provider: "opencode-agent-sdk-fixture",
			Events: []sdk.SDKFixtureEvent{
				{
					ID:             "fixture_session_1",
					Type:           "sidecar_session_ready",
					SessionID:      "fixture_session_1",
					Model:          "opencode/gpt-5.1-fixture",
					PermissionMode: "approval-required",
					Tools:          []string{"read", "bash"},
				},
				{
					ID:        "fixture_tool_1",
					Type:      "tool_state",
					SessionID: "fixture_session_1",
					CallID:    "call_read",
					ToolName:  "read",
					Status:    "running",
					Input:     map[string]any{"path": "README.md"},
				},
				{
					ID:        "fixture_permission_1",
					Type:      "permission.asked",
					RequestID: "perm_fixture_shell",
					CallID:    "call_shell",
					ToolName:  "bash",
					RiskLevel: "high",
					Reason:    "fixture shell approval",
					Input:     map[string]any{"command": "go test ./internal/adapters -short -count=1"},
				},
				{
					ID:        "fixture_result_1",
					Type:      "run_result",
					SessionID: "fixture_session_1",
					Success:   &success,
					Summary:   "Fixture SDK stream completed.",
				},
			},
		}
		data, err := json.Marshal(stream)
		if err != nil {
			fmt.Fprintf(os.Stderr, "marshal fixture stream: %v\n", err)
			os.Exit(4)
		}
		fmt.Fprintln(os.Stdout, string(data))
	case "sdk-fixture-runner-contract-json":
		success := true
		stream := sdk.SDKFixtureStream{
			Provider: "agenthub-runner-process-fixture",
			Events: []sdk.SDKFixtureEvent{
				{
					ID:             "runner_session_1",
					Type:           "sidecar_session_ready",
					SessionID:      "runner_session_1",
					Model:          "fixture/model",
					PermissionMode: "approval-required",
					Tools:          []string{"read", "write", "bash"},
				},
				{
					ID:        "runner_text_1",
					Type:      "text_block",
					SessionID: "runner_session_1",
					Content:   "runner transcript fixture api_key=sk-fixture-runner-123456 path=D:\\private\\notes.md",
				},
				{
					ID:           "runner_task_1",
					Type:         "task_progress",
					TaskID:       "task_runner_fixture",
					Status:       "running",
					Description:  "normalize fixture process stream",
					LastToolName: "write",
					Percent:      50,
				},
				{
					ID:           "runner_route_1",
					Type:         "route_suggestion",
					Action:       "delegate",
					NextWorker:   "edge-fixture-adapter-runner",
					Instructions: "continue fixture-only contract validation",
					Reason:       "approval and artifact evidence ready",
				},
				{
					ID:        "runner_permission_1",
					Type:      "permission.asked",
					RequestID: "perm_runner_write",
					CallID:    "call_write_fixture",
					ToolName:  "write",
					RiskLevel: "high",
					Reason:    "write action requires approval evidence",
					Input: map[string]any{
						"path":      "C:\\Users\\Example\\private\\fixture.patch",
						"api_token": "sk-fixture-runner-123456",
						"header":    "Authorization: Bearer runner-secret-token",
					},
				},
				{
					ID:       "runner_file_1",
					Type:     "file_change",
					ToolName: "write",
					CallID:   "call_write_fixture",
					Path:     "D:\\private\\fixture.patch",
					Kind:     "modified",
					Diff:     "@@ fixture @@\n-api_key=sk-fixture-runner-123456\n+api_key=[redacted]\n",
				},
				{
					ID:         "runner_artifact_1",
					Type:       "artifact",
					ArtifactID: "artifact_runner_report",
					Path:       "/home/example/private/runner-report.json",
					Kind:       "file",
					SizeBytes:  256,
					Summary:    "runner artifact summary token=sk-fixture-runner-123456",
					Metadata: map[string]any{
						"api_token": "sk-fixture-runner-123456",
					},
				},
				{
					ID:        "runner_result_1",
					Type:      "run_result",
					SessionID: "runner_session_1",
					Success:   &success,
					Summary:   "runner fixture completed with Authorization: Bearer runner-secret-token",
				},
			},
		}
		data, err := json.Marshal(stream)
		if err != nil {
			fmt.Fprintf(os.Stderr, "marshal runner fixture stream: %v\n", err)
			os.Exit(4)
		}
		fmt.Fprintln(os.Stdout, string(data))
	case "sdk-fixture-malformed-json":
		fmt.Fprintln(os.Stdout, `{"provider":"agenthub-runner-process-fixture","events":[`)
		fmt.Fprintln(os.Stdout, `not-json`)
	case "sdk-fixture-error-json":
		stream := sdk.SDKFixtureStream{
			Provider: "agenthub-runner-process-fixture",
			Events: []sdk.SDKFixtureEvent{
				{
					ID:        "error_permission_1",
					Type:      "permission.asked",
					RequestID: "perm_error_fixture",
					ToolName:  "bash",
					RiskLevel: "high",
					Reason:    "fixture error stream approval event",
					Input: map[string]any{
						"command":   "go test ./internal/adapters -run SDKFixture -short -count=1",
						"api_token": "sk-error-fixture-123456",
					},
				},
				{
					ID:     "error_result_1",
					Type:   "error",
					Error:  "runtime failed with api_key=sk-error-fixture-123456",
					Reason: "fixture runtime error",
				},
			},
		}
		data, err := json.Marshal(stream)
		if err != nil {
			fmt.Fprintf(os.Stderr, "marshal error fixture stream: %v\n", err)
			os.Exit(4)
		}
		fmt.Fprintln(os.Stdout, string(data))
	default:
		fmt.Fprintf(os.Stderr, "unknown helper mode %q\n", mode)
		os.Exit(2)
	}
	os.Exit(0)
}

func processExecutorHelperMode() (string, bool) {
	if os.Getenv("AGENTHUB_PROCESS_EXECUTOR_HELPER") != "1" && !hasArg(os.Args, processExecutorHelperRunFlag) {
		return "", false
	}
	if len(os.Args) == 0 {
		return "", false
	}
	return os.Args[len(os.Args)-1], true
}

func hasArg(args []string, want string) bool {
	for _, arg := range args {
		if arg == want {
			return true
		}
	}
	return false
}
