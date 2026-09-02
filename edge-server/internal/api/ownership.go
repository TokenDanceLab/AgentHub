package api

import (
	"net/http"
	"strings"

	"github.com/agenthub/edge-server/internal/adapters/orchestrator"
	"github.com/agenthub/edge-server/internal/edgeidentity"
	"github.com/agenthub/edge-server/internal/events"
	"github.com/agenthub/edge-server/internal/store"
)

// localSingleTenantBypass is the only documented ownership bypass for intentional
// local single-tenant mode (local auth token / unauthenticated local-dev).
// Empty userID is fail-closed on multi-user paths (#878 / AH-SR-045).
// The NUL-prefix keeps this sentinel out of real Hub user ID space.
// #nosec G101 -- sentinel user ID constant, not a credential
const localSingleTenantBypass = "\x00agenthub-local-single-tenant"

// hubUserFromRequest extracts the Hub-authenticated user ID from the request context.
// Returns empty string if the request was not authenticated via Hub JWT.
func hubUserFromRequest(r *http.Request) string {
	return strings.TrimSpace(edgeidentity.FromContext(r.Context()).UserID)
}

// OwnerUserID resolves the ownership principal for API gates.
//
//   - Hub JWT identity present → that user ID (ownership enforced)
//   - multiUser=true and no Hub identity → "" (fail closed)
//   - multiUser=false and no Hub identity → localSingleTenantBypass
//     (intentional local single-tenant; documented mode gate)
//
// multiUser should be true when Hub JWT validation is configured on the Edge
// (Handler.HubJWTSecret non-empty), i.e. the multi-user / remote trust path.
func OwnerUserID(r *http.Request, multiUser bool) string {
	if uid := hubUserFromRequest(r); uid != "" {
		return uid
	}
	if multiUser {
		return ""
	}
	return localSingleTenantBypass
}

// ownerUserID resolves ownership principal for this handler's auth mode.
func (h *Handler) ownerUserID(r *http.Request) string {
	multiUser := h != nil && strings.TrimSpace(h.HubJWTSecret) != ""
	return OwnerUserID(r, multiUser)
}

func isLocalSingleTenant(userID string) bool {
	return userID == localSingleTenantBypass
}

