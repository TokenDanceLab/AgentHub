package store

import (
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
