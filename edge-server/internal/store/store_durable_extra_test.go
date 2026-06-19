package store

import (
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"
)

// --- Store durability and edge case tests ---

// TestStoreSetRunStatusIfMultipleAllowed verifies that SetRunStatusIf
// accepts multiple allowed states for a transition.
func TestStoreSetRunStatusIfMultipleAllowed(t *testing.T) {
	s := New()
	project, _ := s.CreateProject("proj_status_if", "StatusIf Project", "")
	thread, _ := s.CreateThread("thread_status_if", project.ID, "Thread", "", "", "")
	run, _ := s.CreateRun("run_status_if", project.ID, thread.ID)

	// Should allow queued -> started (queued is allowed).
	started, ok := s.SetRunStatusIf(run.ID, "started", "queued")
	if !ok || started.Status != "started" || started.StartedAt == "" {
		t.Fatalf("SetRunStatusIf queued->started = %#v, %v", started, ok)
	}

	// Should allow started -> cancelling (multiple allowed states: queued, started, cancelling).
	cancelling, ok := s.SetRunStatusIf(run.ID, "cancelling", "queued", "started", "cancelling")
	if !ok || cancelling.Status != "cancelling" {
		t.Fatalf("SetRunStatusIf started->cancelling = %#v, %v", cancelling, ok)
	}

	// Should NOT allow cancelling -> finished (finished not in the allowed list).
	finished, ok := s.SetRunStatusIf(run.ID, "finished", "queued", "started")
	if ok || finished.Status != "cancelling" {
		t.Fatalf("SetRunStatusIf cancelling->finished should fail: %#v, %v", finished, ok)
	}

	stored, _ := s.GetRun(run.ID)
	if stored.Status != "cancelling" {
		t.Fatalf("run status should be unchanged at cancelling, got %q", stored.Status)
	}
}

// TestStoreSetRunStatusIfEmptyAllowedAlwaysPasses verifies that
// calling SetRunStatusIf with no allowedCurrent list always allows
// the transition.
func TestStoreSetRunStatusIfEmptyAllowedAlwaysPasses(t *testing.T) {
	s := New()
	project, _ := s.CreateProject("proj_empty_allowed", "EmptyAllowed", "")
	thread, _ := s.CreateThread("thread_empty_allowed", project.ID, "Thread", "", "", "")
	run, _ := s.CreateRun("run_empty_allowed", project.ID, thread.ID)

	// Empty allowedCurrent list means any transition is allowed.
	started, ok := s.SetRunStatusIf(run.ID, "started")
	if !ok || started.Status != "started" {
		t.Fatalf("SetRunStatusIf empty allowed = %#v, %v", started, ok)
	}

	// Can also go directly to finished with empty list.
	finished, ok := s.SetRunStatusIf(run.ID, "finished")
	if !ok || finished.Status != "finished" || finished.FinishedAt == "" {
		t.Fatalf("SetRunStatusIf started->finished empty allowed = %#v, %v", finished, ok)
	}
}

// TestStoreUpsertRunDiffFileEmptyPathRejected verifies that a blank
// path in UpsertRunDiffFile returns ErrNotFound.
func TestStoreUpsertRunDiffFileEmptyPathRejected(t *testing.T) {
	s := New()
	project, _ := s.CreateProject("proj_diff_empty", "DiffEmpty", "")
	thread, _ := s.CreateThread("thread_diff_empty", project.ID, "Thread", "", "", "")
	run, _ := s.CreateRun("run_diff_empty", project.ID, thread.ID)

	_, err := s.UpsertRunDiffFile(RunDiffFile{
		RunID:  run.ID,
		Path:   "",
		Diff:   "+new",
		Status: "added",
	})
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("UpsertRunDiffFile empty path error = %v, want ErrNotFound", err)
	}

	_, err = s.UpsertRunDiffFile(RunDiffFile{
		RunID:  run.ID,
		Path:   "   ",
		Diff:   "+new",
		Status: "added",
	})
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("UpsertRunDiffFile whitespace-only path error = %v, want ErrNotFound", err)
	}
}

