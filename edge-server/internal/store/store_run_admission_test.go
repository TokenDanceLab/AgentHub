package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestRunAdmissionStateMachine(t *testing.T) {
	s := New()
	project, thread := seedRunAdmissionStore(t, s)

	if _, err := s.CreateRunAdmission("admission_missing_hub", project.ID, thread.ID, "", ""); !errors.Is(err, ErrRunAdmissionHubTaskIDRequired) {
		t.Fatalf("CreateRunAdmission empty HubTaskID error = %v, want ErrRunAdmissionHubTaskIDRequired", err)
	}

	run, err := s.CreateRunAdmission("admission_run_1", project.ID, thread.ID, "hub-task-1", "")
	if err != nil {
		t.Fatalf("CreateRunAdmission returned error: %v", err)
	}
	if run.ID != "admission_run_1" || run.Status != "queued" || run.HubTaskID != "hub-task-1" || run.AdmissionState != RunAdmissionPending || run.AdmissionErrorCode != "" {
		t.Fatalf("CreateRunAdmission = %#v, want queued/pending/hub-task-1", run)
	}

	if _, ok := s.SetRunStatus(run.ID, "started"); !ok {
		t.Fatal("SetRunStatus started returned false")
	}
	if _, ok := s.SetRunEvidenceGate(run.ID, `{"ok":true}`); !ok {
		t.Fatal("SetRunEvidenceGate returned false")
	}
	if _, ok := s.SetRunRetryCount(run.ID, 3); !ok {
		t.Fatal("SetRunRetryCount returned false")
	}
	if _, ok := s.SetRunWorkDir(run.ID, "run-workdir"); !ok {
		t.Fatal("SetRunWorkDir returned false")
	}

	before, ok := s.GetRun(run.ID)
	if !ok {
		t.Fatal("GetRun after state setup returned false")
	}
	accepted, err := s.RecordRunAdmission(run.ID, "")
	if err != nil {
		t.Fatalf("RecordRunAdmission accepted returned error: %v", err)
	}
	if accepted.AdmissionState != RunAdmissionAccepted || accepted.AdmissionErrorCode != "" {
		t.Fatalf("RecordRunAdmission accepted = %#v", accepted)
	}
	if accepted.Status != before.Status || accepted.StartedAt != before.StartedAt || accepted.FinishedAt != before.FinishedAt ||
		accepted.EvidenceGateResult != before.EvidenceGateResult || accepted.RetryCount != before.RetryCount || accepted.WorkDir != before.WorkDir ||
		accepted.HubTaskID != before.HubTaskID {
		t.Fatalf("RecordRunAdmission changed execution metadata: before=%#v after=%#v", before, accepted)
	}

	repeated, err := s.RecordRunAdmission(run.ID, "")
	if err != nil {
		t.Fatalf("RecordRunAdmission repeated accepted returned error: %v", err)
	}
	if repeated.AdmissionState != RunAdmissionAccepted || repeated.AdmissionErrorCode != "" {
		t.Fatalf("repeated accepted = %#v", repeated)
	}
	if _, err := s.RecordRunAdmission(run.ID, "capacity"); !errors.Is(err, ErrRunAdmissionInvalidTransition) {
		t.Fatalf("accepted -> rejected error = %v, want ErrRunAdmissionInvalidTransition", err)
	}

	rejected, err := s.CreateRunAdmission("admission_run_2", project.ID, thread.ID, "hub-task-2", "")
	if err != nil {
		t.Fatalf("CreateRunAdmission second returned error: %v", err)
	}
	rejected, err = s.RecordRunAdmission(rejected.ID, "capacity")
	if err != nil {
		t.Fatalf("RecordRunAdmission rejected returned error: %v", err)
	}
	if rejected.AdmissionState != RunAdmissionRejected || rejected.AdmissionErrorCode != "capacity" {
		t.Fatalf("RecordRunAdmission rejected = %#v", rejected)
	}
	if _, err := s.RecordRunAdmission(rejected.ID, "capacity"); err != nil {
		t.Fatalf("RecordRunAdmission repeated rejected returned error: %v", err)
	}
	if _, err := s.RecordRunAdmission(rejected.ID, "different"); !errors.Is(err, ErrRunAdmissionInvalidTransition) {
		t.Fatalf("rejected different code error = %v, want ErrRunAdmissionInvalidTransition", err)
	}

	legacy, err := s.CreateRun("admission_legacy", project.ID, thread.ID)
	if err != nil {
		t.Fatalf("CreateRun legacy returned error: %v", err)
	}
	if _, err := s.RecordRunAdmission(legacy.ID, ""); !errors.Is(err, ErrRunAdmissionInvalidTransition) {
		t.Fatalf("legacy run admission error = %v, want ErrRunAdmissionInvalidTransition", err)
	}

	if _, err := s.RecordRunAdmission("admission_missing", ""); !errors.Is(err, ErrNotFound) {
		t.Fatalf("RecordRunAdmission missing error = %v, want ErrNotFound", err)
	}
}

