package store

import (
	"reflect"
	"testing"
)

func TestDefaultNonEmpty(t *testing.T) {
	t.Parallel()
	tests := []struct {
		value, fallback, want string
	}{
		{"", "fallback", "fallback"},
		{"kept", "fallback", "kept"},
		{" ", "fallback", " "},
	}
	for _, tt := range tests {
		if got := defaultNonEmpty(tt.value, tt.fallback); got != tt.want {
			t.Fatalf("defaultNonEmpty(%q, %q) = %q, want %q", tt.value, tt.fallback, got, tt.want)
		}
	}
}

func TestScopeEquals(t *testing.T) {
	t.Parallel()
	tests := []struct {
		filter, value string
		want          bool
	}{
		{"", "any", true},
		{"p1", "p1", true},
		{"p1", "p2", false},
	}
	for _, tt := range tests {
		if got := scopeEquals(tt.filter, tt.value); got != tt.want {
			t.Fatalf("scopeEquals(%q, %q) = %v, want %v", tt.filter, tt.value, got, tt.want)
		}
	}
}

func TestCollectAndFilterOrdered(t *testing.T) {
	t.Parallel()
	order := []string{"a", "b", "c"}
	items := map[string]int{"a": 1, "b": 2, "c": 3}

	got := collectOrdered(order, items)
	want := []int{1, 2, 3}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("collectOrdered = %#v, want %#v", got, want)
	}

	filtered := filterOrdered(order, items, func(v int) bool { return v%2 == 1 })
	wantFiltered := []int{1, 3}
	if !reflect.DeepEqual(filtered, wantFiltered) {
		t.Fatalf("filterOrdered = %#v, want %#v", filtered, wantFiltered)
	}
}

func TestSelectCurrentUserProfile(t *testing.T) {
	t.Parallel()
	order := []string{"u1", "u2", "u3"}
	profiles := map[string]UserProfile{
		"u1": {ID: "u1", Status: "member"},
		"u2": {ID: "u2", Status: "owner"},
		"u3": {ID: "u3", Status: "member"},
	}
	got, ok := selectCurrentUserProfile(order, profiles)
	if !ok || got.ID != "u2" {
		t.Fatalf("owner select = %#v ok=%v", got, ok)
	}

	// No owner → first profile.
	got, ok = selectCurrentUserProfile(order, map[string]UserProfile{
		"u1": {ID: "u1", Status: "member"},
		"u2": {ID: "u2", Status: "member"},
		"u3": {ID: "u3", Status: "member"},
	})
	if !ok || got.ID != "u1" {
		t.Fatalf("first profile = %#v ok=%v", got, ok)
	}

	if _, ok := selectCurrentUserProfile(nil, nil); ok {
		t.Fatal("empty should be missing")
	}
}

func TestSortItemsAndPins(t *testing.T) {
	t.Parallel()
	items := []Item{
		{ID: "b", CreatedAt: "2026-01-02T00:00:00Z"},
		{ID: "a", CreatedAt: "2026-01-01T00:00:00Z"},
		{ID: "c", CreatedAt: "2026-01-03T00:00:00Z"},
	}
	sortItemsByCreatedAtAsc(items)
	if items[0].ID != "a" || items[1].ID != "b" || items[2].ID != "c" {
		t.Fatalf("sortItems = %#v", items)
	}

	pins := []ThreadPin{
		{ItemID: "old", PinnedAt: "2026-01-01T00:00:00Z"},
		{ItemID: "new", PinnedAt: "2026-01-03T00:00:00Z"},
		{ItemID: "mid", PinnedAt: "2026-01-02T00:00:00Z"},
	}
	sortPinsByPinnedAtDesc(pins)
	if pins[0].ItemID != "new" || pins[1].ItemID != "mid" || pins[2].ItemID != "old" {
		t.Fatalf("sortPins = %#v", pins)
	}
}

func TestListClonedArtifacts(t *testing.T) {
	t.Parallel()
	src := &ArtifactContentSource{Kind: ArtifactContentSourceBasename, Path: "a.txt", Readable: false}
	items := map[string]Artifact{
		"a1": {ID: "a1", RunID: "r1", ContentSource: src},
		"a2": {ID: "a2", RunID: "r2"},
	}
	order := []string{"a1", "a2"}
	got := listClonedArtifacts(order, items, "r1")
	if len(got) != 1 || got[0].ID != "a1" {
		t.Fatalf("listClonedArtifacts = %#v", got)
	}
	// Mutating returned content source must not affect map.
	got[0].ContentSource.Path = "mutated"
	if items["a1"].ContentSource.Path != "a.txt" {
		t.Fatal("clone did not isolate ContentSource")
	}
}

