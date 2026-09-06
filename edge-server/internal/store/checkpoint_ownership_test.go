package store

import (
	"path/filepath"
	"reflect"
	"testing"
)

func TestRunCheckpointWriteOwnsFiles(t *testing.T) {
	t.Parallel()
	for _, backend := range []struct {
		name string
		open func(string) (Repository, error)
	}{
		{"memory", func(string) (Repository, error) { return New(), nil }},
		{"file", func(path string) (Repository, error) { return NewFile(path) }},
		{"sqlite", func(path string) (Repository, error) { return NewSQLite(path) }},
	} {
		t.Run(backend.name, func(t *testing.T) {
			for _, access := range []string{"input", "result"} {
				t.Run(access, func(t *testing.T) {
					path := filepath.Join(t.TempDir(), "checkpoint.data")
					repo, err := backend.open(path)
					if err != nil {
						t.Fatal(err)
					}
					t.Cleanup(repo.Close)
					if _, err := repo.CreateProject("project", "Checkpoint", ""); err != nil {
						t.Fatal(err)
					}
					if _, err := repo.CreateThread("thread", "project", "Checkpoint", "", "", ""); err != nil {
						t.Fatal(err)
					}
					if _, err := repo.CreateRun("run", "project", "thread"); err != nil {
						t.Fatal(err)
					}
					input := RunCheckpoint{
						ID: "checkpoint", RunID: "run", WorkDir: "workspace", FileCount: 2, TotalBytes: 11,
						Files: []CheckpointFile{
							{Path: "z.txt", Size: 6, Hash: "original-z", Content: "before"},
							{Path: "a.txt", Size: 5, Hash: "original-a", Content: "other"},
						},
					}
					want := input
					want.Files = append([]CheckpointFile(nil), input.Files...)
					saved, err := repo.UpsertRunCheckpoint(input)
					if err != nil {
						t.Fatal(err)
					}
					want.CreatedAt = saved.CreatedAt
					if want.CreatedAt == "" {
						t.Fatal("checkpoint creation time was not stamped")
					}
					view := input
					if access == "result" {
						view = saved
					}
					view.Files[0] = CheckpointFile{Path: "caller.txt", Size: 1, Hash: "caller", Content: "x"}

					got, ok := repo.GetRunCheckpoint(input.RunID)
					if !ok || !reflect.DeepEqual(got, want) {
						t.Errorf("caller %s changed stored checkpoint: got=%#v want=%#v", access, got, want)
					}
					other := saved
					if access == "result" {
						other = input
					}
					if !reflect.DeepEqual(other.Files, want.Files) {
						t.Errorf("checkpoint input and result share files: other=%#v", other.Files)
					}
					if backend.name == "memory" {
						return
					}

					// An unrelated successful write must not persist caller-side edits.
					if _, err := repo.UpsertSettings(map[string]string{"theme": "dark"}); err != nil {
						t.Fatal(err)
					}
					repo.Close()
					if err := repo.(interface{ LastPersistError() error }).LastPersistError(); err != nil {
						t.Fatalf("close persist: %v", err)
					}
					restored, err := backend.open(path)
					if err != nil {
						t.Fatal(err)
					}
					t.Cleanup(restored.Close)
					got, ok = restored.GetRunCheckpoint(input.RunID)
					if !ok || !reflect.DeepEqual(got, want) {
						t.Errorf("caller %s edits survived reopen: got=%#v want=%#v", access, got, want)
					}
				})
			}
		})
	}
}

func TestRunCheckpointWritePreservesEmptyFileLists(t *testing.T) {
	s := New()
	if _, err := s.CreateProject("project", "Checkpoint", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateThread("thread", "project", "Checkpoint", "", "", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateRun("run", "project", "thread"); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name  string
		files []CheckpointFile
	}{
		{"nil", nil},
		{"empty", []CheckpointFile{}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			input := RunCheckpoint{
				ID: "checkpoint", RunID: "run", WorkDir: "workspace",
				CreatedAt: "2026-09-01T00:00:00Z", Files: tc.files,
			}
			saved, err := s.UpsertRunCheckpoint(input)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(saved, input) {
				t.Fatalf("upsert changed empty checkpoint metadata or list shape: got=%#v want=%#v", saved, input)
			}
		})
	}
}
