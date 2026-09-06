package store

import (
	"encoding/json"
	"errors"
	"reflect"
	"sort"
	"testing"
	"time"
)

func TestDecodeSQLiteRowPayload(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		payload string
		want    Project
		wantErr bool
	}{
		{
			name:    "valid project",
			payload: `{"projectId":"p1","name":"Local","status":"active","ownerId":"o1","createdAt":"t1","updatedAt":"t2"}`,
			want: Project{
				ID: "p1", Name: "Local", Status: "active", OwnerID: "o1",
				CreatedAt: "t1", UpdatedAt: "t2",
			},
		},
		{
			name:    "trailing data rejected",
			payload: `{"projectId":"p1"}{"extra":true}`,
			wantErr: true,
		},
		{
			name:    "invalid json",
			payload: `{not-json`,
			wantErr: true,
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			var got Project
			err := decodeSQLiteRowPayload(tt.payload, &got)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("decodeSQLiteRowPayload() error = nil, want error")
				}
				return
			}
			if err != nil {
				t.Fatalf("decodeSQLiteRowPayload() unexpected error: %v", err)
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("decodeSQLiteRowPayload() = %#v, want %#v", got, tt.want)
			}
		})
	}
}

func TestApplySQLiteRow(t *testing.T) {
	t.Parallel()

	var snapshot fileSnapshot
	if err := applySQLiteRow(&snapshot, sqliteRowKindProject, "p1", `{"projectId":"p1","name":"P","status":"active","ownerId":"o1","createdAt":"c","updatedAt":"u"}`); err != nil {
		t.Fatalf("apply project: %v", err)
	}
	if err := applySQLiteRow(&snapshot, sqliteRowKindThread, "t1", `{"threadId":"t1","projectId":"p1","title":"T","kind":"chat","status":"active","createdAt":"c","updatedAt":"u"}`); err != nil {
		t.Fatalf("apply thread: %v", err)
	}
	if err := applySQLiteRow(&snapshot, "unknown", "x", `{}`); err == nil {
		t.Fatal("apply unknown kind: expected error")
	}

	if len(snapshot.Projects) != 1 || snapshot.Projects["p1"].Name != "P" {
		t.Fatalf("projects = %#v", snapshot.Projects)
	}
	if !reflect.DeepEqual(snapshot.ProjectOrder, []string{"p1"}) {
		t.Fatalf("project order = %#v", snapshot.ProjectOrder)
	}
	if len(snapshot.Threads) != 1 || snapshot.Threads["t1"].Title != "T" {
		t.Fatalf("threads = %#v", snapshot.Threads)
	}
}

func TestSelectSQLiteRowDeltas(t *testing.T) {
	t.Parallel()

	type row struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}

	oldMap := map[string]row{
		"a": {ID: "a", Name: "keep"},
		"b": {ID: "b", Name: "old"},
		"c": {ID: "c", Name: "delete-me"},
	}
	newMap := map[string]row{
		"a": {ID: "a", Name: "keep"},
		"b": {ID: "b", Name: "new"},
		"d": {ID: "d", Name: "insert"},
	}
	oldOrder := []string{"a", "b", "c"}
	newOrder := []string{"a", "b", "d"}

	upserts, deletes, err := selectSQLiteRowDeltas(oldOrder, oldMap, newOrder, newMap)
	if err != nil {
		t.Fatalf("selectSQLiteRowDeltas: %v", err)
	}

	upsertByID := make(map[string]sqliteRowUpsert, len(upserts))
	for _, u := range upserts {
		upsertByID[u.ID] = u
	}
	if _, ok := upsertByID["a"]; ok {
		t.Fatalf("unchanged row a should not upsert: %#v", upserts)
	}
	if got := upsertByID["b"]; got.Payload == "" || got.Index != 1 {
		t.Fatalf("row b upsert = %#v", got)
	}
	if got := upsertByID["d"]; got.Payload == "" || got.Index != 2 {
		t.Fatalf("row d upsert = %#v", got)
	}
	sort.Strings(deletes)
	if !reflect.DeepEqual(deletes, []string{"c"}) {
		t.Fatalf("deletes = %#v, want [c]", deletes)
	}

	// Order-only change should upsert.
	reordered, deletes2, err := selectSQLiteRowDeltas([]string{"a", "b"}, map[string]row{
		"a": {ID: "a", Name: "keep"},
		"b": {ID: "b", Name: "keep"},
	}, []string{"b", "a"}, map[string]row{
		"a": {ID: "a", Name: "keep"},
		"b": {ID: "b", Name: "keep"},
	})
	if err != nil {
		t.Fatalf("order-only select: %v", err)
	}
	if len(deletes2) != 0 {
		t.Fatalf("order-only deletes = %#v", deletes2)
	}
	if len(reordered) != 2 {
		t.Fatalf("order-only upserts = %#v", reordered)
	}
}

