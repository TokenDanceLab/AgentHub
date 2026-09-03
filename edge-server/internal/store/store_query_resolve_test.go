package store

import "testing"

func TestResolveUpsertHelpers(t *testing.T) {
	t.Parallel()
	now := "2026-07-18T00:00:00Z"

	created, isNew := resolveRunDiffFileUpsert(RunDiffFile{}, false, RunDiffFile{RunID: "r1", Path: "a.go", Diff: "+x", Status: "added"}, now)
	if !isNew || created.CreatedAt != now || created.UpdatedAt != now || created.Diff != "+x" {
		t.Fatalf("resolveRunDiffFileUpsert create = %#v isNew=%v", created, isNew)
	}
	updated, isNew := resolveRunDiffFileUpsert(
		RunDiffFile{RunID: "r1", Path: "a.go", Diff: "old", Status: "added", CreatedAt: "old", UpdatedAt: "old"},
		true,
		RunDiffFile{Diff: "new", Status: "modified"},
		now,
	)
	if isNew || updated.CreatedAt != "old" || updated.UpdatedAt != now || updated.Diff != "new" || updated.Status != "modified" {
		t.Fatalf("resolveRunDiffFileUpsert update = %#v isNew=%v", updated, isNew)
	}

	art := resolveArtifactUpsert(Artifact{ID: "a1", Path: "out.txt"}, Artifact{}, false, now)
	if art.CreatedAt != now || art.UpdatedAt != now {
		t.Fatalf("resolveArtifactUpsert create = %#v", art)
	}
	art = resolveArtifactUpsert(Artifact{ID: "a1", Path: "out2.txt"}, Artifact{ID: "a1", CreatedAt: "old"}, true, now)
	if art.CreatedAt != "old" || art.UpdatedAt != now || art.Path != "out2.txt" {
		t.Fatalf("resolveArtifactUpsert update = %#v", art)
	}

	pv := resolvePreviewUpsert(Preview{ID: "p1", URL: "http://x"}, Preview{}, false, now)
	if pv.CreatedAt != now || pv.UpdatedAt != now {
		t.Fatalf("resolvePreviewUpsert create = %#v", pv)
	}
	pv = resolvePreviewUpsert(Preview{ID: "p1", URL: "http://y"}, Preview{ID: "p1", CreatedAt: "old"}, true, now)
	if pv.CreatedAt != "old" || pv.UpdatedAt != now || pv.URL != "http://y" {
		t.Fatalf("resolvePreviewUpsert update = %#v", pv)
	}

	pin, createdPin := resolveThreadPinUpsert(ThreadPin{}, false, "t1", "i1", " alice ", now)
	if !createdPin || pin.PinnedBy != "alice" || pin.CreatedAt != now || pin.PinnedAt != now {
		t.Fatalf("resolveThreadPinUpsert create = %#v created=%v", pin, createdPin)
	}
	pin, createdPin = resolveThreadPinUpsert(
		ThreadPin{ThreadID: "t1", ItemID: "i1", PinnedBy: "old", CreatedAt: "old", PinnedAt: "old", UpdatedAt: "old"},
		true,
		"t1",
		"i1",
		" bob ",
		now,
	)
	if createdPin || pin.PinnedBy != "bob" || pin.CreatedAt != "old" || pin.PinnedAt != now || pin.UpdatedAt != now {
		t.Fatalf("resolveThreadPinUpsert update = %#v created=%v", pin, createdPin)
	}
}

