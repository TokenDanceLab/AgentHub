package store

import (
	"reflect"
	"testing"
	"time"
)

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
	if !lookupThreadInProject(threads, "t1", "p1") {
		t.Fatal("lookupThreadInProject match should succeed")
	}
	if lookupThreadInProject(threads, "t1", "p2") {
		t.Fatal("lookupThreadInProject project mismatch should fail")
	}
	if lookupThreadInProject(threads, "missing", "p1") {
		t.Fatal("lookupThreadInProject missing should fail")
	}

	runs := map[string]Run{
		"r1": {ID: "r1", ThreadID: "t1"},
	}
	if !lookupRunInThread(runs, "r1", "t1") {
		t.Fatal("lookupRunInThread match should succeed")
	}
	if lookupRunInThread(runs, "r1", "t2") {
		t.Fatal("lookupRunInThread thread mismatch should fail")
	}

	items := map[string]Item{
		"i1": {ID: "i1", ThreadID: "t1"},
	}
	if !lookupItemInThread(items, "i1", "t1") {
		t.Fatal("lookupItemInThread match should succeed")
	}
	if lookupItemInThread(items, "i1", "t2") {
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

func TestDeleteMapKeysAndMatchingPins(t *testing.T) {
	t.Parallel()
	items := map[string]int{"a": 1, "b": 2, "c": 3}
	deleteMapKeys(items, map[string]struct{}{"a": {}, "c": {}, "z": {}})
	if len(items) != 1 || items["b"] != 2 {
		t.Fatalf("deleteMapKeys = %#v", items)
	}

	pins := map[string]ThreadPin{
		"p1": {ThreadID: "t1", ItemID: "i1"},
		"p2": {ThreadID: "t2", ItemID: "i2"},
		"p3": {ThreadID: "t1", ItemID: "i3"},
	}
	keys := collectMatchingPinKeys(pins, func(pin ThreadPin) bool {
		return pin.ThreadID == "t1"
	})
	if len(keys) != 2 {
		t.Fatalf("collectMatchingPinKeys = %#v", keys)
	}
	if _, ok := keys["p1"]; !ok {
		t.Fatalf("missing p1 in %#v", keys)
	}
	if _, ok := keys["p3"]; !ok {
		t.Fatalf("missing p3 in %#v", keys)
	}
}

func TestPutTrackedAndPutUpsert(t *testing.T) {
	t.Parallel()
	items := map[string]int{}
	order := []string{}

	order = putTracked(items, order, "a", 1, false)
	if len(items) != 0 || len(order) != 0 {
		t.Fatalf("putTracked false should no-op: items=%#v order=%#v", items, order)
	}
	order = putTracked(items, order, "a", 1, true)
	if items["a"] != 1 || !reflect.DeepEqual(order, []string{"a"}) {
		t.Fatalf("putTracked true = items=%#v order=%#v", items, order)
	}

	order = putUpsert(items, order, "a", 9, false)
	if items["a"] != 9 || !reflect.DeepEqual(order, []string{"a"}) {
		t.Fatalf("putUpsert update = items=%#v order=%#v", items, order)
	}
	order = putUpsert(items, order, "b", 2, true)
	if items["b"] != 2 || !reflect.DeepEqual(order, []string{"a", "b"}) {
		t.Fatalf("putUpsert create = items=%#v order=%#v", items, order)
	}
}

func TestDeleteTracked(t *testing.T) {
	t.Parallel()
	items := map[string]string{"a": "1", "b": "2"}
	order := []string{"a", "b"}

	order, ok := deleteTracked(items, order, "missing")
	if ok || !reflect.DeepEqual(order, []string{"a", "b"}) || len(items) != 2 {
		t.Fatalf("deleteTracked missing = ok=%v order=%#v items=%#v", ok, order, items)
	}
	order, ok = deleteTracked(items, order, "a")
	if !ok || !reflect.DeepEqual(order, []string{"b"}) || len(items) != 1 {
		t.Fatalf("deleteTracked a = ok=%v order=%#v items=%#v", ok, order, items)
	}
	if _, still := items["a"]; still {
		t.Fatal("deleteTracked left key a")
	}
}

func TestCollectThreadOwnedKeys(t *testing.T) {
	t.Parallel()
	runs := map[string]Run{
		"r1": {ID: "r1", ThreadID: "t1"},
		"r2": {ID: "r2", ThreadID: "t2"},
	}
	items := map[string]Item{
		"i1": {ID: "i1", ThreadID: "t1"},
		"i2": {ID: "i2", ThreadID: "t1"},
		"i3": {ID: "i3", ThreadID: "t9"},
	}
	runIDs, itemIDs := collectThreadOwnedKeys(runs, items, "t1")
	if len(runIDs) != 1 {
		t.Fatalf("runIDs = %#v", runIDs)
	}
	if _, ok := runIDs["r1"]; !ok {
		t.Fatalf("missing r1 in %#v", runIDs)
	}
	if len(itemIDs) != 2 {
		t.Fatalf("itemIDs = %#v", itemIDs)
	}
	if _, ok := itemIDs["i1"]; !ok {
		t.Fatalf("missing i1 in %#v", itemIDs)
	}
	if _, ok := itemIDs["i2"]; !ok {
		t.Fatalf("missing i2 in %#v", itemIDs)
	}
}

func TestPruneMatchingPinsAndRunEvidence(t *testing.T) {
	t.Parallel()
	pins := map[string]ThreadPin{
		"p1": {ThreadID: "t1", ItemID: "i1"},
		"p2": {ThreadID: "t2", ItemID: "i2"},
	}
	pinOrder := []string{"p1", "p2"}
	pinOrder = pruneMatchingPins(pins, pinOrder, pinMatchesThread("t1"))
	if len(pins) != 1 || pins["p2"].ThreadID != "t2" || !reflect.DeepEqual(pinOrder, []string{"p2"}) {
		t.Fatalf("pruneMatchingPins = pins=%#v order=%#v", pins, pinOrder)
	}
	// empty pins early return
	emptyOrder := []string{"x"}
	emptyOrder = pruneMatchingPins(map[string]ThreadPin{}, emptyOrder, pinMatchesThread("t1"))
	if !reflect.DeepEqual(emptyOrder, []string{"x"}) {
		t.Fatalf("empty pruneMatchingPins changed order: %#v", emptyOrder)
	}

	diffs := map[string]RunDiffFile{
		"d1": {RunID: "r1", Path: "a.go"},
		"d2": {RunID: "r2", Path: "b.go"},
	}
	artifacts := map[string]Artifact{
		"a1": {ID: "a1", RunID: "r1"},
		"a2": {ID: "a2", RunID: "r9"},
	}
	previews := map[string]Preview{
		"pv1": {ID: "pv1", RunID: "r1"},
		"pv2": {ID: "pv2", RunID: "r2"},
	}
	diffOrder, artifactOrder, previewOrder := pruneRunEvidence(
		diffs, artifacts, previews,
		[]string{"d1", "d2"}, []string{"a1", "a2"}, []string{"pv1", "pv2"},
		"r1",
	)
	if len(diffs) != 1 || len(artifacts) != 1 || len(previews) != 1 {
		t.Fatalf("pruneRunEvidence maps = diffs=%#v arts=%#v previews=%#v", diffs, artifacts, previews)
	}
	if !reflect.DeepEqual(diffOrder, []string{"d2"}) || !reflect.DeepEqual(artifactOrder, []string{"a2"}) || !reflect.DeepEqual(previewOrder, []string{"pv2"}) {
		t.Fatalf("pruneRunEvidence orders = %#v %#v %#v", diffOrder, artifactOrder, previewOrder)
	}
}

func TestApplyRunCleanupMapsAndPinMatchers(t *testing.T) {
	t.Parallel()
	runs := map[string]Run{
		"r1": {ID: "r1", ThreadID: "t1"},
		"r2": {ID: "r2", ThreadID: "t1"},
	}
	items := map[string]Item{
		"i1": {ID: "i1", RunID: "r1"},
		"i2": {ID: "i2", RunID: "r2"},
		"i3": {ID: "i3", RunID: "keep"},
	}
	runOrder := []string{"r1", "r2"}
	itemOrder := []string{"i1", "i2", "i3"}
	removeRuns := map[string]struct{}{"r1": {}}

	newRunOrder, newItemOrder, removedItemIDs, removedItems := applyRunCleanupMaps(
		runs, items, runOrder, itemOrder, removeRuns,
	)
	if len(runs) != 1 || runs["r2"].ID != "r2" {
		t.Fatalf("runs after cleanup = %#v", runs)
	}
	if !reflect.DeepEqual(newRunOrder, []string{"r2"}) {
		t.Fatalf("newRunOrder = %#v", newRunOrder)
	}
	if removedItems != 1 || len(removedItemIDs) != 1 {
		t.Fatalf("removedItems=%d ids=%#v", removedItems, removedItemIDs)
	}
	if _, ok := items["i1"]; ok {
		t.Fatal("item i1 should be deleted")
	}
	if !reflect.DeepEqual(newItemOrder, []string{"i2", "i3"}) {
		t.Fatalf("newItemOrder = %#v", newItemOrder)
	}

	// No removed items keeps itemOrder pointer-equivalent content.
	runs2 := map[string]Run{"r2": {ID: "r2"}}
	items2 := map[string]Item{"i2": {ID: "i2", RunID: "r2"}}
	_, keptItemOrder, _, removed := applyRunCleanupMaps(
		runs2, items2, []string{"r2"}, []string{"i2"}, map[string]struct{}{"missing": {}},
	)
	if removed != 0 || !reflect.DeepEqual(keptItemOrder, []string{"i2"}) {
		t.Fatalf("no-item cleanup = removed=%d order=%#v", removed, keptItemOrder)
	}

	if !pinMatchesThread("t1")(ThreadPin{ThreadID: "t1"}) {
		t.Fatal("pinMatchesThread true")
	}
	if pinMatchesThread("t1")(ThreadPin{ThreadID: "t2"}) {
		t.Fatal("pinMatchesThread false")
	}
	matchRemoved := pinMatchesRemovedItems(map[string]struct{}{"i1": {}})
	if !matchRemoved(ThreadPin{ItemID: "i1"}) || matchRemoved(ThreadPin{ItemID: "i2"}) {
		t.Fatal("pinMatchesRemovedItems mismatch")
	}
}

func TestStoreIfAndResolveUpdateThread(t *testing.T) {
	t.Parallel()
	items := map[string]int{"a": 1}
	storeIf(items, "b", 2, false)
	if _, ok := items["b"]; ok {
		t.Fatal("storeIf false should no-op")
	}
	storeIf(items, "b", 2, true)
	if items["b"] != 2 {
		t.Fatalf("storeIf true = %#v", items)
	}

	title := "renamed"
	thread, ok := resolveUpdateThread(Thread{ID: "t1", Title: "old"}, false, &title, nil, "now")
	if ok || thread.ID != "" {
		t.Fatalf("missing thread = %#v ok=%v", thread, ok)
	}
	thread, ok = resolveUpdateThread(Thread{ID: "t1", Title: "old", Status: "active"}, true, &title, nil, "now")
	if !ok || thread.Title != "renamed" || thread.UpdatedAt != "now" {
		t.Fatalf("resolveUpdateThread = %#v ok=%v", thread, ok)
	}
}

func TestApplyDeleteThreadOwnedMapsAndPlanCleanup(t *testing.T) {
	t.Parallel()
	runs := map[string]Run{"r1": {ID: "r1"}, "r2": {ID: "r2"}}
	items := map[string]Item{"i1": {ID: "i1"}, "i2": {ID: "i2"}, "i3": {ID: "i3"}}
	runOrder, itemOrder := applyDeleteThreadOwnedMaps(
		runs, items,
		[]string{"r1", "r2"}, []string{"i1", "i2", "i3"},
		map[string]struct{}{"r1": {}},
		map[string]struct{}{"i1": {}, "i2": {}},
	)
	if len(runs) != 1 || runs["r2"].ID != "r2" {
		t.Fatalf("runs = %#v", runs)
	}
	if len(items) != 1 || items["i3"].ID != "i3" {
		t.Fatalf("items = %#v", items)
	}
	if !reflect.DeepEqual(runOrder, []string{"r2"}) || !reflect.DeepEqual(itemOrder, []string{"i3"}) {
		t.Fatalf("orders = %#v %#v", runOrder, itemOrder)
	}

	now := time.Date(2026, 7, 18, 12, 0, 0, 0, time.UTC)
	order := []string{"r1", "r2", "r3"}
	runMap := map[string]Run{
		"r1": {ID: "r1", ThreadID: "t1", Status: "finished", FinishedAt: now.Add(-2 * time.Hour).Format(time.RFC3339)},
		"r2": {ID: "r2", ThreadID: "t1", Status: "finished", FinishedAt: now.Add(-10 * time.Minute).Format(time.RFC3339)},
		"r3": {ID: "r3", ThreadID: "t1", Status: "queued"},
	}
	remove := planRunsForCleanup(order, runMap, now, time.Hour, 1)
	if _, ok := remove["r1"]; !ok {
		t.Fatalf("expected r1 removed by TTL: %#v", remove)
	}
	if _, ok := remove["r2"]; ok {
		t.Fatalf("r2 should remain: %#v", remove)
	}
	if _, ok := remove["r3"]; ok {
		t.Fatalf("queued r3 should remain: %#v", remove)
	}
}