func TestBuildProjectionMaps(t *testing.T) {
	t.Parallel()

	snapshot := fileSnapshot{
		Projects: map[string]Project{
			"p1": {ID: "p1", Name: "P1"},
		},
		Runs: map[string]Run{
			"r1": {ID: "r1", ProjectID: "p1", Status: "finished"},
		},
		Artifacts: map[string]Artifact{
			"a1": {
				ID: "a1", RunID: "r1", Kind: "file", Path: "out.txt",
				SizeBytes: 12, CreatedAt: "c1", UpdatedAt: "u1",
				ContentSource: &ArtifactContentSource{Kind: "path", Path: "/tmp/out.txt", Readable: true},
			},
			"skip": {ID: "skip", RunID: "missing"},
		},
		Diffs: map[string]RunDiffFile{
			"d1": {RunID: "r1", Path: "src/a.go", Diff: "@@", Status: "modified", CreatedAt: "c2", UpdatedAt: "u2"},
		},
		Previews: map[string]Preview{
			"v1": {ID: "v1", RunID: "r1", URL: "http://localhost:3000", Status: "created", CreatedAt: "c3", UpdatedAt: "u3"},
		},
	}

	artifactMap := buildArtifactProjectionMap(snapshot)
	if len(artifactMap) != 1 {
		t.Fatalf("artifact projection size = %d, want 1", len(artifactMap))
	}
	var artifactProj artifactProjection
	if err := json.Unmarshal([]byte(artifactMap["a1"]), &artifactProj); err != nil {
		t.Fatalf("unmarshal artifact projection: %v", err)
	}
	if artifactProj.WorkspaceID != "p1" || artifactProj.ContentSourceReadable != 1 || artifactProj.Path != "out.txt" {
		t.Fatalf("artifact projection = %#v", artifactProj)
	}
	if artifactProj.MetadataJSON != `{"sizeBytes":12}` {
		t.Fatalf("artifact metadata = %q", artifactProj.MetadataJSON)
	}

	diffMap := buildDiffProjectionMap(snapshot)
	if len(diffMap) != 1 {
		t.Fatalf("diff projection size = %d, want 1", len(diffMap))
	}
	var diffID string
	for id := range diffMap {
		diffID = id
	}
	wantDiffID := sqliteDiffProjectionID(snapshot.Diffs["d1"])
	if diffID != wantDiffID {
		t.Fatalf("diff id = %q, want %q", diffID, wantDiffID)
	}
	var diffProj diffProjection
	if err := json.Unmarshal([]byte(diffMap[diffID]), &diffProj); err != nil {
		t.Fatalf("unmarshal diff projection: %v", err)
	}
	if diffProj.WorkspaceID != "p1" || diffProj.PatchPath != "src/a.go" {
		t.Fatalf("diff projection = %#v", diffProj)
	}

	previewMap := buildPreviewProjectionMap(snapshot)
	if len(previewMap) != 1 {
		t.Fatalf("preview projection size = %d, want 1", len(previewMap))
	}
	var previewProj previewProjection
	if err := json.Unmarshal([]byte(previewMap["v1"]), &previewProj); err != nil {
		t.Fatalf("unmarshal preview projection: %v", err)
	}
	if previewProj.WorkspaceID != "p1" || previewProj.URL != "http://localhost:3000" {
		t.Fatalf("preview projection = %#v", previewProj)
	}
}

func TestDeltaProjectionMap(t *testing.T) {
	t.Parallel()

	oldMap := map[string]string{"a": "1", "b": "2", "c": "3"}
	newMap := map[string]string{"a": "1", "b": "22", "d": "4"}

	var upserts []string
	var deletes []string
	err := deltaProjectionMap("edge_demo", "demo_id", oldMap, newMap,
		func(id, payload string) error {
			upserts = append(upserts, id+":"+payload)
			return nil
		},
		func(id string) error {
			deletes = append(deletes, id)
			return nil
		},
	)
	if err != nil {
		t.Fatalf("deltaProjectionMap: %v", err)
	}
	sort.Strings(upserts)
	sort.Strings(deletes)
	if !reflect.DeepEqual(upserts, []string{"b:22", "d:4"}) {
		t.Fatalf("upserts = %#v", upserts)
	}
	if !reflect.DeepEqual(deletes, []string{"c"}) {
		t.Fatalf("deletes = %#v", deletes)
	}
}

