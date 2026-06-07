package store

import (
	"errors"
	"testing"
	"time"
)

var _ Repository = (*Store)(nil)
var _ RunLifecycleStore = (*Store)(nil)

func TestStoreCreatesProjectThreadRunAndItem(t *testing.T) {
	s := New()

	project, _ := s.CreateProject("proj_test", "Test Project")
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

func TestStoreCreateProjectDistinguishesExistingProject(t *testing.T) {
	s := New()

	created, err := s.CreateProject("proj_test", "Original")
	if err != nil {
		t.Fatalf("CreateProject first call returned error: %v", err)
	}

	existing, err := s.CreateProject("proj_test", "Renamed")
	if !errors.Is(err, ErrProjectExists) {
		t.Fatalf("CreateProject duplicate error = %v, want ErrProjectExists", err)
	}
	if existing.ID != created.ID {
		t.Fatalf("duplicate project ID = %q, want %q", existing.ID, created.ID)
	}
	if existing.Name != "Original" {
		t.Fatalf("duplicate project name = %q, want Original", existing.Name)
	}
	if projects := s.ListProjects(); len(projects) != 1 {
		t.Fatalf("ListProjects length = %d, want 1", len(projects))
	}
}

func TestStoreCreatesThreadMessageItem(t *testing.T) {
	s := New()
	project, _ := s.CreateProject("proj_test", "Test Project")
	thread, err := s.CreateThread("thread_test", project.ID, "Test Thread")
	if err != nil {
		t.Fatalf("CreateThread returned error: %v", err)
	}

	item, err := s.CreateThreadMessage("item_msg", thread.ID, "", "hello")
	if err != nil {
		t.Fatalf("CreateThreadMessage returned error: %v", err)
	}
	if item.ProjectID != project.ID || item.ThreadID != thread.ID {
		t.Fatalf("message item scope = %#v, want project/thread binding", item)
	}
	if item.Type != "user_message" {
		t.Fatalf("item type = %q, want user_message", item.Type)
	}
	if item.Role != "user" {
		t.Fatalf("item role = %q, want user", item.Role)
	}
	if item.Status != "created" {
		t.Fatalf("item status = %q, want created", item.Status)
	}
	if item.Content != "hello" {
		t.Fatalf("item content = %q, want hello", item.Content)
	}
}

func TestStorePinsThreadItems(t *testing.T) {
	s := New()
	_, _ = s.CreateProject("proj_test", "Test Project")
	thread, _ := s.CreateThread("thread_test", "proj_test", "Test Thread")
	otherThread, _ := s.CreateThread("thread_other", "proj_test", "Other Thread")
	item, err := s.CreateThreadMessage("item_msg", thread.ID, "", "hello")
	if err != nil {
		t.Fatalf("CreateThreadMessage returned error: %v", err)
	}
	if _, err := s.CreateThreadMessage("item_other", otherThread.ID, "", "other"); err != nil {
		t.Fatalf("CreateThreadMessage other returned error: %v", err)
	}

	pin, err := s.PinThreadItem(thread.ID, item.ID, "  Delicious233  ")
	if err != nil {
		t.Fatalf("PinThreadItem returned error: %v", err)
	}
	if pin.ThreadID != thread.ID || pin.ItemID != item.ID || pin.PinnedBy != "Delicious233" {
		t.Fatalf("pin = %#v, want trimmed pinned item metadata", pin)
	}

	updated, err := s.PinThreadItem(thread.ID, item.ID, "AgentHub")
	if err != nil {
		t.Fatalf("PinThreadItem duplicate returned error: %v", err)
	}
	if updated.CreatedAt != pin.CreatedAt || updated.PinnedBy != "AgentHub" || updated.UpdatedAt == "" {
		t.Fatalf("updated pin = %#v, want same CreatedAt and updated metadata", updated)
	}
	if pins := s.ListThreadPins(thread.ID); len(pins) != 1 || pins[0].PinnedBy != "AgentHub" {
		t.Fatalf("ListThreadPins = %#v, want one updated pin", pins)
	}

	if _, err := s.PinThreadItem("thread_missing", item.ID, "user"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("PinThreadItem missing thread error = %v, want ErrNotFound", err)
	}
	if _, err := s.PinThreadItem(thread.ID, "item_other", "user"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("PinThreadItem cross-thread item error = %v, want ErrNotFound", err)
	}

	if !s.DeleteThreadPin(thread.ID, item.ID) {
		t.Fatal("DeleteThreadPin returned false")
	}
	if pins := s.ListThreadPins(thread.ID); len(pins) != 0 {
		t.Fatalf("ListThreadPins after delete = %#v, want empty", pins)
	}
	if s.DeleteThreadPin(thread.ID, item.ID) {
		t.Fatal("DeleteThreadPin missing pin returned true")
	}
}

func TestStoreRejectsThreadMessageForMissingThread(t *testing.T) {
	s := New()
	_, _ = s.CreateProject("proj_test", "Test Project")

	_, err := s.CreateThreadMessage("item_msg", "thread_missing", "user", "hello")
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("CreateThreadMessage error = %v, want ErrNotFound", err)
	}
}

