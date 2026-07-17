package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/agenthub/edge-server/internal/edgeidentity"
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

	// #878: empty userID fails closed (no unrestricted multi-user access).
	if got := filterProjectsByOwner(projects, ""); len(got) != 0 {
		t.Fatalf("empty userID must fail closed: got %d", len(got))
	}

	// Documented local single-tenant bypass still sees all projects.
	if got := filterProjectsByOwner(projects, localSingleTenantBypass); len(got) != 3 {
		t.Fatalf("local single-tenant should skip filter: got %d", len(got))
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

	// #878: empty userID fails closed on multi-user ownership checks.
	if isProjectOwnedBy(repo, "owned", "") {
		t.Fatal("empty userID must fail closed")
	}
	if !isProjectOwnedBy(repo, "owned", localSingleTenantBypass) {
		t.Fatal("local single-tenant should allow any project")
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

func TestEmptyUserIDFailClosedAcrossHelpers(t *testing.T) {
	t.Parallel()

	repo := store.New()
	_, _ = repo.CreateProject("proj-a", "A", "user-a")
	_, _ = repo.CreateThread("thread-a", "proj-a", "T", "direct", "", "")
	_, _ = repo.CreateRun("run-a", "proj-a", "thread-a")
	_, _ = repo.UpsertArtifact(store.Artifact{ID: "art-a", RunID: "run-a", Kind: "file", Path: "out.txt"})
	_, _ = repo.UpsertPreview(store.Preview{ID: "prev-a", RunID: "run-a", URL: "http://127.0.0.1/x", Status: "ready"})

	// Empty userID must deny all ownership helpers used by state-changing/read APIs.
	if isProjectOwnedBy(repo, "proj-a", "") {
		t.Fatal("isProjectOwnedBy empty must deny")
	}
	if isThreadOwnedBy(repo, "thread-a", "") {
		t.Fatal("isThreadOwnedBy empty must deny")
	}
	if isRunOwnedBy(repo, "run-a", "") {
		t.Fatal("isRunOwnedBy empty must deny")
	}
	if isArtifactOwnedBy(repo, "art-a", "") {
		t.Fatal("isArtifactOwnedBy empty must deny")
	}
	if isPreviewOwnedBy(repo, "prev-a", "") {
		t.Fatal("isPreviewOwnedBy empty must deny")
	}
	if eventVisibleToUser(repo, events.EventEnvelope{
		Type:  "run.updated",
		Scope: map[string]any{"runId": "run-a"},
	}, "") {
		t.Fatal("eventVisibleToUser empty must deny")
	}

	// List filters return empty under empty userID.
	if got := filterThreadsByOwner(repo.ListThreads(""), repo, ""); len(got) != 0 {
		t.Fatalf("filterThreadsByOwner empty must return none, got %d", len(got))
	}
	if got := filterRunsByOwner(repo.ListRuns(""), repo, ""); len(got) != 0 {
		t.Fatalf("filterRunsByOwner empty must return none, got %d", len(got))
	}
	if got := filterArtifactsByOwner(repo.ListArtifacts(""), repo, ""); len(got) != 0 {
		t.Fatalf("filterArtifactsByOwner empty must return none, got %d", len(got))
	}
	if got := filterPreviewsByOwner(repo.ListPreviews(""), repo, ""); len(got) != 0 {
		t.Fatalf("filterPreviewsByOwner empty must return none, got %d", len(got))
	}

	// Local single-tenant bypass still allows.
	if !isProjectOwnedBy(repo, "proj-a", localSingleTenantBypass) ||
		!isThreadOwnedBy(repo, "thread-a", localSingleTenantBypass) ||
		!isRunOwnedBy(repo, "run-a", localSingleTenantBypass) ||
		!isArtifactOwnedBy(repo, "art-a", localSingleTenantBypass) ||
		!isPreviewOwnedBy(repo, "prev-a", localSingleTenantBypass) {
		t.Fatal("local single-tenant bypass must allow owned resources")
	}
}

func TestOwnerUserIDModeGate(t *testing.T) {
	t.Parallel()

	// No identity, multi-user mode → fail closed empty.
	req := httptest.NewRequest(http.MethodGet, "/v1/projects", nil)
	if got := OwnerUserID(req, true); got != "" {
		t.Fatalf("multi-user empty identity want \"\", got %q", got)
	}
	// No identity, local single-tenant mode → documented bypass.
	if got := OwnerUserID(req, false); got != localSingleTenantBypass {
		t.Fatalf("local mode want bypass, got %q", got)
	}

	// Hub identity present always wins.
	ctx := context.WithValue(context.Background(), edgeidentity.HubUserIDKey, "user-a")
	req = req.WithContext(ctx)
	if got := OwnerUserID(req, true); got != "user-a" {
		t.Fatalf("hub identity multi-user: got %q", got)
	}
	if got := OwnerUserID(req, false); got != "user-a" {
		t.Fatalf("hub identity local mode: got %q", got)
	}

	// Handler.ownerUserID uses HubJWTSecret as multi-user gate.
	hMulti := &Handler{HubJWTSecret: "secret-at-least-32-bytes-long!!!!"}
	reqNoID := httptest.NewRequest(http.MethodGet, "/v1/projects", nil)
	if got := hMulti.ownerUserID(reqNoID); got != "" {
		t.Fatalf("handler multi-user empty want \"\", got %q", got)
	}
	hLocal := &Handler{}
	if got := hLocal.ownerUserID(reqNoID); got != localSingleTenantBypass {
		t.Fatalf("handler local empty want bypass, got %q", got)
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
	// #878: empty userID fails closed even for unanchored items.
	if isItemOwnedBy(repo, "item-none", "") {
		t.Fatal("empty userID must fail closed for unanchored item")
	}
	if !isItemOwnedBy(repo, "item-none", localSingleTenantBypass) {
		t.Fatal("local single-tenant should allow unanchored item")
	}
}

func TestEventVisibleToUser(t *testing.T) {
	t.Parallel()

	repo := store.New()
	_, _ = repo.CreateProject("proj-a", "A", "user-a")
	_, _ = repo.CreateThread("thread-a", "proj-a", "T", "direct", "", "")
	_, _ = repo.CreateRun("run-a", "proj-a", "thread-a")

	// #878: empty userID fails closed.
	if eventVisibleToUser(repo, events.EventEnvelope{Type: "any"}, "") {
		t.Fatal("empty userID must not see events")
	}
	if !eventVisibleToUser(repo, events.EventEnvelope{Type: "any"}, localSingleTenantBypass) {
		t.Fatal("local single-tenant should see all events")
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
