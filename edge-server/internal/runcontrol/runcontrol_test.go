package runcontrol

import (
	"errors"
	"sync"
	"testing"

	"github.com/agenthub/edge-server/internal/errcode"
	"github.com/agenthub/edge-server/internal/events"
	"github.com/agenthub/edge-server/internal/lifecycle"
	"github.com/agenthub/edge-server/internal/store"
)

// recordingExecutor records Start calls and returns a configurable error.
type recordingExecutor struct {
	mu       sync.Mutex
	started  []store.Run
	contexts []lifecycle.RunProcessContext
	startErr error
}

func (e *recordingExecutor) Start(run store.Run, ctx lifecycle.RunProcessContext) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.started = append(e.started, run)
	e.contexts = append(e.contexts, ctx)
	return e.startErr
}

func (e *recordingExecutor) Cancel(runID string) lifecycle.CancelResult {
	return lifecycle.CancelResult{Found: false}
}

func (e *recordingExecutor) lastContext() lifecycle.RunProcessContext {
	e.mu.Lock()
	defer e.mu.Unlock()
	if len(e.contexts) == 0 {
		return lifecycle.RunProcessContext{}
	}
	return e.contexts[len(e.contexts)-1]
}

func (e *recordingExecutor) startCount() int {
	e.mu.Lock()
	defer e.mu.Unlock()
	return len(e.started)
}

func newTestRepo(t *testing.T) store.Repository {
	t.Helper()
	repo := store.New()
	if _, err := repo.CreateProject("proj_local", "Local Project", ""); err != nil {
		t.Fatalf("CreateProject: %v", err)
	}
	if _, err := repo.CreateThread("thread_local", "proj_local", "Local Thread", "direct", "", ""); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	return repo
}

func baseParams(workDir string) CreateParams {
	return CreateParams{
		ProjectID:          "proj_local",
		ThreadID:           "thread_local",
		Prompt:             "build the patch",
		AgentID:            "codex",
		Model:              "gpt-5",
		WorkDir:            workDir,
		WorkspaceAllowlist: []string{workDir},
		Timeline:           func(store.Run) {},
		BuildContext: func(run store.Run) lifecycle.RunProcessContext {
			return lifecycle.RunProcessContext{Run: run, Prompt: "build the patch"}
		},
	}
}

func TestCreateHappyPath(t *testing.T) {
	repo := newTestRepo(t)
	bus := events.NewBus(100)
	executor := &recordingExecutor{}
	workDir := t.TempDir()

	run, err := Create(repo, executor, bus, baseParams(workDir))
	if err != nil {
		t.Fatalf("Create returned error: %v", err)
	}
	if run.ID == "" || run.ProjectID != "proj_local" || run.ThreadID != "thread_local" {
		t.Fatalf("run = %#v, want created run bound to project/thread", run)
	}
	if got := executor.lastContext(); got.Run.ID != run.ID || got.Prompt != "build the patch" {
		t.Fatalf("executor context = %#v, want run id %s and prompt", got, run.ID)
	}
	// The core publishes exactly run.queued before the timeline hook runs.
	if bus.HistoryLen() != 1 {
		t.Fatalf("bus history = %d, want 1 (run.queued)", bus.HistoryLen())
	}
}

func TestCreateRejectsMissingTarget(t *testing.T) {
	repo := newTestRepo(t)
	bus := events.NewBus(100)
	executor := &recordingExecutor{}

	params := baseParams(t.TempDir())
	params.ThreadID = "thread_missing"
	if _, err := Create(repo, executor, bus, params); !errors.Is(err, errcode.ErrNotFound) {
		t.Fatalf("missing thread err = %v, want ErrNotFound", err)
	}
	params.ThreadID = "thread_local"
	params.ProjectID = "proj_missing"
	if _, err := Create(repo, executor, bus, params); !errors.Is(err, errcode.ErrNotFound) {
		t.Fatalf("missing project err = %v, want ErrNotFound", err)
	}
	if bus.HistoryLen() != 0 {
		t.Fatalf("event history = %d, want 0 for rejected creates", bus.HistoryLen())
	}
}

func TestCreateRejectsWorkDirViolations(t *testing.T) {
	repo := newTestRepo(t)
	bus := events.NewBus(100)
	executor := &recordingExecutor{}
	allowedRoot := t.TempDir()

	params := baseParams(allowedRoot)
	params.WorkDir = "   "
	if _, err := Create(repo, executor, bus, params); !errors.Is(err, errcode.ErrWorkDirRequired) {
		t.Fatalf("empty workDir err = %v, want ErrWorkDirRequired", err)
	}
	params.WorkDir = t.TempDir() // outside allowlist
	params.WorkspaceAllowlist = []string{allowedRoot}
	if _, err := Create(repo, executor, bus, params); !errors.Is(err, errcode.ErrWorkspaceNotAllowed) {
		t.Fatalf("outside workDir err = %v, want ErrWorkspaceNotAllowed", err)
	}
	params.WorkDir = allowedRoot
	params.WorkspaceAllowlist = nil
	if _, err := Create(repo, executor, bus, params); !errors.Is(err, errcode.ErrWorkspaceAllowlistNotConfigured) {
		t.Fatalf("empty allowlist err = %v, want ErrWorkspaceAllowlistNotConfigured", err)
	}
}

func TestCreateRejectsInvalidPermissionMode(t *testing.T) {
	repo := newTestRepo(t)
	params := baseParams(t.TempDir())
	params.PermissionMode = "bypassPermissions"
	if _, err := Create(repo, &recordingExecutor{}, events.NewBus(10), params); !errors.Is(err, errcode.ErrInvalidPermissionMode) {
		t.Fatalf("err = %v, want ErrInvalidPermissionMode", err)
	}
}

