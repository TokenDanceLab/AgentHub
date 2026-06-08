package store

import (
	"errors"
	"path/filepath"
	"testing"
	"time"
)

type repositoryContractStore interface {
	Repository
	RunCleaner
}

type repositoryEvidenceStore interface {
	UpsertRunDiffFile(file RunDiffFile) (RunDiffFile, error)
	ListRunDiffFiles(runID string) []RunDiffFile
	UpsertArtifact(artifact Artifact) (Artifact, error)
	GetArtifact(id string) (Artifact, bool)
	ListArtifacts(runID string) []Artifact
	UpsertPreview(preview Preview) (Preview, error)
	GetPreview(id string) (Preview, bool)
	ListPreviews(runID string) []Preview
}

type repositoryContractHandle struct {
	name   string
	store  repositoryContractStore
	path   string
	flush  func()
	close  func()
	reopen func(t *testing.T, path string) repositoryContractHandle
}

func TestRepositoryContract(t *testing.T) {
	factories := []struct {
		name string
		new  func(t *testing.T) repositoryContractHandle
	}{
		{
			name: "memory",
			new: func(t *testing.T) repositoryContractHandle {
				s := New()
				return repositoryContractHandle{
					name:  "memory",
					store: s,
				}
			},
		},
		{
			name: "file",
			new: func(t *testing.T) repositoryContractHandle {
				path := filepath.Join(t.TempDir(), "edge-store.json")
				s, err := NewFile(path)
				if err != nil {
					t.Fatalf("NewFile returned error: %v", err)
				}
				return repositoryContractHandle{
					name:  "file",
					store: s,
					path:  path,
					flush: s.Flush,
					close: s.Close,
					reopen: func(t *testing.T, path string) repositoryContractHandle {
						t.Helper()
						restored, err := NewFile(path)
						if err != nil {
							t.Fatalf("NewFile restore returned error: %v", err)
						}
						return repositoryContractHandle{
							name:  "file",
							store: restored,
							path:  path,
							flush: restored.Flush,
							close: restored.Close,
						}
					},
				}
			},
		},
		{
			name: "sqlite",
			new: func(t *testing.T) repositoryContractHandle {
				path := filepath.Join(t.TempDir(), "edge-store.db")
				s, err := NewSQLite(path)
				if err != nil {
					t.Fatalf("NewSQLite returned error: %v", err)
				}
				return repositoryContractHandle{
					name:  "sqlite",
					store: s,
					path:  path,
					close: s.Close,
					reopen: func(t *testing.T, path string) repositoryContractHandle {
						t.Helper()
						restored, err := NewSQLite(path)
						if err != nil {
							t.Fatalf("NewSQLite restore returned error: %v", err)
						}
						return repositoryContractHandle{
							name:  "sqlite",
							store: restored,
							path:  path,
							close: restored.Close,
						}
					},
				}
			},
		},
	}

	for _, factory := range factories {
		t.Run(factory.name, func(t *testing.T) {
			t.Run("lifecycle", func(t *testing.T) {
				runRepositoryLifecycleContract(t, factory.new(t))
			})
			t.Run("pins", func(t *testing.T) {
				runRepositoryPinsContract(t, factory.new(t))
			})
			t.Run("thread_delete_cascade", func(t *testing.T) {
				runRepositoryThreadDeleteCascadeContract(t, factory.new(t))
			})
			t.Run("cleanup_cascade", func(t *testing.T) {
				runRepositoryCleanupCascadeContract(t, factory.new(t))
			})
			t.Run("artifact_diff_preview_readonly", func(t *testing.T) {
				runRepositoryArtifactDiffPreviewContract(t, factory.new(t))
			})
			t.Run("runtime_evidence_current", func(t *testing.T) {
				runRepositoryRuntimeEvidenceCurrentContract(t, factory.new(t))
			})
		})
	}
}

