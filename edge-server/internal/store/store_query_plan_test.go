package store

import (
	"reflect"
	"testing"
	"time"
)

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

func TestNewEmptyStore(t *testing.T) {
	t.Parallel()
	s := newEmptyStore()
	if s == nil || s.projects == nil || s.threads == nil || s.runs == nil || s.items == nil {
		t.Fatalf("newEmptyStore core maps nil: %#v", s)
	}
	if s.pins == nil || s.diffs == nil || s.artifacts == nil || s.previews == nil {
		t.Fatalf("newEmptyStore evidence maps nil: %#v", s)
	}
	if s.userProfiles == nil || s.agentProfiles == nil || s.settings == nil {
		t.Fatalf("newEmptyStore profile/settings nil: %#v", s)
	}
	if len(s.projectOrder) != 0 || len(s.threadOrder) != 0 {
		t.Fatalf("newEmptyStore orders should be empty")
	}
}

func TestCreateEntitiesInMaps(t *testing.T) {
	t.Parallel()
	now := "2026-07-18T00:00:00Z"

	projects := map[string]Project{}
	projectOrder := []string{}
	project, projectOrder, err := createProjectInMaps(projects, projectOrder, "p1", "Demo", "owner", now)
	if err != nil || project.ID != "p1" || project.Name != "Demo" || !reflect.DeepEqual(projectOrder, []string{"p1"}) {
		t.Fatalf("create project = %#v order=%#v err=%v", project, projectOrder, err)
	}
	// collision
	_, projectOrder, err = createProjectInMaps(projects, projectOrder, "p1", "Other", "owner", now)
	if err != ErrProjectExists || !reflect.DeepEqual(projectOrder, []string{"p1"}) {
		t.Fatalf("project collision = order=%#v err=%v", projectOrder, err)
	}

	threads := map[string]Thread{}
	threadOrder := []string{}
	thread, threadOrder, err := createThreadInMaps(projects, threads, threadOrder, "t1", "p1", "", "chat", "blue", "A", now)
	if err != nil || thread.Title != "New Thread" || !reflect.DeepEqual(threadOrder, []string{"t1"}) {
		t.Fatalf("create thread = %#v order=%#v err=%v", thread, threadOrder, err)
	}
	// reuse same project
	thread, threadOrder, err = createThreadInMaps(projects, threads, threadOrder, "t1", "p1", "ignored", "chat", "blue", "A", now)
	if err != nil || thread.Title != "New Thread" || !reflect.DeepEqual(threadOrder, []string{"t1"}) {
		t.Fatalf("reuse thread = %#v order=%#v err=%v", thread, threadOrder, err)
	}
	// missing project
	if _, _, err := createThreadInMaps(map[string]Project{}, threads, threadOrder, "t2", "missing", "x", "", "", "", now); err != ErrNotFound {
		t.Fatalf("missing project create thread err=%v", err)
	}

	runs := map[string]Run{}
	runOrder := []string{}
	run, runOrder, err := createRunInMaps(projects, threads, runs, runOrder, "r1", "p1", "t1", now)
	if err != nil || run.Status != "queued" || !reflect.DeepEqual(runOrder, []string{"r1"}) {
		t.Fatalf("create run = %#v order=%#v err=%v", run, runOrder, err)
	}
	// reuse
	run, runOrder, err = createRunInMaps(projects, threads, runs, runOrder, "r1", "p1", "t1", now)
	if err != nil || run.ID != "r1" || !reflect.DeepEqual(runOrder, []string{"r1"}) {
		t.Fatalf("reuse run = %#v order=%#v err=%v", run, runOrder, err)
	}
	// bad refs
	if _, _, err := createRunInMaps(projects, threads, runs, runOrder, "r2", "p1", "missing", now); err != ErrNotFound {
		t.Fatalf("bad run refs err=%v", err)
	}

	items := map[string]Item{}
	itemOrder := []string{}
	item, itemOrder, err := createItemInMaps(projects, threads, runs, items, itemOrder, Item{
		ID: "i1", ProjectID: "p1", ThreadID: "t1", RunID: "r1", Content: "hi",
	}, now)
	if err != nil || item.Type != "event" || item.Status != "created" || !reflect.DeepEqual(itemOrder, []string{"i1"}) {
		t.Fatalf("create item = %#v order=%#v err=%v", item, itemOrder, err)
	}
	// reuse
	item, itemOrder, err = createItemInMaps(projects, threads, runs, items, itemOrder, Item{
		ID: "i1", ProjectID: "p1", ThreadID: "t1",
	}, now)
	if err != nil || item.Content != "hi" || !reflect.DeepEqual(itemOrder, []string{"i1"}) {
		t.Fatalf("reuse item = %#v order=%#v err=%v", item, itemOrder, err)
	}
	if _, _, err := createItemInMaps(projects, threads, runs, items, itemOrder, Item{
		ID: "i2", ProjectID: "missing", ThreadID: "t1",
	}, now); err != ErrNotFound {
		t.Fatalf("bad item refs err=%v", err)
	}

	profiles := map[string]UserProfile{}
	profileOrder := []string{}
	profile, profileOrder := createUserProfileInMaps(profiles, profileOrder, UserProfile{ID: "u1", DisplayName: "Alice"}, now)
	if profile.ID != "u1" || !reflect.DeepEqual(profileOrder, []string{"u1"}) {
		t.Fatalf("create user profile = %#v order=%#v", profile, profileOrder)
	}
	profile, profileOrder = createUserProfileInMaps(profiles, profileOrder, UserProfile{ID: "u1", DisplayName: "Bob"}, now)
	if profile.DisplayName != "Alice" || !reflect.DeepEqual(profileOrder, []string{"u1"}) {
		t.Fatalf("reuse user profile = %#v order=%#v", profile, profileOrder)
	}

	agents := map[string]AgentProfile{}
	agentOrder := []string{}
	agent, agentOrder, err := createAgentProfileInMaps(agents, agentOrder, AgentProfile{ID: "ag1", Name: "Coder", AdapterID: "claude"}, now)
	if err != nil || agent.Name != "Coder" || !reflect.DeepEqual(agentOrder, []string{"ag1"}) {
		t.Fatalf("create agent = %#v order=%#v err=%v", agent, agentOrder, err)
	}
	if _, agentOrder, err = createAgentProfileInMaps(agents, agentOrder, AgentProfile{ID: "ag1", Name: "X", AdapterID: "claude"}, now); err == nil || !reflect.DeepEqual(agentOrder, []string{"ag1"}) {
		t.Fatalf("agent collision err=%v order=%#v", err, agentOrder)
	}
}