func TestCreateRejectsActiveRun(t *testing.T) {
	repo := newTestRepo(t)
	if _, err := repo.CreateRun("run_active", "proj_local", "thread_local"); err != nil {
		t.Fatalf("CreateRun: %v", err)
	}
	_, err := Create(repo, &recordingExecutor{}, events.NewBus(10), baseParams(t.TempDir()))
	if !errors.Is(err, errcode.ErrActiveRunExists) {
		t.Fatalf("err = %v, want ErrActiveRunExists", err)
	}
}

func TestCreateRejectsUnknownAgent(t *testing.T) {
	repo := newTestRepo(t)
	params := baseParams(t.TempDir())
	params.AgentExists = func(agentID string) bool { return false }
	_, err := Create(repo, &recordingExecutor{}, events.NewBus(10), params)
	if !errors.Is(err, errcode.ErrInvalidAgentID) {
		t.Fatalf("err = %v, want ErrInvalidAgentID", err)
	}
}

func TestCreateRequiresExecutor(t *testing.T) {
	repo := newTestRepo(t)
	_, err := Create(repo, nil, events.NewBus(10), baseParams(t.TempDir()))
	if !errors.Is(err, errcode.ErrExecutorUnavailable) {
		t.Fatalf("err = %v, want ErrExecutorUnavailable", err)
	}
}

func TestCreateMarksRunFailedWhenExecutorFails(t *testing.T) {
	repo := newTestRepo(t)
	bus := events.NewBus(100)
	executor := &recordingExecutor{startErr: errors.New("executor offline")}

	_, err := Create(repo, executor, bus, baseParams(t.TempDir()))
	if !errors.Is(err, errcode.ErrExecutorStartFailed) {
		t.Fatalf("err = %v, want ErrExecutorStartFailed", err)
	}
	runs := repo.ListRuns("thread_local")
	if len(runs) != 1 || runs[0].Status != "failed" {
		t.Fatalf("runs = %#v, want single failed run", runs)
	}
	// run.queued followed by run.failed.
	if bus.HistoryLen() != 2 {
		t.Fatalf("bus history = %d, want 2 (run.queued + run.failed)", bus.HistoryLen())
	}
}

func TestCreateMapsTooManyConcurrentRuns(t *testing.T) {
	repo := newTestRepo(t)
	executor := &recordingExecutor{startErr: lifecycle.ErrTooManyConcurrentRuns}
	_, err := Create(repo, executor, events.NewBus(10), baseParams(t.TempDir()))
	if !errors.Is(err, errcode.ErrTooManyConcurrentRuns) {
		t.Fatalf("err = %v, want ErrTooManyConcurrentRuns", err)
	}
}

func TestCreateSerializesConcurrentCreates(t *testing.T) {
	repo := newTestRepo(t)
	executor := &recordingExecutor{}
	workDir := t.TempDir()

	const workers = 8
	var wg sync.WaitGroup
	ready := make(chan struct{})
	results := make([]error, workers)
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-ready
			_, results[i] = Create(repo, executor, events.NewBus(10), baseParams(workDir))
		}(i)
	}
	close(ready)
	wg.Wait()

	successes, activeRunErrors := 0, 0
	for _, err := range results {
		switch {
		case err == nil:
			successes++
		case errors.Is(err, errcode.ErrActiveRunExists):
			activeRunErrors++
		default:
			t.Fatalf("unexpected error: %v", err)
		}
	}
	if successes != 1 || activeRunErrors != workers-1 {
		t.Fatalf("successes = %d, activeRunErrors = %d, want 1 and %d", successes, activeRunErrors, workers-1)
	}
	if got := executor.startCount(); got != 1 {
		t.Fatalf("executor starts = %d, want exactly 1", got)
	}
}

func TestCreateHubTaskIDDedup(t *testing.T) {
	repo := newTestRepo(t)
	bus := events.NewBus(100)
	executor := &recordingExecutor{}
	workDir := t.TempDir()

	params := baseParams(workDir)
	params.HubTaskID = "hub-task-001"

	// First create should succeed
	run1, err := Create(repo, executor, bus, params)
	if err != nil {
		t.Fatalf("first create: %v", err)
	}
	if run1.ID == "" {
		t.Fatal("first create returned empty run ID")
	}
	if run1.HubTaskID != "hub-task-001" {
		t.Fatalf("first create HubTaskID = %q, want %q", run1.HubTaskID, "hub-task-001")
	}

	// Second create with same HubTaskID should return existing run
	run2, err := Create(repo, executor, bus, params)
	if err != nil {
		t.Fatalf("second create (dedup): %v", err)
	}
	if run2.ID != run1.ID {
		t.Fatalf("dedup returned different run ID: got %q, want %q", run2.ID, run1.ID)
	}

	// Executor should only have been started once
	if executor.startCount() != 1 {
		t.Fatalf("executor start count = %d, want 1", executor.startCount())
	}
}

func TestCreateEmptyHubTaskIDNoDedup(t *testing.T) {
	repo := newTestRepo(t)
	bus := events.NewBus(100)
	executor := &recordingExecutor{}
	workDir := t.TempDir()

	params := baseParams(workDir)
	// Empty HubTaskID — should NOT dedup

	run1, err := Create(repo, executor, bus, params)
	if err != nil {
		t.Fatalf("first create: %v", err)
	}

	// Need to finish/cancel first run before creating another on same thread
	repo.SetRunStatus(run1.ID, "finished")

	run2, err := Create(repo, executor, bus, params)
	if err != nil {
		t.Fatalf("second create: %v", err)
	}
	if run2.ID == run1.ID {
		t.Fatal("empty HubTaskID should not dedup; got same run ID")
	}
}