func TestStoreRejectsRunForMissingThread(t *testing.T) {
	s := New()
	_, _ = s.CreateProject("proj_test", "Test Project")

	_, err := s.CreateRun("run_test", "proj_test", "thread_missing")
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("CreateRun error = %v, want ErrNotFound", err)
	}
}

func TestStoreAllowsMultipleRunsForSameThread(t *testing.T) {
	s := New()
	_, _ = s.CreateProject("proj_test", "Test Project")
	_, _ = s.CreateThread("thread_test", "proj_test", "Test Thread")

	first, err := s.CreateRun("run_first", "proj_test", "thread_test")
	if err != nil {
		t.Fatalf("CreateRun first returned error: %v", err)
	}
	second, err := s.CreateRun("run_second", "proj_test", "thread_test")
	if err != nil {
		t.Fatalf("CreateRun second returned error: %v", err)
	}

	runs := s.ListRuns("thread_test")
	if len(runs) != 2 {
		t.Fatalf("ListRuns length = %d, want 2", len(runs))
	}
	if runs[0].ID != first.ID || runs[1].ID != second.ID {
		t.Fatalf("ListRuns order = %#v, want first then second", runs)
	}
}

func TestStoreFiltersListsByProjectAndThread(t *testing.T) {
	s := New()
	_, _ = s.CreateProject("proj_a", "A")
	_, _ = s.CreateProject("proj_b", "B")
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

func TestStoreUpdatesAndDeletesThreads(t *testing.T) {
	s := New()
	_, _ = s.CreateProject("proj_test", "Test Project")
	thread, err := s.CreateThread("thread_test", "proj_test", "Test Thread")
	if err != nil {
		t.Fatalf("CreateThread returned error: %v", err)
	}
	run, err := s.CreateRun("run_test", "proj_test", thread.ID)
	if err != nil {
		t.Fatalf("CreateRun returned error: %v", err)
	}
	if _, err := s.CreateThreadMessage("item_test", thread.ID, "user", "hello"); err != nil {
		t.Fatalf("CreateThreadMessage returned error: %v", err)
	}
	if _, err := s.PinThreadItem(thread.ID, "item_test", "Delicious233"); err != nil {
		t.Fatalf("PinThreadItem returned error: %v", err)
	}

	title := "Renamed Thread"
	status := "archived"
	updated, ok := s.UpdateThread(thread.ID, &title, &status)
	if !ok {
		t.Fatal("UpdateThread returned ok=false")
	}
	if updated.Title != title || updated.Status != status || updated.UpdatedAt == "" {
		t.Fatalf("updated thread = %#v, want title/status and updatedAt", updated)
	}

	if !s.DeleteThread(thread.ID) {
		t.Fatal("DeleteThread returned false")
	}
	if _, ok := s.GetThread(thread.ID); ok {
		t.Fatal("thread still exists after delete")
	}
	if _, ok := s.GetRun(run.ID); ok {
		t.Fatal("thread run still exists after delete")
	}
	if items := s.ListThreadItems(thread.ID); len(items) != 0 {
		t.Fatalf("thread items = %#v, want none after delete", items)
	}
	if pins := s.ListThreadPins(thread.ID); len(pins) != 0 {
		t.Fatalf("thread pins = %#v, want none after delete", pins)
	}
}

func TestStoreUpdatesRunStatusTimestamps(t *testing.T) {
	s := New()
	_, _ = s.CreateProject("proj_test", "Test Project")
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

func TestStoreSetRunStatusIfDoesNotOverwriteDisallowedStatus(t *testing.T) {
	s := New()
	_, _ = s.CreateProject("proj_test", "Test Project")
	_, _ = s.CreateThread("thread_test", "proj_test", "Test Thread")
	_, _ = s.CreateRun("run_test", "proj_test", "thread_test")
	finished, ok := s.SetRunStatus("run_test", "finished")
	if !ok {
		t.Fatal("SetRunStatus returned ok=false")
	}

	got, ok := s.SetRunStatusIf("run_test", "cancelling", "queued", "started")
	if ok {
		t.Fatal("SetRunStatusIf returned ok=true for disallowed terminal status")
	}
	if got.Status != finished.Status {
		t.Fatalf("run status = %q, want %q", got.Status, finished.Status)
	}
	stored, ok := s.GetRun("run_test")
	if !ok {
		t.Fatal("GetRun returned ok=false")
	}
	if stored.Status != "finished" {
		t.Fatalf("stored status = %q, want finished", stored.Status)
	}
}

func TestStoreCleanupRunsRemovesExpiredTerminalRunsAndItems(t *testing.T) {
	now := time.Date(2026, 5, 25, 9, 0, 0, 0, time.UTC)
	s := newStoreWithRunsForCleanup(now, map[string]Run{
		"run_old": {
			ID:         "run_old",
			ProjectID:  "proj_test",
			ThreadID:   "thread_test",
			Status:     "finished",
			CreatedAt:  now.Add(-72 * time.Hour).Format(time.RFC3339),
			FinishedAt: now.Add(-48 * time.Hour).Format(time.RFC3339),
		},
		"run_recent": {
			ID:         "run_recent",
			ProjectID:  "proj_test",
			ThreadID:   "thread_test",
			Status:     "failed",
			CreatedAt:  now.Add(-2 * time.Hour).Format(time.RFC3339),
			FinishedAt: now.Add(-1 * time.Hour).Format(time.RFC3339),
		},
		"run_active": {
			ID:        "run_active",
			ProjectID: "proj_test",
			ThreadID:  "thread_test",
			Status:    "queued",
			CreatedAt: now.Add(-72 * time.Hour).Format(time.RFC3339),
		},
	}, []string{"run_old", "run_recent", "run_active"})
	addCleanupItem(s, "item_old", "run_old")
	addCleanupItem(s, "item_recent", "run_recent")
	addCleanupItem(s, "item_active", "run_active")
	if _, err := s.PinThreadItem("thread_test", "item_old", "Delicious233"); err != nil {
		t.Fatalf("PinThreadItem old returned error: %v", err)
	}
	if _, err := s.PinThreadItem("thread_test", "item_recent", "Delicious233"); err != nil {
		t.Fatalf("PinThreadItem recent returned error: %v", err)
	}

	result := s.CleanupRuns(RunCleanupOptions{
		Now:         now,
		TerminalTTL: 24 * time.Hour,
	})

	if result.RemovedRuns != 1 || result.RemovedItems != 1 {
		t.Fatalf("CleanupRuns result = %#v, want one removed run and item", result)
	}
	if _, ok := s.GetRun("run_old"); ok {
		t.Fatal("expired terminal run was not removed")
	}
	if _, ok := s.GetItem("item_old"); ok {
		t.Fatal("item for expired terminal run was not removed")
	}
	if _, ok := s.GetRun("run_recent"); !ok {
		t.Fatal("recent terminal run was removed")
	}
	if _, ok := s.GetRun("run_active"); !ok {
		t.Fatal("active run was removed")
	}
	if _, ok := s.GetItem("item_recent"); !ok {
		t.Fatal("item for recent terminal run was removed")
	}
	if _, ok := s.GetItem("item_active"); !ok {
		t.Fatal("item for active run was removed")
	}
	pins := s.ListThreadPins("thread_test")
	if len(pins) != 1 || pins[0].ItemID != "item_recent" {
		t.Fatalf("pins after cleanup = %#v, want only recent item pin", pins)
	}
}

func TestStoreCleanupRunsEnforcesMaxTerminalRunsPerThread(t *testing.T) {
	now := time.Date(2026, 5, 25, 9, 0, 0, 0, time.UTC)
	s := newStoreWithRunsForCleanup(now, map[string]Run{
		"run_new": {
			ID:         "run_new",
			ProjectID:  "proj_test",
			ThreadID:   "thread_test",
			Status:     "finished",
			CreatedAt:  now.Add(-4 * time.Hour).Format(time.RFC3339),
			FinishedAt: now.Add(-1 * time.Hour).Format(time.RFC3339),
		},
		"run_old": {
			ID:         "run_old",
			ProjectID:  "proj_test",
			ThreadID:   "thread_test",
			Status:     "finished",
			CreatedAt:  now.Add(-5 * time.Hour).Format(time.RFC3339),
			FinishedAt: now.Add(-3 * time.Hour).Format(time.RFC3339),
		},
		"run_mid": {
			ID:         "run_mid",
			ProjectID:  "proj_test",
			ThreadID:   "thread_test",
			Status:     "cancelled",
			CreatedAt:  now.Add(-5 * time.Hour).Format(time.RFC3339),
			FinishedAt: now.Add(-2 * time.Hour).Format(time.RFC3339),
		},
		"run_active": {
			ID:        "run_active",
			ProjectID: "proj_test",
			ThreadID:  "thread_test",
			Status:    "started",
			CreatedAt: now.Add(-6 * time.Hour).Format(time.RFC3339),
		},
	}, []string{"run_new", "run_old", "run_mid", "run_active"})
	addCleanupItem(s, "item_old", "run_old")
	addCleanupItem(s, "item_mid", "run_mid")
	addCleanupItem(s, "item_new", "run_new")
	addCleanupItem(s, "item_active", "run_active")

	result := s.CleanupRuns(RunCleanupOptions{
		Now:                      now,
		MaxTerminalRunsPerThread: 2,
	})

	if result.RemovedRuns != 1 || result.RemovedItems != 1 {
		t.Fatalf("CleanupRuns result = %#v, want one removed run and item", result)
	}
	if _, ok := s.GetRun("run_old"); ok {
		t.Fatal("oldest terminal run was not removed")
	}
	for _, id := range []string{"run_mid", "run_new", "run_active"} {
		if _, ok := s.GetRun(id); !ok {
			t.Fatalf("%s was removed, want it kept", id)
		}
	}
	if _, ok := s.GetItem("item_old"); ok {
		t.Fatal("item for oldest terminal run was not removed")
	}
}

func newStoreWithRunsForCleanup(now time.Time, runs map[string]Run, runOrder []string) *Store {
	s := New()
	items := make(map[string]Item)
	s.applySnapshot(fileSnapshot{
		Projects: map[string]Project{
			"proj_test": {
				ID:        "proj_test",
				Name:      "Test Project",
				Status:    "active",
				CreatedAt: now.Format(time.RFC3339),
				UpdatedAt: now.Format(time.RFC3339),
			},
		},
		Threads: map[string]Thread{
			"thread_test": {
				ID:        "thread_test",
				ProjectID: "proj_test",
				Title:     "Test Thread",
				Status:    "active",
				CreatedAt: now.Format(time.RFC3339),
				UpdatedAt: now.Format(time.RFC3339),
			},
		},
		Runs:         runs,
		Items:        items,
		ProjectOrder: []string{"proj_test"},
		ThreadOrder:  []string{"thread_test"},
		RunOrder:     runOrder,
	})
	return s
}

func addCleanupItem(s *Store, itemID, runID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	item := Item{
		ID:        itemID,
		ProjectID: "proj_test",
		ThreadID:  "thread_test",
		RunID:     runID,
		Type:      "run",
		Status:    "created",
		CreatedAt: "2026-05-25T09:00:00Z",
		UpdatedAt: "2026-05-25T09:00:00Z",
	}
	s.items[itemID] = item
	s.itemOrder = append(s.itemOrder, itemID)
}