func TestRepositoryContractFileStoreSnapshotRestore(t *testing.T) {
	path := filepath.Join(t.TempDir(), "edge-store.json")
	s, err := NewFile(path)
	if err != nil {
		t.Fatalf("NewFile returned error: %v", err)
	}

	project, err := s.CreateProject("proj_contract", "Contract Project")
	if err != nil {
		t.Fatalf("CreateProject returned error: %v", err)
	}
	thread, err := s.CreateThread("thread_contract", project.ID, "Contract Thread")
	if err != nil {
		t.Fatalf("CreateThread returned error: %v", err)
	}
	run, err := s.CreateRun("run_contract", project.ID, thread.ID)
	if err != nil {
		t.Fatalf("CreateRun returned error: %v", err)
	}
	item, err := s.CreateItem(Item{
		ID:        "item_contract",
		ProjectID: project.ID,
		ThreadID:  thread.ID,
		RunID:     run.ID,
		Type:      "run",
		Status:    "created",
		Content:   "contract item",
	})
	if err != nil {
		t.Fatalf("CreateItem returned error: %v", err)
	}
	if _, err := s.PinThreadItem(thread.ID, item.ID, "Delicious233"); err != nil {
		t.Fatalf("PinThreadItem returned error: %v", err)
	}
	s.Flush()
	s.Close()

	restored, err := NewFile(path)
	if err != nil {
		t.Fatalf("NewFile restore returned error: %v", err)
	}
	defer restored.Close()

	if got := restored.ListProjects(); len(got) != 1 || got[0].ID != project.ID {
		t.Fatalf("restored projects = %#v, want %s", got, project.ID)
	}
	if got := restored.ListThreads(project.ID); len(got) != 1 || got[0].ID != thread.ID {
		t.Fatalf("restored threads = %#v, want %s", got, thread.ID)
	}
	if got := restored.ListRuns(thread.ID); len(got) != 1 || got[0].ID != run.ID {
		t.Fatalf("restored runs = %#v, want %s", got, run.ID)
	}
	if got := restored.ListThreadItems(thread.ID); len(got) != 1 || got[0].ID != item.ID || got[0].Content != "contract item" {
		t.Fatalf("restored items = %#v, want item_contract content", got)
	}
	if got := restored.ListThreadPins(thread.ID); len(got) != 1 || got[0].ItemID != item.ID || got[0].PinnedBy != "Delicious233" {
		t.Fatalf("restored pins = %#v, want item_contract pin", got)
	}
}

func TestRepositoryContractSQLiteStoreRestore(t *testing.T) {
	path := filepath.Join(t.TempDir(), "edge-store.db")
	s, err := NewSQLite(path)
	if err != nil {
		t.Fatalf("NewSQLite returned error: %v", err)
	}

	project, err := s.CreateProject("proj_contract", "Contract Project")
	if err != nil {
		t.Fatalf("CreateProject returned error: %v", err)
	}
	thread, err := s.CreateThread("thread_contract", project.ID, "Contract Thread")
	if err != nil {
		t.Fatalf("CreateThread returned error: %v", err)
	}
	run, err := s.CreateRun("run_contract", project.ID, thread.ID)
	if err != nil {
		t.Fatalf("CreateRun returned error: %v", err)
	}
	item, err := s.CreateItem(Item{
		ID:        "item_contract",
		ProjectID: project.ID,
		ThreadID:  thread.ID,
		RunID:     run.ID,
		Type:      "run",
		Status:    "created",
		Content:   "contract item",
	})
	if err != nil {
		t.Fatalf("CreateItem returned error: %v", err)
	}
	if _, err := s.PinThreadItem(thread.ID, item.ID, "Delicious233"); err != nil {
		t.Fatalf("PinThreadItem returned error: %v", err)
	}
	s.Close()

	restored, err := NewSQLite(path)
	if err != nil {
		t.Fatalf("NewSQLite restore returned error: %v", err)
	}
	defer restored.Close()

	if got := restored.ListProjects(); len(got) != 1 || got[0].ID != project.ID {
		t.Fatalf("restored projects = %#v, want %s", got, project.ID)
	}
	if got := restored.ListThreads(project.ID); len(got) != 1 || got[0].ID != thread.ID {
		t.Fatalf("restored threads = %#v, want %s", got, thread.ID)
	}
	if got := restored.ListRuns(thread.ID); len(got) != 1 || got[0].ID != run.ID {
		t.Fatalf("restored runs = %#v, want %s", got, run.ID)
	}
	if got := restored.ListThreadItems(thread.ID); len(got) != 1 || got[0].ID != item.ID || got[0].Content != "contract item" {
		t.Fatalf("restored items = %#v, want item_contract content", got)
	}
	if got := restored.ListThreadPins(thread.ID); len(got) != 1 || got[0].ItemID != item.ID || got[0].PinnedBy != "Delicious233" {
		t.Fatalf("restored pins = %#v, want item_contract pin", got)
	}
}

