// Package runcontrol is the single source of truth for agent run creation,
// shared by the REST (POST /v1/runs) and MCP (agenthub_start_run) entry
// points. Both transports decode their own request shape and build their own
// timeline/context policies, but the invariant sequence — target validation,
// active-run guard, run record creation, run.queued publication, executor
// start, and failure state transition — lives here exactly once.
//
// Dependency direction: runcontrol depends on store / lifecycle / events /
// security / errcode only. It must never import api or mcp.
package runcontrol

import (
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/agenthub/edge-server/internal/errcode"
	"github.com/agenthub/edge-server/internal/events"
	"github.com/agenthub/edge-server/internal/idgen"
	"github.com/agenthub/edge-server/internal/lifecycle"
	"github.com/agenthub/edge-server/internal/security"
	"github.com/agenthub/edge-server/internal/store"
)

// runCreationMu serializes run creation process-wide. Run creation is a
// check-then-create sequence (no active run on the thread, then CreateRun);
// without one shared lock, two concurrent requests — including one from REST
// and one from MCP — could both pass the active-run check and create
// overlapping runs. For Hub work this section includes the durable pending
// identity write. Timeline publication and executor startup stay outside it.
var runCreationMu sync.Mutex

const (
	// DefaultRunCleanupTerminalTTL is how long a terminal run is retained
	// before the pre-create cleanup removes it.
	DefaultRunCleanupTerminalTTL = 24 * time.Hour
	// DefaultRunCleanupMaxTerminalRunsPerThread bounds how many terminal runs
	// are retained per thread before the pre-create cleanup trims the oldest.
	DefaultRunCleanupMaxTerminalRunsPerThread = 50
)

// CreateParams carries the transport-independent inputs for starting a run.
// Transport-specific behavior (profile defaults, session naming, timeline
// items, adapter context) is injected as callbacks so the core sequence never
// needs to know which protocol created the request.
type CreateParams struct {
	ProjectID      string
	ThreadID       string
	Prompt         string
	AgentID        string
	Model          string
	PermissionMode string
	SessionID      string
	ContinueLast   bool
	WorkDir        string

	// WorkspaceAllowlist is the request-time allowlist used to validate
	// WorkDir (AH-SR-006 / #998). Empty = fail-closed for non-empty workDir.
	WorkspaceAllowlist []string

	// AgentExists, when non-nil, rejects unknown agent IDs (#175). REST wires
	// it to the adapter registry; MCP leaves it nil (no registry in scope).
	AgentExists func(agentID string) bool

	// Cleanup runs terminal-run cleanup before validation (REST housekeeping).
	Cleanup bool

	// Timeline publishes the transport's timeline items/events after the run
	// record is created and before the executor starts. REST publishes the
	// prompt and queued-marker items; MCP publishes a single user_message item.
	Timeline func(run store.Run)

	// HubTaskID identifies one logical Hub task across delivery transports.
	// A retained run is replayable only with admission evidence, not merely
	// because a queued/failed record exists.
	HubTaskID string

	// AuthorizeReplay validates the actual stored scope before replaying a Hub
	// task. Transports with capability policy must supply it. Without a policy,
	// replay is restricted to the same project/thread as the request.
	AuthorizeReplay func(store.Run) *errcode.Error

	// BuildContext builds the RunProcessContext handed to the executor.
	// When nil, the executor start step is skipped.
	BuildContext func(run store.Run) lifecycle.RunProcessContext
}

// Create validates the target thread, creates the run record, publishes
// run.queued, invokes the transport timeline hook, and starts the executor.
//
// Error returns are always *errcode.Error so each transport can map them to
// its own response shape (HTTP status via HTTPStatus, or JSON-RPC error text).
// The returned run is the persisted record; on error the run is zero-valued.
func Create(repository store.Repository, executor lifecycle.RunExecutor, bus *events.Bus, params CreateParams) (store.Run, error) {
	if repository == nil {
		return store.Run{}, errcode.ErrStoreNotConfigured
	}
	params.WorkDir = strings.TrimSpace(params.WorkDir)

	runCreationMu.Lock()
	run, replayed, err := prepareRunAdmission(repository, executor, params)
	runCreationMu.Unlock()
	if err != nil {
		return store.Run{}, err
	}
	if replayed {
		return run, nil
	}
	if params.HubTaskID != "" {
		defer finishRunAdmission(run.ID)
	}

	scope := map[string]any{
		"projectId": run.ProjectID,
		"threadId":  run.ThreadID,
		"runId":     run.ID,
	}
	if bus != nil {
		bus.Publish("run.queued", scope, run)
		slog.Debug("run.queued", "runId", run.ID, "agentId", params.AgentID)
	}
	if params.Timeline != nil {
		params.Timeline(run)
	}

	if params.BuildContext != nil {
		runCtx := params.BuildContext(run)
		if err := executor.Start(run, runCtx); err != nil {
			slog.Error("run executor start failed", "runId", run.ID, "error", err)
			if failed, ok := repository.SetRunStatusIf(run.ID, "failed", "queued"); ok && bus != nil {
				bus.Publish("run.failed", scope, map[string]any{
					"runId":  failed.ID,
					"status": failed.Status,
					"error":  "run execution failed",
				})
			}
			admissionErr := errcode.ErrExecutorStartFailed
			if errors.Is(err, lifecycle.ErrTooManyConcurrentRuns) {
				admissionErr = errcode.ErrTooManyConcurrentRuns
			}
			if params.HubTaskID != "" {
				if _, persistErr := repository.RecordRunAdmission(run.ID, admissionErr.Code); persistErr != nil {
					return store.Run{}, errcode.ErrAdmissionPersistFailed
				}
			}
			return store.Run{}, admissionErr
		}
	}
	if params.HubTaskID != "" {
		accepted, persistErr := repository.RecordRunAdmission(run.ID, "")
		if persistErr != nil {
			return store.Run{}, errcode.ErrAdmissionPersistFailed
		}
		return accepted, nil
	}
	return run, nil
}

