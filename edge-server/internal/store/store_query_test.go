package store

import (
	"reflect"
	"testing"
	"time"
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

func TestBuildProjectAndThreadAndRun(t *testing.T) {
	t.Parallel()
	now := "2026-07-18T00:00:00Z"

	project := buildProject("p1", "", "  owner  ", now)
	if project.Name != "Local Project" || project.OwnerID != "owner" || project.Status != "active" {
		t.Fatalf("buildProject = %#v", project)
	}
	if project.CreatedAt != now || project.UpdatedAt != now {
		t.Fatalf("buildProject timestamps = %#v", project)
	}

	thread := buildThread("t1", "p1", "", "chat", "blue", "A", now)
	if thread.Title != "New Thread" || thread.Status != "active" || thread.Kind != "chat" {
		t.Fatalf("buildThread = %#v", thread)
	}

	run := buildQueuedRun("r1", "p1", "t1", now)
	if run.Status != "queued" || run.CreatedAt != now || run.ThreadID != "t1" {
		t.Fatalf("buildQueuedRun = %#v", run)
	}
}

func TestBuildUserMessageAndPrepareItemDefaults(t *testing.T) {
	t.Parallel()
	item := buildUserMessageItem("i1", "p1", "t1", "  ", "hello")
	if item.Type != "user_message" || item.Role != "user" || item.Status != "created" || item.Content != "hello" {
		t.Fatalf("buildUserMessageItem = %#v", item)
	}
	item = buildUserMessageItem("i2", "p1", "t1", "assistant", "hi")
	if item.Role != "assistant" {
		t.Fatalf("role preserved = %q", item.Role)
	}

	prepared := prepareItemDefaults(Item{ID: "x"}, "2026-01-01T00:00:00Z")
	if prepared.Type != "event" || prepared.Status != "created" {
		t.Fatalf("prepareItemDefaults defaults = %#v", prepared)
	}
	if prepared.CreatedAt != "2026-01-01T00:00:00Z" || prepared.UpdatedAt != prepared.CreatedAt {
		t.Fatalf("prepareItemDefaults timestamps = %#v", prepared)
	}
	prepared = prepareItemDefaults(Item{ID: "y", Type: "tool", Status: "done"}, "t")
	if prepared.Type != "tool" || prepared.Status != "done" {
		t.Fatalf("prepareItemDefaults keep = %#v", prepared)
	}
}

func TestApplyThreadUpdateAndRunStatus(t *testing.T) {
	t.Parallel()
	title := "renamed"
	status := "archived"
	thread := applyThreadUpdate(Thread{ID: "t1", Title: "old", Status: "active"}, &title, &status, "now")
	if thread.Title != "renamed" || thread.Status != "archived" || thread.UpdatedAt != "now" {
		t.Fatalf("applyThreadUpdate = %#v", thread)
	}
	// nil pointers leave fields unchanged.
	thread = applyThreadUpdate(Thread{ID: "t1", Title: "keep", Status: "active"}, nil, nil, "later")
	if thread.Title != "keep" || thread.Status != "active" || thread.UpdatedAt != "later" {
		t.Fatalf("applyThreadUpdate nils = %#v", thread)
	}

	tests := []struct {
		status       string
		wantStarted  bool
		wantFinished bool
	}{
		{"started", true, false},
		{"finished", false, true},
		{"failed", false, true},
		{"cancelled", false, true},
		{"completed_with_issues", false, true},
		{"queued", false, false},
	}
	for _, tt := range tests {
		run := applyRunStatus(Run{ID: "r1", Status: "queued"}, tt.status, "ts")
		if run.Status != tt.status {
			t.Fatalf("status %q -> %#v", tt.status, run)
		}
		if tt.wantStarted && run.StartedAt != "ts" {
			t.Fatalf("status %q missing StartedAt", tt.status)
		}
		if !tt.wantStarted && run.StartedAt != "" {
			t.Fatalf("status %q unexpected StartedAt", tt.status)
		}
		if tt.wantFinished && run.FinishedAt != "ts" {
			t.Fatalf("status %q missing FinishedAt", tt.status)
		}
		if !tt.wantFinished && run.FinishedAt != "" {
			t.Fatalf("status %q unexpected FinishedAt", tt.status)
		}
	}
}

func TestIsAllowedCurrentStatus(t *testing.T) {
	t.Parallel()
	if !isAllowedCurrentStatus("queued", nil) {
		t.Fatal("empty allow-list should accept")
	}
	if !isAllowedCurrentStatus("queued", []string{}) {
		t.Fatal("empty slice should accept")
	}
	if !isAllowedCurrentStatus("queued", []string{"started", "queued"}) {
		t.Fatal("matching status rejected")
	}
	if isAllowedCurrentStatus("queued", []string{"started"}) {
		t.Fatal("non-matching status accepted")
	}
}

func TestNormalizeRunDiffFileInput(t *testing.T) {
	t.Parallel()
	file := normalizeRunDiffFileInput(RunDiffFile{
		RunID:  "r1",
		Path:   "  src/a.go  ",
		Status: "ADD",
		Diff:   "+x",
	})
	if file.Path != "src/a.go" || file.Status != "added" || file.Diff != "+x" {
		t.Fatalf("normalizeRunDiffFileInput = %#v", file)
	}
}

func TestBindScopedThreadID(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name                string
		threadID, runThread string
		wantID              string
		wantOK              bool
	}{
		{"empty fills", "", "th1", "th1", true},
		{"match", "th1", "th1", "th1", true},
		{"mismatch", "th2", "th1", "", false},
	}
	for _, tt := range tests {
		got, ok := bindScopedThreadID(tt.threadID, tt.runThread)
		if ok != tt.wantOK || got != tt.wantID {
			t.Fatalf("%s: got (%q, %v), want (%q, %v)", tt.name, got, ok, tt.wantID, tt.wantOK)
		}
	}
}

