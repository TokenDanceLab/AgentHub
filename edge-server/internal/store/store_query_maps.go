package store

// store_query_maps.go holds pure map/order collection, tracked put/delete,
// prune, and scoped lookup helpers extracted from store_query.go.

// collectItemIDsForRemovedRuns returns item IDs whose RunID is in removeRuns.
func collectItemIDsForRemovedRuns(items map[string]Item, removeRuns map[string]struct{}) map[string]struct{} {
	removed := make(map[string]struct{})
	for id, item := range items {
		if _, remove := removeRuns[item.RunID]; remove {
			removed[id] = struct{}{}
		}
	}
	return removed
}

// collectKeysByRunID returns map keys whose value's run id matches runID.
func collectKeysByRunID[T any](items map[string]T, runID string, runOf func(T) string) map[string]struct{} {
	keys := make(map[string]struct{})
	for id, item := range items {
		if runOf(item) == runID {
			keys[id] = struct{}{}
		}
	}
	return keys
}

// collectKeysByThreadID returns map keys whose value's thread id matches threadID.
func collectKeysByThreadID[T any](items map[string]T, threadID string, threadOf func(T) string) map[string]struct{} {
	keys := make(map[string]struct{})
	for id, item := range items {
		if threadOf(item) == threadID {
			keys[id] = struct{}{}
		}
	}
	return keys
}

// orderWithoutRemoved drops any id present in remove from order, preserving relative order.
func orderWithoutRemoved(order []string, remove map[string]struct{}) []string {
	return filterIDs(order, func(id string) bool {
		_, drop := remove[id]
		return !drop
	})
}

// orderKeepPresent keeps only ids that still exist in items.
func orderKeepPresent[T any](order []string, items map[string]T) []string {
	return filterIDs(order, func(id string) bool {
		_, ok := items[id]
		return ok
	})
}

// lookupThreadInProject returns the thread when it exists and belongs to projectID.
func lookupThreadInProject(threads map[string]Thread, threadID, projectID string) (Thread, bool) {
	thread, ok := threads[threadID]
	if !ok || thread.ProjectID != projectID {
		return Thread{}, false
	}
	return thread, true
}

// lookupRunInThread returns the run when it exists and belongs to threadID.
func lookupRunInThread(runs map[string]Run, runID, threadID string) (Run, bool) {
	run, ok := runs[runID]
	if !ok || run.ThreadID != threadID {
		return Run{}, false
	}
	return run, true
}

// lookupItemInThread returns the item when it exists and belongs to threadID.
func lookupItemInThread(items map[string]Item, itemID, threadID string) (Item, bool) {
	item, ok := items[itemID]
	if !ok || item.ThreadID != threadID {
		return Item{}, false
	}
	return item, true
}

// existingThreadConflict reports whether an already-stored thread may be reused for projectID.
// ok is false when the thread belongs to a different project.
func existingThreadConflict(existing Thread, projectID string) bool {
	return existing.ProjectID != projectID
}

// collectRunEvidenceKeys returns evidence map keys scoped to a single run.
func collectRunEvidenceKeys(
	diffs map[string]RunDiffFile,
	artifacts map[string]Artifact,
	previews map[string]Preview,
	runID string,
) (diffKeys, artifactKeys, previewKeys map[string]struct{}) {
	diffKeys = collectKeysByRunID(diffs, runID, func(file RunDiffFile) string { return file.RunID })
	artifactKeys = collectKeysByRunID(artifacts, runID, func(artifact Artifact) string { return artifact.RunID })
	previewKeys = collectKeysByRunID(previews, runID, func(preview Preview) string { return preview.RunID })
	return diffKeys, artifactKeys, previewKeys
}

// deleteMapKeys removes every key present in keys from items.
func deleteMapKeys[T any](items map[string]T, keys map[string]struct{}) {
	for id := range keys {
		delete(items, id)
	}
}

