package store

import (
	"sort"
	"time"
)

// store_query_plan.go holds pure in-map create/update/upsert/cleanup plan
// helpers extracted from store_query.go. Callers own mutex/IO.

// resolveCleanupNow fills a zero Now with the provided fallback (usually UTC now).
func resolveCleanupNow(now, fallback time.Time) time.Time {
	if now.IsZero() {
		return fallback
	}
	return now
}

// planRunsForCleanup builds terminal candidates and selects runs for deletion.
func planRunsForCleanup(order []string, runs map[string]Run, now time.Time, terminalTTL time.Duration, maxPerThread int) map[string]struct{} {
	candidates := buildTerminalCleanupCandidates(order, runs)
	return selectRunsForCleanup(candidates, now, terminalTTL, maxPerThread)
}

// planRunCleanup normalizes opts.Now then selects terminal runs for cleanup.
func planRunCleanup(order []string, runs map[string]Run, opts RunCleanupOptions, fallbackNow time.Time) map[string]struct{} {
	now := resolveCleanupNow(opts.Now, fallbackNow)
	return planRunsForCleanup(order, runs, now, opts.TerminalTTL, opts.MaxTerminalRunsPerThread)
}

// applyPlannedRunCleanup deletes planned runs/items and builds pin match + result.
// pinMatch is nil when no items were removed.
func applyPlannedRunCleanup(
	runs map[string]Run,
	items map[string]Item,
	runOrder, itemOrder []string,
	removeRuns map[string]struct{},
) (newRunOrder, newItemOrder []string, pinMatch func(ThreadPin) bool, result RunCleanupResult) {
	var removedItemIDs map[string]struct{}
	var removedItems int
	newRunOrder, newItemOrder, removedItemIDs, removedItems = applyRunCleanupMaps(
		runs, items, runOrder, itemOrder, removeRuns,
	)
	if removedItems > 0 {
		pinMatch = pinMatchesRemovedItems(removedItemIDs)
	}
	result = buildRunCleanupResult(len(removeRuns), removedItems)
	return newRunOrder, newItemOrder, pinMatch, result
}

// createProjectInMaps resolves and optionally stores a new project.
func createProjectInMaps(
	projects map[string]Project,
	order []string,
	id, name, ownerID, now string,
) (Project, []string, error) {
	existing, exists := projects[id]
	project, created, err := resolveCreateProject(existing, exists, id, name, ownerID, now)
	return project, putTracked(projects, order, id, project, created), err
}

// createThreadInMaps resolves and optionally stores a new thread.
func createThreadInMaps(
	projects map[string]Project,
	threads map[string]Thread,
	order []string,
	id, projectID, title, kind, avatarColor, avatarLabel, now string,
) (Thread, []string, error) {
	_, projectExists := projects[projectID]
	existing, exists := threads[id]
	thread, created, err := resolveCreateThread(existing, exists, projectExists, id, projectID, title, kind, avatarColor, avatarLabel, now)
	return thread, putTracked(threads, order, id, thread, created), err
}

// createRunInMaps validates refs and optionally stores a queued run.
func createRunInMaps(
	projects map[string]Project,
	threads map[string]Thread,
	runs map[string]Run,
	order []string,
	id, projectID, threadID, now string,
) (Run, []string, error) {
	existing, exists := runs[id]
	refsOK := validateCreateRunRefs(projects, threads, projectID, threadID)
	run, created, err := resolveCreateRun(existing, exists, refsOK, id, projectID, threadID, now)
	return run, putTracked(runs, order, id, run, created), err
}

// createItemInMaps validates refs and optionally stores a prepared item.
func createItemInMaps(
	projects map[string]Project,
	threads map[string]Thread,
	runs map[string]Run,
	items map[string]Item,
	order []string,
	item Item,
	now string,
) (Item, []string, error) {
	existing, exists := items[item.ID]
	refsOK := validateCreateItemRefs(projects, threads, runs, item)
	item, created, err := resolveCreateItem(existing, exists, refsOK, item, now)
	return item, putTracked(items, order, item.ID, item, created), err
}

// createUserProfileInMaps reuses or stores a prepared user profile.
func createUserProfileInMaps(
	profiles map[string]UserProfile,
	order []string,
	profile UserProfile,
	now string,
) (UserProfile, []string) {
	existing, exists := profiles[profile.ID]
	profile, created := resolveCreateUserProfile(existing, exists, profile, now)
	return profile, putTracked(profiles, order, profile.ID, profile, created)
}

