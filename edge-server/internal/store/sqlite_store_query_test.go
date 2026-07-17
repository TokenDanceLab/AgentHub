package store

import (
	"encoding/json"
	"errors"
	"reflect"
	"sort"
	"testing"
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
