package lifecycle

import (
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