func runRepositoryLifecycleContract(t *testing.T, handle repositoryContractHandle) {
	defer closeContractHandle(handle)
	repo := handle.store

	project, err := repo.CreateProject("proj_contract", "")
	if err != nil {
		t.Fatalf("CreateProject returned error: %v", err)
	}
	if project.Name != "Local Project" || project.Status != "active" {
		t.Fatalf("project = %#v, want default name and active status", project)
	}
	duplicate, err := repo.CreateProject(project.ID, "Renamed")
	if !errors.Is(err, ErrProjectExists) {
		t.Fatalf("duplicate CreateProject error = %v, want ErrProjectExists", err)
	}
	if duplicate.Name != project.Name {
		t.Fatalf("duplicate project = %#v, want original project", duplicate)
	}

	if _, err := repo.CreateThread("thread_missing_project", "missing", "Missing"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("CreateThread missing project error = %v, want ErrNotFound", err)
	}
	thread, err := repo.CreateThread("thread_contract", project.ID, "")
	if err != nil {
		t.Fatalf("CreateThread returned error: %v", err)
	}
	if thread.Title != "New Thread" || thread.ProjectID != project.ID {
		t.Fatalf("thread = %#v, want default title and project binding", thread)
	}

	if _, err := repo.CreateRun("run_missing_thread", project.ID, "missing"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("CreateRun missing thread error = %v, want ErrNotFound", err)
	}
	run, err := repo.CreateRun("run_contract", project.ID, thread.ID)
	if err != nil {
		t.Fatalf("CreateRun returned error: %v", err)
	}
	if run.Status != "queued" {
		t.Fatalf("run status = %q, want queued", run.Status)
	}

	message, err := repo.CreateThreadMessage("item_message", thread.ID, "", "hello")
	if err != nil {
		t.Fatalf("CreateThreadMessage returned error: %v", err)
	}
	if message.ProjectID != project.ID || message.Type != "user_message" || message.Role != "user" || message.Content != "hello" {
		t.Fatalf("message item = %#v, want scoped default user message", message)
	}
	runItem, err := repo.CreateItem(Item{
		ID:        "item_run",
		ProjectID: project.ID,
		ThreadID:  thread.ID,
		RunID:     run.ID,
	})
	if err != nil {
		t.Fatalf("CreateItem returned error: %v", err)
	}
	if runItem.Type != "event" || runItem.Status != "created" {
		t.Fatalf("run item = %#v, want default event/created", runItem)
	}

	if got := repo.ListProjects(); len(got) != 1 || got[0].ID != project.ID {
		t.Fatalf("ListProjects = %#v, want one project", got)
	}
	if got := repo.ListThreads(project.ID); len(got) != 1 || got[0].ID != thread.ID {
		t.Fatalf("ListThreads(project) = %#v, want thread_contract", got)
	}
	if got := repo.ListRuns(thread.ID); len(got) != 1 || got[0].ID != run.ID {
		t.Fatalf("ListRuns(thread) = %#v, want run_contract", got)
	}
	if got := repo.ListThreadItems(thread.ID); len(got) != 2 || got[0].ID != "item_message" || got[1].ID != "item_run" {
		t.Fatalf("ListThreadItems(thread) = %#v, want message then run item", got)
	}

	title := "Renamed"
	status := "archived"
	updated, ok := repo.UpdateThread(thread.ID, &title, &status)
	if !ok || updated.Title != title || updated.Status != status {
		t.Fatalf("UpdateThread = %#v, %v; want renamed archived", updated, ok)
	}
	started, ok := repo.SetRunStatus(run.ID, "started")
	if !ok || started.Status != "started" || started.StartedAt == "" {
		t.Fatalf("SetRunStatus(started) = %#v, %v; want StartedAt", started, ok)
	}
	finished, ok := repo.SetRunStatusIf(run.ID, "finished", "queued")
	if ok || finished.Status != "started" {
		t.Fatalf("SetRunStatusIf disallowed = %#v, %v; want unchanged started", finished, ok)
	}
	finished, ok = repo.SetRunStatusIf(run.ID, "finished", "started")
	if !ok || finished.Status != "finished" || finished.FinishedAt == "" {
		t.Fatalf("SetRunStatusIf allowed = %#v, %v; want finished with FinishedAt", finished, ok)
	}
}

