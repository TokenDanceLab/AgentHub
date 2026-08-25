package store

// store_query_resolve.go holds pure create/update/upsert resolve helpers
// and ref validators extracted from store_query.go.

// resolveRunDiffFileUpsert merges an update or stamps a create. created is true on first insert.
func resolveRunDiffFileUpsert(existing RunDiffFile, exists bool, file RunDiffFile, now string) (RunDiffFile, bool) {
	if exists {
		return mergeRunDiffFileUpdate(existing, file, now), false
	}
	return stampRunDiffFileCreate(file, now), true
}

// resolveArtifactUpsert stamps create/update timestamps for an artifact upsert.
func resolveArtifactUpsert(artifact, existing Artifact, exists bool, now string) Artifact {
	if exists {
		return stampArtifactUpsert(artifact, existing.CreatedAt, true, now)
	}
	return stampArtifactUpsert(artifact, "", false, now)
}

// resolvePreviewUpsert stamps create/update timestamps for a preview upsert.
func resolvePreviewUpsert(preview, existing Preview, exists bool, now string) Preview {
	if exists {
		return stampPreviewUpsert(preview, existing.CreatedAt, true, now)
	}
	return stampPreviewUpsert(preview, "", false, now)
}

// resolveThreadPinUpsert touches an existing pin or builds a new one. created is true on first insert.
func resolveThreadPinUpsert(existing ThreadPin, exists bool, threadID, itemID, pinnedBy, now string) (ThreadPin, bool) {
	if exists {
		return touchThreadPin(existing, pinnedBy, now), false
	}
	return buildThreadPin(threadID, itemID, pinnedBy, now), true
}

// validateCreateRunRefs checks project/thread references for CreateRun.
func validateCreateRunRefs(projects map[string]Project, threads map[string]Thread, projectID, threadID string) bool {
	if _, ok := projects[projectID]; !ok {
		return false
	}
	if !lookupThreadInProject(threads, threadID, projectID) {
		return false
	}
	return true
}

// validateCreateItemRefs checks project/thread/run references for CreateItem.
func validateCreateItemRefs(
	projects map[string]Project,
	threads map[string]Thread,
	runs map[string]Run,
	item Item,
) bool {
	if _, ok := projects[item.ProjectID]; !ok {
		return false
	}
	if !lookupThreadInProject(threads, item.ThreadID, item.ProjectID) {
		return false
	}
	if item.RunID != "" {
		if !lookupRunInThread(runs, item.RunID, item.ThreadID) {
			return false
		}
	}
	return true
}

// resolveCreateProject returns a new project, or the existing one with ErrProjectExists.
// created is true only when the new project should be stored.
func resolveCreateProject(existing Project, exists bool, id, name, ownerID, now string) (Project, bool, error) {
	if exists {
		return existing, false, ErrProjectExists
	}
	return buildProject(id, name, ownerID, now), true, nil
}

// resolveCreateThread decides create vs reuse vs conflict for CreateThread.
// created is true when a new thread value should be stored.
func resolveCreateThread(
	existing Thread,
	exists bool,
	projectExists bool,
	id, projectID, title, kind, avatarColor, avatarLabel, now string,
) (Thread, bool, error) {
	if !projectExists {
		return Thread{}, false, ErrNotFound
	}
	if exists {
		if existingThreadConflict(existing, projectID) {
			return Thread{}, false, errThreadExistsInProject(id, existing.ProjectID)
		}
		return existing, false, nil
	}
	return buildThread(id, projectID, title, kind, avatarColor, avatarLabel, now), true, nil
}

// resolveCreateRun returns existing reuse or a new queued run.
// created is true when a new run should be stored.
func resolveCreateRun(existing Run, exists bool, refsOK bool, id, projectID, threadID, now string) (Run, bool, error) {
	if !refsOK {
		return Run{}, false, ErrNotFound
	}
	if exists {
		return existing, false, nil
	}
	return buildQueuedRun(id, projectID, threadID, now), true, nil
}

// resolveCreateItem returns existing reuse or a prepared new item.
// created is true when a new item should be stored.
func resolveCreateItem(existing Item, exists bool, refsOK bool, item Item, now string) (Item, bool, error) {
	if !refsOK {
		return Item{}, false, ErrNotFound
	}
	if exists {
		return existing, false, nil
	}
	return prepareItemDefaults(item, now), true, nil
}

// resolveCreateUserProfile returns existing reuse or a prepared new profile.
// created is true when a new profile should be stored.
func resolveCreateUserProfile(existing UserProfile, exists bool, profile UserProfile, now string) (UserProfile, bool) {
	if exists {
		return existing, false
	}
	return prepareUserProfileCreate(profile, now), true
}

// resolveCreateAgentProfile validates and prepares agent profile create.
// created is true when a new profile should be stored.
func resolveCreateAgentProfile(exists bool, profile AgentProfile, now string) (AgentProfile, bool, error) {
	if err := validateAgentProfileCreate(profile); err != nil {
		return AgentProfile{}, false, err
	}
	if exists {
		return AgentProfile{}, false, errAgentProfileExists(profile.ID)
	}
	return prepareAgentProfileCreate(profile, now), true, nil
}