// ActiveRunForThread returns the first active (queued, started, or cancelling)
// run of the given list. Used both by Create and by transports that need to
// enrich an active-run error response with the conflicting run.
func ActiveRunForThread(runs []store.Run) (store.Run, bool) {
	for _, run := range runs {
		if IsActiveRunStatus(run.Status) {
			return run, true
		}
	}
	return store.Run{}, false
}

// IsActiveRunStatus reports whether a run status occupies the thread's run
// slot (queued/started/cancelling). Terminal statuses release the slot.
func IsActiveRunStatus(status string) bool {
	switch status {
	case "queued", "started", "cancelling":
		return true
	default:
		return false
	}
}

// validateTarget verifies the project and thread exist and the thread belongs
// to the project, mirroring the historical PostRuns order.
func validateTarget(repository store.Repository, projectID, threadID string) *errcode.Error {
	thread, ok := repository.GetThread(threadID)
	if !ok || thread.ProjectID != projectID {
		return errcode.ErrNotFound.WithMessage("project or thread not found")
	}
	if _, ok := repository.GetProject(projectID); !ok {
		return errcode.ErrNotFound.WithMessage("project or thread not found")
	}
	return nil
}

// validateWorkDir enforces a non-empty workDir for adapter runs (#854), then
// applies the shared REST/MCP workspace allowlist policy (AH-SR-006 / #998):
// EvalSymlinks + IsPathWithin via security.ValidateWorkDirAgainstAllowlist.
func validateWorkDir(workDir string, allowlist []string) *errcode.Error {
	if workDir == "" {
		return errcode.ErrWorkDirRequired
	}
	if err := security.ValidateWorkDirAgainstAllowlist(workDir, allowlist); err != nil {
		if errors.Is(err, security.ErrWorkspaceAllowlistEmpty) {
			// Fail-closed: empty allowlist rejects any non-empty workDir.
			return errcode.ErrWorkspaceAllowlistNotConfigured
		}
		if errors.Is(err, security.ErrWorkspaceOutsideAllowlist) {
			return errcode.ErrWorkspaceNotAllowed
		}
		slog.Error("run workdir validation failed", "workDir", workDir, "error", err)
		return errcode.ErrWorkspaceNotAllowed.WithMessagef("invalid workDir: %v", err)
	}
	return nil
}

// validatePermissionMode returns an error if mode is not a recognised
// Claude Code --permission-mode value. An empty mode is allowed and means
// "use the adapter default".
func validatePermissionMode(mode string) error {
	if mode == "" {
		return nil
	}
	// SEC-02: Reject 'bypassPermissions' — it disables ALL security hooks at
	// the CLI level, giving the agent unrestricted shell access regardless
	// of SecurityHook settings. Only the whitelist modes are allowed.
	switch mode {
	case "default", "acceptEdits", "plan", "dontAsk":
		return nil
	default:
		return fmt.Errorf("unknown permission mode %q: valid values are default, acceptEdits, plan, dontAsk", mode)
	}
}

// cleanupRuns removes terminal runs that exceeded the retention policy. It is
// a no-op when the store does not implement store.RunCleaner.
func cleanupRuns(repository store.Repository) {
	cleaner, ok := repository.(store.RunCleaner)
	if !ok {
		return
	}
	cleaner.CleanupRuns(store.RunCleanupOptions{
		TerminalTTL:              DefaultRunCleanupTerminalTTL,
		MaxTerminalRunsPerThread: DefaultRunCleanupMaxTerminalRunsPerThread,
	})
}

// generateRunID produces a run_ prefixed random identifier via idgen.
func generateRunID() string {
	return idgen.New("run_")
}
