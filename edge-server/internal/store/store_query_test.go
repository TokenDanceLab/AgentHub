package store

import (
	"fmt"
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

func TestFilterOrderedSinglePass(t *testing.T) {
	t.Parallel()
	if got := filterOrdered[Run](nil, nil, func(Run) bool {
		t.Fatal("empty input must not call the predicate")
		return false
	}); got == nil || len(got) != 0 {
		t.Fatalf("empty input = %#v, want non-nil empty result", got)
	}
	for _, matches := range []int{0, 1, 16, 17, 40} {
		t.Run(fmt.Sprintf("matches=%d", matches), func(t *testing.T) {
			items := make(map[string]Run)
			order := make([]string, 0)
			want := make([]Run, 0)
			for i := 0; i < 2*max(matches, 20)+1; i++ {
				id := fmt.Sprintf("run-%03d", 100-i)
				run := Run{ID: id, ThreadID: "other"}
				if i%2 == 1 && i < 2*matches {
					run.ThreadID = "selected"
					want = append(want, run)
				}
				items[id] = run
				order = append(order, id)
			}
			var visited []string
			got := filterOrdered(order, items, func(run Run) bool {
				visited = append(visited, run.ID)
				return run.ThreadID == "selected"
			})
			if !reflect.DeepEqual(visited, order) {
				t.Fatalf("predicate visits = %v, want one ordered visit per row: %v", visited, order)
			}
			if !reflect.DeepEqual(got, want) {
				t.Fatalf("filterOrdered = %#v, want %#v", got, want)
			}
		})
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
	items := make(map[string]Artifact)
	order := make([]string, 0)
	idsByRun := make(map[string][]string)
	for i := 0; i < 40; i++ {
		id, runID := fmt.Sprintf("artifact-%02d", 40-i), "dense"
		if i%4 == 1 {
			runID = "small"
		}
		artifact := Artifact{ID: id, RunID: runID}
		if i%3 != 0 {
			artifact.ContentSource = &ArtifactContentSource{
				Kind: ArtifactContentSourceBasename, Path: id + ".txt", Readable: true,
			}
		}
		items[id] = artifact
		order = append(order, id)
		idsByRun[runID] = append(idsByRun[runID], id)
	}
	for _, scope := range []struct {
		name, runID string
		want        []string
	}{
		{"missing", "missing", []string{}},
		{"small", "small", idsByRun["small"]},
		{"dense", "dense", idsByRun["dense"]},
		{"all", "", order},
	} {
		t.Run(scope.name, func(t *testing.T) {
			got := listClonedArtifacts(order, items, scope.runID)
			if got == nil || len(got) != len(scope.want) {
				t.Fatalf("listClonedArtifacts = %#v, want non-nil with %d results", got, len(scope.want))
			}
			for i, id := range scope.want {
				if got[i].ID != id {
					t.Fatalf("result[%d].ID = %q, want %q", i, got[i].ID, id)
				}
				source := items[id].ContentSource
				if !reflect.DeepEqual(got[i].ContentSource, source) {
					t.Fatalf("result[%d] content source = %#v, want %#v", i, got[i].ContentSource, source)
				}
				if source != nil {
					got[i].ContentSource.Path = "mutated"
					got[i].ContentSource.Readable = false
					if source.Path != id+".txt" || !source.Readable {
						t.Fatalf("result[%d] content source aliases the store", i)
					}
				}
			}
		})
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
