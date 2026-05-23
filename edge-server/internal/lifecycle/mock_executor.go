package lifecycle

import (
	"errors"
	"sync"
	"time"

	"github.com/agenthub/edge-server/internal/events"
	"github.com/agenthub/edge-server/internal/store"
)

var ErrRunFailed = errors.New("mock run failed")
var ErrRunAlreadyStarted = errors.New("run already started")

type MockExecutorOption func(*MockExecutor)

type MockExecutor struct {
	bus       *events.Bus
	store     store.RunLifecycleStore
	stepDelay time.Duration
	outputs   []OutputBatch
	failRuns  map[string]error
	mu        sync.Mutex
	cancels   map[string]chan struct{}
}

type OutputBatch struct {
	Stream string
	Offset int
	Text   string
}

func NewMockExecutor(bus *events.Bus, store store.RunLifecycleStore, opts ...MockExecutorOption) *MockExecutor {
	e := &MockExecutor{
		bus:       bus,
		store:     store,
		stepDelay: 50 * time.Millisecond,
		outputs: []OutputBatch{
			{Stream: "stdout", Offset: 0, Text: "Initializing mock runner...\n"},
			{Stream: "stdout", Offset: 29, Text: "Executing mock task step 1/3...\n"},
			{Stream: "stdout", Offset: 60, Text: "Executing mock task step 2/3...\n"},
			{Stream: "stderr", Offset: 0, Text: "Warning: mock task is running in simulation mode\n"},
			{Stream: "stdout", Offset: 91, Text: "Executing mock task step 3/3...\n"},
		},
		failRuns: make(map[string]error),
		cancels:  make(map[string]chan struct{}),
	}
	for _, opt := range opts {
		opt(e)
	}
	return e
}

func WithStepDelay(delay time.Duration) MockExecutorOption {
	return func(e *MockExecutor) {
		e.stepDelay = delay
	}
}

func WithOutputBatches(outputs []OutputBatch) MockExecutorOption {
	return func(e *MockExecutor) {
		e.outputs = outputs
	}
}

func WithFailedRun(runID string, err error) MockExecutorOption {
	return func(e *MockExecutor) {
		if err == nil {
			err = ErrRunFailed
		}
		e.failRuns[runID] = err
	}
}

func (e *MockExecutor) Start(run store.Run, _ RunProcessContext) error {
	current, ok := e.store.GetRun(run.ID)
	if ok && current.Status != "queued" {
		return ErrRunAlreadyStarted
	}

	cancelCh := make(chan struct{})
	e.mu.Lock()
	if _, ok := e.cancels[run.ID]; ok {
		e.mu.Unlock()
		return ErrRunAlreadyStarted
	}
	e.cancels[run.ID] = cancelCh
	e.mu.Unlock()

	go e.run(run, cancelCh)
	return nil
}

func (e *MockExecutor) Cancel(runID string) CancelResult {
	run, ok := e.store.GetRun(runID)
	if !ok {
		return CancelResult{Found: false, Status: "not_found"}
	}
	switch run.Status {
	case "queued", "started", "cancelling":
	default:
		return CancelResult{Run: run, Found: true, Status: run.Status}
	}

	e.mu.Lock()
	cancelCh, ok := e.cancels[runID]
	if !ok {
		e.mu.Unlock()
		return CancelResult{Found: false, Status: "not_running"}
	}
	select {
	case <-cancelCh:
	default:
		close(cancelCh)
	}
	e.mu.Unlock()

	run, ok = e.store.SetRunStatusIf(runID, "cancelling", "queued", "started")
	if !ok {
		if current, found := e.store.GetRun(runID); found {
			return CancelResult{Run: current, Found: true, Status: current.Status}
		}
		return CancelResult{Found: false, Status: "not_found"}
	}
	return CancelResult{Run: run, Found: true, Status: run.Status}
}

func (e *MockExecutor) run(run store.Run, cancelCh <-chan struct{}) {
	defer e.finish(run.ID)

	if e.sleepOrCancelled(cancelCh, e.stepDelay) {
		e.publishCancelled(run)
		return
	}

	started, ok := e.store.SetRunStatusIf(run.ID, "started", "queued")
	if !ok {
		return
	}
	e.bus.Publish("run.started", runScope(started), RunResponse(started))

	if err := e.failureFor(run.ID); err != nil {
		failed, ok := e.store.SetRunStatus(run.ID, "failed")
		if ok {
			e.bus.Publish("run.failed", runScope(failed), map[string]any{
				"runId":  failed.ID,
				"status": failed.Status,
				"error":  err.Error(),
			})
		}
		return
	}

	for _, output := range e.outputs {
		if e.sleepOrCancelled(cancelCh, e.stepDelay) {
			e.publishCancelled(run)
			return
		}
		e.bus.Publish("run.output.batch", runScope(run), map[string]any{
			"runId":  run.ID,
			"stream": output.Stream,
			"chunks": []map[string]any{
				{"offset": output.Offset, "text": output.Text},
			},
		})
	}

	if e.sleepOrCancelled(cancelCh, e.stepDelay) {
		e.publishCancelled(run)
		return
	}
	finished, ok := e.store.SetRunStatus(run.ID, "finished")
	if ok {
		e.bus.Publish("run.finished", runScope(finished), RunResponse(finished))
	}
}

func (e *MockExecutor) failureFor(runID string) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.failRuns[runID]
}

func (e *MockExecutor) sleepOrCancelled(cancelCh <-chan struct{}, delay time.Duration) bool {
	if delay <= 0 {
		select {
		case <-cancelCh:
			return true
		default:
			return false
		}
	}
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-cancelCh:
		return true
	case <-timer.C:
		return false
	}
}

func (e *MockExecutor) publishCancelled(run store.Run) {
	cancelled, ok := e.store.SetRunStatus(run.ID, "cancelled")
	if ok {
		e.bus.Publish("run.cancelled", runScope(cancelled), RunResponse(cancelled))
	}
}

func (e *MockExecutor) finish(runID string) {
	e.mu.Lock()
	delete(e.cancels, runID)
	e.mu.Unlock()
}

func RunResponse(run store.Run) map[string]any {
	return map[string]any{
		"runId":      run.ID,
		"projectId":  run.ProjectID,
		"threadId":   run.ThreadID,
		"status":     run.Status,
		"createdAt":  run.CreatedAt,
		"startedAt":  run.StartedAt,
		"finishedAt": run.FinishedAt,
	}
}

func runScope(run store.Run) map[string]any {
	return map[string]any{
		"projectId": run.ProjectID,
		"threadId":  run.ThreadID,
		"runId":     run.ID,
	}
}
