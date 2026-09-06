package runcontrol

import (
	"errors"
	"log/slog"

	"github.com/agenthub/edge-server/internal/errcode"
	"github.com/agenthub/edge-server/internal/lifecycle"
	"github.com/agenthub/edge-server/internal/store"
)

// Owned only while Create is deciding executor admission. The shared mutex
// protects this transient ownership evidence; no completed receipts accumulate.
var pendingRunAdmissions = make(map[string]struct{})

func finishRunAdmission(runID string) {
	runCreationMu.Lock()
	delete(pendingRunAdmissions, runID)
	runCreationMu.Unlock()
}

// prepareRunAdmission is called under runCreationMu. It atomically chooses a
// retained receipt or creates durable pending identity before executor startup.
func prepareRunAdmission(repository store.Repository, executor lifecycle.RunExecutor, params CreateParams) (store.Run, bool, *errcode.Error) {
	if params.HubTaskID != "" {
		if existing, found := repository.GetRunByHubTaskID(params.HubTaskID); found {
			if err := authorizeRunReplay(existing, params); err != nil {
				return store.Run{}, false, err
			}
			retry, err := replayRunAdmission(repository, existing)
			if err != nil {
				return store.Run{}, false, err
			}
			if !retry {
				slog.Info("run.dedup", "hubTaskId", params.HubTaskID, "existingRunId", existing.ID)
				return existing, true, nil
			}
		}
	}
	if params.Cleanup {
		cleanupRuns(repository)
	}
	if err := validateTarget(repository, params.ProjectID, params.ThreadID); err != nil {
		return store.Run{}, false, err
	}
	if err := validateWorkDir(params.WorkDir, params.WorkspaceAllowlist); err != nil {
		return store.Run{}, false, err
	}
	if err := validatePermissionMode(params.PermissionMode); err != nil {
		return store.Run{}, false, errcode.ErrInvalidPermissionMode
	}
	if active, ok := ActiveRunForThread(repository.ListRuns(params.ThreadID)); ok {
		return store.Run{}, false, errcode.ErrActiveRunExists.WithMessagef("thread already has an active run: %s", active.ID)
	}
	if executor == nil {
		return store.Run{}, false, errcode.ErrExecutorUnavailable
	}
	if params.AgentID != "" && params.AgentExists != nil && !params.AgentExists(params.AgentID) {
		return store.Run{}, false, errcode.ErrInvalidAgentID.WithMessagef("unknown agent adapter: %q", params.AgentID)
	}
	if params.HubTaskID != "" && params.BuildContext == nil {
		return store.Run{}, false, errcode.ErrExecutorUnavailable.WithMessage("Hub task admission requires an executor context")
	}
	runID := generateRunID()
	var run store.Run
	var err error
	if params.HubTaskID == "" {
		run, err = repository.CreateRun(runID, params.ProjectID, params.ThreadID)
	} else {
		run, err = repository.CreateRunAdmission(runID, params.ProjectID, params.ThreadID, params.HubTaskID)
	}
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return store.Run{}, false, errcode.ErrNotFound.WithMessage("project or thread not found")
		}
		if params.HubTaskID != "" {
			// This attempt has not called Start. Keep that definite rejection in
			// memory even if the write path is down; a retry in this process may
			// persist it before trying again. A recovered pending record stays unknown.
			if retained, ok := repository.GetRun(runID); ok && retained.HubTaskID == params.HubTaskID {
				_, _ = repository.RecordRunAdmission(runID, errcode.ErrAdmissionPersistFailed.Code)
				repository.SetRunStatusIf(runID, "failed", "queued")
			}
			return store.Run{}, false, errcode.ErrAdmissionPersistFailed
		}
		return store.Run{}, false, errcode.ErrInternal.WithMessage("failed to create run")
	}
	if params.HubTaskID != "" {
		pendingRunAdmissions[run.ID] = struct{}{}
	}
	return run, false, nil
}

func authorizeRunReplay(run store.Run, params CreateParams) *errcode.Error {
	if params.AuthorizeReplay != nil {
		return params.AuthorizeReplay(run)
	}
	if run.ProjectID != params.ProjectID || run.ThreadID != params.ThreadID {
		return errcode.ErrDeliveryConflict
	}
	return nil
}

// replayRunAdmission returns retry=true only with durable proof of a rejected
// pre-execution attempt. Execution status alone never grants permission to start.
func replayRunAdmission(repository store.Repository, run store.Run) (retry bool, result *errcode.Error) {
	if _, owned := pendingRunAdmissions[run.ID]; owned {
		return false, errcode.ErrDeliveryBusy
	}
	switch run.AdmissionState {
	case store.RunAdmissionAccepted:
		// Also retries a previous final persistence failure without starting work.
		if _, err := repository.RecordRunAdmission(run.ID, ""); err != nil {
			return false, errcode.ErrAdmissionPersistFailed
		}
		return false, nil
	case store.RunAdmissionRejected:
		if _, err := repository.RecordRunAdmission(run.ID, run.AdmissionErrorCode); err != nil {
			return false, errcode.ErrAdmissionPersistFailed
		}
		switch run.AdmissionErrorCode {
		case errcode.ErrTooManyConcurrentRuns.Code, errcode.ErrAdmissionPersistFailed.Code:
			// The former was rejected before executor ownership; the latter was
			// rejected before Start was called. A completed/started run is never reset.
			if run.StartedAt != "" || (run.Status != "failed" && run.Status != "queued") {
				break
			}
			if _, ok := repository.SetRunStatusIf(run.ID, "failed", "queued", "failed"); !ok {
				return false, errcode.ErrAdmissionPersistFailed
			}
			return true, nil
		case errcode.ErrExecutorStartFailed.Code:
			return false, errcode.ErrExecutorStartFailed
		}
	case "":
		// Compatibility: a legacy durable started timestamp is positive execution
		// evidence. Legacy queued/failed records without it are ambiguous.
		if run.StartedAt != "" {
			return false, nil
		}
	}
	return false, errcode.ErrAdmissionUncertain.WithMessagef("admission outcome for run %s requires reconciliation; automatic restart is unsafe", run.ID)
}