// createAgentProfileInMaps validates and optionally stores an agent profile.
func createAgentProfileInMaps(
	profiles map[string]AgentProfile,
	order []string,
	profile AgentProfile,
	now string,
) (AgentProfile, []string, error) {
	_, exists := profiles[profile.ID]
	profile, created, err := resolveCreateAgentProfile(exists, profile, now)
	order = putTracked(profiles, order, profile.ID, cloneAgentProfile(profile), created)
	return cloneAgentProfile(profile), order, err
}

// updateThreadInMaps applies optional title/status when the thread exists.
func updateThreadInMaps(threads map[string]Thread, id string, title, status *string, now string) (Thread, bool) {
	thread, exists := threads[id]
	thread, ok := resolveUpdateThread(thread, exists, title, status, now)
	storeIf(threads, id, thread, ok)
	return thread, ok
}

// setRunStatusInMaps applies status when the run exists.
func setRunStatusInMaps(runs map[string]Run, id, status, now string) (Run, bool) {
	run, exists := runs[id]
	run, ok := resolveSetRunStatus(run, exists, status, now)
	storeIf(runs, id, run, ok)
	return run, ok
}

// setRunStatusIfInMaps applies status when the run exists and current is allowed.
func setRunStatusIfInMaps(runs map[string]Run, id, status string, allowed []string, now string) (Run, bool) {
	run, exists := runs[id]
	run, ok := resolveSetRunStatusIf(run, exists, status, allowed, now)
	storeIf(runs, id, run, ok)
	return run, ok
}

// setRunEvidenceGateInMaps stores gate result when the run exists.
func setRunEvidenceGateInMaps(runs map[string]Run, id, result string) (Run, bool) {
	run, exists := runs[id]
	run, ok := resolveSetRunEvidenceGate(run, exists, result)
	storeIf(runs, id, run, ok)
	return run, ok
}

// setRunRetryCountInMaps updates retry count when the run exists.
func setRunRetryCountInMaps(runs map[string]Run, id string, count int) (Run, bool) {
	run, exists := runs[id]
	run, ok := resolveSetRunRetryCount(run, exists, count)
	storeIf(runs, id, run, ok)
	return run, ok
}

func setRunWorkDirInMaps(runs map[string]Run, id string, workDir string) (Run, bool) {
	run, exists := runs[id]
	run, ok := resolveSetRunWorkDir(run, exists, workDir)
	storeIf(runs, id, run, ok)
	return run, ok
}

// updateAgentProfileInMaps applies a patch when the profile exists.
func updateAgentProfileInMaps(
	profiles map[string]AgentProfile,
	id string,
	patch map[string]any,
	now string,
) (AgentProfile, error) {
	profile, exists := profiles[id]
	profile, err := resolveUpdateAgentProfile(profile, exists, patch, now)
	if err != nil {
		return AgentProfile{}, err
	}
	profiles[id] = cloneAgentProfile(profile)
	return cloneAgentProfile(profile), nil
}

// upsertRunDiffFileInMaps validates, merges, and stores a run diff file.
func upsertRunDiffFileInMaps(
	runs map[string]Run,
	diffs map[string]RunDiffFile,
	order []string,
	file RunDiffFile,
	now string,
) (RunDiffFile, []string, error) {
	_, runExists := runs[file.RunID]
	key, file, ok := prepareRunDiffFileUpsert(runExists, file)
	if !ok {
		return RunDiffFile{}, order, ErrNotFound
	}
	existing, exists := diffs[key]
	file, created := resolveRunDiffFileUpsert(existing, exists, file, now)
	return file, putUpsert(diffs, order, key, file, created), nil
}

// upsertArtifactInMaps validates, stamps, and stores a cloned artifact.
func upsertArtifactInMaps(
	runs map[string]Run,
	artifacts map[string]Artifact,
	order []string,
	artifact Artifact,
	now string,
) (Artifact, []string, error) {
	run, runExists := runs[artifact.RunID]
	var ok bool
	artifact, ok = prepareArtifactForUpsert(run, runExists, artifact)
	if !ok {
		return Artifact{}, order, ErrNotFound
	}
	existing, exists := artifacts[artifact.ID]
	artifact = resolveArtifactUpsert(artifact, existing, exists, now)
	order = putUpsert(artifacts, order, artifact.ID, cloneArtifact(artifact), !exists)
	return cloneArtifact(artifact), order, nil
}

