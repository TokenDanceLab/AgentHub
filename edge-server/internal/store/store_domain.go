package store

// Residual pure-helper peel #1144: run/artifact/profile/settings methods. Same package; zero behavior change.

import (
	"time"
)

func (s *Store) CreateRun(id, projectID, threadID string) (Run, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	run, order, err := createRunInMaps(s.projects, s.threads, s.runs, s.runOrder, id, projectID, threadID, nowString())
	s.runOrder = order
	return run, err
}

func (s *Store) GetRun(id string) (Run, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return lookupByID(s.runs, id)
}

func (s *Store) ListRuns(threadID string) []Run {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return listRunsForThread(s.runOrder, s.runs, threadID)
}

func (s *Store) UpsertRunDiffFile(file RunDiffFile) (RunDiffFile, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	file, order, err := upsertRunDiffFileInMaps(s.runs, s.diffs, s.diffOrder, file, nowString())
	s.diffOrder = order
	return file, err
}

func (s *Store) ListRunDiffFiles(runID string) []RunDiffFile {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return listDiffsForRun(s.diffOrder, s.diffs, runID)
}

func (s *Store) UpsertArtifact(artifact Artifact) (Artifact, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	artifact, order, err := upsertArtifactInMaps(s.runs, s.artifacts, s.artifactOrder, artifact, nowString())
	s.artifactOrder = order
	return artifact, err
}

func (s *Store) ListArtifacts(runID string) []Artifact {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return listClonedArtifacts(s.artifactOrder, s.artifacts, runID)
}

func (s *Store) GetArtifact(id string) (Artifact, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return lookupClonedArtifact(s.artifacts, id)
}

func (s *Store) UpsertPreview(preview Preview) (Preview, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	preview, order, err := upsertPreviewInMaps(s.runs, s.previews, s.previewOrder, preview, nowString())
	s.previewOrder = order
	return preview, err
}

func (s *Store) ListPreviews(runID string) []Preview {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return listPreviewsForRun(s.previewOrder, s.previews, runID)
}

func (s *Store) GetPreview(id string) (Preview, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return lookupByID(s.previews, id)
}

func (s *Store) CleanupRuns(opts RunCleanupOptions) RunCleanupResult {
	s.mu.Lock()
	defer s.mu.Unlock()

	removeRuns := planRunCleanup(s.runOrder, s.runs, opts, time.Now().UTC())
	if len(removeRuns) == 0 {
		return RunCleanupResult{}
	}

	for id := range removeRuns {
		s.removeRunEvidence(id)
	}
	var pinMatch func(ThreadPin) bool
	var result RunCleanupResult
	s.runOrder, s.itemOrder, pinMatch, result = applyPlannedRunCleanup(
		s.runs, s.items, s.runOrder, s.itemOrder, removeRuns,
	)
	if pinMatch != nil {
		s.removePins(pinMatch)
	}
	return result
}

func (s *Store) SetRunStatus(id, status string) (Run, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return setRunStatusInMaps(s.runs, id, status, nowString())
}

func (s *Store) SetRunStatusIf(id, status string, allowedCurrent ...string) (Run, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return setRunStatusIfInMaps(s.runs, id, status, allowedCurrent, nowString())
}

// SetRunEvidenceGate stores the evidence gate verification result on a run.
// The result should be a JSON-encoded string.
func (s *Store) SetRunEvidenceGate(id, result string) (Run, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return setRunEvidenceGateInMaps(s.runs, id, result)
}

// SetRunRetryCount updates the retry count on a run. Used by the fault
// escalation chain to track auto-retry attempts before escalation.
func (s *Store) SetRunRetryCount(id string, count int) (Run, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return setRunRetryCountInMaps(s.runs, id, count)
}

// SetRunWorkDir records the executor-resolved working directory on a run.
// The value is evidence for run-level diff review (#1967): clients may apply
// run diffs only against a workDir reported by the executor, never a guess.
func (s *Store) SetRunWorkDir(id, workDir string) (Run, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return setRunWorkDirInMaps(s.runs, id, workDir)
}

