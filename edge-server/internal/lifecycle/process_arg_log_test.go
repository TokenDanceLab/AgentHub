package lifecycle

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/agenthub/edge-server/internal/events"
	"github.com/agenthub/edge-server/internal/store"
)

func TestSummarizeProcessArgsForLogRedactsValueLikeArgs(t *testing.T) {
	tests := []struct {
		name                    string
		args                    []string
		secrets                 []string
		wantFlags               []string
		wantConfigKeys          []string
		wantUnknownFlagCount    int
		wantRedactedConfigCount int
	}{
		{
			name:                 "codex prompt starting with dash",
			args:                 []string{"exec", "--json", "-SECRET_PROMPT_SHOULD_NOT_APPEAR"},
			secrets:              []string{"SECRET_PROMPT_SHOULD_NOT_APPEAR"},
			wantFlags:            []string{"--json"},
			wantUnknownFlagCount: 1,
		},
		{
			name:      "separator treats later dash tokens as positional",
			args:      []string{"-test.run=^TestProcessExecutorHelper$", "--", "-SECRET_AFTER_SEPARATOR_SHOULD_NOT_APPEAR"},
			secrets:   []string{"SECRET_AFTER_SEPARATOR_SHOULD_NOT_APPEAR"},
			wantFlags: []string{"-test.run"},
		},
		{
			name: "opencode value flags and dash prompt",
			args: []string{
				"run",
				"--thinking",
				"--title", "-SECRET_TITLE_SHOULD_NOT_APPEAR",
				"--session", "-SECRET_SESSION_SHOULD_NOT_APPEAR",
				"-m", "provider/model",
				"-SECRET_PROMPT_SHOULD_NOT_APPEAR",
			},
			secrets:              []string{"SECRET_TITLE_SHOULD_NOT_APPEAR", "SECRET_SESSION_SHOULD_NOT_APPEAR", "SECRET_PROMPT_SHOULD_NOT_APPEAR"},
			wantFlags:            []string{"--thinking", "--title", "--session", "-m"},
			wantUnknownFlagCount: 1,
		},
		{
			name: "codex flags with paths and thinking value",
			args: []string{
				"exec",
				"--skip-git-repo-check",
				"--cd", "C:\\Users\\Example\\secret-workspace",
				"--mcp-config=SECRET_INLINE_MCP_SHOULD_NOT_APPEAR",
				"--thinking", "SECRET_THINKING_SHOULD_NOT_APPEAR",
				"--", "SECRET_PROMPT_SHOULD_NOT_APPEAR",
			},
			secrets:   []string{"SECRET_INLINE_MCP_SHOULD_NOT_APPEAR", "SECRET_THINKING_SHOULD_NOT_APPEAR", "SECRET_PROMPT_SHOULD_NOT_APPEAR"},
			wantFlags: []string{"--skip-git-repo-check", "--cd", "--mcp-config", "--thinking"},
		},
		{
			name: "codex config key only",
			args: []string{
				"exec",
				"-c", "api_key=SECRET_CONFIG_SHOULD_NOT_APPEAR",
				"-c", "SECRET_CONFIG_WITHOUT_EQUALS_SHOULD_NOT_APPEAR",
				"-c", "bad key=SECRET_BAD_KEY_SHOULD_NOT_APPEAR",
			},
			secrets:                 []string{"SECRET_CONFIG_SHOULD_NOT_APPEAR", "SECRET_CONFIG_WITHOUT_EQUALS_SHOULD_NOT_APPEAR", "SECRET_BAD_KEY_SHOULD_NOT_APPEAR"},
			wantFlags:               []string{"-c"},
			wantConfigKeys:          []string{"api_key"},
			wantRedactedConfigCount: 2,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			summary := summarizeProcessArgsForLog(tt.args)
			rendered := fmt.Sprintf("%#v", summary)
			for _, secret := range tt.secrets {
				if strings.Contains(rendered, secret) {
					t.Fatalf("summary leaked %q: %#v", secret, summary)
				}
			}
			for _, flag := range tt.wantFlags {
				if !stringSliceContains(summary.ArgFlags, flag) {
					t.Fatalf("arg flags = %#v, want %q", summary.ArgFlags, flag)
				}
			}
			for _, key := range tt.wantConfigKeys {
				if !stringSliceContains(summary.ConfigKeys, key) {
					t.Fatalf("config keys = %#v, want %q", summary.ConfigKeys, key)
				}
			}
			if summary.UnknownFlagCount != tt.wantUnknownFlagCount {
				t.Fatalf("unknown flag count = %d, want %d (summary %#v)", summary.UnknownFlagCount, tt.wantUnknownFlagCount, summary)
			}
			if summary.RedactedConfigKeyCount != tt.wantRedactedConfigCount {
				t.Fatalf("redacted config key count = %d, want %d (summary %#v)", summary.RedactedConfigKeyCount, tt.wantRedactedConfigCount, summary)
			}
		})
	}
}