func runRepositoryPinsContract(t *testing.T, handle repositoryContractHandle) {
	defer closeContractHandle(handle)
	repo := handle.store

	project, err := repo.CreateProject("proj_contract", "Contract Project")
	if err != nil {
		t.Fatalf("CreateProject returned error: %v", err)
	}
	thread, err := repo.CreateThread("thread_contract", project.ID, "Contract Thread")
	if err != nil {
		t.Fatalf("CreateThread returned error: %v", err)
	}
	otherThread, err := repo.CreateThread("thread_other", project.ID, "Other Thread")
	if err != nil {
		t.Fatalf("CreateThread other returned error: %v", err)
	}
	item, err := repo.CreateThreadMessage("item_contract", thread.ID, "", "hello")
	if err != nil {
		t.Fatalf("CreateThreadMessage returned error: %v", err)
	}
	if _, err := repo.CreateThreadMessage("item_other", otherThread.ID, "", "other"); err != nil {
		t.Fatalf("CreateThreadMessage other returned error: %v", err)
	}

	pin, err := repo.PinThreadItem(thread.ID, item.ID, "  Delicious233  ")
	if err != nil {
		t.Fatalf("PinThreadItem returned error: %v", err)
	}
	if pin.ThreadID != thread.ID || pin.ItemID != item.ID || pin.PinnedBy != "Delicious233" {
		t.Fatalf("pin = %#v, want scoped trimmed pin", pin)
	}
	updated, err := repo.PinThreadItem(thread.ID, item.ID, "AgentHub")
	if err != nil {
		t.Fatalf("PinThreadItem duplicate returned error: %v", err)
	}
	if updated.CreatedAt != pin.CreatedAt || updated.PinnedBy != "AgentHub" {
		t.Fatalf("updated pin = %#v, want idempotent update preserving CreatedAt", updated)
	}
	if got := repo.ListThreadPins(thread.ID); len(got) != 1 || got[0].PinnedBy != "AgentHub" {
		t.Fatalf("ListThreadPins = %#v, want one updated pin", got)
	}

	if _, err := repo.PinThreadItem("missing", item.ID, "user"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("PinThreadItem missing thread error = %v, want ErrNotFound", err)
	}
	if _, err := repo.PinThreadItem(thread.ID, "item_other", "user"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("PinThreadItem cross-thread item error = %v, want ErrNotFound", err)
	}
	if !repo.DeleteThreadPin(thread.ID, item.ID) {
		t.Fatal("DeleteThreadPin returned false")
	}
	if repo.DeleteThreadPin(thread.ID, item.ID) {
		t.Fatal("DeleteThreadPin missing pin returned true")
	}
	if got := repo.ListThreadPins(thread.ID); len(got) != 0 {
		t.Fatalf("ListThreadPins after delete = %#v, want empty", got)
	}
}

func runRepositoryThreadDeleteCascadeContract(t *testing.T, handle repositoryContractHandle) {
	defer closeContractHandle(handle)
	repo := handle.store

	project, _ := repo.CreateProject("proj_contract", "Contract Project")
	thread, _ := repo.CreateThread("thread_contract", project.ID, "Contract Thread")
	run, err := repo.CreateRun("run_contract", project.ID, thread.ID)
	if err != nil {
		t.Fatalf("CreateRun returned error: %v", err)
	}
	item, err := repo.CreateItem(Item{
		ID:        "item_contract",
		ProjectID: project.ID,
		ThreadID:  thread.ID,
		RunID:     run.ID,
	})
	if err != nil {
		t.Fatalf("CreateItem returned error: %v", err)
	}
	if _, err := repo.PinThreadItem(thread.ID, item.ID, "Delicious233"); err != nil {
		t.Fatalf("PinThreadItem returned error: %v", err)
	}

	if !repo.DeleteThread(thread.ID) {
		t.Fatal("DeleteThread returned false")
	}
	if _, ok := repo.GetThread(thread.ID); ok {
		t.Fatal("thread still exists after delete")
	}
	if _, ok := repo.GetRun(run.ID); ok {
		t.Fatal("run still exists after thread delete")
	}
	if _, ok := repo.GetItem(item.ID); ok {
		t.Fatal("item still exists after thread delete")
	}
	if got := repo.ListThreadPins(thread.ID); len(got) != 0 {
		t.Fatalf("pins after thread delete = %#v, want empty", got)
	}

	if handle.path == "" || handle.reopen == nil {
		return
	}
	closeContractHandle(handle)

	restored := handle.reopen(t, handle.path)
	defer closeContractHandle(restored)

	if _, ok := restored.store.GetThread(thread.ID); ok {
		t.Fatal("restored thread exists after persisted thread delete")
	}
	if _, ok := restored.store.GetRun(run.ID); ok {
		t.Fatal("restored run exists after persisted thread delete")
	}
	if _, ok := restored.store.GetItem(item.ID); ok {
		t.Fatal("restored item exists after persisted thread delete")
	}
	if got := restored.store.ListThreadPins(thread.ID); len(got) != 0 {
		t.Fatalf("restored pins after thread delete = %#v, want empty", got)
	}
}

