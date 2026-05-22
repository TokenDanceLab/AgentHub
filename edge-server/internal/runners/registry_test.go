package runners

import (
	"sync"
	"testing"
)

func TestNewRegistryPrePopulatesMockRunner(t *testing.T) {
	r := NewRegistry()
	list := r.List()
	if len(list) != 1 {
		t.Fatalf("expected 1 pre-populated runner, got %d", len(list))
	}
	info := list[0]
	if info.ID != "runner_local_1" {
		t.Errorf("id = %q, want runner_local_1", info.ID)
	}
	if info.Name != "Mock Runner (local)" {
		t.Errorf("name = %q", info.Name)
	}
	if info.Status != "online" {
		t.Errorf("status = %q, want online", info.Status)
	}
	if len(info.Capabilities) < 2 {
		t.Errorf("expected at least 2 capabilities, got %v", info.Capabilities)
	}
}

func TestListReturnsCopy(t *testing.T) {
	r := NewRegistry()
	list1 := r.List()
	list2 := r.List()
	// Modify the returned slice; should not affect internal state.
	list1[0] = RunnerInfo{ID: "hacked"}
	list3 := r.List()
	if list3[0].ID != "runner_local_1" {
		t.Error("List should return a copy, not internal reference")
	}
	_ = list2
}

func TestGetExisting(t *testing.T) {
	r := NewRegistry()
	info, ok := r.Get("runner_local_1")
	if !ok {
		t.Fatal("expected runner_local_1 to exist")
	}
	if info.ID != "runner_local_1" {
		t.Errorf("id = %q", info.ID)
	}
}

func TestGetNonExisting(t *testing.T) {
	r := NewRegistry()
	_, ok := r.Get("nonexistent")
	if ok {
		t.Error("expected false for nonexistent runner")
	}
}

func TestUpsertNew(t *testing.T) {
	r := NewRegistry()
	r.Upsert(RunnerInfo{
		ID:           "runner_2",
		Name:         "Codex Runner",
		Status:       "idle",
		Capabilities: []string{"codex"},
	})

	list := r.List()
	if len(list) != 2 {
		t.Fatalf("expected 2 runners, got %d", len(list))
	}
	info, ok := r.Get("runner_2")
	if !ok {
		t.Fatal("runner_2 should exist")
	}
	if info.Status != "idle" {
		t.Errorf("status = %q, want idle", info.Status)
	}
}

func TestUpsertUpdate(t *testing.T) {
	r := NewRegistry()
	r.Upsert(RunnerInfo{
		ID:           "runner_local_1",
		Name:         "Updated Runner",
		Status:       "offline",
		Capabilities: []string{"mock"},
	})

	info, ok := r.Get("runner_local_1")
	if !ok {
		t.Fatal("runner_local_1 should still exist")
	}
	if info.Name != "Updated Runner" {
		t.Errorf("name = %q, want 'Updated Runner'", info.Name)
	}
	if info.Status != "offline" {
		t.Errorf("status = %q, want offline", info.Status)
	}
}

func TestRemove(t *testing.T) {
	r := NewRegistry()
	r.Remove("runner_local_1")

	list := r.List()
	if len(list) != 0 {
		t.Errorf("expected 0 runners after remove, got %d", len(list))
	}
	_, ok := r.Get("runner_local_1")
	if ok {
		t.Error("runner_local_1 should not exist after remove")
	}
}

func TestRemoveNonExisting(t *testing.T) {
	r := NewRegistry()
	// Should not panic.
	r.Remove("nonexistent")
	if len(r.List()) != 1 {
		t.Error("removing nonexistent runner should not affect existing ones")
	}
}

func TestListEmpty(t *testing.T) {
	r := NewRegistry()
	r.Remove("runner_local_1")
	list := r.List()
	if list == nil {
		t.Error("List should return empty slice, not nil")
	}
	if len(list) != 0 {
		t.Errorf("expected empty list, got %d items", len(list))
	}
}

func TestConcurrentAccess(t *testing.T) {
	r := NewRegistry()
	var wg sync.WaitGroup
	const goroutines = 20

	for i := 0; i < goroutines; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			r.List()
			r.Get("runner_local_1")
		}(i)
	}

	for i := 0; i < goroutines; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			r.Upsert(RunnerInfo{
				ID:     "runner_concurrent",
				Status: "online",
			})
		}(i)
	}

	for i := 0; i < goroutines; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			r.Remove("runner_concurrent")
		}(i)
	}

	wg.Wait()
	// Should not panic; final state is race-dependent but must be consistent.
	_ = r.List()
}
