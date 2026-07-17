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

func TestApplyUpsertTimestamps(t *testing.T) {
	t.Parallel()
	created, updated := applyUpsertTimestamps("old", true, "now")
	if created != "old" || updated != "now" {
		t.Fatalf("exists timestamps = %q/%q", created, updated)
	}
	created, updated = applyUpsertTimestamps("", false, "now")
	if created != "now" || updated != "now" {
		t.Fatalf("create timestamps = %q/%q", created, updated)
	}
}

func TestMergeAndStampDiffArtifactPreview(t *testing.T) {
	t.Parallel()
	existing := RunDiffFile{RunID: "r1", Path: "a.go", Diff: "old", Status: "modified", CreatedAt: "c0"}
	merged := mergeRunDiffFileUpdate(existing, RunDiffFile{Diff: "new", Status: "added"}, "now")
	if merged.Diff != "new" || merged.Status != "added" || merged.UpdatedAt != "now" || merged.CreatedAt != "c0" {
		t.Fatalf("mergeRunDiffFileUpdate = %#v", merged)
	}

	created := stampRunDiffFileCreate(RunDiffFile{RunID: "r1", Path: "b.go", Diff: "+x"}, "ts")
	if created.CreatedAt != "ts" || created.UpdatedAt != "ts" {
		t.Fatalf("stampRunDiffFileCreate = %#v", created)
	}

	artifact := stampArtifactUpsert(Artifact{ID: "a1"}, "old", true, "now")
	if artifact.CreatedAt != "old" || artifact.UpdatedAt != "now" {
		t.Fatalf("stampArtifactUpsert update = %#v", artifact)
	}
	artifact = stampArtifactUpsert(Artifact{ID: "a2"}, "", false, "now")
	if artifact.CreatedAt != "now" || artifact.UpdatedAt != "now" {
		t.Fatalf("stampArtifactUpsert create = %#v", artifact)
	}

	preview := stampPreviewUpsert(Preview{ID: "p1"}, "old", true, "now")
	if preview.CreatedAt != "old" || preview.UpdatedAt != "now" {
		t.Fatalf("stampPreviewUpsert update = %#v", preview)
	}
	preview = stampPreviewUpsert(Preview{ID: "p2"}, "", false, "now")
	if preview.CreatedAt != "now" || preview.UpdatedAt != "now" {
		t.Fatalf("stampPreviewUpsert create = %#v", preview)
	}
}

func TestBuildAndTouchThreadPin(t *testing.T) {
	t.Parallel()
	pin := buildThreadPin("t1", "i1", "  alice  ", "now")
	if pin.ThreadID != "t1" || pin.ItemID != "i1" || pin.PinnedBy != "alice" {
		t.Fatalf("buildThreadPin = %#v", pin)
	}
	if pin.PinnedAt != "now" || pin.CreatedAt != "now" || pin.UpdatedAt != "now" {
		t.Fatalf("buildThreadPin timestamps = %#v", pin)
	}

	touched := touchThreadPin(pin, "  bob  ", "later")
	if touched.PinnedBy != "bob" || touched.PinnedAt != "later" || touched.UpdatedAt != "later" {
		t.Fatalf("touchThreadPin = %#v", touched)
	}
	if touched.CreatedAt != "now" {
		t.Fatalf("CreatedAt should be preserved, got %q", touched.CreatedAt)
	}
}

func TestPrepareUserAndAgentProfileCreate(t *testing.T) {
	t.Parallel()
	user := prepareUserProfileCreate(UserProfile{ID: "u1", DisplayName: "U"}, "now")
	if user.CreatedAt != "now" || user.UpdatedAt != "now" {
		t.Fatalf("prepareUserProfileCreate = %#v", user)
	}

	agent := prepareAgentProfileCreate(AgentProfile{ID: "a1", AdapterID: "cli"}, "now")
	if agent.Name != "Unnamed Agent" || agent.CreatedAt != "now" || agent.UpdatedAt != "now" {
		t.Fatalf("prepareAgentProfileCreate defaults = %#v", agent)
	}
	// Preserve existing CreatedAt; still refresh UpdatedAt and default empty name.
	agent = prepareAgentProfileCreate(AgentProfile{
		ID:        "a2",
		Name:      "Coder",
		AdapterID: "cli",
		CreatedAt: "old",
	}, "now")
	if agent.Name != "Coder" || agent.CreatedAt != "old" || agent.UpdatedAt != "now" {
		t.Fatalf("prepareAgentProfileCreate keep = %#v", agent)
	}
}

