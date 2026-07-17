package store

import (
	"fmt"
	"sort"
	"strings"
	"time"
)

// store_query.go holds pure query/filter builders, domain mappers, and
// validators extracted from store.go. No *gorm.DB / IO / mutex ownership.

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
	out := make([]T, 0, len(order))
	for _, id := range order {
		item := items[id]
		if keep(item) {
			out = append(out, item)
		}
	}
	return out
}

func listClonedArtifacts(order []string, items map[string]Artifact, runID string) []Artifact {
	out := make([]Artifact, 0, len(order))
	for _, id := range order {
		artifact := cloneArtifact(items[id])
		if scopeEquals(runID, artifact.RunID) {
			out = append(out, artifact)
		}
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

func buildProject(id, name, ownerID, now string) Project {
	return Project{
		ID:        id,
		Name:      defaultNonEmpty(name, "Local Project"),
		Status:    "active",
		OwnerID:   strings.TrimSpace(ownerID),
		CreatedAt: now,
		UpdatedAt: now,
	}
}

func buildThread(id, projectID, title, kind, avatarColor, avatarLabel, now string) Thread {
	return Thread{
		ID:          id,
		ProjectID:   projectID,
		Title:       defaultNonEmpty(title, "New Thread"),
		Kind:        kind,
		AvatarColor: avatarColor,
		AvatarLabel: avatarLabel,
		Status:      "active",
		CreatedAt:   now,
		UpdatedAt:   now,
	}
}

func buildQueuedRun(id, projectID, threadID, now string) Run {
	return Run{
		ID:        id,
		ProjectID: projectID,
		ThreadID:  threadID,
		Status:    "queued",
		CreatedAt: now,
	}
}

func buildUserMessageItem(itemID, projectID, threadID, role, content string) Item {
	return Item{
		ID:        itemID,
		ProjectID: projectID,
		ThreadID:  threadID,
		Type:      "user_message",
		Role:      defaultNonEmpty(strings.TrimSpace(role), "user"),
		Status:    "created",
		Content:   content,
	}
}

func prepareItemDefaults(item Item, now string) Item {
	item.Type = defaultNonEmpty(item.Type, "event")
	item.Status = defaultNonEmpty(item.Status, "created")
	item.CreatedAt = now
	item.UpdatedAt = now
	return item
}

func applyThreadUpdate(thread Thread, title, status *string, now string) Thread {
	if title != nil {
		thread.Title = *title
	}
	if status != nil {
		thread.Status = *status
	}
	thread.UpdatedAt = now
	return thread
}

func applyRunStatus(run Run, status, now string) Run {
	switch status {
	case "started":
		run.StartedAt = now
	case "cancelled", "finished", "failed", "completed_with_issues":
		run.FinishedAt = now
	}
	run.Status = status
	return run
}

func isAllowedCurrentStatus(current string, allowed []string) bool {
	if len(allowed) == 0 {
		return true
	}
	for _, candidate := range allowed {
		if current == candidate {
			return true
		}
	}
	return false
}

func normalizeRunDiffFileInput(file RunDiffFile) RunDiffFile {
	file.Path = strings.TrimSpace(file.Path)
	file.Status = normalizeEvidenceStatus(file.Status)
	return file
}

// bindScopedThreadID fills an empty threadID with runThreadID and validates match.
// ok is false when a non-empty threadID disagrees with the run.
func bindScopedThreadID(threadID, runThreadID string) (string, bool) {
	if threadID == "" {
		return runThreadID, true
	}
	if threadID != runThreadID {
		return "", false
	}
	return threadID, true
}

func prepareArtifactInput(artifact Artifact, runThreadID string) (Artifact, bool) {
	threadID, ok := bindScopedThreadID(artifact.ThreadID, runThreadID)
	if !ok {
		return Artifact{}, false
	}
	artifact.ThreadID = threadID
	artifact.ID = strings.TrimSpace(artifact.ID)
	if artifact.ID == "" {
		return Artifact{}, false
	}
	artifact.Kind = defaultNonEmpty(artifact.Kind, "file")
	artifact.Path = sanitizeArtifactDisplayPath(artifact.Path)
	artifact.ContentSource = normalizeArtifactContentSource(artifact.ContentSource)
	return artifact, true
}

func preparePreviewInput(preview Preview, runThreadID string) (Preview, bool) {
	threadID, ok := bindScopedThreadID(preview.ThreadID, runThreadID)
	if !ok {
		return Preview{}, false
	}
	preview.ThreadID = threadID
	preview.ID = strings.TrimSpace(preview.ID)
	if preview.ID == "" {
		return Preview{}, false
	}
	preview.Status = defaultNonEmpty(preview.Status, "ready")
	return preview, true
}

func applySettingsPatch(settings map[string]string, patch map[string]string) {
	for k, v := range patch {
		key := strings.TrimSpace(k)
		if key == "" {
			continue
		}
		settings[key] = v
	}
}

func defaultAgentProfileName(name string) string {
	return defaultNonEmpty(name, "Unnamed Agent")
}

// applyUpsertTimestamps returns CreatedAt/UpdatedAt for create-or-update paths.
// When exists is true, CreatedAt is preserved and UpdatedAt becomes now.
func applyUpsertTimestamps(existingCreatedAt string, exists bool, now string) (createdAt, updatedAt string) {
	if exists {
		return existingCreatedAt, now
	}
	return now, now
}

func mergeRunDiffFileUpdate(existing, incoming RunDiffFile, now string) RunDiffFile {
	existing.Diff = incoming.Diff
	existing.Status = incoming.Status
	existing.UpdatedAt = now
	return existing
}

func stampRunDiffFileCreate(file RunDiffFile, now string) RunDiffFile {
	file.CreatedAt = now
	file.UpdatedAt = now
	return file
}

func stampArtifactUpsert(artifact Artifact, existingCreatedAt string, exists bool, now string) Artifact {
	artifact.CreatedAt, artifact.UpdatedAt = applyUpsertTimestamps(existingCreatedAt, exists, now)
	return artifact
}

func stampPreviewUpsert(preview Preview, existingCreatedAt string, exists bool, now string) Preview {
	preview.CreatedAt, preview.UpdatedAt = applyUpsertTimestamps(existingCreatedAt, exists, now)
	return preview
}

func buildThreadPin(threadID, itemID, pinnedBy, now string) ThreadPin {
	return ThreadPin{
		ThreadID:  threadID,
		ItemID:    itemID,
		PinnedBy:  strings.TrimSpace(pinnedBy),
		PinnedAt:  now,
		CreatedAt: now,
		UpdatedAt: now,
	}
}

func touchThreadPin(pin ThreadPin, pinnedBy, now string) ThreadPin {
	pin.PinnedBy = strings.TrimSpace(pinnedBy)
	pin.PinnedAt = now
	pin.UpdatedAt = now
	return pin
}

func prepareUserProfileCreate(profile UserProfile, now string) UserProfile {
	profile.CreatedAt = now
	profile.UpdatedAt = now
	return profile
}

func prepareAgentProfileCreate(profile AgentProfile, now string) AgentProfile {
	profile.Name = defaultAgentProfileName(profile.Name)
	if profile.CreatedAt == "" {
		profile.CreatedAt = now
	}
	profile.UpdatedAt = now
	return profile
}

func applyRunEvidenceGate(run Run, result string) Run {
	run.EvidenceGateResult = result
	return run
}

func applyRunRetryCount(run Run, count int) Run {
	run.RetryCount = count
	return run
}

func cloneUserSettings(settings map[string]string, mtime string) UserSettings {
	values := make(map[string]string, len(settings))
	for k, v := range settings {
		values[k] = v
	}
	return UserSettings{
		Values:    values,
		UpdatedAt: mtime,
	}
}

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

func touchAgentProfile(profile AgentProfile, now string) AgentProfile {
	profile.UpdatedAt = now
	return profile
}

func ensureSettingsMap(settings map[string]string) map[string]string {
	if settings == nil {
		return make(map[string]string)
	}
	return settings
}

// resolveCleanupNow fills a zero Now with the provided fallback (usually UTC now).
func resolveCleanupNow(now, fallback time.Time) time.Time {
	if now.IsZero() {
		return fallback
	}
	return now
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
	return filterOrdered(order, profiles, func(profile AgentProfile) bool {
		return scopeEquals(adapterID, profile.AdapterID)
	})
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

// buildRunCleanupResult packages cleanup deletion counts.
func buildRunCleanupResult(removedRuns, removedItems int) RunCleanupResult {
	return RunCleanupResult{
		RemovedRuns:  removedRuns,
		RemovedItems: removedItems,
	}
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

// validateCreateRunRefs checks project/thread references for CreateRun.
func validateCreateRunRefs(projects map[string]Project, threads map[string]Thread, projectID, threadID string) bool {
	if _, ok := projects[projectID]; !ok {
		return false
	}
	if _, ok := lookupThreadInProject(threads, threadID, projectID); !ok {
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
	if _, ok := lookupThreadInProject(threads, item.ThreadID, item.ProjectID); !ok {
		return false
	}
	if item.RunID != "" {
		if _, ok := lookupRunInThread(runs, item.RunID, item.ThreadID); !ok {
			return false
		}
	}
	return true
}

// resolveCreateProject returns a new project, or the existing one with ErrProjectExists.
// created is true only when the new project should be stored.
func resolveCreateProject(existing Project, exists bool, id, name, ownerID, now string) (Project, error, bool) {
	if exists {
		return existing, ErrProjectExists, false
	}
	return buildProject(id, name, ownerID, now), nil, true
}

// resolveCreateThread decides create vs reuse vs conflict for CreateThread.
// created is true when a new thread value should be stored.
func resolveCreateThread(
	existing Thread,
	exists bool,
	projectExists bool,
	id, projectID, title, kind, avatarColor, avatarLabel, now string,
) (Thread, error, bool) {
	if !projectExists {
		return Thread{}, ErrNotFound, false
	}
	if exists {
		if existingThreadConflict(existing, projectID) {
			return Thread{}, errThreadExistsInProject(id, existing.ProjectID), false
		}
		return existing, nil, false
	}
	return buildThread(id, projectID, title, kind, avatarColor, avatarLabel, now), nil, true
}

// resolveCreateRun returns existing reuse or a new queued run.
// created is true when a new run should be stored.
func resolveCreateRun(existing Run, exists bool, refsOK bool, id, projectID, threadID, now string) (Run, error, bool) {
	if !refsOK {
		return Run{}, ErrNotFound, false
	}
	if exists {
		return existing, nil, false
	}
	return buildQueuedRun(id, projectID, threadID, now), nil, true
}

// resolveCreateItem returns existing reuse or a prepared new item.
// created is true when a new item should be stored.
func resolveCreateItem(existing Item, exists bool, refsOK bool, item Item, now string) (Item, error, bool) {
	if !refsOK {
		return Item{}, ErrNotFound, false
	}
	if exists {
		return existing, nil, false
	}
	return prepareItemDefaults(item, now), nil, true
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
func resolveCreateAgentProfile(existing AgentProfile, exists bool, profile AgentProfile, now string) (AgentProfile, error, bool) {
	if err := validateAgentProfileCreate(profile); err != nil {
		return AgentProfile{}, err, false
	}
	if exists {
		return AgentProfile{}, errAgentProfileExists(profile.ID), false
	}
	return prepareAgentProfileCreate(profile, now), nil, true
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

// errThreadExistsInProject is returned when CreateThread collides across projects.
func errThreadExistsInProject(threadID, projectID string) error {
	return fmt.Errorf("thread %q already exists in project %q", threadID, projectID)
}

// errAgentProfileExists is returned when CreateAgentProfile collides on id.
func errAgentProfileExists(id string) error {
	return fmt.Errorf("agent profile %q already exists", id)
}

// buildFileSnapshot deep-copies maps/orders into a durable snapshot value.
func buildFileSnapshot(
	projects map[string]Project,
	threads map[string]Thread,
	runs map[string]Run,
	items map[string]Item,
	pins map[string]ThreadPin,
	diffs map[string]RunDiffFile,
	artifacts map[string]Artifact,
	previews map[string]Preview,
	userProfiles map[string]UserProfile,
	agentProfiles map[string]AgentProfile,
	projectOrder, threadOrder, runOrder, itemOrder, pinOrder, diffOrder, artifactOrder, previewOrder, userProfileOrder, agentProfileOrder []string,
	settings map[string]string,
	settingsMtime string,
) fileSnapshot {
	return fileSnapshot{
		Projects:          copyMap(projects),
		Threads:           copyMap(threads),
		Runs:              copyMap(runs),
		Items:             copyMap(items),
		Pins:              copyMap(pins),
		Diffs:             copyMap(diffs),
		Artifacts:         cloneArtifactMap(artifacts),
		Previews:          copyMap(previews),
		UserProfiles:      copyMap(userProfiles),
		AgentProfiles:     copyMap(agentProfiles),
		ProjectOrder:      append([]string(nil), projectOrder...),
		ThreadOrder:       append([]string(nil), threadOrder...),
		RunOrder:          append([]string(nil), runOrder...),
		ItemOrder:         append([]string(nil), itemOrder...),
		PinOrder:          append([]string(nil), pinOrder...),
		DiffOrder:         append([]string(nil), diffOrder...),
		ArtifactOrder:     append([]string(nil), artifactOrder...),
		PreviewOrder:      append([]string(nil), previewOrder...),
		UserProfileOrder:  append([]string(nil), userProfileOrder...),
		AgentProfileOrder: append([]string(nil), agentProfileOrder...),
		Settings:          copyMap(settings),
		SettingsMtime:     settingsMtime,
	}
}

// materializeFileSnapshot copies snapshot maps and normalizes order slices.
// Caller assigns the returned values under the store mutex.
func materializeFileSnapshot(snapshot fileSnapshot) (
	projects map[string]Project,
	threads map[string]Thread,
	runs map[string]Run,
	items map[string]Item,
	pins map[string]ThreadPin,
	diffs map[string]RunDiffFile,
	artifacts map[string]Artifact,
	previews map[string]Preview,
	userProfiles map[string]UserProfile,
	agentProfiles map[string]AgentProfile,
	projectOrder, threadOrder, runOrder, itemOrder, pinOrder, diffOrder, artifactOrder, previewOrder, userProfileOrder, agentProfileOrder []string,
) {
	projects = copyMap(snapshot.Projects)
	threads = copyMap(snapshot.Threads)
	runs = copyMap(snapshot.Runs)
	items = copyMap(snapshot.Items)
	pins = copyMap(snapshot.Pins)
	diffs = copyMap(snapshot.Diffs)
	artifacts = cloneArtifactMap(snapshot.Artifacts)
	previews = copyMap(snapshot.Previews)
	userProfiles = copyMap(snapshot.UserProfiles)
	agentProfiles = copyMap(snapshot.AgentProfiles)
	projectOrder = normalizeOrder(snapshot.ProjectOrder, projects)
	threadOrder = normalizeOrder(snapshot.ThreadOrder, threads)
	runOrder = normalizeOrder(snapshot.RunOrder, runs)
	itemOrder = normalizeOrder(snapshot.ItemOrder, items)
	pinOrder = normalizeOrder(snapshot.PinOrder, pins)
	diffOrder = normalizeOrder(snapshot.DiffOrder, diffs)
	artifactOrder = normalizeOrder(snapshot.ArtifactOrder, artifacts)
	previewOrder = normalizeOrder(snapshot.PreviewOrder, previews)
	userProfileOrder = normalizeOrder(snapshot.UserProfileOrder, userProfiles)
	agentProfileOrder = normalizeOrder(snapshot.AgentProfileOrder, agentProfiles)
	return
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