func TestValidateCreateRefs(t *testing.T) {
	t.Parallel()
	projects := map[string]Project{"p1": {ID: "p1"}}
	threads := map[string]Thread{"t1": {ID: "t1", ProjectID: "p1"}}
	runs := map[string]Run{"r1": {ID: "r1", ThreadID: "t1"}}

	if !validateCreateRunRefs(projects, threads, "p1", "t1") {
		t.Fatal("validateCreateRunRefs expected ok")
	}
	if validateCreateRunRefs(projects, threads, "missing", "t1") {
		t.Fatal("missing project should fail")
	}
	if validateCreateRunRefs(projects, threads, "p1", "missing") {
		t.Fatal("missing thread should fail")
	}
	if validateCreateRunRefs(projects, map[string]Thread{"t2": {ID: "t2", ProjectID: "other"}}, "p1", "t2") {
		t.Fatal("thread project mismatch should fail")
	}

	item := Item{ProjectID: "p1", ThreadID: "t1", RunID: "r1"}
	if !validateCreateItemRefs(projects, threads, runs, item) {
		t.Fatal("validateCreateItemRefs expected ok")
	}
	if !validateCreateItemRefs(projects, threads, runs, Item{ProjectID: "p1", ThreadID: "t1"}) {
		t.Fatal("empty run id should skip run check")
	}
	if validateCreateItemRefs(projects, threads, runs, Item{ProjectID: "p1", ThreadID: "t1", RunID: "missing"}) {
		t.Fatal("missing run should fail")
	}
	if validateCreateItemRefs(projects, threads, map[string]Run{"r9": {ID: "r9", ThreadID: "other"}}, Item{ProjectID: "p1", ThreadID: "t1", RunID: "r9"}) {
		t.Fatal("run thread mismatch should fail")
	}
}

func TestResolveCreateHelpers(t *testing.T) {
	t.Parallel()
	now := "2026-07-18T00:00:00Z"

	project, created, err := resolveCreateProject(Project{}, false, "p1", "", "owner", now)
	if err != nil || !created || project.ID != "p1" || project.Name != "Local Project" {
		t.Fatalf("resolveCreateProject create = %#v err=%v created=%v", project, err, created)
	}
	project, created, err = resolveCreateProject(Project{ID: "p1", Name: "Existing"}, true, "p1", "x", "o", now)
	if err != ErrProjectExists || created || project.Name != "Existing" {
		t.Fatalf("resolveCreateProject exists = %#v err=%v created=%v", project, err, created)
	}

	thread, created, err := resolveCreateThread(Thread{}, false, false, "t1", "p1", "title", "chat", "blue", "A", now)
	if err != ErrNotFound || created {
		t.Fatalf("resolveCreateThread missing project = err=%v created=%v", err, created)
	}
	thread, created, err = resolveCreateThread(
		Thread{ID: "t1", ProjectID: "other"}, true, true,
		"t1", "p1", "title", "chat", "blue", "A", now,
	)
	if err == nil || created || err.Error() != "thread \"t1\" already exists in project \"other\"" {
		t.Fatalf("resolveCreateThread conflict = %#v err=%v created=%v", thread, err, created)
	}
	existing := Thread{ID: "t1", ProjectID: "p1", Title: "keep"}
	thread, created, err = resolveCreateThread(existing, true, true, "t1", "p1", "title", "chat", "blue", "A", now)
	if err != nil || created || thread.Title != "keep" {
		t.Fatalf("resolveCreateThread reuse = %#v err=%v created=%v", thread, err, created)
	}
	thread, created, err = resolveCreateThread(Thread{}, false, true, "t1", "p1", "", "chat", "blue", "A", now)
	if err != nil || !created || thread.Title != "New Thread" {
		t.Fatalf("resolveCreateThread create = %#v err=%v created=%v", thread, err, created)
	}

	run, created, err := resolveCreateRun(Run{}, false, false, "r1", "p1", "t1", now)
	if err != ErrNotFound || created {
		t.Fatalf("resolveCreateRun refs fail = err=%v created=%v", err, created)
	}
	run, created, err = resolveCreateRun(Run{ID: "r1", Status: "started"}, true, true, "r1", "p1", "t1", now)
	if err != nil || created || run.Status != "started" {
		t.Fatalf("resolveCreateRun reuse = %#v err=%v created=%v", run, err, created)
	}
	run, created, err = resolveCreateRun(Run{}, false, true, "r1", "p1", "t1", now)
	if err != nil || !created || run.Status != "queued" {
		t.Fatalf("resolveCreateRun create = %#v err=%v created=%v", run, err, created)
	}

	item, created, err := resolveCreateItem(Item{}, false, false, Item{ID: "i1"}, now)
	if err != ErrNotFound || created {
		t.Fatalf("resolveCreateItem refs fail = err=%v created=%v", err, created)
	}
	item, created, err = resolveCreateItem(Item{ID: "i1", Type: "old"}, true, true, Item{ID: "i1"}, now)
	if err != nil || created || item.Type != "old" {
		t.Fatalf("resolveCreateItem reuse = %#v err=%v created=%v", item, err, created)
	}
	item, created, err = resolveCreateItem(Item{}, false, true, Item{ID: "i1"}, now)
	if err != nil || !created || item.Type != "event" || item.Status != "created" {
		t.Fatalf("resolveCreateItem create = %#v err=%v created=%v", item, err, created)
	}

	profile, created := resolveCreateUserProfile(UserProfile{ID: "u1", DisplayName: "keep"}, true, UserProfile{ID: "u1"}, now)
	if created || profile.DisplayName != "keep" {
		t.Fatalf("resolveCreateUserProfile reuse = %#v created=%v", profile, created)
	}
	profile, created = resolveCreateUserProfile(UserProfile{}, false, UserProfile{ID: "u1", DisplayName: "New"}, now)
	if !created || profile.CreatedAt != now || profile.UpdatedAt != now {
		t.Fatalf("resolveCreateUserProfile create = %#v created=%v", profile, created)
	}

	agent, created, err := resolveCreateAgentProfile(false, AgentProfile{ID: "", AdapterID: "a"}, now)
	if err == nil || created {
		t.Fatalf("resolveCreateAgentProfile invalid = err=%v created=%v", err, created)
	}
	agent, created, err = resolveCreateAgentProfile(true, AgentProfile{ID: "ag1", AdapterID: "claude"}, now)
	if err == nil || created || err.Error() != "agent profile \"ag1\" already exists" {
		t.Fatalf("resolveCreateAgentProfile exists = err=%v created=%v", err, created)
	}
	agent, created, err = resolveCreateAgentProfile(false, AgentProfile{ID: "ag1", AdapterID: "claude", Name: ""}, now)
	if err != nil || !created || agent.Name != "Unnamed Agent" || agent.UpdatedAt != now {
		t.Fatalf("resolveCreateAgentProfile create = %#v err=%v created=%v", agent, err, created)
	}
}