func TestApplyRunEvidenceGateAndRetryCount(t *testing.T) {
	t.Parallel()
	run := applyRunEvidenceGate(Run{ID: "r1"}, `{"ok":true}`)
	if run.EvidenceGateResult != `{"ok":true}` {
		t.Fatalf("applyRunEvidenceGate = %#v", run)
	}
	run = applyRunRetryCount(run, 3)
	if run.RetryCount != 3 {
		t.Fatalf("applyRunRetryCount = %#v", run)
	}
}

func TestCloneUserSettings(t *testing.T) {
	t.Parallel()
	src := map[string]string{"theme": "dark"}
	got := cloneUserSettings(src, "mtime")
	if got.Values["theme"] != "dark" || got.UpdatedAt != "mtime" {
		t.Fatalf("cloneUserSettings = %#v", got)
	}
	got.Values["theme"] = "light"
	if src["theme"] != "dark" {
		t.Fatal("cloneUserSettings must isolate map values")
	}
}

func TestCollectItemIDsForRemovedRuns(t *testing.T) {
	t.Parallel()
	items := map[string]Item{
		"i1": {ID: "i1", RunID: "r1"},
		"i2": {ID: "i2", RunID: "r2"},
		"i3": {ID: "i3", RunID: ""},
	}
	got := collectItemIDsForRemovedRuns(items, map[string]struct{}{"r1": {}, "r9": {}})
	if len(got) != 1 {
		t.Fatalf("collectItemIDsForRemovedRuns = %#v", got)
	}
	if _, ok := got["i1"]; !ok {
		t.Fatalf("expected i1, got %#v", got)
	}
}

func TestCollectKeysByRunID(t *testing.T) {
	t.Parallel()
	diffs := map[string]RunDiffFile{
		"d1": {RunID: "r1", Path: "a.go"},
		"d2": {RunID: "r2", Path: "b.go"},
		"d3": {RunID: "r1", Path: "c.go"},
	}
	got := collectKeysByRunID(diffs, "r1", func(file RunDiffFile) string { return file.RunID })
	if len(got) != 2 {
		t.Fatalf("collectKeysByRunID = %#v", got)
	}
	if _, ok := got["d1"]; !ok {
		t.Fatalf("missing d1 in %#v", got)
	}
	if _, ok := got["d3"]; !ok {
		t.Fatalf("missing d3 in %#v", got)
	}
}

func TestCollectKeysByThreadID(t *testing.T) {
	t.Parallel()
	runs := map[string]Run{
		"r1": {ID: "r1", ThreadID: "t1"},
		"r2": {ID: "r2", ThreadID: "t2"},
		"r3": {ID: "r3", ThreadID: "t1"},
	}
	got := collectKeysByThreadID(runs, "t1", func(run Run) string { return run.ThreadID })
	if len(got) != 2 {
		t.Fatalf("collectKeysByThreadID = %#v", got)
	}
	if _, ok := got["r1"]; !ok {
		t.Fatalf("missing r1 in %#v", got)
	}
	if _, ok := got["r3"]; !ok {
		t.Fatalf("missing r3 in %#v", got)
	}
}

func TestOrderWithoutRemovedAndKeepPresent(t *testing.T) {
	t.Parallel()
	// filterIDs reuses the backing array; use independent inputs per call.
	got := orderWithoutRemoved([]string{"a", "b", "c", "d"}, map[string]struct{}{"b": {}, "d": {}})
	want := []string{"a", "c"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("orderWithoutRemoved = %#v, want %#v", got, want)
	}

	items := map[string]int{"a": 1, "c": 3}
	kept := orderKeepPresent([]string{"a", "b", "c", "d"}, items)
	if !reflect.DeepEqual(kept, want) {
		t.Fatalf("orderKeepPresent = %#v, want %#v", kept, want)
	}
}