// filterProjectsByOwner filters a list of projects to those owned by the given user.
// Local single-tenant bypass skips filtering. Empty userID fails closed (returns none).
// Under Hub JWT, unowned projects (OwnerID=="") are fail-closed and hidden.
func filterProjectsByOwner(projects []store.Project, userID string) []store.Project {
	if isLocalSingleTenant(userID) {
		return projects
	}
	if userID == "" {
		return []store.Project{}
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
// given user. Local single-tenant bypass skips filtering. Empty userID fails closed.
// Under Hub JWT, threads under unowned projects are fail-closed and hidden.
func filterThreadsByOwner(threads []store.Thread, repo store.Reader, userID string) []store.Thread {
	if isLocalSingleTenant(userID) {
		return threads
	}
	if userID == "" {
		return []store.Thread{}
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
// given user. Local single-tenant bypass skips filtering. Empty userID fails closed.
// Under Hub JWT, runs under unowned projects are fail-closed and hidden.
func filterRunsByOwner(runs []store.Run, repo store.Reader, userID string) []store.Run {
	if isLocalSingleTenant(userID) {
		return runs
	}
	if userID == "" {
		return []store.Run{}
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
// by the given user. Local single-tenant bypass skips filtering. Empty userID fails closed.
func filterArtifactsByOwner(artifacts []store.Artifact, repo store.Reader, userID string) []store.Artifact {
	if isLocalSingleTenant(userID) {
		return artifacts
	}
	if userID == "" {
		return []store.Artifact{}
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
// by the given user. Local single-tenant bypass skips filtering. Empty userID fails closed.
func filterPreviewsByOwner(previews []store.Preview, repo store.Reader, userID string) []store.Preview {
	if isLocalSingleTenant(userID) {
		return previews
	}
	if userID == "" {
		return []store.Preview{}
	}
	filtered := make([]store.Preview, 0, len(previews))
	for _, p := range previews {
		if isRunOwnedBy(repo, p.RunID, userID) {
			filtered = append(filtered, p)
		}
	}
	return filtered
}

// filterPendingPlansByOwner filters pending orchestrator plans to those whose run
// is owned by the given user. Local single-tenant bypass skips filtering. Empty
// userID fails closed (returns none).
// Plans are broker entries rather than store rows, so this walks the same
// isRunOwnedBy anchor as filterArtifactsByOwner/filterPreviewsByOwner: under Hub
// JWT a plan whose run is unknown, or whose project is unowned, is hidden.
func filterPendingPlansByOwner(plans []orchestrator.PendingPlan, repo store.Reader, userID string) []orchestrator.PendingPlan {
	if isLocalSingleTenant(userID) {
		return plans
	}
	if userID == "" {
		return []orchestrator.PendingPlan{}
	}
	filtered := make([]orchestrator.PendingPlan, 0, len(plans))
	for _, p := range plans {
		if isRunOwnedBy(repo, p.RunID, userID) {
			filtered = append(filtered, p)
		}
	}
	return filtered
}

// isProjectOwnedBy checks if the project with the given ID is accessible to the user.
// Local single-tenant bypass allows any project. Empty userID fails closed.
// Under Hub JWT (real userID), unowned projects (OwnerID=="") are NOT accessible (AH-SR-045).
func isProjectOwnedBy(repo store.Reader, projectID, userID string) bool {
	if isLocalSingleTenant(userID) {
		return true
	}
	if userID == "" {
		return false
	}
	proj, ok := repo.GetProject(projectID)
	if !ok {
		return false
	}
	return proj.OwnerID == userID
}

// isThreadOwnedBy checks if the thread with the given ID is accessible to the user.
// Empty userID fails closed; local single-tenant bypass allows.
func isThreadOwnedBy(repo store.Reader, threadID, userID string) bool {
	if isLocalSingleTenant(userID) {
		return true
	}
	if userID == "" {
		return false
	}
	thread, ok := repo.GetThread(threadID)
	if !ok {
		return false
	}
	return isProjectOwnedBy(repo, thread.ProjectID, userID)
}

// isRunOwnedBy checks if the run with the given ID is accessible to the user.
// Empty userID fails closed; local single-tenant bypass allows.
func isRunOwnedBy(repo store.Reader, runID, userID string) bool {
	if isLocalSingleTenant(userID) {
		return true
	}
	if userID == "" {
		return false
	}
	run, ok := repo.GetRun(runID)
	if !ok {
		return false
	}
	return isProjectOwnedBy(repo, run.ProjectID, userID)
}

// isItemOwnedBy checks if the item with the given ID is accessible to the user.
// Empty userID fails closed; local single-tenant bypass allows.
func isItemOwnedBy(repo store.Reader, itemID, userID string) bool {
	if isLocalSingleTenant(userID) {
		return true
	}
	if userID == "" {
		return false
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
// Empty userID fails closed; local single-tenant bypass allows.
func isArtifactOwnedBy(repo store.Reader, artifactID, userID string) bool {
	if isLocalSingleTenant(userID) {
		return true
	}
	if userID == "" {
		return false
	}
	artifact, ok := repo.GetArtifact(artifactID)
	if !ok {
		return false
	}
	return isRunOwnedBy(repo, artifact.RunID, userID)
}

// isPreviewOwnedBy checks if the preview is accessible to the user via its run.
// Empty userID fails closed; local single-tenant bypass allows.
func isPreviewOwnedBy(repo store.Reader, previewID, userID string) bool {
	if isLocalSingleTenant(userID) {
		return true
	}
	if userID == "" {
		return false
	}
	preview, ok := repo.GetPreview(previewID)
	if !ok {
		return false
	}
	return isRunOwnedBy(repo, preview.RunID, userID)
}

// eventVisibleToUser reports whether an event envelope is visible under ownership rules.
// Local single-tenant bypass sees all events. Empty userID fails closed.
// Gap events with empty scopes stay visible under an authenticated Hub user.
// Under Hub JWT, events without a resolvable owned project/thread/run are suppressed.
func eventVisibleToUser(repo store.Reader, evt events.EventEnvelope, userID string) bool {
	if isLocalSingleTenant(userID) {
		return true
	}
	if userID == "" {
		return false
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