func TestCreateRunAdmissionDoesNotResetExistingFinalOrLegacy(t *testing.T) {
	s := New()
	project, thread := seedRunAdmissionStore(t, s)

	accepted, err := s.CreateRunAdmission("same_admission_id", project.ID, thread.ID, "same-task", "")
	if err != nil {
		t.Fatalf("CreateRunAdmission accepted returned error: %v", err)
	}
	accepted, err = s.RecordRunAdmission(accepted.ID, "")
	if err != nil {
		t.Fatalf("RecordRunAdmission accepted returned error: %v", err)
	}

	// Rebuilding an existing run ID must not downgrade a final admission.
	if _, err := s.CreateRunAdmission(accepted.ID, project.ID, thread.ID, "same-task", ""); err == nil ||
		(!errors.Is(err, ErrRunAdmissionInvalidTransition) && !errors.Is(err, ErrRunAdmissionExists)) {
		t.Fatalf("CreateRunAdmission same accepted ID error = %v, want explicit admission conflict", err)
	}
	got, ok := s.GetRun(accepted.ID)
	if !ok || got.AdmissionState != RunAdmissionAccepted || got.AdmissionErrorCode != "" ||
		got.HubTaskID != "same-task" || got.ProjectID != project.ID || got.ThreadID != thread.ID {
		t.Fatalf("accepted run changed after same-ID CreateRunAdmission: %#v, %v", got, ok)
	}

	// A different HubTaskID must never overwrite the existing binding.
	if _, err := s.CreateRunAdmission(accepted.ID, project.ID, thread.ID, "different-task", ""); err == nil ||
		(!errors.Is(err, ErrRunAdmissionInvalidTransition) && !errors.Is(err, ErrRunAdmissionExists)) {
		t.Fatalf("CreateRunAdmission different HubTaskID error = %v, want explicit conflict", err)
	}
	got, _ = s.GetRun(accepted.ID)
	if got.AdmissionState != RunAdmissionAccepted || got.AdmissionErrorCode != "" || got.HubTaskID != "same-task" {
		t.Fatalf("different HubTaskID changed accepted binding: %#v", got)
	}

	// A different project/thread must also never overwrite the existing binding.
	otherProject, err := s.CreateProject("admission_project_other", "Other", "")
	if err != nil {
		t.Fatalf("CreateProject other returned error: %v", err)
	}
	otherThread, err := s.CreateThread("admission_thread_other", otherProject.ID, "Other Thread", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread other returned error: %v", err)
	}
	if _, err := s.CreateRunAdmission(accepted.ID, otherProject.ID, otherThread.ID, "same-task", ""); err == nil ||
		(!errors.Is(err, ErrRunAdmissionInvalidTransition) && !errors.Is(err, ErrRunAdmissionExists)) {
		t.Fatalf("CreateRunAdmission different scope error = %v, want explicit conflict", err)
	}
	got, _ = s.GetRun(accepted.ID)
	if got.AdmissionState != RunAdmissionAccepted || got.HubTaskID != "same-task" ||
		got.ProjectID != project.ID || got.ThreadID != thread.ID {
		t.Fatalf("different scope changed accepted run: %#v", got)
	}

	// A matching pending run ID is idempotent.
	pending, err := s.CreateRunAdmission("pending_admission_id", project.ID, thread.ID, "pending-task", "")
	if err != nil {
		t.Fatalf("CreateRunAdmission pending returned error: %v", err)
	}
	again, err := s.CreateRunAdmission(pending.ID, project.ID, thread.ID, "pending-task", "")
	if err != nil {
		t.Fatalf("CreateRunAdmission matching pending retry returned error: %v", err)
	}
	if again.AdmissionState != RunAdmissionPending || again.HubTaskID != "pending-task" {
		t.Fatalf("matching pending retry changed record: %#v", again)
	}

	// New attempts keep using a new run ID and remain usable.
	attempt, err := s.CreateRunAdmission("new_attempt_id", project.ID, thread.ID, "same-task", "")
	if err != nil {
		t.Fatalf("CreateRunAdmission new attempt returned error: %v", err)
	}
	if attempt.AdmissionState != RunAdmissionPending || attempt.HubTaskID != "same-task" {
		t.Fatalf("new attempt = %#v, want pending same-task", attempt)
	}
	if got, ok := s.GetRunByHubTaskID("same-task"); !ok || got.ID != attempt.ID {
		t.Fatalf("GetRunByHubTaskID after new attempt = %#v, %v; want newest %q", got, ok, attempt.ID)
	}

	// Legacy runs without admission state cannot be reset or bound by this method.
	legacy, err := s.CreateRun("legacy_admission_id", project.ID, thread.ID)
	if err != nil {
		t.Fatalf("CreateRun legacy returned error: %v", err)
	}
	if _, err := s.CreateRunAdmission(legacy.ID, project.ID, thread.ID, "legacy-task", ""); err == nil ||
		(!errors.Is(err, ErrRunAdmissionInvalidTransition) && !errors.Is(err, ErrRunAdmissionExists)) {
		t.Fatalf("CreateRunAdmission legacy ID error = %v, want explicit conflict", err)
	}
	legacyGot, ok := s.GetRun(legacy.ID)
	if !ok || legacyGot.AdmissionState != "" || legacyGot.HubTaskID != "" {
		t.Fatalf("legacy run changed: %#v, %v", legacyGot, ok)
	}
}

