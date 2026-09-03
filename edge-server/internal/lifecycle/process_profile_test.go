package lifecycle

import (
	"os"
	"strings"
	"testing"

	"github.com/agenthub/edge-server/internal/events"
	"github.com/agenthub/edge-server/internal/store"
)

func TestProcessExecutorExpandsRunPlaceholdersInArgs(t *testing.T) {
	bus := events.NewBus(100)
	s := store.New()
	run := newExecutorTestRun(t, s)
	_, ch, _ := bus.Subscribe(0)
	executor, err := NewProcessExecutor(bus, s, ProcessExecutorConfig{
		Command: os.Args[0],
		Args: []string{
			processExecutorHelperRunFlag,
			"--",
			"--run={{run.id}}",
			"--project={{ run.projectId }}",
			"--thread={{run.threadId}}",
			"args",
		},
		Env: append(os.Environ(), "AGENTHUB_PROCESS_EXECUTOR_HELPER=1"),
	}, nil, nil)
	if err != nil {
		t.Fatalf("NewProcessExecutor returned error: %v", err)
	}

	if err := executor.Start(run, RunProcessContext{}); err != nil {
		t.Fatalf("Start returned error: %v", err)
	}

	stdoutText := collectStdoutUntilFinished(t, ch)
	for _, want := range []string{
		"--run=" + run.ID,
		"--project=" + run.ProjectID,
		"--thread=" + run.ThreadID,
	} {
		if !strings.Contains(stdoutText, want) {
			t.Fatalf("stdout text = %q, want %q", stdoutText, want)
		}
	}
}

func TestProcessExecutorExpandsRunPlaceholdersInEnv(t *testing.T) {
	bus := events.NewBus(100)
	s := store.New()
	run := newExecutorTestRun(t, s)
	_, ch, _ := bus.Subscribe(0)
	executor, err := NewProcessExecutor(bus, s, ProcessExecutorConfig{
		Command: os.Args[0],
		Args:    []string{processExecutorHelperRunFlag, "--", "env"},
		Env: append(os.Environ(),
			"AGENTHUB_PROCESS_EXECUTOR_HELPER=1",
			"PROFILE_RUN={{run.id}}",
			"PROFILE_PROJECT={{run.projectId}}",
			"PROFILE_THREAD={{run.threadId}}",
		),
	}, nil, nil)
	if err != nil {
		t.Fatalf("NewProcessExecutor returned error: %v", err)
	}

	if err := executor.Start(run, RunProcessContext{}); err != nil {
		t.Fatalf("Start returned error: %v", err)
	}

	stdoutText := collectStdoutUntilFinished(t, ch)
	for _, want := range []string{
		"profileRun=" + run.ID,
		"profileProject=" + run.ProjectID,
		"profileThread=" + run.ThreadID,
	} {
		if !strings.Contains(stdoutText, want) {
			t.Fatalf("stdout text = %q, want %q", stdoutText, want)
		}
	}
}

func TestProcessExecutorExpandsRunPlaceholdersInExtraEnv(t *testing.T) {
	bus := events.NewBus(100)
	s := store.New()
	run := newExecutorTestRun(t, s)
	_, ch, _ := bus.Subscribe(0)
	executor, err := NewProcessExecutor(bus, s, ProcessExecutorConfig{
		Command: os.Args[0],
		Args:    []string{processExecutorHelperRunFlag, "--", "env"},
		Env:     nil,
		ExtraEnv: []string{
			"AGENTHUB_PROCESS_EXECUTOR_HELPER=1",
			"PROFILE_RUN={{run.id}}",
			"PROFILE_PROJECT={{run.projectId}}",
			"PROFILE_THREAD={{run.threadId}}",
		},
	}, nil, nil)
	if err != nil {
		t.Fatalf("NewProcessExecutor returned error: %v", err)
	}

	if err := executor.Start(run, RunProcessContext{}); err != nil {
		t.Fatalf("Start returned error: %v", err)
	}

	stdoutText := collectStdoutUntilFinished(t, ch)
	for _, want := range []string{
		"profileRun=" + run.ID,
		"profileProject=" + run.ProjectID,
		"profileThread=" + run.ThreadID,
	} {
		if !strings.Contains(stdoutText, want) {
			t.Fatalf("stdout text = %q, want %q", stdoutText, want)
		}
	}
}

func TestProcessExecutorExtraEnvDoesNotTemplateParentEnvironment(t *testing.T) {
	t.Setenv("AGENTHUB_PARENT_ENV_WITH_BRACES", "{{not.a.template")

	_, err := NewProcessExecutor(events.NewBus(10), store.New(), ProcessExecutorConfig{
		Command:  os.Args[0],
		Args:     []string{processExecutorHelperRunFlag, "--", "env"},
		Env:      nil,
		ExtraEnv: []string{"PROFILE_RUN={{run.id}}"},
	}, nil, nil)
	if err != nil {
		t.Fatalf("NewProcessExecutor returned error: %v", err)
	}
}

