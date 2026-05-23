// Package runnerctx provides shared types for passing run-level context
// between the API handler, lifecycle executor, and agent adapters.
package runnerctx

import "github.com/agenthub/edge-server/internal/store"

// RunProcessContext carries all parameters needed to build and execute an agent command.
// It is shared between lifecycle (executor) and adapters (command builder) to avoid
// duplicate struct definitions.
type RunProcessContext struct {
	Run     store.Run
	Prompt  string // User message content
	AgentID string // Agent adapter ID
	Model   string // Model override
	WorkDir string // Working directory

	// Session continuity
	SessionID    string // Specific session to resume
	ContinueLast bool   // Resume most recent session
	ForkSession  bool   // Fork before continuing
}