func TestRunAdmissionPhasesSurviveReopen(t *testing.T) {
	for _, kind := range []string{"file", "sqlite"} {
		t.Run(kind, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "admission-store.dat")
			first := openRunAdmissionStore(t, kind, path)
			project, thread := seedRunAdmissionStore(t, first)

			pending, err := first.CreateRunAdmission("admission_pending", project.ID, thread.ID, "task-pending", "")
			if err != nil {
				t.Fatalf("CreateRunAdmission pending returned error: %v", err)
			}
			assertDurableRunAdmission(t, first, path, pending.ID, RunAdmissionPending, "task-pending", "")
			accepted, err := first.CreateRunAdmission("admission_accepted", project.ID, thread.ID, "task-accepted", "")
			if err != nil {
				t.Fatalf("CreateRunAdmission accepted returned error: %v", err)
			}
			accepted, err = first.RecordRunAdmission(accepted.ID, "")
			if err != nil {
				t.Fatalf("RecordRunAdmission accepted returned error: %v", err)
			}
			assertDurableRunAdmission(t, first, path, accepted.ID, RunAdmissionAccepted, "task-accepted", "")
			rejected, err := first.CreateRunAdmission("admission_rejected", project.ID, thread.ID, "task-rejected", "")
			if err != nil {
				t.Fatalf("CreateRunAdmission rejected returned error: %v", err)
			}
			rejected, err = first.RecordRunAdmission(rejected.ID, "capacity")
			if err != nil {
				t.Fatalf("RecordRunAdmission rejected returned error: %v", err)
			}
			assertDurableRunAdmission(t, first, path, rejected.ID, RunAdmissionRejected, "task-rejected", "capacity")
			first.Close()

			second := openRunAdmissionStore(t, kind, path)
			defer second.Close()

			gotPending, ok := second.GetRun(pending.ID)
			if !ok || gotPending.HubTaskID != pending.HubTaskID || gotPending.AdmissionState != RunAdmissionPending || gotPending.AdmissionErrorCode != "" {
				t.Fatalf("reopen pending = %#v, %v", gotPending, ok)
			}
			gotAccepted, ok := second.GetRun(accepted.ID)
			if !ok || gotAccepted.HubTaskID != accepted.HubTaskID || gotAccepted.AdmissionState != RunAdmissionAccepted || gotAccepted.AdmissionErrorCode != "" {
				t.Fatalf("reopen accepted = %#v, %v", gotAccepted, ok)
			}
			gotRejected, ok := second.GetRun(rejected.ID)
			if !ok || gotRejected.HubTaskID != rejected.HubTaskID || gotRejected.AdmissionState != RunAdmissionRejected || gotRejected.AdmissionErrorCode != "capacity" {
				t.Fatalf("reopen rejected = %#v, %v", gotRejected, ok)
			}
		})
	}
}

