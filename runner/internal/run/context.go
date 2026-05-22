package run

import "os"

const (
	// DefaultMockRunID keeps the mock runner compatible when Edge has not
	// injected a run context yet.
	DefaultMockRunID = "mock-run-1"

	envRunID     = "AGENTHUB_RUN_ID"
	envProjectID = "AGENTHUB_PROJECT_ID"
	envThreadID  = "AGENTHUB_THREAD_ID"
)

// RunContext is the minimal run scope injected by Edge into the runner process.
type RunContext struct {
	RunID     string
	ProjectID string
	ThreadID  string
}

// ContextFromEnv reads the Edge-injected runner context from process
// environment variables.
func ContextFromEnv() RunContext {
	ctx := RunContext{
		RunID:     os.Getenv(envRunID),
		ProjectID: os.Getenv(envProjectID),
		ThreadID:  os.Getenv(envThreadID),
	}
	return normalizeRunContext(ctx)
}

func normalizeRunContext(ctx RunContext) RunContext {
	if ctx.RunID == "" {
		ctx.RunID = DefaultMockRunID
	}
	return ctx
}