func TestCloneFileSnapshot(t *testing.T) {
	t.Parallel()

	source := &ArtifactContentSource{Kind: "path", Path: "/tmp/a", Readable: true}
	original := fileSnapshot{
		Projects: map[string]Project{"p1": {ID: "p1", Name: "P"}},
		Artifacts: map[string]Artifact{
			"a1": {ID: "a1", RunID: "r1", ContentSource: source},
		},
		Checkpoints: map[string]RunCheckpoint{
			"r1": {RunID: "r1", Files: []CheckpointFile{{Path: "input.txt", Content: "original"}}},
		},
		ProjectOrder:  []string{"p1"},
		ArtifactOrder: []string{"a1"},
		Settings:      map[string]string{"theme": "dark"},
		SettingsMtime: "m1",
	}

	cloned := cloneFileSnapshot(original)
	if !reflect.DeepEqual(cloned.ProjectOrder, original.ProjectOrder) {
		t.Fatalf("project order mismatch: %#v", cloned.ProjectOrder)
	}
	if cloned.Projects["p1"].Name != "P" {
		t.Fatalf("cloned project = %#v", cloned.Projects["p1"])
	}
	if cloned.Artifacts["a1"].ContentSource == original.Artifacts["a1"].ContentSource {
		t.Fatal("artifact content source pointer should be deep-cloned")
	}
	checkpoint, ok := cloned.Checkpoints["r1"]
	if !ok || !reflect.DeepEqual(checkpoint, original.Checkpoints["r1"]) {
		t.Fatal("checkpoint missing or changed in cloned snapshot")
	}
	checkpoint.Files[0].Content = "mutated"
	delete(cloned.Checkpoints, "r1")
	if got := original.Checkpoints["r1"].Files[0].Content; got != "original" {
		t.Fatalf("checkpoint clone shares nested files: %q", got)
	}
	cloned.Projects["p1"] = Project{ID: "p1", Name: "mutated"}
	cloned.ProjectOrder[0] = "mutated"
	cloned.Settings["theme"] = "light"
	if original.Projects["p1"].Name != "P" || original.ProjectOrder[0] != "p1" || original.Settings["theme"] != "dark" {
		t.Fatalf("clone mutated original: %#v", original)
	}
}

func TestSQLiteArtifactAndDiffHelpers(t *testing.T) {
	t.Parallel()

	kind, path, readable := sqliteArtifactContentSourceColumns(nil)
	if kind != "" || path != "" || readable != 0 {
		t.Fatalf("nil content source = (%q,%q,%d)", kind, path, readable)
	}
	kind, path, readable = sqliteArtifactContentSourceColumns(&ArtifactContentSource{
		Kind: "path", Path: "/x", Readable: true,
	})
	if kind != "path" || path != "/x" || readable != 1 {
		t.Fatalf("content source columns = (%q,%q,%d)", kind, path, readable)
	}

	meta, err := sqliteArtifactMetadataJSON(Artifact{SizeBytes: 7})
	if err != nil {
		t.Fatalf("metadata: %v", err)
	}
	if meta != `{"sizeBytes":7}` {
		t.Fatalf("metadata = %q", meta)
	}

	file := RunDiffFile{RunID: "r1", Path: "a.go", Diff: "abc"}
	id := sqliteDiffProjectionID(file)
	if id == "" || id[:9] != "run_diff:" {
		t.Fatalf("diff projection id = %q", id)
	}
	summary, err := sqliteDiffSummaryJSON(file)
	if err != nil {
		t.Fatalf("diff summary: %v", err)
	}
	var parsed struct {
		Path      string `json:"path"`
		DiffBytes int    `json:"diffBytes"`
	}
	if err := json.Unmarshal([]byte(summary), &parsed); err != nil {
		t.Fatalf("unmarshal summary: %v", err)
	}
	if parsed.Path != "a.go" || parsed.DiffBytes != 3 {
		t.Fatalf("summary = %#v", parsed)
	}
}

