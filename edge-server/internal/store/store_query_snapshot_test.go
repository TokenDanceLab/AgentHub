package store

import (
	"reflect"
	"testing"
)

func TestBuildAndMaterializeFileSnapshot(t *testing.T) {
	t.Parallel()
	projects := map[string]Project{"p1": {ID: "p1", Name: "Local"}}
	threads := map[string]Thread{"t1": {ID: "t1", ProjectID: "p1"}}
	runs := map[string]Run{"r1": {ID: "r1", ThreadID: "t1"}}
	items := map[string]Item{"i1": {ID: "i1", ThreadID: "t1"}}
	pins := map[string]ThreadPin{"pin": {ThreadID: "t1", ItemID: "i1"}}
	diffs := map[string]RunDiffFile{"d1": {RunID: "r1", Path: "a.go"}}
	artifacts := map[string]Artifact{
		"a1": {
			ID:            "a1",
			RunID:         "r1",
			ContentSource: &ArtifactContentSource{Kind: "path", Path: "out.txt", Readable: true},
		},
	}
	previews := map[string]Preview{"pv1": {ID: "pv1", RunID: "r1"}}
	userProfiles := map[string]UserProfile{"u1": {ID: "u1", DisplayName: "Owner"}}
	agentProfiles := map[string]AgentProfile{"ag1": {ID: "ag1", Name: "Coder"}}
	settings := map[string]string{"theme": "dark"}

	snap := buildFileSnapshot(
		projects, threads, runs, items, pins, diffs, artifacts, previews, map[string]RunCheckpoint{"r1": {ID: "cp1", RunID: "r1", Files: []CheckpointFile{{Path: "a.txt", Size: 1, Hash: "h", Content: "x"}}}}, userProfiles, agentProfiles,
		[]string{"p1"}, []string{"t1"}, []string{"r1"}, []string{"i1"}, []string{"pin"},
		[]string{"d1"}, []string{"a1"}, []string{"pv1"}, []string{"u1"}, []string{"ag1"},
		settings, "mtime",
	)
	if snap.SettingsMtime != "mtime" || snap.Settings["theme"] != "dark" {
		t.Fatalf("buildFileSnapshot settings = %#v", snap)
	}
	// Isolation: mutating source maps/settings must not affect snapshot.
	projects["p1"] = Project{ID: "p1", Name: "mutated"}
	settings["theme"] = "light"
	artifacts["a1"].ContentSource.Path = "mutated.txt"
	if snap.Projects["p1"].Name != "Local" || snap.Settings["theme"] != "dark" {
		t.Fatalf("buildFileSnapshot failed to isolate maps: %#v", snap)
	}
	if snap.Artifacts["a1"].ContentSource == nil || snap.Artifacts["a1"].ContentSource.Path != "out.txt" {
		t.Fatalf("buildFileSnapshot failed to clone artifact content source: %#v", snap.Artifacts["a1"])
	}

	// materialize should normalize orders (drop missing, append unseen sorted).
	snap.ProjectOrder = []string{"missing", "p1"}
	snap.Projects["p2"] = Project{ID: "p2", Name: "Extra"}
	gotProjects, gotThreads, gotRuns, gotItems, gotPins, gotDiffs, gotArtifacts, gotPreviews, gotCheckpoints, gotUsers, gotAgents,
		projectOrder, threadOrder, runOrder, itemOrder, pinOrder, diffOrder, artifactOrder, previewOrder, userOrder, agentOrder,
		gotSettings, gotSettingsMtime :=
		materializeFileSnapshot(snap)
	if len(gotProjects) != 2 || gotProjects["p1"].Name != "Local" || gotProjects["p2"].Name != "Extra" {
		t.Fatalf("materialize projects = %#v", gotProjects)
	}
	if cp, ok := gotCheckpoints["r1"]; !ok || cp.ID != "cp1" || len(cp.Files) != 1 || cp.Files[0].Path != "a.txt" {
		t.Fatalf("materialize checkpoints = %#v", gotCheckpoints)
	}
	if !reflect.DeepEqual(projectOrder, []string{"p1", "p2"}) {
		t.Fatalf("materialize projectOrder = %#v", projectOrder)
	}
	if len(gotThreads) != 1 || len(gotRuns) != 1 || len(gotItems) != 1 || len(gotPins) != 1 {
		t.Fatalf("materialize entity counts unexpected")
	}
	if len(gotDiffs) != 1 || len(gotArtifacts) != 1 || len(gotPreviews) != 1 || len(gotUsers) != 1 || len(gotAgents) != 1 {
		t.Fatalf("materialize evidence/profile counts unexpected")
	}
	if len(threadOrder) != 1 || len(runOrder) != 1 || len(itemOrder) != 1 || len(pinOrder) != 1 {
		t.Fatalf("materialize core orders unexpected")
	}
	if len(diffOrder) != 1 || len(artifactOrder) != 1 || len(previewOrder) != 1 || len(userOrder) != 1 || len(agentOrder) != 1 {
		t.Fatalf("materialize residual orders unexpected")
	}
	if gotSettingsMtime != "mtime" || gotSettings["theme"] != "dark" {
		t.Fatalf("materialize settings = %#v mtime=%q, want theme=dark mtime=mtime", gotSettings, gotSettingsMtime)
	}
	// Settings isolation on materialize.
	snap.Settings["theme"] = "mutated"
	if gotSettings["theme"] != "dark" {
		t.Fatalf("materializeFileSnapshot failed to clone settings: %#v", gotSettings)
	}
	// Artifact content source isolation on materialize.
	snap.Artifacts["a1"].ContentSource.Path = "again.txt"
	if gotArtifacts["a1"].ContentSource.Path != "out.txt" {
		t.Fatalf("materializeFileSnapshot failed to clone artifact: %#v", gotArtifacts["a1"])
	}
}