func TestPrepareArtifactAndPreviewInput(t *testing.T) {
	t.Parallel()
	artifact, ok := prepareArtifactInput(Artifact{
		ID:    "  art1  ",
		RunID: "r1",
		Path:  "docs/out.md",
		Kind:  "",
	}, "th1")
	if !ok {
		t.Fatal("prepareArtifactInput rejected valid input")
	}
	if artifact.ID != "art1" || artifact.ThreadID != "th1" || artifact.Kind != "file" {
		t.Fatalf("prepareArtifactInput = %#v", artifact)
	}
	if artifact.Path != "docs/out.md" {
		t.Fatalf("path = %q", artifact.Path)
	}

	if _, ok := prepareArtifactInput(Artifact{ID: "  ", RunID: "r1"}, "th1"); ok {
		t.Fatal("empty id should fail")
	}
	if _, ok := prepareArtifactInput(Artifact{ID: "a1", ThreadID: "other", RunID: "r1"}, "th1"); ok {
		t.Fatal("thread mismatch should fail")
	}

	preview, ok := preparePreviewInput(Preview{ID: "  p1  ", RunID: "r1"}, "th1")
	if !ok || preview.ID != "p1" || preview.ThreadID != "th1" || preview.Status != "ready" {
		t.Fatalf("preparePreviewInput = %#v ok=%v", preview, ok)
	}
	if _, ok := preparePreviewInput(Preview{ID: "", RunID: "r1"}, "th1"); ok {
		t.Fatal("empty preview id should fail")
	}
}