func TestApplySettingsUpsert(t *testing.T) {
	t.Parallel()
	paddedKey := " theme " // intentionally padded: keys must be trimmed before storing
	settings, view := applySettingsUpsert(nil, map[string]string{paddedKey: "dark", "": "x"}, "now")
	if settings["theme"] != "dark" || view.Values["theme"] != "dark" || view.UpdatedAt != "now" {
		t.Fatalf("applySettingsUpsert = settings=%#v view=%#v", settings, view)
	}
	if _, ok := settings[""]; ok {
		t.Fatal("empty key should be ignored")
	}
	// Isolation of returned view values.
	settings["theme"] = "light"
	if view.Values["theme"] != "dark" {
		t.Fatalf("view not isolated: %#v", view)
	}
}

func TestResolveSetRunStatusHelpers(t *testing.T) {
	t.Parallel()
	now := "2026-07-18T00:00:00Z"

	run, ok := resolveSetRunStatus(Run{}, false, "started", now)
	if ok || run.ID != "" {
		t.Fatalf("missing set status = %#v ok=%v", run, ok)
	}
	run, ok = resolveSetRunStatus(Run{ID: "r1", Status: "queued"}, true, "started", now)
	if !ok || run.Status != "started" || run.StartedAt != now {
		t.Fatalf("set status = %#v ok=%v", run, ok)
	}

	run, ok = resolveSetRunStatusIf(Run{ID: "r1", Status: "queued"}, true, "started", []string{"started"}, now)
	if ok || run.Status != "queued" {
		t.Fatalf("disallowed status should keep run: %#v ok=%v", run, ok)
	}
	run, ok = resolveSetRunStatusIf(Run{ID: "r1", Status: "queued"}, true, "started", []string{"queued"}, now)
	if !ok || run.Status != "started" {
		t.Fatalf("allowed status = %#v ok=%v", run, ok)
	}
	if _, ok := resolveSetRunStatusIf(Run{}, false, "started", nil, now); ok {
		t.Fatal("missing run should fail status-if")
	}

	run, ok = resolveSetRunEvidenceGate(Run{ID: "r1"}, true, `{"ok":true}`)
	if !ok || run.EvidenceGateResult != `{"ok":true}` {
		t.Fatalf("evidence gate = %#v ok=%v", run, ok)
	}
	if _, ok := resolveSetRunEvidenceGate(Run{}, false, "x"); ok {
		t.Fatal("missing evidence gate should fail")
	}

	run, ok = resolveSetRunRetryCount(Run{ID: "r1"}, true, 3)
	if !ok || run.RetryCount != 3 {
		t.Fatalf("retry count = %#v ok=%v", run, ok)
	}
	if _, ok := resolveSetRunRetryCount(Run{}, false, 1); ok {
		t.Fatal("missing retry count should fail")
	}
}

