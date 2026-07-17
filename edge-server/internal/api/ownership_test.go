package api

import (
	"path/filepath"
	"testing"

	"github.com/agenthub/edge-server/internal/events"
	"github.com/agenthub/edge-server/internal/store"
)

func TestFilterProjectsByOwner(t *testing.T) {
	t.Parallel()

	projects := []store.Project{
		{ID: "p1", OwnerID: "user-a"},
		{ID: "p2", OwnerID: "user-b"},
		{ID: "p3", OwnerID: ""},
	}

	if got := filterProjectsByOwner(projects, ""); len(got) != 3 {
		t.Fatalf("empty userID should skip filter: got %d", len(got))
	}

	got := filterProjectsByOwner(projects, "user-a")
	if len(got) != 1 || got[0].ID != "p1" {
		t.Fatalf("user-a filter: got %+v", got)
	}
}

func TestIsProjectOwnedByFailClosed(t *testing.T) {
	t.Parallel()

	repo := store.New()
	_, _ = repo.CreateProject("owned", "Owned", "user-a")
	_, _ = repo.CreateProject("unowned", "Unowned", "")

	if !isProjectOwnedBy(repo, "owned", "") {
		t.Fatal("local auth should allow any project")
	}
	if !isProjectOwnedBy(repo, "owned", "user-a") {
		t.Fatal("owner should access owned project")
	}
	if isProjectOwnedBy(repo, "owned", "user-b") {
		t.Fatal("non-owner must be denied")
	}
	// AH-SR-045: unowned projects fail closed under Hub JWT.
	if isProjectOwnedBy(repo, "unowned", "user-a") {
		t.Fatal("unowned project must fail closed under Hub JWT")
	}
	if isProjectOwnedBy(repo, "missing", "user-a") {
		t.Fatal("missing project must fail closed")
	}
}

// itemOwnerRepo is a minimal Reader for ownership checks that need unanchored items.
// store.CreateItem always requires project+thread anchors, so tests inject items here.
type itemOwnerRepo struct {
	store.Reader
	items map[string]store.Item
}

func (r itemOwnerRepo) GetItem(id string) (store.Item, bool) {
	item, ok := r.items[id]
	return item, ok
}

func TestIsItemOwnedByFailClosedNoAnchors(t *testing.T) {
	t.Parallel()

	base := store.New()
	_, _ = base.CreateProject("proj-a", "A", "user-a")
	_, _ = base.CreateThread("thread-a", "proj-a", "T", "direct", "", "")
	_, _ = base.CreateRun("run-a", "proj-a", "thread-a")

	repo := itemOwnerRepo{
		Reader: base,
		items: map[string]store.Item{
			"item-proj":   {ID: "item-proj", ProjectID: "proj-a"},
			"item-thread": {ID: "item-thread", ThreadID: "thread-a"},
			"item-run":    {ID: "item-run", RunID: "run-a"},
			"item-none":   {ID: "item-none"},
		},
	}

	if !isItemOwnedBy(repo, "item-proj", "user-a") {
		t.Fatal("project-anchored item should be owned")
	}
	if !isItemOwnedBy(repo, "item-thread", "user-a") {
		t.Fatal("thread-anchored item should be owned")
	}
	if !isItemOwnedBy(repo, "item-run", "user-a") {
		t.Fatal("run-anchored item should be owned")
	}
	if isItemOwnedBy(repo, "item-none", "user-a") {
		t.Fatal("item with no ownership anchors must fail closed under Hub JWT")
	}
	if !isItemOwnedBy(repo, "item-none", "") {
		t.Fatal("local auth should allow unanchored item")
	}
}

func TestEventVisibleToUser(t *testing.T) {
	t.Parallel()

	repo := store.New()
	_, _ = repo.CreateProject("proj-a", "A", "user-a")
	_, _ = repo.CreateThread("thread-a", "proj-a", "T", "direct", "", "")
	_, _ = repo.CreateRun("run-a", "proj-a", "thread-a")

	if !eventVisibleToUser(repo, events.EventEnvelope{Type: "any"}, "") {
		t.Fatal("local auth should see all events")
	}
	if !eventVisibleToUser(repo, events.EventEnvelope{Type: events.GapEventType}, "user-a") {
		t.Fatal("gap events always visible under Hub JWT")
	}
	if eventVisibleToUser(repo, events.EventEnvelope{Type: "run.updated"}, "user-a") {
		t.Fatal("unscoped event under Hub JWT must be hidden")
	}
	if eventVisibleToUser(nil, events.EventEnvelope{
		Type:  "run.updated",
		Scope: map[string]any{"projectId": "proj-a"},
	}, "user-a") {
		t.Fatal("nil repo under Hub JWT must fail closed")
	}
	if !eventVisibleToUser(repo, events.EventEnvelope{
		Type:  "project.updated",
		Scope: map[string]any{"projectId": "proj-a"},
	}, "user-a") {
		t.Fatal("owned project scope should be visible")
	}
	if !eventVisibleToUser(repo, events.EventEnvelope{
		Type:  "thread.updated",
		Scope: map[string]any{"threadId": "thread-a"},
	}, "user-a") {
		t.Fatal("owned thread scope should be visible")
	}
	if !eventVisibleToUser(repo, events.EventEnvelope{
		Type:  "run.updated",
		Scope: map[string]any{"runId": "run-a"},
	}, "user-a") {
		t.Fatal("owned run scope should be visible")
	}
	if eventVisibleToUser(repo, events.EventEnvelope{
		Type:  "project.updated",
		Scope: map[string]any{"projectId": "missing"},
	}, "user-a") {
		t.Fatal("missing project scope must fail closed")
	}
}

func TestIsPathWithin(t *testing.T) {
	t.Parallel()

	root := filepath.Clean("/workspace/root")
	cases := []struct {
		name string
		path string
		want bool
	}{
		{name: "root itself", path: root, want: true},
		{name: "child", path: filepath.Join(root, "src", "main.go"), want: true},
		{name: "parent escape", path: filepath.Join(root, "..", "outside"), want: false},
		{name: "double-dot segment", path: filepath.Join(root, "a", "..", "..", "outside"), want: false},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := isPathWithin(root, tc.path); got != tc.want {
				t.Fatalf("isPathWithin(%q, %q)=%v want %v", root, tc.path, got, tc.want)
			}
		})
	}
}

func TestListAndAcceptedResponseShape(t *testing.T) {
	t.Parallel()

	list := listResponse([]string{"a", "b"})
	items, ok := list["items"].([]string)
	if !ok || len(items) != 2 {
		t.Fatalf("listResponse items: %+v", list["items"])
	}
	page, ok := list["page"].(map[string]any)
	if !ok {
		t.Fatalf("listResponse page missing: %+v", list)
	}
	if page["hasMore"] != false {
		t.Fatalf("hasMore want false, got %v", page["hasMore"])
	}

	in := map[string]any{"status": "accepted", "id": "x"}
	out := acceptedResponse(in)
	if out["status"] != "accepted" || out["id"] != "x" {
		t.Fatalf("acceptedResponse should pass through: %+v", out)
	}
}