func TestApplySettingsPatch(t *testing.T) {
	t.Parallel()
	settings := map[string]string{"keep": "1"}
	applySettingsPatch(settings, map[string]string{
		"  theme  ": "dark",
		"":          "ignored",
		"   ":       "ignored",
		"lang":      "zh",
	})
	if settings["theme"] != "dark" || settings["lang"] != "zh" || settings["keep"] != "1" {
		t.Fatalf("settings = %#v", settings)
	}
	if _, ok := settings[""]; ok {
		t.Fatal("empty key should not be stored")
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

func TestCleanupCandidateLessAndSelect(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 7, 18, 12, 0, 0, 0, time.UTC)
	older := now.Add(-2 * time.Hour)
	newer := now.Add(-10 * time.Minute)

	left := runCleanupCandidate{id: "old", threadID: "t1", terminalAt: older, hasTime: true, order: 0}
	right := runCleanupCandidate{id: "new", threadID: "t1", terminalAt: newer, hasTime: true, order: 1}
	// Less means "keep first" (newer first).
	if !cleanupCandidateLess(right, left) {
		t.Fatal("newer should sort before older")
	}
	if cleanupCandidateLess(left, right) {
		t.Fatal("older should not sort before newer")
	}

	// hasTime preferred over no time.
	withTime := runCleanupCandidate{id: "timed", hasTime: true, terminalAt: older, order: 0}
	noTime := runCleanupCandidate{id: "notime", hasTime: false, order: 5}
	if !cleanupCandidateLess(withTime, noTime) {
		t.Fatal("hasTime should rank higher")
	}
	// Same time presence → higher order wins.
	a := runCleanupCandidate{id: "a", hasTime: false, order: 1}
	b := runCleanupCandidate{id: "b", hasTime: false, order: 3}
	if !cleanupCandidateLess(b, a) {
		t.Fatal("higher order should rank higher")
	}

	candidates := []runCleanupCandidate{
		{id: "keep-new", threadID: "t1", terminalAt: newer, hasTime: true, order: 2},
		{id: "ttl-old", threadID: "t1", terminalAt: older, hasTime: true, order: 0},
		{id: "overage", threadID: "t1", terminalAt: now.Add(-30 * time.Minute), hasTime: true, order: 1},
		{id: "other", threadID: "t2", terminalAt: newer, hasTime: true, order: 3},
	}
	// TTL 1h expires ttl-old; max 1 per thread then removes overage after keeping newest.
	remove := selectRunsForCleanup(candidates, now, time.Hour, 1)
	if _, ok := remove["ttl-old"]; !ok {
		t.Fatalf("expected ttl-old removed, got %#v", remove)
	}
	if _, ok := remove["keep-new"]; ok {
		t.Fatalf("keep-new should remain, got %#v", remove)
	}
	if _, ok := remove["overage"]; !ok {
		t.Fatalf("expected overage removed, got %#v", remove)
	}
	if _, ok := remove["other"]; ok {
		t.Fatalf("other thread single run should remain, got %#v", remove)
	}
}

func TestBuildTerminalCleanupCandidates(t *testing.T) {
	t.Parallel()
	order := []string{"r1", "r2", "r3"}
	runs := map[string]Run{
		"r1": {ID: "r1", ThreadID: "t1", Status: "queued"},
		"r2": {ID: "r2", ThreadID: "t1", Status: "finished", FinishedAt: "2026-07-18T10:00:00Z"},
		"r3": {ID: "r3", ThreadID: "t2", Status: "failed", CreatedAt: "2026-07-18T09:00:00Z"},
	}
	got := buildTerminalCleanupCandidates(order, runs)
	if len(got) != 2 {
		t.Fatalf("candidates = %#v", got)
	}
	if got[0].id != "r2" || !got[0].hasTime || got[1].id != "r3" {
		t.Fatalf("candidates = %#v", got)
	}
}

func TestDefaultAgentProfileName(t *testing.T) {
	t.Parallel()
	if got := defaultAgentProfileName(""); got != "Unnamed Agent" {
		t.Fatalf("empty = %q", got)
	}
	if got := defaultAgentProfileName("Coder"); got != "Coder" {
		t.Fatalf("kept = %q", got)
	}
}
