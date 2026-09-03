package store

import "testing"

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
	// Same map identity when non-nil (Go cannot compare maps directly, so
	// mutate the result and verify the source map reflects the change).
	got := ensureSettingsMap(src)
	got["theme"] = "light"
	if src["theme"] != "light" {
		t.Fatalf("ensureSettingsMap should return the same map, got %#v", got)
	}
}

func TestBuildRunCleanupResultAndErrorHelpers(t *testing.T) {
	t.Parallel()
	got := buildRunCleanupResult(2, 5)
	if got.RemovedRuns != 2 || got.RemovedItems != 5 {
		t.Fatalf("buildRunCleanupResult = %#v", got)
	}

	err := errThreadExistsInProject("t1", "p9")
	if err == nil || err.Error() != "thread \"t1\" already exists in project \"p9\"" {
		t.Fatalf("errThreadExistsInProject = %v", err)
	}
	err = errAgentProfileExists("agent-1")
	if err == nil || err.Error() != "agent profile \"agent-1\" already exists" {
		t.Fatalf("errAgentProfileExists = %v", err)
	}
}