func TestProcessExecutorStartLogRedactsRuntimeArgs(t *testing.T) {
	var logs bytes.Buffer
	previousLogger := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&logs, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() {
		slog.SetDefault(previousLogger)
	})

	bus := events.NewBus(100)
	s := store.New()
	run := newExecutorTestRun(t, s)
	_, ch, _ := bus.Subscribe(0)

	secretPrompt := "-SECRET_PROMPT_SHOULD_NOT_APPEAR"
	secretMCP := `{"servers":{"private":{"command":"node","token":"SECRET_MCP_SHOULD_NOT_APPEAR"}}}`
	secretConfig := "api_key=SECRET_CONFIG_SHOULD_NOT_APPEAR"
	executor, err := NewProcessExecutor(bus, s, ProcessExecutorConfig{
		Command: os.Args[0],
		Args: []string{
			processExecutorHelperRunFlag,
			"--",
			"-p", secretPrompt,
			"--mcp-config", secretMCP,
			"-c", secretConfig,
			"success",
		},
		Env: append(os.Environ(), "AGENTHUB_PROCESS_EXECUTOR_HELPER=1"),
	}, nil, nil)
	if err != nil {
		t.Fatalf("NewProcessExecutor returned error: %v", err)
	}

	if err := executor.Start(run, RunProcessContext{}); err != nil {
		t.Fatalf("Start returned error: %v", err)
	}
	_ = collectStdoutUntilFinished(t, ch)

	logText := logs.String()
	for _, secret := range []string{secretPrompt, secretMCP, secretConfig} {
		if strings.Contains(logText, secret) {
			t.Fatalf("subprocess start log leaked runtime arg %q in %s", secret, logText)
		}
	}
	if strings.Contains(logText, os.Args[0]) {
		t.Fatalf("subprocess start log leaked command path %q in %s", os.Args[0], logText)
	}
	if strings.Contains(logText, `"args"`) {
		t.Fatalf("subprocess start log must not include full args field: %s", logText)
	}
	record := parseSlogRecordByMessage(t, logText, "executor.subprocess.starting")
	if _, ok := record["args"]; ok {
		t.Fatalf("subprocess start log must not include full args field: %#v", record)
	}
	if _, ok := record["command"]; ok {
		t.Fatalf("subprocess start log must not include full command path field: %#v", record)
	}
	if got := record["argsRedacted"]; got != true {
		t.Fatalf("argsRedacted = %#v, want true in %#v", got, record)
	}
	if got := record["commandName"]; got != filepath.Base(os.Args[0]) {
		t.Fatalf("commandName = %#v, want %q in %#v", got, filepath.Base(os.Args[0]), record)
	}
	if got := record["commandRedacted"]; got != true {
		t.Fatalf("commandRedacted = %#v, want true in %#v", got, record)
	}
	for _, key := range []string{"argCount", "argFlags", "configKeys", "positionalArgCount", "unknownFlagCount", "redactedConfigKeyCount"} {
		if _, ok := record[key]; !ok {
			t.Fatalf("subprocess start log missing %q in %#v", key, record)
		}
	}
}

func parseSlogRecordByMessage(t *testing.T, text, message string) map[string]any {
	t.Helper()

	for _, line := range strings.Split(strings.TrimSpace(text), "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		var record map[string]any
		if err := json.Unmarshal([]byte(line), &record); err != nil {
			t.Fatalf("parse slog JSON line %q: %v", line, err)
		}
		if record["msg"] == message {
			return record
		}
	}
	t.Fatalf("log message %q not found in %s", message, text)
	return nil
}

func stringSliceContains(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
