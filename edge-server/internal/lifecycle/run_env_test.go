package lifecycle

import (
	"bytes"
	"log/slog"
	"strings"
	"testing"

	"github.com/agenthub/edge-server/internal/store"
)

func TestEnvForRun_InjectsAgentHubIDs(t *testing.T) {
	t.Parallel()

	run := store.Run{ID: "run_1", ProjectID: "proj_1", ThreadID: "thread_1"}
	env := envForRun(run, []string{"FOO=bar"}, []string{"EXTRA=1"})

	got := envToMap(env)
	if got["FOO"] != "bar" {
		t.Fatalf("FOO = %q, want bar", got["FOO"])
	}
	if got["EXTRA"] != "1" {
		t.Fatalf("EXTRA = %q, want 1", got["EXTRA"])
	}
	if got["AGENTHUB_RUN_ID"] != "run_1" {
		t.Fatalf("AGENTHUB_RUN_ID = %q", got["AGENTHUB_RUN_ID"])
	}
	if got["AGENTHUB_PROJECT_ID"] != "proj_1" {
		t.Fatalf("AGENTHUB_PROJECT_ID = %q", got["AGENTHUB_PROJECT_ID"])
	}
	if got["AGENTHUB_THREAD_ID"] != "thread_1" {
		t.Fatalf("AGENTHUB_THREAD_ID = %q", got["AGENTHUB_THREAD_ID"])
	}
}

func TestEnvForRun_NilProfileUsesSanitizedBase(t *testing.T) {
	// Not parallel: mutates process environment via t.Setenv.
	t.Setenv("PATH", "/usr/bin")
	t.Setenv("ANTHROPIC_API_KEY", "sk-secret")

	run := store.Run{ID: "run_s", ProjectID: "p", ThreadID: "t"}
	env := envForRun(run, nil, []string{"EXTRA=yes"})
	got := envToMap(env)

	if got["PATH"] != "/usr/bin" {
		t.Fatalf("PATH missing from sanitized env: %v", env)
	}
	if _, ok := got["ANTHROPIC_API_KEY"]; ok {
		t.Fatalf("sensitive key leaked into env: %v", env)
	}
	if got["EXTRA"] != "yes" {
		t.Fatalf("EXTRA = %q", got["EXTRA"])
	}
	if !strings.HasPrefix(got["AGENTHUB_RUN_ID"], "run_") {
		t.Fatalf("AGENTHUB_RUN_ID = %q", got["AGENTHUB_RUN_ID"])
	}
}

func TestEnvForAdapterOrProfile_WarnsSensitiveExtraEnvKeys(t *testing.T) {
	t.Parallel()

	var logs bytes.Buffer
	previousLogger := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&logs, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() {
		slog.SetDefault(previousLogger)
	})

	run := store.Run{ID: "run_warn", ProjectID: "p", ThreadID: "t"}
	extraEnv := []string{"ANTHROPIC_API_KEY=sk-secret", "SAFE_VAR=ok", "OPENAI_API_KEY=sk-also-secret"}
	_ = envForAdapterOrProfile(run, true, nil, extraEnv)

	logText := logs.String()
	// Must warn for each sensitive key (only key name, never value).
	for _, key := range []string{"ANTHROPIC_API_KEY", "OPENAI_API_KEY"} {
		if !strings.Contains(logText, `"key":"`+key+`"`) {
			t.Fatalf("expected warn for sensitive key %q in log: %s", key, logText)
		}
	}
	// Must NOT leak secret values.
	for _, secret := range []string{"sk-secret", "sk-also-secret"} {
		if strings.Contains(logText, secret) {
			t.Fatalf("log leaked sensitive value %q: %s", secret, logText)
		}
	}
	// Non-sensitive key must not trigger warn.
	if strings.Contains(logText, `"key":"SAFE_VAR"`) {
		t.Fatalf("non-sensitive key SAFE_VAR should not trigger warn: %s", logText)
	}
}

func TestEnvForAdapterOrProfile_NoWarnInProfileMode(t *testing.T) {
	t.Parallel()

	var logs bytes.Buffer
	previousLogger := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&logs, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() {
		slog.SetDefault(previousLogger)
	})

	run := store.Run{ID: "run_profile", ProjectID: "p", ThreadID: "t"}
	profileEnv := []string{"FOO=bar"}
	extraEnv := []string{"ANTHROPIC_API_KEY=sk-secret"}
	_ = envForAdapterOrProfile(run, false, profileEnv, extraEnv)

	logText := logs.String()
	// Profile mode does not run the adapter-extraEnv warning path.
	if strings.Contains(logText, "adapter extra environment") {
		t.Fatalf("profile mode should not emit adapter extraEnv warn: %s", logText)
	}
}