func TestUpdateAndSetInMaps(t *testing.T) {
	t.Parallel()
	now := "2026-07-18T00:00:00Z"
	title := "renamed"

	threads := map[string]Thread{"t1": {ID: "t1", Title: "old", Status: "active"}}
	thread, ok := updateThreadInMaps(threads, "missing", &title, nil, now)
	if ok || thread.ID != "" {
		t.Fatalf("missing update thread = %#v ok=%v", thread, ok)
	}
	thread, ok = updateThreadInMaps(threads, "t1", &title, nil, now)
	if !ok || thread.Title != "renamed" || threads["t1"].Title != "renamed" || thread.UpdatedAt != now {
		t.Fatalf("update thread = %#v ok=%v map=%#v", thread, ok, threads["t1"])
	}

	runs := map[string]Run{"r1": {ID: "r1", Status: "queued"}}
	run, ok := setRunStatusInMaps(runs, "missing", "started", now)
	if ok {
		t.Fatal("missing set status accepted")
	}
	run, ok = setRunStatusInMaps(runs, "r1", "started", now)
	if !ok || run.Status != "started" || runs["r1"].StartedAt != now {
		t.Fatalf("set status = %#v ok=%v", run, ok)
	}

	runs["r1"] = Run{ID: "r1", Status: "queued"}
	run, ok = setRunStatusIfInMaps(runs, "r1", "started", []string{"started"}, now)
	if ok || runs["r1"].Status != "queued" {
		t.Fatalf("disallowed status-if = %#v ok=%v", run, ok)
	}
	run, ok = setRunStatusIfInMaps(runs, "r1", "started", []string{"queued"}, now)
	if !ok || run.Status != "started" {
		t.Fatalf("allowed status-if = %#v ok=%v", run, ok)
	}

	run, ok = setRunEvidenceGateInMaps(runs, "r1", `{"ok":true}`)
	if !ok || run.EvidenceGateResult != `{"ok":true}` || runs["r1"].EvidenceGateResult != `{"ok":true}` {
		t.Fatalf("evidence gate = %#v ok=%v", run, ok)
	}
	if _, ok := setRunEvidenceGateInMaps(runs, "missing", "x"); ok {
		t.Fatal("missing evidence gate accepted")
	}

	run, ok = setRunRetryCountInMaps(runs, "r1", 4)
	if !ok || run.RetryCount != 4 || runs["r1"].RetryCount != 4 {
		t.Fatalf("retry count = %#v ok=%v", run, ok)
	}

	agents := map[string]AgentProfile{"ag1": {ID: "ag1", Name: "old", AdapterID: "claude"}}
	agent, err := updateAgentProfileInMaps(agents, "missing", map[string]any{"name": "x"}, now)
	if err != ErrNotFound || agent.ID != "" {
		t.Fatalf("missing agent update = %#v err=%v", agent, err)
	}
	agent, err = updateAgentProfileInMaps(agents, "ag1", map[string]any{"name": "new"}, now)
	if err != nil || agent.Name != "new" || agents["ag1"].Name != "new" || agent.UpdatedAt != now {
		t.Fatalf("agent update = %#v err=%v map=%#v", agent, err, agents["ag1"])
	}
}

