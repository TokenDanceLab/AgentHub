package adapters

import (
	"context"
	"fmt"
	"io"
	"sync"
	"testing"

	"github.com/agenthub/edge-server/internal/store"
)

type stubAdapter struct {
	id string
}

func (s *stubAdapter) Metadata() AdapterMetadata       { return AdapterMetadata{ID: s.id, Name: s.id} }
func (s *stubAdapter) Capabilities() AgentCapabilities { return AgentCapabilities{} }
func (s *stubAdapter) BuildCommand(ctx RunProcessContext) (string, []string, []string, string) {
	return "", nil, nil, ""
}
func (s *stubAdapter) ParseStream(ctx context.Context, stdout io.Reader, stdin io.Writer, emitter EventEmitter, run store.Run) error {
	return nil
}
func (s *stubAdapter) NeedsStdin() bool { return false }
func (s *stubAdapter) Available() bool  { return true }

func TestRegistryRegisterAndGet(t *testing.T) {
	r := NewRegistry()
	a := &stubAdapter{id: "test-adapter"}

	if err := r.Register(a); err != nil {
		t.Fatalf("Register: %v", err)
	}

	got, ok := r.Get("test-adapter")
	if !ok {
		t.Fatal("Get returned not found")
	}
	if got.Metadata().ID != "test-adapter" {
		t.Errorf("got ID %q, want test-adapter", got.Metadata().ID)
	}
}

func TestRegistryRegisterDuplicate(t *testing.T) {
	r := NewRegistry()
	r.Register(&stubAdapter{id: "dup"})
	err := r.Register(&stubAdapter{id: "dup"})
	if err == nil {
		t.Error("expected error on duplicate registration")
	}
}

func TestRegistryRegisterEmptyID(t *testing.T) {
	r := NewRegistry()
	err := r.Register(&stubAdapter{id: ""})
	if err == nil {
		t.Error("expected error on empty ID")
	}
}

func TestRegistryGetNotFound(t *testing.T) {
	r := NewRegistry()
	_, ok := r.Get("nonexistent")
	if ok {
		t.Error("expected not found")
	}
}

func TestRegistryList(t *testing.T) {
	r := NewRegistry()
	r.Register(&stubAdapter{id: "a1"})
	r.Register(&stubAdapter{id: "a2"})

	list := r.List()
	if len(list) != 2 {
		t.Fatalf("expected 2 adapters, got %d", len(list))
	}
}

func TestRegistrySetDefaultAndResolve(t *testing.T) {
	r := NewRegistry()
	a := &stubAdapter{id: "default-agent"}
	r.Register(a)
	r.SetDefault("default", "default-agent")

	resolved, err := r.Resolve("")
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if resolved.Metadata().ID != "default-agent" {
		t.Errorf("got %q, want default-agent", resolved.Metadata().ID)
	}
}

func TestRegistryResolveSpecific(t *testing.T) {
	r := NewRegistry()
	r.Register(&stubAdapter{id: "specific-agent"})

	resolved, err := r.Resolve("specific-agent")
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if resolved.Metadata().ID != "specific-agent" {
		t.Errorf("got %q, want specific-agent", resolved.Metadata().ID)
	}
}

func TestRegistryResolveNotFound(t *testing.T) {
	r := NewRegistry()
	_, err := r.Resolve("nonexistent")
	if err == nil {
		t.Error("expected error for nonexistent agent")
	}
}

func TestRegistryResolveNoDefault(t *testing.T) {
	r := NewRegistry()
	_, err := r.Resolve("")
	if err == nil {
		t.Error("expected error when no default configured")
	}
}

func TestRegistryDefaultRoleNotFound(t *testing.T) {
	r := NewRegistry()
	_, ok := r.Default("nonexistent-role")
	if ok {
		t.Error("expected not found for unset role")
	}
}

func TestRegistrySetDefaultOverwrites(t *testing.T) {
	r := NewRegistry()
	r.Register(&stubAdapter{id: "first"})
	r.Register(&stubAdapter{id: "second"})

	r.SetDefault("default", "first")
	r.SetDefault("default", "second")

	resolved, err := r.Resolve("")
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if resolved.Metadata().ID != "second" {
		t.Fatalf("got %q, want second (overwritten default)", resolved.Metadata().ID)
	}
}

func TestRegistrySetDefaultRoleSpecific(t *testing.T) {
	r := NewRegistry()
	r.Register(&stubAdapter{id: "worker-a"})
	r.Register(&stubAdapter{id: "worker-b"})

	r.SetDefault("worker", "worker-a")
	r.SetDefault("reviewer", "worker-b")

	got, ok := r.Default("worker")
	if !ok || got.Metadata().ID != "worker-a" {
		t.Fatalf("Default(worker) = %v, %v; want worker-a", got, ok)
	}
	got, ok = r.Default("reviewer")
	if !ok || got.Metadata().ID != "worker-b" {
		t.Fatalf("Default(reviewer) = %v, %v; want worker-b", got, ok)
	}
}

func TestRegistryConcurrentRegisterAndGet(t *testing.T) {
	r := NewRegistry()
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			r.Register(&stubAdapter{id: fmt.Sprintf("concurrent-%d", id)})
		}(i)
	}
	wg.Wait()

	for i := 0; i < 20; i++ {
		if _, ok := r.Get(fmt.Sprintf("concurrent-%d", i)); !ok {
			t.Fatalf("concurrent-%d not found after concurrent registration", i)
		}
	}
}
