package store

import (
	"errors"
	"testing"
)

func TestStoreCreatesProjectThreadRunAndItem(t *testing.T) {
	s := New()

	project := s.CreateProject("proj_test", "Test Project")
	if project.ID != "proj_test" {
		t.Fatalf("project ID = %q, want proj_test", project.ID)
	}

	thread, err := s.CreateThread("thread_test", project.ID, "Test Thread")
	if err != nil {
		t.Fatalf("CreateThread returned error: %v", err)
	}
	if thread.ProjectID != project.ID {
		t.Fatalf("thread project ID = %q, want %q", thread.ProjectID, project.ID)
	}

	run, err := s.CreateRun("run_test", project.ID, thread.ID)
	if err != nil {
		t.Fatalf("CreateRun returned error: %v", err)
	}
	if run.Status != "queued" {
		t.Fatalf("run status = %q, want queued", run.Status)
	}

	item, err := s.CreateItem(Item{
		ID:        "item_test",
		ProjectID: project.ID,
		ThreadID:  thread.ID,
		RunID:     run.ID,
		Type:      "run",
		Status:    "queued",
	})
	if err != nil {
		t.Fatalf("CreateItem returned error: %v", err)
	}
	if item.ID != "item_test" {
		t.Fatalf("item ID = %q, want item_test", item.ID)
	}
}

func TestStoreRejectsRunForMissingThread(t *testing.T) {
	s := New()
	s.CreateProject("proj_test", "Test Project")

	_, err := s.CreateRun("run_test", "proj_test", "thread_missing")
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("CreateRun error = %v, want ErrNotFound", err)
	}
}

func TestStoreFiltersListsByProjectAndThread(t *testing.T) {
	s := New()
	s.CreateProject("proj_a", "A")
	s.CreateProject("proj_b", "B")
	threadA, _ := s.CreateThread("thread_a", "proj_a", "A")
	threadB, _ := s.CreateThread("thread_b", "proj_b", "B")
	runA, _ := s.CreateRun("run_a", "proj_a", threadA.ID)
	_, _ = s.CreateRun("run_b", "proj_b", threadB.ID)
	_, _ = s.CreateItem(Item{ID: "item_a", ProjectID: "proj_a", ThreadID: threadA.ID, RunID: runA.ID})
	_, _ = s.CreateItem(Item{ID: "item_b", ProjectID: "proj_b", ThreadID: threadB.ID})

	if got := s.ListThreads("proj_a"); len(got) != 1 || got[0].ID != "thread_a" {
		t.Fatalf("ListThreads(proj_a) = %#v, want only thread_a", got)
	}
	if got := s.ListRuns("thread_a"); len(got) != 1 || got[0].ID != "run_a" {
		t.Fatalf("ListRuns(thread_a) = %#v, want only run_a", got)
	}
	if got := s.ListThreadItems("thread_a"); len(got) != 1 || got[0].ID != "item_a" {
		t.Fatalf("ListThreadItems(thread_a) = %#v, want only item_a", got)
	}
}

func TestStoreUpdatesRunStatusTimestamps(t *testing.T) {
	s := New()
	s.CreateProject("proj_test", "Test Project")
	_, _ = s.CreateThread("thread_test", "proj_test", "Test Thread")
	_, _ = s.CreateRun("run_test", "proj_test", "thread_test")

	started, ok := s.SetRunStatus("run_test", "started")
	if !ok {
		t.Fatal("SetRunStatus returned ok=false")
	}
	if started.Status != "started" || started.StartedAt == "" {
		t.Fatalf("started run = %#v, want status started and startedAt", started)
	}

	finished, ok := s.SetRunStatus("run_test", "finished")
	if !ok {
		t.Fatal("SetRunStatus returned ok=false")
	}
	if finished.Status != "finished" || finished.FinishedAt == "" {
		t.Fatalf("finished run = %#v, want status finished and finishedAt", finished)
	}
}