func TestUpsertEntitiesInMaps(t *testing.T) {
	t.Parallel()
	now := "2026-07-18T00:00:00Z"
	runs := map[string]Run{"r1": {ID: "r1", ThreadID: "t1"}}

	diffs := map[string]RunDiffFile{}
	diffOrder := []string{}
	file, diffOrder, err := upsertRunDiffFileInMaps(runs, diffs, diffOrder, RunDiffFile{
		RunID: "r1", Path: "  src/a.go  ", Status: "ADD", Diff: "+x",
	}, now)
	if err != nil || file.Path != "src/a.go" || file.Status != "added" || !reflect.DeepEqual(diffOrder, []string{runDiffFileKey("r1", "src/a.go")}) {
		t.Fatalf("upsert diff create = %#v order=%#v err=%v", file, diffOrder, err)
	}
	file, diffOrder, err = upsertRunDiffFileInMaps(runs, diffs, diffOrder, RunDiffFile{
		RunID: "r1", Path: "src/a.go", Status: "modified", Diff: "+y",
	}, now)
	if err != nil || file.Diff != "+y" || !reflect.DeepEqual(diffOrder, []string{runDiffFileKey("r1", "src/a.go")}) {
		t.Fatalf("upsert diff update = %#v order=%#v err=%v", file, diffOrder, err)
	}
	if _, _, err := upsertRunDiffFileInMaps(map[string]Run{}, diffs, diffOrder, RunDiffFile{RunID: "missing", Path: "a.go"}, now); err != ErrNotFound {
		t.Fatalf("missing run diff err=%v", err)
	}

	artifacts := map[string]Artifact{}
	artifactOrder := []string{}
	artifact, artifactOrder, err := upsertArtifactInMaps(runs, artifacts, artifactOrder, Artifact{
		ID: "  a1  ", RunID: "r1", Path: "out.md",
	}, now)
	if err != nil || artifact.ID != "a1" || artifact.ThreadID != "t1" || artifact.Kind != "file" || !reflect.DeepEqual(artifactOrder, []string{"a1"}) {
		t.Fatalf("upsert artifact create = %#v order=%#v err=%v", artifact, artifactOrder, err)
	}
	// mutate returned clone must not affect map
	if artifact.ContentSource != nil {
		artifact.ContentSource.Path = "mut"
	}
	if artifacts["a1"].ContentSource != nil && artifacts["a1"].ContentSource.Path == "mut" {
		t.Fatal("artifact map should store isolated clone")
	}
	if _, _, err := upsertArtifactInMaps(map[string]Run{}, artifacts, artifactOrder, Artifact{ID: "a2", RunID: "missing"}, now); err != ErrNotFound {
		t.Fatalf("missing run artifact err=%v", err)
	}

	previews := map[string]Preview{}
	previewOrder := []string{}
	preview, previewOrder, err := upsertPreviewInMaps(runs, previews, previewOrder, Preview{
		ID: "  p1  ", RunID: "r1", URL: "http://localhost",
	}, now)
	if err != nil || preview.ID != "p1" || preview.ThreadID != "t1" || preview.Status != "ready" || !reflect.DeepEqual(previewOrder, []string{"p1"}) {
		t.Fatalf("upsert preview create = %#v order=%#v err=%v", preview, previewOrder, err)
	}
	if _, _, err := upsertPreviewInMaps(map[string]Run{}, previews, previewOrder, Preview{ID: "p2", RunID: "missing"}, now); err != ErrNotFound {
		t.Fatalf("missing run preview err=%v", err)
	}

	threads := map[string]Thread{"t1": {ID: "t1"}}
	items := map[string]Item{"i1": {ID: "i1", ThreadID: "t1"}}
	pins := map[string]ThreadPin{}
	pinOrder := []string{}
	pin, pinOrder, err := upsertThreadPinInMaps(threads, items, pins, pinOrder, "t1", "i1", "u1", now)
	if err != nil || pin.ItemID != "i1" || pin.PinnedBy != "u1" || !reflect.DeepEqual(pinOrder, []string{threadPinKey("t1", "i1")}) {
		t.Fatalf("upsert pin create = %#v order=%#v err=%v", pin, pinOrder, err)
	}
	pin, pinOrder, err = upsertThreadPinInMaps(threads, items, pins, pinOrder, "t1", "i1", "u2", now)
	if err != nil || pin.PinnedBy != "u2" || !reflect.DeepEqual(pinOrder, []string{threadPinKey("t1", "i1")}) {
		t.Fatalf("upsert pin update = %#v order=%#v err=%v", pin, pinOrder, err)
	}
	if _, _, err := upsertThreadPinInMaps(threads, items, pins, pinOrder, "missing", "i1", "u1", now); err != ErrNotFound {
		t.Fatalf("bad pin refs err=%v", err)
	}

	settings := map[string]string{"keep": "1"}
	settings, mtime, view := upsertSettingsInMaps(settings, map[string]string{"  theme  ": "dark", "": "x"}, now)
	if mtime != now || settings["theme"] != "dark" || settings["keep"] != "1" || view.Values["theme"] != "dark" || view.UpdatedAt != now {
		t.Fatalf("upsert settings = %#v mtime=%q view=%#v", settings, mtime, view)
	}
	view.Values["theme"] = "mutated"
	if settings["theme"] != "dark" {
		t.Fatal("settings view should be cloned")
	}
}