func runRepositoryCleanupCascadeContract(t *testing.T, handle repositoryContractHandle) {
	defer closeContractHandle(handle)
	repo := handle.store

	project, _ := repo.CreateProject("proj_contract", "Contract Project")
	thread, _ := repo.CreateThread("thread_contract", project.ID, "Contract Thread")
	run, err := repo.CreateRun("run_contract", project.ID, thread.ID)
	if err != nil {
		t.Fatalf("CreateRun returned error: %v", err)
	}
	if _, ok := repo.SetRunStatus(run.ID, "finished"); !ok {
		t.Fatal("SetRunStatus(finished) returned ok=false")
	}
	item, err := repo.CreateItem(Item{
		ID:        "item_contract",
		ProjectID: project.ID,
		ThreadID:  thread.ID,
		RunID:     run.ID,
	})
	if err != nil {
		t.Fatalf("CreateItem returned error: %v", err)
	}
	if _, err := repo.PinThreadItem(thread.ID, item.ID, "Delicious233"); err != nil {
		t.Fatalf("PinThreadItem returned error: %v", err)
	}

	result := repo.CleanupRuns(RunCleanupOptions{
		Now:         time.Now().UTC().Add(48 * time.Hour),
		TerminalTTL: time.Hour,
	})
	if result.RemovedRuns != 1 || result.RemovedItems != 1 {
		t.Fatalf("CleanupRuns result = %#v, want one run and item removed", result)
	}
	if _, ok := repo.GetRun(run.ID); ok {
		t.Fatal("run still exists after cleanup")
	}
	if _, ok := repo.GetItem(item.ID); ok {
		t.Fatal("item still exists after cleanup")
	}
	if got := repo.ListThreadPins(thread.ID); len(got) != 0 {
		t.Fatalf("pins after cleanup = %#v, want empty", got)
	}
}

func runRepositoryArtifactDiffPreviewContract(t *testing.T, handle repositoryContractHandle) {
	defer closeContractHandle(handle)
	repo := handle.store
	evidence, ok := repo.(repositoryEvidenceStore)
	if !ok {
		t.Fatalf("%s store does not implement artifact/diff/preview evidence contract", handle.name)
	}

	project, _ := repo.CreateProject("proj_contract", "Contract Project")
	thread, _ := repo.CreateThread("thread_contract", project.ID, "Contract Thread")
	run, err := repo.CreateRun("run_contract", project.ID, thread.ID)
	if err != nil {
		t.Fatalf("CreateRun returned error: %v", err)
	}

	if _, err := evidence.UpsertRunDiffFile(RunDiffFile{RunID: "missing", Path: "src/app.ts", Diff: "+new", Status: "modified"}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("UpsertRunDiffFile missing run error = %v, want ErrNotFound", err)
	}
	diffFile, err := evidence.UpsertRunDiffFile(RunDiffFile{
		RunID:  run.ID,
		Path:   "src/app.ts",
		Diff:   "@@ -1 +1 @@\n-old\n+new",
		Status: "modified",
	})
	if err != nil {
		t.Fatalf("UpsertRunDiffFile returned error: %v", err)
	}
	if diffFile.CreatedAt == "" || diffFile.UpdatedAt == "" {
		t.Fatalf("diff timestamps = %#v, want created and updated", diffFile)
	}
	diffFile, err = evidence.UpsertRunDiffFile(RunDiffFile{
		RunID:  run.ID,
		Path:   "src/app.ts",
		Diff:   "@@ -1 +1 @@\n-old\n+newer",
		Status: "modified",
	})
	if err != nil {
		t.Fatalf("UpsertRunDiffFile update returned error: %v", err)
	}
	if diffFile.Diff != "@@ -1 +1 @@\n-old\n+newer" {
		t.Fatalf("updated diff = %#v, want newer diff", diffFile.Diff)
	}
	if got := evidence.ListRunDiffFiles(run.ID); len(got) != 1 || got[0].Path != "src/app.ts" || got[0].Diff != diffFile.Diff {
		t.Fatalf("ListRunDiffFiles = %#v, want updated src/app.ts diff", got)
	}

	artifact, err := evidence.UpsertArtifact(Artifact{
		ID:        "artifact_contract",
		RunID:     run.ID,
		ThreadID:  thread.ID,
		Kind:      "patch",
		Path:      "changes.diff",
		SizeBytes: 42,
	})
	if err != nil {
		t.Fatalf("UpsertArtifact returned error: %v", err)
	}
	if artifact.CreatedAt == "" || artifact.UpdatedAt == "" {
		t.Fatalf("artifact timestamps = %#v, want created and updated", artifact)
	}
	if got := evidence.ListArtifacts(run.ID); len(got) != 1 || got[0].ID != artifact.ID || got[0].ThreadID != thread.ID {
		t.Fatalf("ListArtifacts(run) = %#v, want scoped artifact", got)
	}
	if got, ok := evidence.GetArtifact(artifact.ID); !ok || got.ID != artifact.ID || got.RunID != run.ID {
		t.Fatalf("GetArtifact = %#v, %v; want stored artifact", got, ok)
	}

	preview, err := evidence.UpsertPreview(Preview{
		ID:       "preview_contract",
		RunID:    run.ID,
		ThreadID: thread.ID,
		URL:      "http://127.0.0.1:4173",
		Status:   "ready",
	})
	if err != nil {
		t.Fatalf("UpsertPreview returned error: %v", err)
	}
	if preview.CreatedAt == "" || preview.UpdatedAt == "" {
		t.Fatalf("preview timestamps = %#v, want created and updated", preview)
	}
	if got := evidence.ListPreviews(run.ID); len(got) != 1 || got[0].ID != preview.ID || got[0].Status != "ready" {
		t.Fatalf("ListPreviews(run) = %#v, want scoped preview", got)
	}
	if got, ok := evidence.GetPreview(preview.ID); !ok || got.ID != preview.ID || got.RunID != run.ID {
		t.Fatalf("GetPreview = %#v, %v; want stored preview", got, ok)
	}
	stoppedPreview, err := evidence.UpsertPreview(Preview{
		ID:       preview.ID,
		RunID:    run.ID,
		ThreadID: thread.ID,
		Status:   "stopped",
	})
	if err != nil {
		t.Fatalf("UpsertPreview stopped returned error: %v", err)
	}
	if stoppedPreview.Status != "stopped" || stoppedPreview.URL != "" || stoppedPreview.CreatedAt != preview.CreatedAt || stoppedPreview.UpdatedAt == "" {
		t.Fatalf("stopped preview = %#v, want stopped transition with preserved createdAt", stoppedPreview)
	}

	if handle.path == "" || handle.reopen == nil {
		return
	}
	closeContractHandle(handle)

	restored := handle.reopen(t, handle.path)
	defer closeContractHandle(restored)
	restoredEvidence, ok := restored.store.(repositoryEvidenceStore)
	if !ok {
		t.Fatalf("restored %s store does not implement evidence contract", restored.name)
	}
	if got := restoredEvidence.ListRunDiffFiles(run.ID); len(got) != 1 || got[0].Diff != diffFile.Diff {
		t.Fatalf("restored diffs = %#v, want persisted diff", got)
	}
	if got := restoredEvidence.ListArtifacts(run.ID); len(got) != 1 || got[0].ID != artifact.ID {
		t.Fatalf("restored artifacts = %#v, want persisted artifact", got)
	}
	if got, ok := restoredEvidence.GetArtifact(artifact.ID); !ok || got.ID != artifact.ID {
		t.Fatalf("restored artifact lookup = %#v, %v; want persisted artifact", got, ok)
	}
	if got := restoredEvidence.ListPreviews(run.ID); len(got) != 1 || got[0].ID != preview.ID || got[0].Status != "stopped" {
		t.Fatalf("restored previews = %#v, want persisted preview", got)
	}
	if got, ok := restoredEvidence.GetPreview(preview.ID); !ok || got.ID != preview.ID || got.Status != "stopped" {
		t.Fatalf("restored preview lookup = %#v, %v; want persisted preview", got, ok)
	}
}

