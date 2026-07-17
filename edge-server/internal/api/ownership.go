package api

import (
	"net/http"
	"strings"

	"github.com/agenthub/edge-server/internal/edgeidentity"
	"github.com/agenthub/edge-server/internal/events"
	"github.com/agenthub/edge-server/internal/store"
)

// hubUserFromRequest extracts the Hub-authenticated user ID from the request context.
// Returns empty string if the request was not authenticated via Hub JWT.
func hubUserFromRequest(r *http.Request) string {
	return edgeidentity.FromContext(r.Context()).UserID
}

// filterProjectsByOwner filters a list of projects to those owned by the given user.
// Pass userID="" to skip filtering (local auth / unauthenticated local-dev mode).
// Under Hub JWT (userID != ""), unowned projects (OwnerID=="") are fail-closed and hidden.
func filterProjectsByOwner(projects []store.Project, userID string) []store.Project {
	if userID == "" {
		return projects
	}
	filtered := make([]store.Project, 0, len(projects))
	for _, p := range projects {
		if p.OwnerID == userID {
			filtered = append(filtered, p)
		}
	}
	return filtered
}

// filterThreadsByOwner filters threads to those whose parent project is owned by the
// given user. Pass userID="" to skip filtering (local auth).
// Under Hub JWT, threads under unowned projects are fail-closed and hidden.
func filterThreadsByOwner(threads []store.Thread, repo store.Reader, userID string) []store.Thread {
	if userID == "" {
		return threads
	}
	filtered := make([]store.Thread, 0, len(threads))
	for _, t := range threads {
		if isProjectOwnedBy(repo, t.ProjectID, userID) {
			filtered = append(filtered, t)
		}
	}
	return filtered
}

// filterRunsByOwner filters runs to those whose parent project is owned by the
// given user. Pass userID="" to skip filtering (local auth).
// Under Hub JWT, runs under unowned projects are fail-closed and hidden.
func filterRunsByOwner(runs []store.Run, repo store.Reader, userID string) []store.Run {
	if userID == "" {
		return runs
	}
	filtered := make([]store.Run, 0, len(runs))
	for _, r := range runs {
		if isProjectOwnedBy(repo, r.ProjectID, userID) {
			filtered = append(filtered, r)
		}
	}
	return filtered
}

// filterArtifactsByOwner filters artifacts to those whose parent run/project is owned
// by the given user. Pass userID="" to skip filtering (local auth).
func filterArtifactsByOwner(artifacts []store.Artifact, repo store.Reader, userID string) []store.Artifact {
	if userID == "" {
		return artifacts
	}
	filtered := make([]store.Artifact, 0, len(artifacts))
	for _, a := range artifacts {
		if isRunOwnedBy(repo, a.RunID, userID) {
			filtered = append(filtered, a)
		}
	}
	return filtered
}

// filterPreviewsByOwner filters previews to those whose parent run/project is owned
// by the given user. Pass userID="" to skip filtering (local auth).
func filterPreviewsByOwner(previews []store.Preview, repo store.Reader, userID string) []store.Preview {
	if userID == "" {
		return previews
	}
	filtered := make([]store.Preview, 0, len(previews))
	for _, p := range previews {
		if isRunOwnedBy(repo, p.RunID, userID) {
			filtered = append(filtered, p)
		}
	}
	return filtered
}

// isProjectOwnedBy checks if the project with the given ID is accessible to the user.
// Returns true if userID is empty (local auth) or the project is owned by the user.
// Under Hub JWT (userID != ""), unowned projects (OwnerID=="") are NOT accessible (AH-SR-045).
func isProjectOwnedBy(repo store.Reader, projectID, userID string) bool {
	if userID == "" {
		return true
	}
	proj, ok := repo.GetProject(projectID)
	if !ok {
		return false
	}
	return proj.OwnerID == userID
}

// isThreadOwnedBy checks if the thread with the given ID is accessible to the user.
func isThreadOwnedBy(repo store.Reader, threadID, userID string) bool {
	if userID == "" {
		return true
	}
	thread, ok := repo.GetThread(threadID)
	if !ok {
		return false
	}
	return isProjectOwnedBy(repo, thread.ProjectID, userID)
}

// isRunOwnedBy checks if the run with the given ID is accessible to the user.
func isRunOwnedBy(repo store.Reader, runID, userID string) bool {
	if userID == "" {
		return true
	}
	run, ok := repo.GetRun(runID)
	if !ok {
		return false
	}
	return isProjectOwnedBy(repo, run.ProjectID, userID)
}

// isItemOwnedBy checks if the item with the given ID is accessible to the user.
func isItemOwnedBy(repo store.Reader, itemID, userID string) bool {
	if userID == "" {
		return true
	}
	item, ok := repo.GetItem(itemID)
	if !ok {
		return false
	}
	if item.ProjectID != "" {
		return isProjectOwnedBy(repo, item.ProjectID, userID)
	}
	if item.ThreadID != "" {
		return isThreadOwnedBy(repo, item.ThreadID, userID)
	}
	if item.RunID != "" {
		return isRunOwnedBy(repo, item.RunID, userID)
	}
	// Fail closed for Hub JWT when the item has no ownership anchors.
	return false
}

// isArtifactOwnedBy checks if the artifact is accessible to the user via its run.
func isArtifactOwnedBy(repo store.Reader, artifactID, userID string) bool {
	if userID == "" {
		return true
	}
	artifact, ok := repo.GetArtifact(artifactID)
	if !ok {
		return false
	}
	return isRunOwnedBy(repo, artifact.RunID, userID)
}

// isPreviewOwnedBy checks if the preview is accessible to the user via its run.
func isPreviewOwnedBy(repo store.Reader, previewID, userID string) bool {
	if userID == "" {
		return true
	}
	preview, ok := repo.GetPreview(previewID)
	if !ok {
		return false
	}
	return isRunOwnedBy(repo, preview.RunID, userID)
}

// eventVisibleToUser reports whether an event envelope is visible under Hub JWT ownership.
// Local auth (userID=="") sees all events. Gap/control events with empty scopes stay visible.
// Under Hub JWT, events without a resolvable owned project/thread/run are suppressed.
func eventVisibleToUser(repo store.Reader, evt events.EventEnvelope, userID string) bool {
	if userID == "" {
		return true
	}
	if evt.Type == events.GapEventType {
		return true
	}
	if repo == nil {
		return false
	}
	scope := evt.Scope
	if scope == nil {
		return false
	}
	if projectID, ok := scopeString(scope, "projectId"); ok && projectID != "" {
		return isProjectOwnedBy(repo, projectID, userID)
	}
	if threadID, ok := scopeString(scope, "threadId"); ok && threadID != "" {
		return isThreadOwnedBy(repo, threadID, userID)
	}
	if runID, ok := scopeString(scope, "runId"); ok && runID != "" {
		return isRunOwnedBy(repo, runID, userID)
	}
	// Fail closed for unscoped events under Hub JWT (AH-SR-045).
	return false
}

func scopeString(scope map[string]any, key string) (string, bool) {
	raw, ok := scope[key]
	if !ok || raw == nil {
		return "", false
	}
	switch v := raw.(type) {
	case string:
		return strings.TrimSpace(v), true
	default:
		return "", false
	}
}