func TestPrepareUpsertInputsAndPinRefs(t *testing.T) {
	t.Parallel()

	key, file, ok := prepareRunDiffFileUpsert(false, RunDiffFile{RunID: "r1", Path: "a.go"})
	if ok || key != "" {
		t.Fatalf("missing run should fail prepareRunDiffFileUpsert: key=%q ok=%v", key, ok)
	}
	key, file, ok = prepareRunDiffFileUpsert(true, RunDiffFile{RunID: "r1", Path: "  ", Status: "ADD"})
	if ok || key != "" {
		t.Fatalf("empty path should fail: key=%q file=%#v ok=%v", key, file, ok)
	}
	key, file, ok = prepareRunDiffFileUpsert(true, RunDiffFile{RunID: "r1", Path: "  src/a.go  ", Status: "ADD"})
	if !ok || key != runDiffFileKey("r1", "src/a.go") || file.Path != "src/a.go" || file.Status != "added" {
		t.Fatalf("prepareRunDiffFileUpsert = key=%q file=%#v ok=%v", key, file, ok)
	}

	artifact, ok := prepareArtifactForUpsert(Run{}, false, Artifact{ID: "a1", RunID: "r1"})
	if ok {
		t.Fatal("missing run artifact should fail")
	}
	artifact, ok = prepareArtifactForUpsert(Run{ID: "r1", ThreadID: "t1"}, true, Artifact{ID: "  a1  ", RunID: "r1"})
	if !ok || artifact.ID != "a1" || artifact.ThreadID != "t1" || artifact.Kind != "file" {
		t.Fatalf("prepareArtifactForUpsert = %#v ok=%v", artifact, ok)
	}

	preview, ok := preparePreviewForUpsert(Run{}, false, Preview{ID: "p1", RunID: "r1"})
	if ok {
		t.Fatal("missing run preview should fail")
	}
	preview, ok = preparePreviewForUpsert(Run{ID: "r1", ThreadID: "t1"}, true, Preview{ID: "  p1  ", RunID: "r1"})
	if !ok || preview.ID != "p1" || preview.ThreadID != "t1" || preview.Status != "ready" {
		t.Fatalf("preparePreviewForUpsert = %#v ok=%v", preview, ok)
	}

	threads := map[string]Thread{"t1": {ID: "t1"}}
	items := map[string]Item{"i1": {ID: "i1", ThreadID: "t1"}, "i2": {ID: "i2", ThreadID: "other"}}
	if !validatePinThreadItemRefs(threads, items, "t1", "i1") {
		t.Fatal("valid pin refs rejected")
	}
	if validatePinThreadItemRefs(threads, items, "missing", "i1") {
		t.Fatal("missing thread accepted")
	}
	if validatePinThreadItemRefs(threads, items, "t1", "i2") {
		t.Fatal("item thread mismatch accepted")
	}
}

func TestResolveUpdateAgentProfileAndErrIfMissing(t *testing.T) {
	t.Parallel()
	now := "2026-07-18T00:00:00Z"
	profile, err := resolveUpdateAgentProfile(AgentProfile{}, false, map[string]any{"name": "x"}, now)
	if err != ErrNotFound || profile.ID != "" {
		t.Fatalf("missing agent = %#v err=%v", profile, err)
	}
	profile, err = resolveUpdateAgentProfile(
		AgentProfile{ID: "ag1", Name: "old", AdapterID: "claude"},
		true,
		map[string]any{"name": "new"},
		now,
	)
	if err != nil || profile.Name != "new" || profile.UpdatedAt != now {
		t.Fatalf("resolveUpdateAgentProfile = %#v err=%v", profile, err)
	}

	if errIfMissing(true) != nil {
		t.Fatal("errIfMissing true")
	}
	if errIfMissing(false) != ErrNotFound {
		t.Fatal("errIfMissing false")
	}
}