func TestScopedListHelpers(t *testing.T) {
	t.Parallel()
	threadOrder := []string{"t1", "t2", "t3"}
	threads := map[string]Thread{
		"t1": {ID: "t1", ProjectID: "p1"},
		"t2": {ID: "t2", ProjectID: "p2"},
		"t3": {ID: "t3", ProjectID: "p1"},
	}
	gotThreads := listThreadsForProject(threadOrder, threads, "p1")
	if len(gotThreads) != 2 || gotThreads[0].ID != "t1" || gotThreads[1].ID != "t3" {
		t.Fatalf("listThreadsForProject = %#v", gotThreads)
	}
	if all := listThreadsForProject(threadOrder, threads, ""); len(all) != 3 {
		t.Fatalf("listThreadsForProject empty scope = %#v", all)
	}

	runOrder := []string{"r1", "r2"}
	runs := map[string]Run{
		"r1": {ID: "r1", ThreadID: "t1"},
		"r2": {ID: "r2", ThreadID: "t2"},
	}
	gotRuns := listRunsForThread(runOrder, runs, "t1")
	if len(gotRuns) != 1 || gotRuns[0].ID != "r1" {
		t.Fatalf("listRunsForThread = %#v", gotRuns)
	}

	diffOrder := []string{"d1", "d2"}
	diffs := map[string]RunDiffFile{
		"d1": {RunID: "r1", Path: "a.go"},
		"d2": {RunID: "r2", Path: "b.go"},
	}
	gotDiffs := listDiffsForRun(diffOrder, diffs, "r1")
	if len(gotDiffs) != 1 || gotDiffs[0].Path != "a.go" {
		t.Fatalf("listDiffsForRun = %#v", gotDiffs)
	}

	previewOrder := []string{"pv1", "pv2"}
	previews := map[string]Preview{
		"pv1": {ID: "pv1", RunID: "r1"},
		"pv2": {ID: "pv2", RunID: "r9"},
	}
	gotPreviews := listPreviewsForRun(previewOrder, previews, "r1")
	if len(gotPreviews) != 1 || gotPreviews[0].ID != "pv1" {
		t.Fatalf("listPreviewsForRun = %#v", gotPreviews)
	}

	profileOrder := []string{"a1", "a2"}
	profiles := map[string]AgentProfile{
		"a1": {ID: "a1", AdapterID: "claude"},
		"a2": {ID: "a2", AdapterID: "codex"},
	}
	gotProfiles := listAgentProfilesForAdapter(profileOrder, profiles, "claude")
	if len(gotProfiles) != 1 || gotProfiles[0].ID != "a1" {
		t.Fatalf("listAgentProfilesForAdapter = %#v", gotProfiles)
	}
}

func TestListSortedThreadItemsAndPins(t *testing.T) {
	t.Parallel()
	itemOrder := []string{"i1", "i2", "i3"}
	items := map[string]Item{
		"i1": {ID: "i1", ThreadID: "t1", CreatedAt: "2026-01-02T00:00:00Z"},
		"i2": {ID: "i2", ThreadID: "t2", CreatedAt: "2026-01-01T00:00:00Z"},
		"i3": {ID: "i3", ThreadID: "t1", CreatedAt: "2026-01-01T00:00:00Z"},
	}
	gotItems := listSortedThreadItems(itemOrder, items, "t1")
	if len(gotItems) != 2 || gotItems[0].ID != "i3" || gotItems[1].ID != "i1" {
		t.Fatalf("listSortedThreadItems = %#v", gotItems)
	}

	pinOrder := []string{"p1", "p2", "p3"}
	pins := map[string]ThreadPin{
		"p1": {ThreadID: "t1", ItemID: "i1", PinnedAt: "2026-01-01T00:00:00Z"},
		"p2": {ThreadID: "t1", ItemID: "i2", PinnedAt: "2026-01-03T00:00:00Z"},
		"p3": {ThreadID: "t2", ItemID: "i9", PinnedAt: "2026-01-04T00:00:00Z"},
	}
	gotPins := listSortedThreadPins(pinOrder, pins, "t1")
	if len(gotPins) != 2 || gotPins[0].ItemID != "i2" || gotPins[1].ItemID != "i1" {
		t.Fatalf("listSortedThreadPins = %#v", gotPins)
	}
}

func TestLookupClonedArtifactAndThreadMessage(t *testing.T) {
	t.Parallel()
	src := &ArtifactContentSource{Kind: ArtifactContentSourceBasename, Path: "a.txt", Readable: true}
	artifacts := map[string]Artifact{"a1": {ID: "a1", ContentSource: src}}
	got, ok := lookupClonedArtifact(artifacts, "a1")
	if !ok || got.ID != "a1" {
		t.Fatalf("lookupClonedArtifact = %#v ok=%v", got, ok)
	}
	got.ContentSource.Path = "mutated"
	if artifacts["a1"].ContentSource.Path != "a.txt" {
		t.Fatal("lookupClonedArtifact did not isolate content source")
	}
	if _, ok := lookupClonedArtifact(artifacts, "missing"); ok {
		t.Fatal("missing artifact should fail")
	}

	item, err := buildThreadMessageFromThread(Thread{}, false, "i1", "user", "hi")
	if err != ErrNotFound || item.ID != "" {
		t.Fatalf("missing thread message = %#v err=%v", item, err)
	}
	item, err = buildThreadMessageFromThread(Thread{ID: "t1", ProjectID: "p1"}, true, "i1", "  ", "hello")
	if err != nil || item.Type != "user_message" || item.Role != "user" || item.ProjectID != "p1" || item.ThreadID != "t1" {
		t.Fatalf("buildThreadMessageFromThread = %#v err=%v", item, err)
	}
}

func TestLookupByID(t *testing.T) {
	t.Parallel()
	items := map[string]int{"a": 1}
	got, ok := lookupByID(items, "a")
	if !ok || got != 1 {
		t.Fatalf("lookupByID hit = %d ok=%v", got, ok)
	}
	if _, ok := lookupByID(items, "missing"); ok {
		t.Fatal("lookupByID miss should fail")
	}
}