func TestNullStringAndFirstNonEmpty(t *testing.T) {
	t.Parallel()

	if got := nullString(""); got != nil {
		t.Fatalf("nullString empty = %#v", got)
	}
	if got := nullString("x"); got != "x" {
		t.Fatalf("nullString non-empty = %#v", got)
	}

	tests := []struct {
		values []string
		want   string
	}{
		{[]string{"", "", "c"}, "c"},
		{[]string{"a", "b"}, "a"},
		{[]string{"", ""}, ""},
		{nil, ""},
	}
	for _, tt := range tests {
		if got := firstNonEmpty(tt.values...); got != tt.want {
			t.Fatalf("firstNonEmpty(%v) = %q, want %q", tt.values, got, tt.want)
		}
	}
}

func TestDecodeSQLiteRowPayloadRejectsTrailingTokens(t *testing.T) {
	t.Parallel()
	var value map[string]any
	err := decodeSQLiteRowPayload(`{"ok":true} 1`, &value)
	if err == nil {
		t.Fatal("expected trailing data error")
	}
	if !errors.Is(err, err) && err.Error() != "trailing data" {
		// keep explicit message check for pure helper contract
		if err.Error() != "trailing data" {
			t.Fatalf("error = %v, want trailing data", err)
		}
	}
}

func TestIsBlankSQLiteSnapshotPayload(t *testing.T) {
	t.Parallel()
	tests := []struct {
		payload string
		want    bool
	}{
		{"", true},
		{"   \n\t", true},
		{"{}", false},
		{"  {\"x\":1} ", false},
	}
	for _, tt := range tests {
		if got := isBlankSQLiteSnapshotPayload(tt.payload); got != tt.want {
			t.Fatalf("isBlankSQLiteSnapshotPayload(%q) = %v, want %v", tt.payload, got, tt.want)
		}
	}
}

func TestDecodeAndEncodeSQLiteSnapshotPayload(t *testing.T) {
	t.Parallel()

	if _, err := decodeSQLiteSnapshotPayload(`{"projects":{}} extra`); err == nil {
		t.Fatal("expected trailing data error")
	}
	if _, err := decodeSQLiteSnapshotPayload(`{not-json`); err == nil {
		t.Fatal("expected invalid json error")
	}

	original := fileSnapshot{
		Projects: map[string]Project{
			"p1": {ID: "p1", Name: "Local", Status: "active", OwnerID: "o1", CreatedAt: "c", UpdatedAt: "u"},
		},
		ProjectOrder: []string{"p1"},
		Settings:     map[string]string{"theme": "dark"},
	}
	payload, err := encodeSQLiteSnapshotPayload(original)
	if err != nil {
		t.Fatalf("encodeSQLiteSnapshotPayload: %v", err)
	}
	decoded, err := decodeSQLiteSnapshotPayload(string(payload))
	if err != nil {
		t.Fatalf("decodeSQLiteSnapshotPayload: %v", err)
	}
	if !reflect.DeepEqual(decoded.Projects["p1"], original.Projects["p1"]) {
		t.Fatalf("decoded project = %#v, want %#v", decoded.Projects["p1"], original.Projects["p1"])
	}
	if !reflect.DeepEqual(decoded.ProjectOrder, original.ProjectOrder) {
		t.Fatalf("decoded order = %#v", decoded.ProjectOrder)
	}
	if decoded.Settings["theme"] != "dark" {
		t.Fatalf("decoded settings = %#v", decoded.Settings)
	}
}

func TestBuildJSONPayloadMap(t *testing.T) {
	t.Parallel()

	items := map[string]Project{
		"p1": {ID: "p1", Name: "One"},
		"p2": {ID: "p2", Name: "Two"},
	}
	got := buildJSONPayloadMap(items)
	if len(got) != 2 {
		t.Fatalf("size = %d, want 2", len(got))
	}
	var p1 Project
	if err := json.Unmarshal([]byte(got["p1"]), &p1); err != nil {
		t.Fatalf("unmarshal p1: %v", err)
	}
	if p1.Name != "One" {
		t.Fatalf("p1 = %#v", p1)
	}
}