func TestRunAdmissionLatestAttempt(t *testing.T) {
	for _, kind := range []string{"memory", "file", "sqlite"} {
		t.Run(kind, func(t *testing.T) {
			var repo Repository
			var path string
			if kind == "memory" {
				repo = New()
			} else {
				path = filepath.Join(t.TempDir(), "admission-latest.dat")
				repo = openRunAdmissionStore(t, kind, path)
			}
			project, thread := seedRunAdmissionStore(t, repo)
			first, err := repo.CreateRunAdmission("admission_latest_1", project.ID, thread.ID, "hub-task-latest", "")
			if err != nil {
				t.Fatalf("CreateRunAdmission first returned error: %v", err)
			}
			if _, err := repo.RecordRunAdmission(first.ID, "capacity"); err != nil {
				t.Fatalf("RecordRunAdmission first returned error: %v", err)
			}
			second, err := repo.CreateRunAdmission("admission_latest_2", project.ID, thread.ID, "hub-task-latest", "")
			if err != nil {
				t.Fatalf("CreateRunAdmission second returned error: %v", err)
			}
			third, err := repo.CreateRunAdmission("admission_latest_3", project.ID, thread.ID, "hub-task-latest", "")
			if err != nil {
				t.Fatalf("CreateRunAdmission third returned error: %v", err)
			}
			if got, ok := repo.GetRunByHubTaskID("hub-task-latest"); !ok || got.ID != third.ID {
				t.Fatalf("GetRunByHubTaskID before reopen = %#v, %v; want %q", got, ok, third.ID)
			}
			if kind != "memory" {
				repo.Close()
				reopened := openRunAdmissionStore(t, kind, path)
				defer reopened.Close()
				if got, ok := reopened.GetRunByHubTaskID("hub-task-latest"); !ok || got.ID != third.ID || got.AdmissionState != RunAdmissionPending {
					t.Fatalf("GetRunByHubTaskID after reopen = %#v, %v; want latest pending %q", got, ok, third.ID)
				}
			} else {
				if got, ok := repo.GetRunByHubTaskID("hub-task-latest"); !ok || got.ID != third.ID {
					t.Fatalf("GetRunByHubTaskID memory = %#v; want latest %q", got, third.ID)
				}
			}
			_ = second
		})
	}
}

func TestRunAdmissionPersistenceFailureRetry(t *testing.T) {
	for _, kind := range []string{"file", "sqlite"} {
		t.Run(kind, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "admission-persist.dat")
			repo := openRunAdmissionStore(t, kind, path)
			project, thread := seedRunAdmissionStore(t, repo)

			block, unblock := blockRunAdmissionPersistence(t, repo)

			block()
			run, err := repo.CreateRunAdmission("admission_persist_retry", project.ID, thread.ID, "hub-task-persist", "")
			if err == nil {
				t.Fatal("CreateRunAdmission with blocked persistence returned nil error")
			}
			if run.HubTaskID != "hub-task-persist" || run.AdmissionState != RunAdmissionPending {
				t.Fatalf("CreateRunAdmission on persist failure run = %#v, want pending marker", run)
			}
			unblock()

			accepted, err := repo.RecordRunAdmission(run.ID, "")
			if err != nil {
				t.Fatalf("RecordRunAdmission after recovery returned error: %v", err)
			}
			if accepted.AdmissionState != RunAdmissionAccepted {
				t.Fatalf("RecordRunAdmission after recovery = %#v, want accepted", accepted)
			}

			block()
			if _, err := repo.RecordRunAdmission(run.ID, ""); err == nil {
				t.Fatal("duplicate RecordRunAdmission with blocked persistence returned nil error")
			}
			unblock()
			retried, err := repo.RecordRunAdmission(run.ID, "")
			if err != nil {
				t.Fatalf("duplicate RecordRunAdmission after recovery returned error: %v", err)
			}
			if retried.AdmissionState != RunAdmissionAccepted || retried.AdmissionErrorCode != "" {
				t.Fatalf("duplicate retry run = %#v", retried)
			}

			persistErr, ok := repo.(interface{ LastPersistError() error })
			if !ok {
				t.Fatal("Repository does not expose LastPersistError")
			}
			if err := persistErr.LastPersistError(); err != nil {
				t.Fatalf("LastPersistError after successful retry = %v, want nil", err)
			}
			repo.Close()
		})
	}
}