// applySettingsUpsert patches settings and returns the updated map plus cloned view.
func applySettingsUpsert(settings map[string]string, patch map[string]string, now string) (map[string]string, UserSettings) {
	settings = ensureSettingsMap(settings)
	applySettingsPatch(settings, patch)
	return settings, cloneUserSettings(settings, now)
}

// applyRunCleanupMaps deletes selected runs/items and returns updated orders + counts.
// Evidence pruning is the caller's responsibility (via pruneRunEvidence / removeRunEvidence).
func applyRunCleanupMaps(
	runs map[string]Run,
	items map[string]Item,
	runOrder, itemOrder []string,
	removeRuns map[string]struct{},
) (newRunOrder, newItemOrder []string, removedItemIDs map[string]struct{}, removedItems int) {
	deleteMapKeys(runs, removeRuns)
	newRunOrder = orderWithoutRemoved(runOrder, removeRuns)
	removedItemIDs = collectItemIDsForRemovedRuns(items, removeRuns)
	deleteMapKeys(items, removedItemIDs)
	removedItems = len(removedItemIDs)
	if removedItems > 0 {
		newItemOrder = orderKeepPresent(itemOrder, items)
	} else {
		newItemOrder = itemOrder
	}
	return newRunOrder, newItemOrder, removedItemIDs, removedItems
}

// resolveUpdateThread applies optional title/status when the thread exists.
func resolveUpdateThread(thread Thread, exists bool, title, status *string, now string) (Thread, bool) {
	if !exists {
		return Thread{}, false
	}
	return applyThreadUpdate(thread, title, status, now), true
}

// resolveSetRunStatus applies status when the run exists.
func resolveSetRunStatus(run Run, exists bool, status, now string) (Run, bool) {
	if !exists {
		return Run{}, false
	}
	return applyRunStatus(run, status, now), true
}

// resolveSetRunStatusIf applies status when the run exists and current is allowed.
// When exists but not allowed, returns the unchanged run with applied=false.
func resolveSetRunStatusIf(run Run, exists bool, status string, allowed []string, now string) (Run, bool) {
	if !exists {
		return Run{}, false
	}
	if !isAllowedCurrentStatus(run.Status, allowed) {
		return run, false
	}
	return applyRunStatus(run, status, now), true
}

// resolveSetRunEvidenceGate stores gate result when the run exists.
func resolveSetRunEvidenceGate(run Run, exists bool, result string) (Run, bool) {
	if !exists {
		return Run{}, false
	}
	return applyRunEvidenceGate(run, result), true
}

// resolveSetRunRetryCount updates retry count when the run exists.
func resolveSetRunRetryCount(run Run, exists bool, count int) (Run, bool) {
	if !exists {
		return Run{}, false
	}
	return applyRunRetryCount(run, count), true
}

// resolveSetRunWorkDir records the executor-resolved workdir when the run exists.
func resolveSetRunWorkDir(run Run, exists bool, workDir string) (Run, bool) {
	if !exists {
		return Run{}, false
	}
	return applyRunWorkDir(run, workDir), true
}

// prepareRunDiffFileUpsert validates run existence and normalizes path/status.
// ok is false when the run is missing or the normalized path is empty.
func prepareRunDiffFileUpsert(runExists bool, file RunDiffFile) (key string, prepared RunDiffFile, ok bool) {
	if !runExists {
		return "", RunDiffFile{}, false
	}
	file = normalizeRunDiffFileInput(file)
	if file.Path == "" {
		return "", RunDiffFile{}, false
	}
	return runDiffFileKey(file.RunID, file.Path), file, true
}

// prepareArtifactForUpsert validates the run and prepares artifact input for upsert.
func prepareArtifactForUpsert(run Run, runExists bool, artifact Artifact) (Artifact, bool) {
	if !runExists {
		return Artifact{}, false
	}
	return prepareArtifactInput(artifact, run.ThreadID)
}

// preparePreviewForUpsert validates the run and prepares preview input for upsert.
func preparePreviewForUpsert(run Run, runExists bool, preview Preview) (Preview, bool) {
	if !runExists {
		return Preview{}, false
	}
	return preparePreviewInput(preview, run.ThreadID)
}

// validatePinThreadItemRefs checks that thread exists and item belongs to it.
func validatePinThreadItemRefs(threads map[string]Thread, items map[string]Item, threadID, itemID string) bool {
	if _, ok := threads[threadID]; !ok {
		return false
	}
	if !lookupItemInThread(items, itemID, threadID) {
		return false
	}
	return true
}

// resolveUpdateAgentProfile applies a patch when the profile exists.
func resolveUpdateAgentProfile(profile AgentProfile, exists bool, patch map[string]any, now string) (AgentProfile, error) {
	if !exists {
		return AgentProfile{}, ErrNotFound
	}
	return touchAgentProfile(applyAgentProfilePatch(profile, patch), now), nil
}

// errIfMissing maps a missing delete/lookup result to ErrNotFound.
func errIfMissing(ok bool) error {
	if !ok {
		return ErrNotFound
	}
	return nil
}