func TestPrepareWorkspaceProjectionWrite(t *testing.T) {
	t.Parallel()

	now := "2026-07-18T00:00:00Z"
	write, skip, err := prepareWorkspaceProjectionWrite(`{"projectId":"p1","name":"Local","status":"active","createdAt":"c1"}`, now)
	if err != nil || skip {
		t.Fatalf("prepare workspace: skip=%v err=%v", skip, err)
	}
	if write.WorkspaceID != "p1" || write.LocalPath != "p1" || write.Name != "Local" || write.Status != "active" {
		t.Fatalf("workspace write = %#v", write)
	}
	if write.CreatedAt != "c1" || write.UpdatedAt != "c1" {
		t.Fatalf("workspace timestamps = %#v", write)
	}

	// Missing name/status/createdAt fall back.
	write, skip, err = prepareWorkspaceProjectionWrite(`{"projectId":"p2"}`, now)
	if err != nil || skip {
		t.Fatalf("prepare workspace defaults: skip=%v err=%v", skip, err)
	}
	if write.Name != "p2" || write.Status != "active" || write.CreatedAt != now || write.UpdatedAt != now {
		t.Fatalf("workspace defaults = %#v", write)
	}

	_, skip, err = prepareWorkspaceProjectionWrite(`{"name":"no-id"}`, now)
	if err != nil || !skip {
		t.Fatalf("empty id skip=%v err=%v, want skip", skip, err)
	}
	if _, _, err := prepareWorkspaceProjectionWrite(`{bad`, now); err == nil {
		t.Fatal("expected invalid json error")
	}
}

func TestPrepareRunProjectionWrite(t *testing.T) {
	t.Parallel()

	now := "2026-07-18T00:00:00Z"
	projects := map[string]Project{"p1": {ID: "p1"}}

	write, skip, err := prepareRunProjectionWrite(
		`{"runId":"r1","projectId":"p1","threadId":"t1","status":"started","createdAt":"c1","startedAt":"s1"}`,
		projects, now,
	)
	if err != nil || skip {
		t.Fatalf("prepare run: skip=%v err=%v", skip, err)
	}
	if write.RunID != "r1" || write.WorkspaceID != "p1" || write.ThreadID != "t1" || write.Status != "started" {
		t.Fatalf("run write = %#v", write)
	}
	if write.CreatedAt != "c1" || write.StartedAt != "s1" || write.FinishedAt != nil {
		t.Fatalf("run times = %#v", write)
	}

	// Empty thread/status/createdAt defaults.
	write, skip, err = prepareRunProjectionWrite(`{"runId":"r2","projectId":"p1"}`, projects, now)
	if err != nil || skip {
		t.Fatalf("prepare run defaults: skip=%v err=%v", skip, err)
	}
	if write.ThreadID != nil || write.Status != "queued" || write.CreatedAt != now {
		t.Fatalf("run defaults = %#v", write)
	}

	_, skip, err = prepareRunProjectionWrite(`{"runId":"r3","projectId":"missing"}`, projects, now)
	if err != nil || !skip {
		t.Fatalf("missing project skip=%v err=%v, want skip", skip, err)
	}
	_, skip, err = prepareRunProjectionWrite(`{"runId":"","projectId":"p1"}`, projects, now)
	if err != nil || !skip {
		t.Fatalf("empty run id skip=%v err=%v, want skip", skip, err)
	}
	if _, _, err := prepareRunProjectionWrite(`{bad`, projects, now); err == nil {
		t.Fatal("expected invalid json error")
	}
}