func runRepositoryRuntimeEvidenceCurrentContract(t *testing.T, handle repositoryContractHandle) {
	defer closeContractHandle(handle)
	repo := handle.store
	evidence, ok := repo.(repositoryEvidenceStore)
	if !ok {
		t.Fatalf("%s store does not implement runtime evidence contract", handle.name)
	}

	project, _ := repo.CreateProject("proj_evidence_current", "Evidence Current")
	threadA, _ := repo.CreateThread("thread_evidence_a", project.ID, "Evidence A")
	threadB, _ := repo.CreateThread("thread_evidence_b", project.ID, "Evidence B")
	runA, err := repo.CreateRun("run_evidence_a", project.ID, threadA.ID)
	if err != nil {
		t.Fatalf("CreateRun A returned error: %v", err)
	}
	runB, err := repo.CreateRun("run_evidence_b", project.ID, threadB.ID)
	if err != nil {
		t.Fatalf("CreateRun B returned error: %v", err)
	}

	if _, err := evidence.UpsertRunDiffFile(RunDiffFile{RunID: runA.ID, Path: "   ", Diff: "+empty"}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("UpsertRunDiffFile blank path error = %v, want ErrNotFound", err)
	}
	diffA, err := evidence.UpsertRunDiffFile(RunDiffFile{
		RunID:  runA.ID,
		Path:   " src/app.ts ",
		Diff:   "@@ -1 +1 @@\n-old\n+new",
		Status: "created",
	})
	if err != nil {
		t.Fatalf("UpsertRunDiffFile A returned error: %v", err)
	}
	if diffA.Path != "src/app.ts" || diffA.Status != "added" {
		t.Fatalf("diff A = %#v, want trimmed path and added status", diffA)
	}
	diffACreatedAt := diffA.CreatedAt
	diffA, err = evidence.UpsertRunDiffFile(RunDiffFile{
		RunID:  runA.ID,
		Path:   "src/app.ts",
		Diff:   "@@ -1 +1 @@\n-old\n+newer",
		Status: "unknown-runtime-status",
	})
	if err != nil {
		t.Fatalf("UpsertRunDiffFile A update returned error: %v", err)
	}
	if diffA.CreatedAt != diffACreatedAt || diffA.Status != "modified" || diffA.Diff == "" {
		t.Fatalf("updated diff A = %#v, want createdAt preserved and modified status", diffA)
	}
	diffB, err := evidence.UpsertRunDiffFile(RunDiffFile{
		RunID:  runB.ID,
		Path:   "src/app.ts",
		Diff:   "@@ -1 +0 @@\n-old",
		Status: "remove",
	})
	if err != nil {
		t.Fatalf("UpsertRunDiffFile B returned error: %v", err)
	}
	if diffB.Status != "deleted" {
		t.Fatalf("diff B status = %q, want deleted", diffB.Status)
	}
	if got := evidence.ListRunDiffFiles(runA.ID); len(got) != 1 || got[0].RunID != runA.ID || got[0].Diff != diffA.Diff {
		t.Fatalf("ListRunDiffFiles(runA) = %#v, want only updated run A diff", got)
	}
	if got := evidence.ListRunDiffFiles(""); len(got) != 2 || got[0].RunID != runA.ID || got[1].RunID != runB.ID {
		t.Fatalf("ListRunDiffFiles(all) = %#v, want current diffs in insertion order", got)
	}

	if _, err := evidence.UpsertArtifact(Artifact{ID: "artifact_missing_run", RunID: "missing"}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("UpsertArtifact missing run error = %v, want ErrNotFound", err)
	}
	if _, err := evidence.UpsertArtifact(Artifact{RunID: runA.ID, Path: "missing-id.txt"}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("UpsertArtifact blank id error = %v, want ErrNotFound", err)
	}
	if _, err := evidence.UpsertArtifact(Artifact{ID: "artifact_wrong_thread", RunID: runA.ID, ThreadID: threadB.ID}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("UpsertArtifact mismatched thread error = %v, want ErrNotFound", err)
	}
	artifactA, err := evidence.UpsertArtifact(Artifact{
		ID:        "artifact_current_a",
		RunID:     runA.ID,
		Path:      "runtime.log",
		SizeBytes: 12,
	})
	if err != nil {
		t.Fatalf("UpsertArtifact A returned error: %v", err)
	}
	if artifactA.ThreadID != threadA.ID || artifactA.Kind != "file" {
		t.Fatalf("artifact A = %#v, want default thread and file kind", artifactA)
	}
	artifactACreatedAt := artifactA.CreatedAt
	artifactA, err = evidence.UpsertArtifact(Artifact{
		ID:        artifactA.ID,
		RunID:     runA.ID,
		Kind:      "log",
		Path:      "runtime-2.log",
		SizeBytes: 24,
	})
	if err != nil {
		t.Fatalf("UpsertArtifact A update returned error: %v", err)
	}
	if artifactA.CreatedAt != artifactACreatedAt || artifactA.Kind != "log" || artifactA.Path != "runtime-2.log" || artifactA.ThreadID != threadA.ID {
		t.Fatalf("updated artifact A = %#v, want preserved createdAt and current metadata", artifactA)
	}
	artifactB, err := evidence.UpsertArtifact(Artifact{
		ID:       "artifact_current_b",
		RunID:    runB.ID,
		ThreadID: threadB.ID,
		Kind:     "patch",
		Path:     "changes.diff",
	})
	if err != nil {
		t.Fatalf("UpsertArtifact B returned error: %v", err)
	}
	if got := evidence.ListArtifacts(runA.ID); len(got) != 1 || got[0].ID != artifactA.ID || got[0].RunID != runA.ID {
		t.Fatalf("ListArtifacts(runA) = %#v, want only artifact A", got)
	}
	if got := evidence.ListArtifacts(""); len(got) != 2 || got[0].ID != artifactA.ID || got[1].ID != artifactB.ID {
		t.Fatalf("ListArtifacts(all) = %#v, want current artifacts in insertion order", got)
	}

	if _, err := evidence.UpsertPreview(Preview{ID: "preview_missing_run", RunID: "missing"}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("UpsertPreview missing run error = %v, want ErrNotFound", err)
	}
	if _, err := evidence.UpsertPreview(Preview{RunID: runA.ID, URL: "http://127.0.0.1:4173"}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("UpsertPreview blank id error = %v, want ErrNotFound", err)
	}
	if _, err := evidence.UpsertPreview(Preview{ID: "preview_wrong_thread", RunID: runA.ID, ThreadID: threadB.ID}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("UpsertPreview mismatched thread error = %v, want ErrNotFound", err)
	}
	previewA, err := evidence.UpsertPreview(Preview{
		ID:    "preview_current_a",
		RunID: runA.ID,
		URL:   "http://127.0.0.1:4173",
	})
	if err != nil {
		t.Fatalf("UpsertPreview A returned error: %v", err)
	}
	if previewA.ThreadID != threadA.ID || previewA.Status != "ready" {
		t.Fatalf("preview A = %#v, want default thread and ready status", previewA)
	}
	previewACreatedAt := previewA.CreatedAt
	previewA, err = evidence.UpsertPreview(Preview{
		ID:     previewA.ID,
		RunID:  runA.ID,
		URL:    "http://127.0.0.1:5173",
		Status: "stopped",
	})
	if err != nil {
		t.Fatalf("UpsertPreview A update returned error: %v", err)
	}
	if previewA.CreatedAt != previewACreatedAt || previewA.URL != "http://127.0.0.1:5173" || previewA.Status != "stopped" || previewA.ThreadID != threadA.ID {
		t.Fatalf("updated preview A = %#v, want preserved createdAt and current metadata", previewA)
	}
	previewB, err := evidence.UpsertPreview(Preview{
		ID:       "preview_current_b",
		RunID:    runB.ID,
		ThreadID: threadB.ID,
		URL:      "http://127.0.0.1:5174",
		Status:   "ready",
	})
	if err != nil {
		t.Fatalf("UpsertPreview B returned error: %v", err)
	}
	if got := evidence.ListPreviews(runA.ID); len(got) != 1 || got[0].ID != previewA.ID || got[0].RunID != runA.ID {
		t.Fatalf("ListPreviews(runA) = %#v, want only preview A", got)
	}
	if got := evidence.ListPreviews(""); len(got) != 2 || got[0].ID != previewA.ID || got[1].ID != previewB.ID {
		t.Fatalf("ListPreviews(all) = %#v, want current previews in insertion order", got)
	}

	if _, ok := repo.SetRunStatus(runA.ID, "finished"); !ok {
		t.Fatalf("SetRunStatus(%s) returned false", runA.ID)
	}
	result := repo.CleanupRuns(RunCleanupOptions{
		Now:         time.Now().UTC().Add(48 * time.Hour),
		TerminalTTL: time.Hour,
	})
	if result.RemovedRuns != 1 {
		t.Fatalf("CleanupRuns result = %#v, want one run removed", result)
	}
	if got := evidence.ListRunDiffFiles(""); len(got) != 1 || got[0].RunID != runB.ID {
		t.Fatalf("diffs after run cleanup = %#v, want only run B evidence", got)
	}
	if got := evidence.ListArtifacts(""); len(got) != 1 || got[0].ID != artifactB.ID {
		t.Fatalf("artifacts after run cleanup = %#v, want only artifact B", got)
	}
	if _, ok := evidence.GetArtifact(artifactA.ID); ok {
		t.Fatalf("GetArtifact(%s) returned true after run cleanup", artifactA.ID)
	}
	if got := evidence.ListPreviews(""); len(got) != 1 || got[0].ID != previewB.ID {
		t.Fatalf("previews after run cleanup = %#v, want only preview B", got)
	}
	if _, ok := evidence.GetPreview(previewA.ID); ok {
		t.Fatalf("GetPreview(%s) returned true after run cleanup", previewA.ID)
	}

	if !repo.DeleteThread(threadB.ID) {
		t.Fatalf("DeleteThread(%s) returned false", threadB.ID)
	}
	if got := evidence.ListRunDiffFiles(""); len(got) != 0 {
		t.Fatalf("diffs after thread delete = %#v, want empty", got)
	}
	if got := evidence.ListArtifacts(""); len(got) != 0 {
		t.Fatalf("artifacts after thread delete = %#v, want empty", got)
	}
	if got := evidence.ListPreviews(""); len(got) != 0 {
		t.Fatalf("previews after thread delete = %#v, want empty", got)
	}
}

func closeContractHandle(handle repositoryContractHandle) {
	if handle.flush != nil {
		handle.flush()
	}
	if handle.close != nil {
		handle.close()
	}
}
