package runcontrol

import (
	"errors"
	"path/filepath"
	"testing"

	"github.com/agenthub/edge-server/internal/errcode"
	"github.com/agenthub/edge-server/internal/store"
)

type admissionWriteFailure struct {
	store.Repository
	failPrepare  bool
	failAccepted bool
}

func (r *admissionWriteFailure) CreateRunAdmission(id, project, thread, task, callbackOwner string) (store.Run, error) {
	run, err := r.Repository.CreateRunAdmission(id, project, thread, task, callbackOwner)
	if err == nil && r.failPrepare {
		r.failPrepare = false
		return run, errors.New("fixture pending write failure")
	}
	return run, err
}
func (r *admissionWriteFailure) RecordRunAdmission(id, code string) (store.Run, error) {
	run, err := r.Repository.RecordRunAdmission(id, code)
	if err == nil && code == "" && r.failAccepted {
		r.failAccepted = false
		return run, errors.New("fixture accepted write failure")
	}
	return run, err
}

func TestHubAdmission_PersistenceFailuresNeverAcknowledgeOrDuplicate(t *testing.T) {
	for _, phase := range []string{"before-executor", "after-executor"} {
		t.Run(phase, func(t *testing.T) {
			repo := &admissionWriteFailure{Repository: newTestRepo(t), failPrepare: phase == "before-executor", failAccepted: phase == "after-executor"}
			executor := &recordingExecutor{}
			params := baseParams(t.TempDir())
			params.HubTaskID = "hub-persistence"
			if _, err := Create(repo, executor, nil, params); !errors.Is(err, errcode.ErrAdmissionPersistFailed) {
				t.Fatalf("write failure err=%v", err)
			}
			wantStarts := 0
			if phase == "after-executor" {
				wantStarts = 1
			}
			if executor.startCount() != wantStarts {
				t.Fatalf("start count after failure=%d want=%d", executor.startCount(), wantStarts)
			}
			run, err := Create(repo, executor, nil, params)
			if err != nil || run.AdmissionState != store.RunAdmissionAccepted || executor.startCount() != 1 {
				t.Fatalf("retry=%#v err=%v starts=%d", run, err, executor.startCount())
			}
			if _, err := Create(repo, executor, nil, params); err != nil || executor.startCount() != 1 {
				t.Fatalf("replay err=%v starts=%d", err, executor.startCount())
			}
		})
	}
}

func TestHubAdmission_ReopenKeepsIdentityWithoutRestarting(t *testing.T) {
	constructors := map[string]func(string) (store.Repository, error){
		"file":   func(p string) (store.Repository, error) { return store.NewFile(p) },
		"sqlite": func(p string) (store.Repository, error) { return store.NewSQLite(p) },
	}
	for backend, open := range constructors {
		t.Run(backend, func(t *testing.T) {
			for _, phase := range []string{"accepted", "pending", "legacy-queued", "legacy-started"} {
				t.Run(phase, func(t *testing.T) {
					path := filepath.Join(t.TempDir(), "runs.db")
					repo, err := open(path)
					if err != nil {
						t.Fatal(err)
					}
					if _, err = repo.CreateProject("proj_local", "Local", ""); err != nil {
						t.Fatal(err)
					}
					if _, err = repo.CreateThread("thread_local", "proj_local", "Local", "direct", "", ""); err != nil {
						t.Fatal(err)
					}
					params := baseParams(t.TempDir())
					params.HubTaskID = "hub-reopen"
					executor := &recordingExecutor{}
					var original store.Run
					switch phase {
					case "accepted":
						original, err = Create(repo, executor, nil, params)
					case "pending":
						original, err = repo.CreateRunAdmission("run-pending", "proj_local", "thread_local", params.HubTaskID, "")
					default:
						original, err = repo.CreateRun("run-legacy", "proj_local", "thread_local")
						if err == nil {
							original, _ = repo.SetRunHubTaskID(original.ID, params.HubTaskID)
						}
						if phase == "legacy-started" {
							original, _ = repo.SetRunStatus(original.ID, "started")
						}
					}
					if err != nil {
						t.Fatal(err)
					}
					repo.Close()
					recovered, err := open(path)
					if err != nil {
						t.Fatal(err)
					}
					defer recovered.Close()
					afterRestart := &recordingExecutor{}
					run, replayErr := Create(recovered, afterRestart, nil, params)
					if phase == "pending" || phase == "legacy-queued" {
						if !errors.Is(replayErr, errcode.ErrAdmissionUncertain) {
							t.Fatalf("ambiguous record err=%v run=%#v", replayErr, run)
						}
					} else if replayErr != nil || run.ID != original.ID {
						t.Fatalf("retained accepted identity=%#v err=%v", run, replayErr)
					}
					if afterRestart.startCount() != 0 {
						t.Fatal("reopening storage must not restart any retained run")
					}
				})
			}
		})
	}
}

func TestHubAdmission_DefaultReplayCannotCrossScope(t *testing.T) {
	repo := newTestRepo(t)
	executor := &recordingExecutor{}
	params := baseParams(t.TempDir())
	params.HubTaskID = "hub-scope"
	if _, err := Create(repo, executor, nil, params); err != nil {
		t.Fatal(err)
	}
	params.ProjectID = "another-project"
	if _, err := Create(repo, executor, nil, params); !errors.Is(err, errcode.ErrDeliveryConflict) {
		t.Fatalf("unscoped replay err=%v", err)
	}
	if executor.startCount() != 1 {
		t.Fatal("conflicting replay started another executor")
	}
}