func TestPrepareArtifactDiffPreviewProjectionWrite(t *testing.T) {
	t.Parallel()

	now := "2026-07-18T00:00:00Z"

	artifact, skip, err := prepareArtifactProjectionWrite(
		`{"artifactId":"a1","runId":"r1","workspaceId":"p1","kind":"log","path":"out.txt","createdAt":"c1","metadataJson":"{\"sizeBytes\":1}","contentSourceKind":"path","contentSourcePath":"/tmp/out","contentSourceReadable":1}`,
		now,
	)
	if err != nil || skip {
		t.Fatalf("artifact: skip=%v err=%v", skip, err)
	}
	if artifact.ArtifactID != "a1" || artifact.Kind != "log" || artifact.ContentSourceReadable != 1 {
		t.Fatalf("artifact write = %#v", artifact)
	}
	artifact, skip, err = prepareArtifactProjectionWrite(`{"artifactId":"a2","runId":"r1","workspaceId":"p1"}`, now)
	if err != nil || skip {
		t.Fatalf("artifact defaults: skip=%v err=%v", skip, err)
	}
	if artifact.Kind != "file" || artifact.CreatedAt != now || artifact.UpdatedAt != now {
		t.Fatalf("artifact defaults = %#v", artifact)
	}
	_, skip, err = prepareArtifactProjectionWrite(`{"artifactId":"","runId":"r1","workspaceId":"p1"}`, now)
	if err != nil || !skip {
		t.Fatalf("artifact empty id skip=%v err=%v", skip, err)
	}

	diff, skip, err := prepareDiffProjectionWrite(
		`{"diffId":"d1","runId":"r1","workspaceId":"p1","summaryJson":"{}","patchPath":"a.go","status":"added","createdAt":"c2"}`,
		now,
	)
	if err != nil || skip {
		t.Fatalf("diff: skip=%v err=%v", skip, err)
	}
	if diff.DiffID != "d1" || diff.PatchPath != "a.go" || diff.Status != "added" || diff.UpdatedAt != "c2" {
		t.Fatalf("diff write = %#v", diff)
	}
	diff, skip, err = prepareDiffProjectionWrite(`{"diffId":"d2","runId":"r1","workspaceId":"p1","patchPath":"b.go"}`, now)
	if err != nil || skip {
		t.Fatalf("diff defaults: skip=%v err=%v", skip, err)
	}
	if diff.Status != "modified" || diff.CreatedAt != now {
		t.Fatalf("diff defaults = %#v", diff)
	}
	_, skip, err = prepareDiffProjectionWrite(`{"diffId":"d3","runId":"","workspaceId":"p1"}`, now)
	if err != nil || !skip {
		t.Fatalf("diff empty run skip=%v err=%v", skip, err)
	}

	preview, skip, err := preparePreviewProjectionWrite(
		`{"previewId":"v1","runId":"r1","workspaceId":"p1","url":"http://localhost","status":"ready","createdAt":"c3"}`,
		now,
	)
	if err != nil || skip {
		t.Fatalf("preview: skip=%v err=%v", skip, err)
	}
	if preview.PreviewID != "v1" || preview.URL != "http://localhost" || preview.Status != "ready" {
		t.Fatalf("preview write = %#v", preview)
	}
	preview, skip, err = preparePreviewProjectionWrite(`{"previewId":"v2","runId":"r1","workspaceId":"p1","url":"http://x"}`, now)
	if err != nil || skip {
		t.Fatalf("preview defaults: skip=%v err=%v", skip, err)
	}
	if preview.Status != "created" || preview.CreatedAt != now || preview.UpdatedAt != now {
		t.Fatalf("preview defaults = %#v", preview)
	}
	_, skip, err = preparePreviewProjectionWrite(`{"previewId":"v3","runId":"r1","workspaceId":""}`, now)
	if err != nil || !skip {
		t.Fatalf("preview empty workspace skip=%v err=%v", skip, err)
	}
}