func (s *Store) CreateItem(item Item) (Item, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	item, order, err := createItemInMaps(s.projects, s.threads, s.runs, s.items, s.itemOrder, item, nowString())
	s.itemOrder = order
	return item, err
}

func (s *Store) CreateThreadMessage(itemID, threadID, role, content string) (Item, error) {
	s.mu.RLock()
	thread, exists := s.threads[threadID]
	s.mu.RUnlock()
	item, err := buildThreadMessageFromThread(thread, exists, itemID, role, content)
	if err != nil {
		return Item{}, err
	}
	return s.CreateItem(item)
}

func (s *Store) GetItem(id string) (Item, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return lookupByID(s.items, id)
}

func (s *Store) ListThreadItems(threadID string) []Item {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return listSortedThreadItems(s.itemOrder, s.items, threadID)
}

func (s *Store) PinThreadItem(threadID, itemID, pinnedBy string) (ThreadPin, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	pin, order, err := upsertThreadPinInMaps(s.threads, s.items, s.pins, s.pinOrder, threadID, itemID, pinnedBy, nowString())
	s.pinOrder = order
	return pin, err
}

func (s *Store) DeleteThreadPin(threadID, itemID string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()

	var ok bool
	s.pinOrder, ok = deleteTracked(s.pins, s.pinOrder, threadPinKey(threadID, itemID))
	return ok
}

func (s *Store) ListThreadPins(threadID string) []ThreadPin {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return listSortedThreadPins(s.pinOrder, s.pins, threadID)
}

func (s *Store) CreateUserProfile(profile UserProfile) (UserProfile, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	profile, order := createUserProfileInMaps(s.userProfiles, s.userProfileOrder, profile, nowString())
	s.userProfileOrder = order
	return profile, nil
}

func (s *Store) GetUserProfile(id string) (UserProfile, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return lookupByID(s.userProfiles, id)
}

func (s *Store) ListUserProfiles() []UserProfile {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return collectOrdered(s.userProfileOrder, s.userProfiles)
}

// GetCurrentUser returns the first profile marked as status="owner",
// or the first profile overall, or false if no profiles exist.
func (s *Store) GetCurrentUser() (UserProfile, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return selectCurrentUserProfile(s.userProfileOrder, s.userProfiles)
}

// ── AgentProfile CRUD ──

func (s *Store) CreateAgentProfile(profile AgentProfile) (AgentProfile, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	profile, order, err := createAgentProfileInMaps(s.agentProfiles, s.agentProfileOrder, profile, nowString())
	s.agentProfileOrder = order
	return profile, err
}

func (s *Store) GetAgentProfile(id string) (AgentProfile, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return lookupByID(s.agentProfiles, id)
}

func (s *Store) ListAgentProfiles(adapterID string) []AgentProfile {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return listAgentProfilesForAdapter(s.agentProfileOrder, s.agentProfiles, adapterID)
}

func (s *Store) UpdateAgentProfile(id string, patch map[string]any) (AgentProfile, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return updateAgentProfileInMaps(s.agentProfiles, id, patch, nowString())
}

func (s *Store) DeleteAgentProfile(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	var ok bool
	s.agentProfileOrder, ok = deleteTracked(s.agentProfiles, s.agentProfileOrder, id)
	return errIfMissing(ok)
}

// ── UserSettings CRUD ──────────────────────────────────────

func (s *Store) GetSettings() UserSettings {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return cloneUserSettings(s.settings, s.settingsMtime)
}

// UpsertSettings merges patch into the in-memory settings map. The in-memory
// write itself cannot fail; the error slot exists so persistence-backed
// implementations (SQLite/File) can surface persist failures to callers.
func (s *Store) UpsertSettings(patch map[string]string) (UserSettings, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	var view UserSettings
	s.settings, s.settingsMtime, view = upsertSettingsInMaps(s.settings, patch, nowString())
	return view, nil
}
