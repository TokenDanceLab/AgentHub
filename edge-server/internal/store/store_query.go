package store

import (
	"sort"
)

// store_query.go holds pure query/filter builders extracted from store.go.
// Companion pure peels: store_query_domain.go, store_query_maps.go,
// store_query_resolve.go, store_query_plan.go, store_query_snapshot.go.
// No *gorm.DB / IO / mutex ownership.

func defaultNonEmpty(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}

func scopeEquals(filter, value string) bool {
	return filter == "" || value == filter
}

func collectOrdered[T any](order []string, items map[string]T) []T {
	out := make([]T, 0, len(order))
	for _, id := range order {
		out = append(out, items[id])
	}
	return out
}

func filterOrdered[T any](order []string, items map[string]T, keep func(T) bool) []T {
	// Stage small results on the stack instead of allocating for every resident
	// row. Dense results still allocate once, without repeated slice growth or
	// calling keep again for rows already visited.
	var small [16]T
	count := 0
	for index, id := range order {
		item := items[id]
		if !keep(item) {
			continue
		}
		if count < len(small) {
			small[count] = item
			count++
			continue
		}
		out := make([]T, count, len(order))
		copy(out, small[:])
		out = append(out, item)
		for _, remainingID := range order[index+1:] {
			remaining := items[remainingID]
			if keep(remaining) {
				out = append(out, remaining)
			}
		}
		return out
	}
	out := make([]T, count)
	copy(out, small[:count])
	return out
}

func listClonedArtifacts(order []string, items map[string]Artifact, runID string) []Artifact {
	out := filterOrdered(order, items, func(artifact Artifact) bool {
		return scopeEquals(runID, artifact.RunID)
	})
	for i := range out {
		out[i] = cloneArtifact(out[i])
	}
	return out
}

func sortItemsByCreatedAtAsc(items []Item) {
	sort.SliceStable(items, func(i, j int) bool {
		return items[i].CreatedAt < items[j].CreatedAt
	})
}

func sortPinsByPinnedAtDesc(pins []ThreadPin) {
	sort.SliceStable(pins, func(i, j int) bool {
		return pins[i].PinnedAt > pins[j].PinnedAt
	})
}

func selectCurrentUserProfile(order []string, profiles map[string]UserProfile) (UserProfile, bool) {
	for _, id := range order {
		if p := profiles[id]; p.Status == "owner" {
			return p, true
		}
	}
	if len(order) > 0 {
		return profiles[order[0]], true
	}
	return UserProfile{}, false
}

// listThreadsForProject returns threads ordered by order, optionally scoped to projectID.
func listThreadsForProject(order []string, threads map[string]Thread, projectID string) []Thread {
	return filterOrdered(order, threads, func(thread Thread) bool {
		return scopeEquals(projectID, thread.ProjectID)
	})
}

// listRunsForThread returns runs ordered by order, optionally scoped to threadID.
func listRunsForThread(order []string, runs map[string]Run, threadID string) []Run {
	return filterOrdered(order, runs, func(run Run) bool {
		return scopeEquals(threadID, run.ThreadID)
	})
}

// listDiffsForRun returns diff files ordered by order, optionally scoped to runID.
func listDiffsForRun(order []string, diffs map[string]RunDiffFile, runID string) []RunDiffFile {
	return filterOrdered(order, diffs, func(file RunDiffFile) bool {
		return scopeEquals(runID, file.RunID)
	})
}

// listPreviewsForRun returns previews ordered by order, optionally scoped to runID.
func listPreviewsForRun(order []string, previews map[string]Preview, runID string) []Preview {
	return filterOrdered(order, previews, func(preview Preview) bool {
		return scopeEquals(runID, preview.RunID)
	})
}

// listAgentProfilesForAdapter returns agent profiles ordered by order, optionally scoped to adapterID.
func listAgentProfilesForAdapter(order []string, profiles map[string]AgentProfile, adapterID string) []AgentProfile {
	out := filterOrdered(order, profiles, func(profile AgentProfile) bool {
		return scopeEquals(adapterID, profile.AdapterID)
	})
	for i := range out {
		out[i] = cloneAgentProfile(out[i])
	}
	return out
}

// listSortedThreadItems returns items for threadID sorted by CreatedAt ascending.
// Empty threadID matches only items with empty ThreadID (not all items).
func listSortedThreadItems(order []string, items map[string]Item, threadID string) []Item {
	out := filterOrdered(order, items, func(item Item) bool {
		return item.ThreadID == threadID
	})
	sortItemsByCreatedAtAsc(out)
	return out
}

// listSortedThreadPins returns pins for threadID sorted by PinnedAt descending.
func listSortedThreadPins(order []string, pins map[string]ThreadPin, threadID string) []ThreadPin {
	out := filterOrdered(order, pins, func(pin ThreadPin) bool {
		return pin.ThreadID == threadID
	})
	sortPinsByPinnedAtDesc(out)
	return out
}

// lookupByID returns the value for id when present.
func lookupByID[T any](items map[string]T, id string) (T, bool) {
	value, ok := items[id]
	return value, ok
}

// lookupClonedArtifact returns a deep-cloned artifact when present.
func lookupClonedArtifact(artifacts map[string]Artifact, id string) (Artifact, bool) {
	artifact, ok := artifacts[id]
	return cloneArtifact(artifact), ok
}