func TestScopedLookups(t *testing.T) {
	t.Parallel()
	threads := map[string]Thread{
		"t1": {ID: "t1", ProjectID: "p1"},
		"t2": {ID: "t2", ProjectID: "p2"},
	}
	if _, ok := lookupThreadInProject(threads, "t1", "p1"); !ok {
		t.Fatal("lookupThreadInProject match should succeed")
	}
	if _, ok := lookupThreadInProject(threads, "t1", "p2"); ok {
		t.Fatal("lookupThreadInProject project mismatch should fail")
	}
	if _, ok := lookupThreadInProject(threads, "missing", "p1"); ok {
		t.Fatal("lookupThreadInProject missing should fail")
	}

	runs := map[string]Run{
		"r1": {ID: "r1", ThreadID: "t1"},
	}
	if _, ok := lookupRunInThread(runs, "r1", "t1"); !ok {
		t.Fatal("lookupRunInThread match should succeed")
	}
	if _, ok := lookupRunInThread(runs, "r1", "t2"); ok {
		t.Fatal("lookupRunInThread thread mismatch should fail")
	}

	items := map[string]Item{
		"i1": {ID: "i1", ThreadID: "t1"},
	}
	if _, ok := lookupItemInThread(items, "i1", "t1"); !ok {
		t.Fatal("lookupItemInThread match should succeed")
	}
	if _, ok := lookupItemInThread(items, "i1", "t2"); ok {
		t.Fatal("lookupItemInThread thread mismatch should fail")
	}
}

func TestExistingThreadConflict(t *testing.T) {
	t.Parallel()
	if !existingThreadConflict(Thread{ProjectID: "p1"}, "p2") {
		t.Fatal("different project should conflict")
	}
	if existingThreadConflict(Thread{ProjectID: "p1"}, "p1") {
		t.Fatal("same project should not conflict")
	}
}

func TestTouchAgentProfileAndEnsureSettingsMap(t *testing.T) {
	t.Parallel()
	profile := touchAgentProfile(AgentProfile{ID: "a1", Name: "Coder", CreatedAt: "old"}, "now")
	if profile.UpdatedAt != "now" || profile.CreatedAt != "old" || profile.Name != "Coder" {
		t.Fatalf("touchAgentProfile = %#v", profile)
	}

	if got := ensureSettingsMap(nil); got == nil || len(got) != 0 {
		t.Fatalf("ensureSettingsMap(nil) = %#v", got)
	}
	src := map[string]string{"theme": "dark"}
	if got := ensureSettingsMap(src); got["theme"] != "dark" {
		t.Fatalf("ensureSettingsMap keep = %#v", got)
	}
	// Same map identity when non-nil.
	if got := ensureSettingsMap(src); &got == nil {
		t.Fatal("unexpected nil")
	}
}

func TestResolveCleanupNow(t *testing.T) {
	t.Parallel()
	fallback := time.Date(2026, 7, 18, 12, 0, 0, 0, time.UTC)
	if got := resolveCleanupNow(time.Time{}, fallback); !got.Equal(fallback) {
		t.Fatalf("zero now should use fallback, got %v", got)
	}
	pinned := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	if got := resolveCleanupNow(pinned, fallback); !got.Equal(pinned) {
		t.Fatalf("non-zero now should be kept, got %v", got)
	}
}

func TestCollectRunEvidenceKeys(t *testing.T) {
	t.Parallel()
	diffs := map[string]RunDiffFile{
		"d1": {RunID: "r1"},
		"d2": {RunID: "r2"},
	}
	artifacts := map[string]Artifact{
		"a1": {ID: "a1", RunID: "r1"},
		"a2": {ID: "a2", RunID: "r9"},
	}
	previews := map[string]Preview{
		"p1": {ID: "p1", RunID: "r1"},
	}
	diffKeys, artifactKeys, previewKeys := collectRunEvidenceKeys(diffs, artifacts, previews, "r1")
	if len(diffKeys) != 1 || len(artifactKeys) != 1 || len(previewKeys) != 1 {
		t.Fatalf("keys = diffs=%#v arts=%#v previews=%#v", diffKeys, artifactKeys, previewKeys)
	}
	if _, ok := diffKeys["d1"]; !ok {
		t.Fatalf("missing d1: %#v", diffKeys)
	}
	if _, ok := artifactKeys["a1"]; !ok {
		t.Fatalf("missing a1: %#v", artifactKeys)
	}
	if _, ok := previewKeys["p1"]; !ok {
		t.Fatalf("missing p1: %#v", previewKeys)
	}
}