// TestStoreUpsertRunDiffFileStatusNormalization verifies status mapping.
func TestStoreUpsertRunDiffFileStatusNormalization(t *testing.T) {
	s := New()
	project, _ := s.CreateProject("proj_diff_status", "DiffStatus", "")
	thread, _ := s.CreateThread("thread_diff_status", project.ID, "Thread", "", "", "")
	run, _ := s.CreateRun("run_diff_status", project.ID, thread.ID)

	tests := []struct {
		input string
		want  string
	}{
		{"added", "added"},
		{"created", "added"},
		{"add", "added"},
		{"deleted", "deleted"},
		{"delete", "deleted"},
		{"removed", "deleted"},
		{"remove", "deleted"},
		{"modified", "modified"},
		{"unknown-status", "modified"},
		{"", "modified"},
	}

	for _, tt := range tests {
		diff, err := s.UpsertRunDiffFile(RunDiffFile{
			RunID:  run.ID,
			Path:   "src/" + tt.input + ".go",
			Diff:   "@@ change",
			Status: tt.input,
		})
		if err != nil {
			t.Fatalf("UpsertRunDiffFile(%q) error = %v", tt.input, err)
		}
		if diff.Status != tt.want {
			t.Fatalf("UpsertRunDiffFile(%q) status = %q, want %q", tt.input, diff.Status, tt.want)
		}
	}
}

// TestStoreConcurrentReadWrite verifies that concurrent reads and writes
// to the in-memory store do not cause data races.
func TestStoreConcurrentReadWrite(t *testing.T) {
	s := New()
	project, _ := s.CreateProject("proj_concurrent", "Concurrent", "")
	thread, _ := s.CreateThread("thread_concurrent", project.ID, "Thread", "", "", "")

	var wg sync.WaitGroup
	// Writers: create runs concurrently.
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			s.CreateRun(fmt.Sprintf("run_conc_%d", idx), project.ID, thread.ID)
		}(i)
	}

	// Readers: list runs and threads concurrently.
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			s.ListProjects()
			s.ListThreads(project.ID)
			s.ListRuns(thread.ID)
		}()
	}
	wg.Wait()

	runs := s.ListRuns(thread.ID)
	if len(runs) != 50 {
		t.Fatalf("expected 50 runs after concurrent creation, got %d", len(runs))
	}
}

// TestStoreConcurrentRunStatusTransitions verifies concurrent
// SetRunStatus operations do not race.
func TestStoreConcurrentRunStatusTransitions(t *testing.T) {
	s := New()
	project, _ := s.CreateProject("proj_status_race", "StatusRace", "")
	thread, _ := s.CreateThread("thread_status_race", project.ID, "Thread", "", "", "")
	run, _ := s.CreateRun("run_status_race", project.ID, thread.ID)

	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			s.SetRunStatusIf(run.ID, "started", "queued")
			s.GetRun(run.ID)
			s.SetRunStatus(run.ID, "finished")
		}(i)
	}
	wg.Wait()

	// Final status must be either finished or started (not queued).
	final, ok := s.GetRun(run.ID)
	if !ok {
		t.Fatal("run not found after concurrent status updates")
	}
	if final.Status != "finished" && final.Status != "started" {
		t.Fatalf("unexpected final status: %q", final.Status)
	}
}

// TestStoreConcurrentPinOperations verifies concurrent pin operations
// do not race.
func TestStoreConcurrentPinOperations(t *testing.T) {
	s := New()
	project, _ := s.CreateProject("proj_pin_race", "PinRace", "")
	thread, _ := s.CreateThread("thread_pin_race", project.ID, "Thread", "", "", "")

	var wg sync.WaitGroup
	for i := 0; i < 30; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			item, _ := s.CreateThreadMessage(fmt.Sprintf("item_pin_%d", idx), thread.ID, "assistant", "content")
			s.PinThreadItem(thread.ID, item.ID, "user")
		}(i)
	}
	wg.Wait()

	pins := s.ListThreadPins(thread.ID)
	if len(pins) != 30 {
		t.Fatalf("expected 30 pins, got %d", len(pins))
	}
}

