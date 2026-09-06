package store

import (
	"testing"
	"time"
)

func TestCleanupRuns_RetainsPendingAdmissionAfterEarlyExecutionFinish(t *testing.T) {
	repo := New()
	if _, err := repo.CreateProject("p", "Project", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.CreateThread("t", "p", "Thread", "direct", "", ""); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"pending", "accepted"} {
		if _, err := repo.CreateRunAdmission(id, "p", "t", id, ""); err != nil {
			t.Fatal(err)
		}
		repo.SetRunStatus(id, "finished")
	}
	if _, err := repo.RecordRunAdmission("accepted", ""); err != nil {
		t.Fatal(err)
	}
	repo.CleanupRuns(RunCleanupOptions{Now: time.Now().Add(48 * time.Hour), TerminalTTL: time.Hour, MaxTerminalRunsPerThread: 1})
	if _, ok := repo.GetRun("pending"); !ok {
		t.Fatal("retention removed uncertain admission evidence")
	}
	if _, ok := repo.GetRun("accepted"); ok {
		t.Fatal("ordinary accepted terminal record should still expire")
	}
}