func seedRunAdmissionStore(t *testing.T, repo Repository) (Project, Thread) {
	t.Helper()
	project, err := repo.CreateProject("admission_project", "Admission Project", "")
	if err != nil {
		t.Fatalf("CreateProject returned error: %v", err)
	}
	thread, err := repo.CreateThread("admission_thread", project.ID, "Admission Thread", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread returned error: %v", err)
	}
	return project, thread
}

func openRunAdmissionStore(t *testing.T, kind, path string) Repository {
	t.Helper()
	switch kind {
	case "file":
		store, err := NewFile(path)
		if err != nil {
			t.Fatalf("NewFile returned error: %v", err)
		}
		t.Cleanup(store.Close)
		return store
	case "sqlite":
		store, err := NewSQLite(path)
		if err != nil {
			t.Fatalf("NewSQLite returned error: %v", err)
		}
		t.Cleanup(store.Close)
		return store
	default:
		t.Fatalf("unknown admission store kind %q", kind)
		return nil
	}
}

func assertDurableRunAdmission(t *testing.T, repo Repository, path, runID, state, hubTaskID, errorCode string) {
	t.Helper()
	var run Run
	var ok bool
	switch r := repo.(type) {
	case *FileStore:
		run, ok = readFileSnapshotRun(t, path, runID)
	case *SQLiteStore:
		run, ok = readSQLiteRunMetadata(t, r, runID)
	default:
		t.Fatalf("unsupported durable admission repo %T", repo)
	}
	if !ok {
		t.Fatalf("durable run %q not found in %T", runID, repo)
	}
	if run.HubTaskID != hubTaskID || run.AdmissionState != state || run.AdmissionErrorCode != errorCode {
		t.Fatalf("durable run %q = %#v, want HubTaskID=%q state=%q errorCode=%q", runID, run, hubTaskID, state, errorCode)
	}
}

func readFileSnapshotRun(t *testing.T, path, runID string) (Run, bool) {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read file snapshot %s: %v", path, err)
	}
	var snapshot fileSnapshot
	if err := json.Unmarshal(data, &snapshot); err != nil {
		t.Fatalf("decode file snapshot %s: %v", path, err)
	}
	run, ok := snapshot.Runs[runID]
	return run, ok
}

// SQLite keeps run admission metadata in the durable row payload. The edge_runs
// relational projection is a separate view and does not carry these fields.
func readSQLiteRunMetadata(t *testing.T, r *SQLiteStore, runID string) (Run, bool) {
	t.Helper()
	var payload string
	err := r.db.QueryRow(`SELECT payload FROM agenthub_store_rows WHERE row_kind = ? AND row_id = ?`, sqliteRowKindRun, runID).Scan(&payload)
	if errors.Is(err, sql.ErrNoRows) {
		return Run{}, false
	}
	if err != nil {
		t.Fatalf("query sqlite run metadata %s: %v", runID, err)
	}
	var run Run
	if err := decodeSQLiteRowPayload(payload, &run); err != nil {
		t.Fatalf("decode sqlite run metadata %s: %v", runID, err)
	}
	return run, true
}

func blockRunAdmissionPersistence(t *testing.T, repo Repository) (func(), func()) {
	t.Helper()
	switch r := repo.(type) {
	case *FileStore:
		return func() {
				r.persistMu.Lock()
				defer r.persistMu.Unlock()
				if err := os.Remove(r.path); err != nil && !errors.Is(err, os.ErrNotExist) {
					t.Fatalf("remove file snapshot before block: %v", err)
				}
				if err := os.Mkdir(r.path, 0o750); err != nil {
					t.Fatalf("mkdir snapshot path to block rename: %v", err)
				}
			}, func() {
				r.persistMu.Lock()
				defer r.persistMu.Unlock()
				if err := os.Remove(r.path); err != nil {
					t.Fatalf("remove snapshot path block: %v", err)
				}
			}
	case *SQLiteStore:
		return func() {
				if _, err := r.db.Exec(`PRAGMA query_only = ON`); err != nil {
					t.Fatalf("enable sqlite query_only: %v", err)
				}
			}, func() {
				if _, err := r.db.Exec(`PRAGMA query_only = OFF`); err != nil {
					t.Fatalf("disable sqlite query_only: %v", err)
				}
			}
	default:
		t.Fatalf("unsupported persistence repo %T", repo)
		return nil, nil
	}
}