// TestStoreRunCleanupRemovesEvidence verifies that cleaning up a run
// also removes its associated evidence (diffs, artifacts, previews).
func TestStoreRunCleanupRemovesEvidence(t *testing.T) {
	s := New()
	project, _ := s.CreateProject("proj_cleanup_evidence", "CleanupEvidence", "")
	thread, _ := s.CreateThread("thread_cleanup_evidence", project.ID, "Thread", "", "", "")

	// Create 3 runs with evidence.
	run1, _ := s.CreateRun("run_ce_1", project.ID, thread.ID)
	run2, _ := s.CreateRun("run_ce_2", project.ID, thread.ID)
	run3, _ := s.CreateRun("run_ce_3", project.ID, thread.ID)

	s.SetRunStatus(run1.ID, "finished")
	s.SetRunStatus(run2.ID, "finished")
	s.SetRunStatus(run3.ID, "started") // not terminal

	s.UpsertRunDiffFile(RunDiffFile{RunID: run1.ID, Path: "a.go", Diff: "+a", Status: "added"})
	s.UpsertRunDiffFile(RunDiffFile{RunID: run2.ID, Path: "b.go", Diff: "+b", Status: "added"})
	s.UpsertRunDiffFile(RunDiffFile{RunID: run3.ID, Path: "c.go", Diff: "+c", Status: "added"})

	s.UpsertArtifact(Artifact{ID: "art_1", RunID: run1.ID, ThreadID: thread.ID, Kind: "file", Path: "a.out"})
	s.UpsertArtifact(Artifact{ID: "art_2", RunID: run2.ID, ThreadID: thread.ID, Kind: "file", Path: "b.out"})
	s.UpsertArtifact(Artifact{ID: "art_3", RunID: run3.ID, ThreadID: thread.ID, Kind: "file", Path: "c.out"})

	s.UpsertPreview(Preview{ID: "pre_1", RunID: run1.ID, ThreadID: thread.ID, URL: "http://1", Status: "ready"})
	s.UpsertPreview(Preview{ID: "pre_2", RunID: run2.ID, ThreadID: thread.ID, URL: "http://2", Status: "ready"})
	s.UpsertPreview(Preview{ID: "pre_3", RunID: run3.ID, ThreadID: thread.ID, URL: "http://3", Status: "ready"})

	// Cleanup runs 1 and 2 (both terminal, TTL expired).
	result := s.CleanupRuns(RunCleanupOptions{
		Now:         time.Now().UTC().Add(48 * time.Hour),
		TerminalTTL: time.Hour,
	})
	if result.RemovedRuns != 2 {
		t.Fatalf("expected 2 removed runs, got %d", result.RemovedRuns)
	}

	// run1 and run2 evidence must be gone.
	if diffs := s.ListRunDiffFiles(run1.ID); len(diffs) != 0 {
		t.Fatalf("run1 diffs should be empty after cleanup, got %d", len(diffs))
	}
	if diffs := s.ListRunDiffFiles(run2.ID); len(diffs) != 0 {
		t.Fatalf("run2 diffs should be empty after cleanup, got %d", len(diffs))
	}
	if arts := s.ListArtifacts(run1.ID); len(arts) != 0 {
		t.Fatalf("run1 artifacts should be empty after cleanup, got %d", len(arts))
	}

	// run3 evidence must remain (not cleaned up since run is not terminal).
	if diffs := s.ListRunDiffFiles(run3.ID); len(diffs) != 1 {
		t.Fatalf("run3 diffs should have 1, got %d", len(diffs))
	}
	if arts := s.ListArtifacts(""); len(arts) != 1 {
		t.Fatalf("all artifacts should have 1 remaining, got %d", len(arts))
	}
}

// TestStoreUpsertRunDiffFileMissingRun verifies that adding a diff for
// a non-existent run returns ErrNotFound.
func TestStoreUpsertRunDiffFileMissingRun(t *testing.T) {
	s := New()
	_, err := s.UpsertRunDiffFile(RunDiffFile{
		RunID:  "nonexistent",
		Path:   "src/app.ts",
		Diff:   "+new",
		Status: "added",
	})
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("UpsertRunDiffFile missing run error = %v, want ErrNotFound", err)
	}
}

// TestStoreCreateRunDuplicateThreadCrossProject verifies that a run
// referencing a thread from a different project returns ErrNotFound.
func TestStoreCreateRunDuplicateThreadCrossProject(t *testing.T) {
	s := New()
	projectA, _ := s.CreateProject("proj_a", "Project A", "")
	projectB, _ := s.CreateProject("proj_b", "Project B", "")
	threadB, _ := s.CreateThread("thread_b", projectB.ID, "Thread B", "", "", "")

	// Create a run on projectA with threadB's ID (should fail).
	_, err := s.CreateRun("run_cross", projectA.ID, threadB.ID)
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("CreateRun cross-project error = %v, want ErrNotFound", err)
	}
}