func TestProcessExecutorNilEnvSanitizesParentEnvironment(t *testing.T) {
	// Set a non-whitelisted var in the parent — it must NOT leak to the child.
	t.Setenv("RANDOM_TEST_SECRET_TOKEN", "must-not-leak")
	t.Setenv("AGENTHUB_EDGE_AUTH_TOKEN", "edge-token")
	t.Setenv("AGENTHUB_JWT_SECRET", "jwt-secret")
	t.Setenv("AGENTHUB_DB_PASSWORD", "db-password")
	// PATH is whitelisted — it SHOULD be visible to the child.
	t.Setenv("PATH", "/usr/bin:/bin")
	parentPath := os.Getenv("PATH")

	bus := events.NewBus(100)
	s := store.New()
	run := newExecutorTestRun(t, s)
	_, ch, _ := bus.Subscribe(0)
	executor, err := NewProcessExecutor(bus, s, ProcessExecutorConfig{
		Command: os.Args[0],
		Args:    []string{processExecutorHelperRunFlag, "--", "sanitized-env"},
		Env:     nil,
		ExtraEnv: []string{
			"AGENTHUB_TEST_EXTRA_ENV=1",
			"AGENTHUB_PARENT_PATH=" + parentPath,
		},
	}, nil, nil)
	if err != nil {
		t.Fatalf("NewProcessExecutor returned error: %v", err)
	}

	if err := executor.Start(run, RunProcessContext{}); err != nil {
		t.Fatalf("Start returned error: %v", err)
	}

	stdoutText := collectStdoutUntilFinished(t, ch)
	// The random secret must NOT appear in the child environment.
	if strings.Contains(stdoutText, "randomSecret=must-not-leak") {
		t.Fatalf("stdout text = %q, must NOT contain leaked env value", stdoutText)
	}
	for _, leaked := range []string{
		"edgeAuthToken=edge-token",
		"jwtSecret=jwt-secret",
		"dbPassword=db-password",
	} {
		if strings.Contains(stdoutText, leaked) {
			t.Fatalf("stdout text = %q, must NOT contain leaked AGENTHUB_* secret", stdoutText)
		}
	}
	if !strings.Contains(stdoutText, "testExtraEnv=1") {
		t.Fatalf("stdout text = %q, want explicit ExtraEnv var to pass through", stdoutText)
	}
	// PATH must be present in the child.
	if !strings.Contains(stdoutText, "sanitizedPath=") {
		t.Fatalf("stdout text = %q, want PATH to be inherited (whitelisted)", stdoutText)
	}
}

func TestProcessExecutorRejectsUnknownPlaceholder(t *testing.T) {
	_, err := NewProcessExecutor(events.NewBus(10), store.New(), ProcessExecutorConfig{
		Command: os.Args[0],
		Args:    []string{"--bad={{run.workspaceId}}"},
	}, nil, nil)
	if err == nil || !strings.Contains(err.Error(), "unknown placeholder") {
		t.Fatalf("NewProcessExecutor error = %v, want unknown placeholder", err)
	}
}

func TestProcessExecutorRejectsInvalidEnvTemplate(t *testing.T) {
	tests := []struct {
		name string
		env  []string
		want string
	}{
		{name: "missing equals", env: []string{"PROFILE_RUN"}, want: "KEY=VALUE"},
		{name: "empty key", env: []string{"=value"}, want: "key is required"},
		{name: "whitespace in key", env: []string{"PROFILE RUN=value"}, want: "invalid whitespace"},
		{name: "unknown placeholder", env: []string{"PROFILE_RUN={{run.workspaceId}}"}, want: "unknown placeholder"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := NewProcessExecutor(events.NewBus(10), store.New(), ProcessExecutorConfig{
				Command: os.Args[0],
				Env:     tt.env,
			}, nil, nil)
			if err == nil || !strings.Contains(err.Error(), tt.want) {
				t.Fatalf("NewProcessExecutor error = %v, want containing %q", err, tt.want)
			}
		})
	}
}

func TestProcessExecutorRedactsEnvTemplateValueInErrors(t *testing.T) {
	secretValue := "token-secret-should-not-appear"
	_, err := NewProcessExecutor(events.NewBus(10), store.New(), ProcessExecutorConfig{
		Command: os.Args[0],
		Env:     []string{"PROFILE_TOKEN=" + secretValue + "{{run.workspaceId}}"},
	}, nil, nil)
	if err == nil {
		t.Fatal("NewProcessExecutor returned nil error for invalid env placeholder")
	}
	if strings.Contains(err.Error(), secretValue) {
		t.Fatalf("NewProcessExecutor error = %q, must not include env value", err.Error())
	}
	if !strings.Contains(err.Error(), "PROFILE_TOKEN") || !strings.Contains(err.Error(), "unknown placeholder") {
		t.Fatalf("NewProcessExecutor error = %q, want key and placeholder error", err.Error())
	}
}