// collectMatchingPinKeys returns pin map keys for which match returns true.
func collectMatchingPinKeys(pins map[string]ThreadPin, match func(ThreadPin) bool) map[string]struct{} {
	keys := make(map[string]struct{})
	for id, pin := range pins {
		if match(pin) {
			keys[id] = struct{}{}
		}
	}
	return keys
}

// putTracked stores value and appends id to order when created is true.
// When created is false the maps/order are left unchanged.
func putTracked[T any](items map[string]T, order []string, id string, value T, created bool) []string {
	if !created {
		return order
	}
	items[id] = value
	return append(order, id)
}

// putUpsert always stores value and appends id to order only on first create.
func putUpsert[T any](items map[string]T, order []string, id string, value T, created bool) []string {
	items[id] = value
	if created {
		return append(order, id)
	}
	return order
}

// deleteTracked removes id from items and order when present.
func deleteTracked[T any](items map[string]T, order []string, id string) ([]string, bool) {
	if _, ok := items[id]; !ok {
		return order, false
	}
	delete(items, id)
	return removeString(order, id), true
}

// collectThreadOwnedKeys returns run and item keys owned by threadID.
func collectThreadOwnedKeys(runs map[string]Run, items map[string]Item, threadID string) (runIDs, itemIDs map[string]struct{}) {
	runIDs = collectKeysByThreadID(runs, threadID, func(run Run) string { return run.ThreadID })
	itemIDs = collectKeysByThreadID(items, threadID, func(item Item) string { return item.ThreadID })
	return runIDs, itemIDs
}

// pruneMatchingPins deletes pins matching match and returns the compacted order.
func pruneMatchingPins(pins map[string]ThreadPin, order []string, match func(ThreadPin) bool) []string {
	if len(pins) == 0 {
		return order
	}
	deleteMapKeys(pins, collectMatchingPinKeys(pins, match))
	return orderKeepPresent(order, pins)
}

// pruneRunEvidence deletes evidence scoped to runID and returns compacted orders.
func pruneRunEvidence(
	diffs map[string]RunDiffFile,
	artifacts map[string]Artifact,
	previews map[string]Preview,
	diffOrder, artifactOrder, previewOrder []string,
	runID string,
) (newDiffOrder, newArtifactOrder, newPreviewOrder []string) {
	diffKeys, artifactKeys, previewKeys := collectRunEvidenceKeys(diffs, artifacts, previews, runID)
	deleteMapKeys(diffs, diffKeys)
	deleteMapKeys(artifacts, artifactKeys)
	deleteMapKeys(previews, previewKeys)
	return orderKeepPresent(diffOrder, diffs),
		orderKeepPresent(artifactOrder, artifacts),
		orderKeepPresent(previewOrder, previews)
}

// pinMatchesThread reports whether a pin belongs to threadID.
func pinMatchesThread(threadID string) func(ThreadPin) bool {
	return func(pin ThreadPin) bool {
		return pin.ThreadID == threadID
	}
}

// pinMatchesRemovedItems reports whether a pin's item was removed.
func pinMatchesRemovedItems(removedItemIDs map[string]struct{}) func(ThreadPin) bool {
	return func(pin ThreadPin) bool {
		_, removed := removedItemIDs[pin.ItemID]
		return removed
	}
}

// storeIf writes value into items when ok is true.
func storeIf[T any](items map[string]T, id string, value T, ok bool) {
	if ok {
		items[id] = value
	}
}

// applyDeleteThreadOwnedMaps deletes runs/items identified by runIDs/itemIDs and returns orders.
func applyDeleteThreadOwnedMaps(
	runs map[string]Run,
	items map[string]Item,
	runOrder, itemOrder []string,
	runIDs, itemIDs map[string]struct{},
) (newRunOrder, newItemOrder []string) {
	deleteMapKeys(runs, runIDs)
	newRunOrder = orderWithoutRemoved(runOrder, runIDs)
	deleteMapKeys(items, itemIDs)
	newItemOrder = orderWithoutRemoved(itemOrder, itemIDs)
	return newRunOrder, newItemOrder
}
