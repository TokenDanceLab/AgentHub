package store

import (
	"path/filepath"
	"testing"
)

func TestRunCallbackOwnerSurvivesReopen(t *testing.T) {
	for _, kind := range []string{"file", "sqlite"} {
		t.Run(kind, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "owners.db")
			repository := openRunAdmissionStore(t, kind, path)
			project, thread := seedRunAdmissionStore(t, repository)
			for _, owner := range []string{"edge", "desktop"} {
				run, err := repository.CreateRunAdmission("run-"+owner, project.ID, thread.ID, "task-"+owner, owner)
				if err != nil {
					t.Fatal(err)
				}
				if _, err := repository.CreateRunAdmission(run.ID, project.ID, thread.ID, run.HubTaskID, "different"); err == nil {
					t.Fatal("pending owner could be reassigned")
				}
				if _, err := repository.RecordRunAdmission(run.ID, ""); err != nil {
					t.Fatal(err)
				}
			}
			repository.Close()
			recovered := openRunAdmissionStore(t, kind, path)
			for _, owner := range []string{"edge", "desktop"} {
				run, ok := recovered.GetRun("run-" + owner)
				if !ok || run.CallbackOwner != owner {
					t.Fatalf("owner lost after reopen: %#v", run)
				}
			}
		})
	}
}
