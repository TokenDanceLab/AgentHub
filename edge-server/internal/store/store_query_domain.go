package store

import (
	"fmt"
	"strings"
)

// store_query_domain.go holds pure domain builders, input preparers, and
// stamp/merge helpers extracted from store_query.go. No DB / IO / mutex.

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

func applyRunWorkDir(run Run, workDir string) Run {
	run.WorkDir = workDir
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

// buildRunCleanupResult packages cleanup deletion counts.
func buildRunCleanupResult(removedRuns, removedItems int) RunCleanupResult {
	return RunCleanupResult{
		RemovedRuns:  removedRuns,
		RemovedItems: removedItems,
	}
}

// buildThreadMessageFromThread builds a user message item when the thread exists.
func buildThreadMessageFromThread(thread Thread, exists bool, itemID, role, content string) (Item, error) {
	if !exists {
		return Item{}, ErrNotFound
	}
	return buildUserMessageItem(itemID, thread.ProjectID, thread.ID, role, content), nil
}

// errThreadExistsInProject is returned when CreateThread collides across projects.
func errThreadExistsInProject(threadID, projectID string) error {
	return fmt.Errorf("thread %q already exists in project %q", threadID, projectID)
}

// errAgentProfileExists is returned when CreateAgentProfile collides on id.
func errAgentProfileExists(id string) error {
	return fmt.Errorf("agent profile %q already exists", id)
}
