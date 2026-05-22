package run

import "testing"

func TestContextFromEnvUsesInjectedValues(t *testing.T) {
	t.Setenv(envRunID, "run-env-1")
	t.Setenv(envProjectID, "project-env-1")
	t.Setenv(envThreadID, "thread-env-1")

	ctx := ContextFromEnv()

	if ctx.RunID != "run-env-1" {
		t.Errorf("expected RunID from env, got %q", ctx.RunID)
	}
	if ctx.ProjectID != "project-env-1" {
		t.Errorf("expected ProjectID from env, got %q", ctx.ProjectID)
	}
	if ctx.ThreadID != "thread-env-1" {
		t.Errorf("expected ThreadID from env, got %q", ctx.ThreadID)
	}
}

func TestContextFromEnvDefaultsRunID(t *testing.T) {
	t.Setenv(envRunID, "")
	t.Setenv(envProjectID, "project-env-1")
	t.Setenv(envThreadID, "thread-env-1")

	ctx := ContextFromEnv()

	if ctx.RunID != DefaultMockRunID {
		t.Errorf("expected default RunID %q, got %q", DefaultMockRunID, ctx.RunID)
	}
	if ctx.ProjectID != "project-env-1" {
		t.Errorf("expected ProjectID from env, got %q", ctx.ProjectID)
	}
	if ctx.ThreadID != "thread-env-1" {
		t.Errorf("expected ThreadID from env, got %q", ctx.ThreadID)
	}
}
