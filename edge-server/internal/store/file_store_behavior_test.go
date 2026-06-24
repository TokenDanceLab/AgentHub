package store

import (
	"path/filepath"
	"testing"
)

func TestFileStore_WriteAndRead(t *testing.T) {
	path := filepath.Join(t.TempDir(), "store.json")

	store, err := NewFile(path)
	if err != nil {
		t.Fatalf("NewFile returned error: %v", err)
	}

	created, err := store.CreateProject("proj_1", "Project One", "")
	if err != nil {
		t.Fatalf("CreateProject returned error: %v", err)
	}
	if created.ID != "proj_1" || created.Name != "Project One" {
		t.Fatalf("CreateProject = %+v, want ID=proj_1 Name=Project One", created)
	}

	store.Flush()
	store.Close()

	reopened, err := NewFile(path)
	if err != nil {
		t.Fatalf("NewFile (reopen) returned error: %v", err)
	}
	defer reopened.Close()

	got, ok := reopened.GetProject("proj_1")
	if !ok {
		t.Fatal("GetProject returned ok=false, want project restored from snapshot")
	}
	if got.ID != "proj_1" {
		t.Fatalf("GetProject.ID = %q, want %q", got.ID, "proj_1")
	}
	if got.Name != "Project One" {
		t.Fatalf("GetProject.Name = %q, want %q", got.Name, "Project One")
	}
	if got.Status != "active" {
		t.Fatalf("GetProject.Status = %q, want %q", got.Status, "active")
	}
}

func TestFileStore_WriteMultipleAndReadAll(t *testing.T) {
	path := filepath.Join(t.TempDir(), "store.json")

	store, err := NewFile(path)
	if err != nil {
		t.Fatalf("NewFile returned error: %v", err)
	}

	if _, err := store.CreateProject("proj_a", "Alpha", ""); err != nil {
		t.Fatalf("CreateProject proj_a returned error: %v", err)
	}
	if _, err := store.CreateProject("proj_b", "Beta", ""); err != nil {
		t.Fatalf("CreateProject proj_b returned error: %v", err)
	}
	if _, err := store.CreateProject("proj_c", "Gamma", ""); err != nil {
		t.Fatalf("CreateProject proj_c returned error: %v", err)
	}

	store.Flush()
	store.Close()

	reopened, err := NewFile(path)
	if err != nil {
		t.Fatalf("NewFile (reopen) returned error: %v", err)
	}
	defer reopened.Close()

	projects := reopened.ListProjects()
	if len(projects) != 3 {
		t.Fatalf("ListProjects length = %d, want 3", len(projects))
	}
	if projects[0].ID != "proj_a" || projects[0].Name != "Alpha" {
		t.Fatalf("ListProjects[0] = {ID=%q Name=%q}, want ID=proj_a Name=Alpha", projects[0].ID, projects[0].Name)
	}
	if projects[1].ID != "proj_b" || projects[1].Name != "Beta" {
		t.Fatalf("ListProjects[1] = {ID=%q Name=%q}, want ID=proj_b Name=Beta", projects[1].ID, projects[1].Name)
	}
	if projects[2].ID != "proj_c" || projects[2].Name != "Gamma" {
		t.Fatalf("ListProjects[2] = {ID=%q Name=%q}, want ID=proj_c Name=Gamma", projects[2].ID, projects[2].Name)
	}
}

func TestFileStore_EmptyRead(t *testing.T) {
	path := filepath.Join(t.TempDir(), "store.json")

	store, err := NewFile(path)
	if err != nil {
		t.Fatalf("NewFile returned error: %v", err)
	}
	defer store.Close()

	projects := store.ListProjects()
	if len(projects) != 0 {
		t.Fatalf("ListProjects length = %d, want 0 (empty store)", len(projects))
	}

	if _, ok := store.GetProject("nonexistent"); ok {
		t.Fatal("GetProject returned ok=true for nonexistent key, want false")
	}
}

func TestFileStore_Overwrite(t *testing.T) {
	path := filepath.Join(t.TempDir(), "store.json")

	store, err := NewFile(path)
	if err != nil {
		t.Fatalf("NewFile returned error: %v", err)
	}

	if _, err := store.CreateProject("proj_ov", "Overwrite Project", ""); err != nil {
		t.Fatalf("CreateProject returned error: %v", err)
	}
	thread, err := store.CreateThread("thread_ov", "proj_ov", "Old Title", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread returned error: %v", err)
	}
	if thread.Title != "Old Title" {
		t.Fatalf("CreateThread Title = %q, want %q", thread.Title, "Old Title")
	}

	store.Flush()
	store.Close()

	// Reopen and overwrite the thread title.
	store2, err := NewFile(path)
	if err != nil {
		t.Fatalf("NewFile (reopen) returned error: %v", err)
	}

	newTitle := "New Title"
	updated, ok := store2.UpdateThread("thread_ov", &newTitle, nil)
	if !ok {
		t.Fatal("UpdateThread returned ok=false")
	}
	if updated.Title != "New Title" {
		t.Fatalf("UpdateThread Title = %q, want %q", updated.Title, "New Title")
	}

	store2.Flush()
	store2.Close()

	// Reopen again and verify the overwritten value persisted.
	store3, err := NewFile(path)
	if err != nil {
		t.Fatalf("NewFile (reopen 2) returned error: %v", err)
	}
	defer store3.Close()

	got, ok := store3.GetThread("thread_ov")
	if !ok {
		t.Fatal("GetThread returned ok=false after overwrite persist")
	}
	if got.Title != "New Title" {
		t.Fatalf("GetThread Title = %q, want %q (overwritten value)", got.Title, "New Title")
	}
}

func TestFileStore_DeleteAndRead(t *testing.T) {
	path := filepath.Join(t.TempDir(), "store.json")

	store, err := NewFile(path)
	if err != nil {
		t.Fatalf("NewFile returned error: %v", err)
	}

	if _, err := store.CreateProject("proj_del", "Delete Project", ""); err != nil {
		t.Fatalf("CreateProject returned error: %v", err)
	}
	if _, err := store.CreateThread("thread_del", "proj_del", "Delete Thread", "", "", ""); err != nil {
		t.Fatalf("CreateThread returned error: %v", err)
	}

	store.Flush()
	store.Close()

	// Reopen, delete the thread, close, reopen again.
	store2, err := NewFile(path)
	if err != nil {
		t.Fatalf("NewFile (reopen) returned error: %v", err)
	}

	deleted := store2.DeleteThread("thread_del")
	if !deleted {
		t.Fatal("DeleteThread returned false, want true")
	}

	store2.Flush()
	store2.Close()

	store3, err := NewFile(path)
	if err != nil {
		t.Fatalf("NewFile (reopen 2) returned error: %v", err)
	}
	defer store3.Close()

	if _, ok := store3.GetThread("thread_del"); ok {
		t.Fatal("GetThread returned ok=true after delete, want false")
	}

	threads := store3.ListThreads("proj_del")
	if len(threads) != 0 {
		t.Fatalf("ListThreads length = %d, want 0 after delete", len(threads))
	}
}