// upsertPreviewInMaps validates, stamps, and stores a preview.
func upsertPreviewInMaps(
	runs map[string]Run,
	previews map[string]Preview,
	order []string,
	preview Preview,
	now string,
) (Preview, []string, error) {
	run, runExists := runs[preview.RunID]
	var ok bool
	preview, ok = preparePreviewForUpsert(run, runExists, preview)
	if !ok {
		return Preview{}, order, ErrNotFound
	}
	existing, exists := previews[preview.ID]
	preview = resolvePreviewUpsert(preview, existing, exists, now)
	return preview, putUpsert(previews, order, preview.ID, preview, !exists), nil
}

// upsertThreadPinInMaps validates refs and upserts a thread pin.
func upsertThreadPinInMaps(
	threads map[string]Thread,
	items map[string]Item,
	pins map[string]ThreadPin,
	order []string,
	threadID, itemID, pinnedBy, now string,
) (ThreadPin, []string, error) {
	if !validatePinThreadItemRefs(threads, items, threadID, itemID) {
		return ThreadPin{}, order, ErrNotFound
	}
	key := threadPinKey(threadID, itemID)
	existing, exists := pins[key]
	pin, created := resolveThreadPinUpsert(existing, exists, threadID, itemID, pinnedBy, now)
	return pin, putUpsert(pins, order, key, pin, created), nil
}

// upsertSettingsInMaps patches settings and returns map, mtime, and cloned view.
func upsertSettingsInMaps(
	settings map[string]string,
	patch map[string]string,
	now string,
) (map[string]string, string, UserSettings) {
	settings, view := applySettingsUpsert(settings, patch, now)
	return settings, now, view
}

// newEmptyStore constructs a Store with empty maps and nil orders.
func newEmptyStore() *Store {
	return &Store{
		projects:      make(map[string]Project),
		threads:       make(map[string]Thread),
		runs:          make(map[string]Run),
		items:         make(map[string]Item),
		pins:          make(map[string]ThreadPin),
		diffs:         make(map[string]RunDiffFile),
		artifacts:     make(map[string]Artifact),
		previews:      make(map[string]Preview),
		checkpoints:   make(map[string]RunCheckpoint),
		userProfiles:  make(map[string]UserProfile),
		agentProfiles: make(map[string]AgentProfile),
		settings:      make(map[string]string),
	}
}

// runCleanupCandidate is a pure view of a terminal run used by cleanup selection.
type runCleanupCandidate struct {
	id         string
	threadID   string
	terminalAt time.Time
	hasTime    bool
	order      int
}

func cleanupCandidateLess(left, right runCleanupCandidate) bool {
	if left.hasTime && right.hasTime && !left.terminalAt.Equal(right.terminalAt) {
		return left.terminalAt.After(right.terminalAt)
	}
	if left.hasTime != right.hasTime {
		return left.hasTime
	}
	return left.order > right.order
}

func buildTerminalCleanupCandidates(order []string, runs map[string]Run) []runCleanupCandidate {
	candidates := make([]runCleanupCandidate, 0, len(order))
	for idx, id := range order {
		run, ok := runs[id]
		if !ok || !isTerminalRunStatus(run.Status) {
			continue
		}
		terminalAt, hasTime := runTerminalTime(run)
		candidates = append(candidates, runCleanupCandidate{
			id:         id,
			threadID:   run.ThreadID,
			terminalAt: terminalAt,
			hasTime:    hasTime,
			order:      idx,
		})
	}
	return candidates
}

func selectRunsForCleanup(candidates []runCleanupCandidate, now time.Time, terminalTTL time.Duration, maxPerThread int) map[string]struct{} {
	removeRuns := map[string]struct{}{}
	if terminalTTL > 0 {
		cutoff := now.Add(-terminalTTL)
		for _, candidate := range candidates {
			if candidate.hasTime && !candidate.terminalAt.After(cutoff) {
				removeRuns[candidate.id] = struct{}{}
			}
		}
	}
	if maxPerThread <= 0 {
		return removeRuns
	}

	byThread := make(map[string][]runCleanupCandidate)
	for _, candidate := range candidates {
		if _, deleting := removeRuns[candidate.id]; deleting {
			continue
		}
		byThread[candidate.threadID] = append(byThread[candidate.threadID], candidate)
	}
	for _, threadRuns := range byThread {
		sort.SliceStable(threadRuns, func(i, j int) bool {
			return cleanupCandidateLess(threadRuns[i], threadRuns[j])
		})
		if len(threadRuns) <= maxPerThread {
			continue
		}
		for _, candidate := range threadRuns[maxPerThread:] {
			removeRuns[candidate.id] = struct{}{}
		}
	}
	return removeRuns
}