func TestPlanAndApplyPlannedRunCleanup(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 7, 18, 12, 0, 0, 0, time.UTC)
	order := []string{"r1", "r2", "r3"}
	runs := map[string]Run{
		"r1": {ID: "r1", ThreadID: "t1", Status: "finished", FinishedAt: now.Add(-2 * time.Hour).Format(time.RFC3339)},
		"r2": {ID: "r2", ThreadID: "t1", Status: "finished", FinishedAt: now.Add(-10 * time.Minute).Format(time.RFC3339)},
		"r3": {ID: "r3", ThreadID: "t1", Status: "queued"},
	}
	remove := planRunCleanup(order, runs, RunCleanupOptions{
		Now:                      now,
		TerminalTTL:              time.Hour,
		MaxTerminalRunsPerThread: 1,
	}, time.Time{})
	if _, ok := remove["r1"]; !ok {
		t.Fatalf("expected r1 removed: %#v", remove)
	}
	if _, ok := remove["r2"]; ok {
		t.Fatalf("r2 should remain: %#v", remove)
	}
	if _, ok := remove["r3"]; ok {
		t.Fatalf("queued r3 should remain: %#v", remove)
	}

	// zero Now uses fallback
	remove = planRunCleanup(order, runs, RunCleanupOptions{
		TerminalTTL:              time.Hour,
		MaxTerminalRunsPerThread: 1,
	}, now)
	if _, ok := remove["r1"]; !ok {
		t.Fatalf("fallback now should still remove r1: %#v", remove)
	}

	// apply planned cleanup with items
	runMap := map[string]Run{
		"r1": {ID: "r1"},
		"r2": {ID: "r2"},
	}
	items := map[string]Item{
		"i1": {ID: "i1", RunID: "r1"},
		"i2": {ID: "i2", RunID: "r2"},
	}
	newRunOrder, newItemOrder, pinMatch, result := applyPlannedRunCleanup(
		runMap, items, []string{"r1", "r2"}, []string{"i1", "i2"}, map[string]struct{}{"r1": {}},
	)
	if result.RemovedRuns != 1 || result.RemovedItems != 1 {
		t.Fatalf("result = %#v", result)
	}
	if !reflect.DeepEqual(newRunOrder, []string{"r2"}) || !reflect.DeepEqual(newItemOrder, []string{"i2"}) {
		t.Fatalf("orders = %#v %#v", newRunOrder, newItemOrder)
	}
	if pinMatch == nil || !pinMatch(ThreadPin{ItemID: "i1"}) || pinMatch(ThreadPin{ItemID: "i2"}) {
		t.Fatal("pinMatch mismatch")
	}

	// no items removed → nil pinMatch
	_, _, pinMatch, result = applyPlannedRunCleanup(
		map[string]Run{"r2": {ID: "r2"}},
		map[string]Item{"i2": {ID: "i2", RunID: "r2"}},
		[]string{"r2"}, []string{"i2"},
		map[string]struct{}{"missing": {}},
	)
	if pinMatch != nil || result.RemovedItems != 0 || result.RemovedRuns != 1 {
		t.Fatalf("no-item cleanup pinMatch=%v result=%#v", pinMatch != nil, result)
	}
}
