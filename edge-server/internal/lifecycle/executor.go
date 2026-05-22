package lifecycle

import "github.com/agenthub/edge-server/internal/store"

// RunExecutor owns state transitions after a run has been queued by the API.
type RunExecutor interface {
	Start(run store.Run) error
	Cancel(runID string) CancelResult
}

type CancelResult struct {
	Run    store.Run
	Found  bool
	Status string
}
