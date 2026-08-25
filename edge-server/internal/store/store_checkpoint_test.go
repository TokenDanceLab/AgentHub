package store

import "testing"

func TestStoreRunCheckpointUpsertAndGet(t *testing.T) {
	s := New()
	s.CreateProject("proj_cp", "Checkpoint", "")
	s.CreateThread("thread_cp", "proj_cp", "Checkpoint Thread", "", "", "")
	run, _ := s.CreateRun("run_cp", "proj_cp", "thread_cp")

	// Missing run is rejected.
	if _, err := s.UpsertRunCheckpoint(RunCheckpoint{RunID: "run_missing"}); err == nil {
		t.Fatal("UpsertRunCheckpoint missing run returned nil error")
	}
	// Empty run id is rejected.
	if _, err := s.UpsertRunCheckpoint(RunCheckpoint{}); err == nil {
		t.Fatal("UpsertRunCheckpoint empty run id returned nil error")
	}

	cp := RunCheckpoint{
		ID:        "cp-run_cp",
		RunID:     run.ID,
		WorkDir:   "/tmp/ws",
		FileCount: 1,
		Files: []CheckpointFile{
			{Path: "a.txt", Size: 5, Hash: "h1", Content: "hello"},
		},
	}
	saved, err := s.UpsertRunCheckpoint(cp)
	if err != nil {
		t.Fatalf("UpsertRunCheckpoint returned error: %v", err)
	}
	if saved.CreatedAt == "" {
		t.Fatal("UpsertRunCheckpoint did not stamp createdAt")
	}

	got, ok := s.GetRunCheckpoint(run.ID)
	if !ok || got.ID != "cp-run_cp" || got.WorkDir != "/tmp/ws" {
		t.Fatalf("GetRunCheckpoint = %#v, %v", got, ok)
	}
	if len(got.Files) != 1 || got.Files[0].Content != "hello" {
		t.Fatalf("GetRunCheckpoint files = %#v", got.Files)
	}

	// Get returns a deep copy: mutating it must not corrupt the store.
	got.Files[0].Content = "mutated"
	again, _ := s.GetRunCheckpoint(run.ID)
	if again.Files[0].Content != "hello" {
		t.Fatalf("GetRunCheckpoint leaked slice backing array: %#v", again.Files[0])
	}

	// Upsert replaces the previous checkpoint for the same run (1:1).
	cp2 := RunCheckpoint{ID: "cp-2", RunID: run.ID, FileCount: 0}
	if _, err := s.UpsertRunCheckpoint(cp2); err != nil {
		t.Fatalf("second UpsertRunCheckpoint returned error: %v", err)
	}
	replaced, ok := s.GetRunCheckpoint(run.ID)
	if !ok || replaced.ID != "cp-2" {
		t.Fatalf("checkpoint not replaced: %#v", replaced)
	}

	// Runs without a checkpoint honestly report absence.
	if _, ok := s.GetRunCheckpoint("run_none"); ok {
		t.Fatal("GetRunCheckpoint unknown run returned ok=true")
	}
}

func TestStoreRunCheckpointSnapshotRoundTrip(t *testing.T) {
	s := New()
	s.CreateProject("proj_cps", "Checkpoint Snapshot", "")
	s.CreateThread("thread_cps", "proj_cps", "Thread", "", "", "")
	s.CreateRun("run_cps", "proj_cps", "thread_cps")
	_, err := s.UpsertRunCheckpoint(RunCheckpoint{
		ID:      "cp-snap",
		RunID:   "run_cps",
		WorkDir: "/tmp/ws-snap",
		Files:   []CheckpointFile{{Path: "b.txt", Size: 1, Hash: "h", Content: "x"}},
	})
	if err != nil {
		t.Fatalf("UpsertRunCheckpoint returned error: %v", err)
	}

	snap := s.snapshot()
	restored := newEmptyStore()
	restored.applySnapshot(snap)

	got, ok := restored.GetRunCheckpoint("run_cps")
	if !ok || got.ID != "cp-snap" || got.WorkDir != "/tmp/ws-snap" || len(got.Files) != 1 {
		t.Fatalf("checkpoint lost in snapshot round-trip: %#v, %v", got, ok)
	}
}