func TestSQLiteResidualPureHelpers1032(t *testing.T) {
	t.Parallel()

	opts := sqlitePeriodicCleanupOptions()
	if opts.TerminalTTL != sqliteCleanupTerminalTTL || opts.MaxTerminalRunsPerThread != sqliteCleanupMaxTerminalRunsPerThread {
		t.Fatalf("cleanup opts = %#v", opts)
	}
	if sqliteBackgroundLoopInterval != 5*time.Minute {
		t.Fatalf("interval = %v", sqliteBackgroundLoopInterval)
	}

	// Load source plan
	if !planSQLiteLoadSource(true).UseRows || planSQLiteLoadSource(true).UseSnapshot {
		t.Fatal("rows path")
	}
	if planSQLiteLoadSource(false).UseRows || !planSQLiteLoadSource(false).UseSnapshot {
		t.Fatal("snapshot path")
	}

	// Legacy snapshot load plan
	if !planLegacySnapshotLoad(true, nil, "").Skip {
		t.Fatal("no rows skip")
	}
	if !planLegacySnapshotLoad(false, errors.New("db"), "").Fail {
		t.Fatal("read fail")
	}
	if !planLegacySnapshotLoad(false, nil, "   ").Skip {
		t.Fatal("blank payload skip")
	}
	if !planLegacySnapshotLoad(false, nil, `{"projects":{}}`).Decode {
		t.Fatal("decode path")
	}

	// Persist gates
	if !shouldSkipPersistOnProjectExists(ErrProjectExists) {
		t.Fatal("skip on exists")
	}
	if shouldSkipPersistOnProjectExists(errors.New("other")) {
		t.Fatal("other err")
	}
	if shouldSyncAfterCleanup(RunCleanupResult{}) {
		t.Fatal("empty cleanup no sync")
	}
	if !shouldSyncAfterCleanup(RunCleanupResult{RemovedRuns: 1}) || !shouldSyncAfterCleanup(RunCleanupResult{RemovedItems: 2}) {
		t.Fatal("cleanup sync")
	}
	// Persist failure still returns the in-memory cleanup counts; LastPersistError
	// is the durable honesty signal (no false "nothing cleaned" zeroing).
	failed := finalizeSQLiteCleanupAfterPersist(RunCleanupResult{RemovedRuns: 3}, errors.New("p"))
	if failed.RemovedRuns != 3 {
		t.Fatalf("cleanup persist fail = %#v, want RemovedRuns retained", failed)
	}
	kept := finalizeSQLiteCleanupAfterPersist(RunCleanupResult{RemovedRuns: 3}, nil)
	if kept.RemovedRuns != 3 {
		t.Fatalf("cleanup persist ok = %#v", kept)
	}

	// Bool write finalize
	run, ok := finalizeSQLiteBoolWrite(Run{ID: "r1"}, false, nil)
	if ok || run.ID != "" {
		t.Fatalf("!ok = %#v ok=%v", run, ok)
	}
	run, ok = finalizeSQLiteBoolWrite(Run{ID: "r1"}, true, errors.New("p"))
	if ok || run.ID != "" {
		t.Fatalf("persist fail = %#v ok=%v", run, ok)
	}
	run, ok = finalizeSQLiteBoolWrite(Run{ID: "r1"}, true, nil)
	if !ok || run.ID != "r1" {
		t.Fatalf("persist ok = %#v ok=%v", run, ok)
	}
	if finalizeSQLiteBoolOK(false, nil) || finalizeSQLiteBoolOK(true, errors.New("p")) || !finalizeSQLiteBoolOK(true, nil) {
		t.Fatal("bool ok finalize")
	}

	// Err write finalize
	profile, err := finalizeSQLiteErrWrite(AgentProfile{ID: "a"}, errors.New("missing"), nil)
	if err == nil || profile.ID != "" {
		t.Fatalf("pre-err = %#v err=%v", profile, err)
	}
	profile, err = finalizeSQLiteErrWrite(AgentProfile{ID: "a"}, nil, errors.New("p"))
	if err == nil || profile.ID != "" {
		t.Fatalf("persist err = %#v err=%v", profile, err)
	}
	profile, err = finalizeSQLiteErrWrite(AgentProfile{ID: "a"}, nil, nil)
	if err != nil || profile.ID != "a" {
		t.Fatalf("ok = %#v err=%v", profile, err)
	}
	if finalizeSQLiteDeleteErr(errors.New("missing"), errors.New("p")).Error() != "missing" {
		t.Fatal("delete pre-err wins")
	}
	if finalizeSQLiteDeleteErr(nil, errors.New("p")) == nil {
		t.Fatal("delete persist err")
	}
	if finalizeSQLiteDeleteErr(nil, nil) != nil {
		t.Fatal("delete ok")
	}

	// Projection payload maps
	oldSnap := fileSnapshot{
		Projects: map[string]Project{"p1": {ID: "p1", Name: "Old"}},
		Runs:     map[string]Run{"r1": {ID: "r1", ProjectID: "p1"}},
	}
	newSnap := fileSnapshot{
		Projects: map[string]Project{"p1": {ID: "p1", Name: "New"}},
		Runs:     map[string]Run{"r1": {ID: "r1", ProjectID: "p1", Status: "started"}},
	}
	payloads := buildRelationalProjectionPayloads(oldSnap, newSnap)
	if len(payloads.OldWorkspaces) != 1 || len(payloads.NewWorkspaces) != 1 {
		t.Fatalf("workspaces %#v %#v", payloads.OldWorkspaces, payloads.NewWorkspaces)
	}
	if len(payloads.OldRuns) != 1 || len(payloads.NewRuns) != 1 {
		t.Fatalf("runs %#v %#v", payloads.OldRuns, payloads.NewRuns)
	}
	if payloads.OldArtifacts == nil || payloads.NewArtifacts == nil ||
		payloads.OldDiffs == nil || payloads.NewDiffs == nil ||
		payloads.OldPreviews == nil || payloads.NewPreviews == nil {
		t.Fatal("nil projection maps")
	}
}
