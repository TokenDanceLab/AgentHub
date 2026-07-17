package store

import (
	"errors"
	"sync"
	"time"
)

var ErrNotFound = errors.New("not found")
var ErrProjectExists = errors.New("project already exists")

type Project struct {
	ID        string `json:"projectId"`
	Name      string `json:"name"`
	Status    string `json:"status"`
	OwnerID   string `json:"ownerId,omitempty"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

type Thread struct {
	ID          string `json:"threadId"`
	ProjectID   string `json:"projectId"`
	Title       string `json:"title"`
	Kind        string `json:"kind,omitempty"`
	Status      string `json:"status"`
	AvatarColor string `json:"avatarColor,omitempty"`
	AvatarLabel string `json:"avatarLabel,omitempty"`
	CreatedAt   string `json:"createdAt"`
	UpdatedAt   string `json:"updatedAt"`
}

type Run struct {
	ID                 string `json:"runId"`
	ProjectID          string `json:"projectId"`
	ThreadID           string `json:"threadId"`
	Status             string `json:"status"`
	RetryCount         int    `json:"retryCount"`
	CreatedAt          string `json:"createdAt"`
	StartedAt          string `json:"startedAt,omitempty"`
	FinishedAt         string `json:"finishedAt,omitempty"`
	EvidenceGateResult string `json:"evidenceGateResult,omitempty"`
}

type RunDiffFile struct {
	RunID     string `json:"runId"`
	Path      string `json:"path"`
	Diff      string `json:"diff"`
	Status    string `json:"status"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

type Artifact struct {
	ID            string                 `json:"id"`
	RunID         string                 `json:"runId"`
	ThreadID      string                 `json:"threadId"`
	Kind          string                 `json:"kind"`
	Path          string                 `json:"path"`
	SizeBytes     int64                  `json:"sizeBytes"`
	ContentSource *ArtifactContentSource `json:"contentSource,omitempty"`
	CreatedAt     string                 `json:"createdAt"`
	UpdatedAt     string                 `json:"updatedAt"`
}

type ArtifactContentSource struct {
	Kind     string `json:"kind"`
	Path     string `json:"path"`
	Readable bool   `json:"readable"`
}

type Preview struct {
	ID        string `json:"id"`
	RunID     string `json:"runId"`
	ThreadID  string `json:"threadId"`
	URL       string `json:"url,omitempty"`
	Status    string `json:"status"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

type Item struct {
	ID         string `json:"itemId"`
	ProjectID  string `json:"projectId"`
	ThreadID   string `json:"threadId"`
	RunID      string `json:"runId,omitempty"`
	Type       string `json:"type"`
	Role       string `json:"role,omitempty"`
	SenderID   string `json:"senderId,omitempty"`
	SenderName string `json:"senderName,omitempty"`
	Status     string `json:"status"`
	Content    string `json:"content,omitempty"`
	CreatedAt  string `json:"createdAt"`
	UpdatedAt  string `json:"updatedAt"`
}

type ThreadPin struct {
	ThreadID  string `json:"threadId"`
	ItemID    string `json:"itemId"`
	PinnedBy  string `json:"pinnedBy,omitempty"`
	PinnedAt  string `json:"pinnedAt"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

type UserProfile struct {
	ID          string `json:"userId"`
	DisplayName string `json:"displayName"`
	AvatarURL   string `json:"avatarUrl,omitempty"`
	Status      string `json:"status,omitempty"`
	CreatedAt   string `json:"createdAt"`
	UpdatedAt   string `json:"updatedAt"`
}

type AgentProfile struct {
	ID                string   `json:"id"`
	Name              string   `json:"name"`
	Description       string   `json:"description,omitempty"`
	AdapterID         string   `json:"adapterId"`
	Model             string   `json:"model,omitempty"`
	Provider          string   `json:"provider,omitempty"`
	ReasoningEffort   string   `json:"reasoningEffort,omitempty"`
	ThinkingMode      string   `json:"thinkingMode,omitempty"`
	MaxThinkingTokens int      `json:"maxThinkingTokens,omitempty"`
	PermissionMode    string   `json:"permissionMode,omitempty"`
	SystemPrompt      string   `json:"systemPrompt,omitempty"`
	AllowedTools      []string `json:"allowedTools,omitempty"`
	MCPConfig         string   `json:"mcpConfig,omitempty"`
	Skills            []string `json:"skills,omitempty"`
	AvatarRef         string   `json:"avatarRef,omitempty"`
	CreatedAt         string   `json:"createdAt"`
	UpdatedAt         string   `json:"updatedAt"`
}

type UserSettings struct {
	Values    map[string]string `json:"values"`
	UpdatedAt string            `json:"updatedAt"`
}

type RunCleanupOptions struct {
	Now                      time.Time
	TerminalTTL              time.Duration
	MaxTerminalRunsPerThread int
}

type RunCleanupResult struct {
	RemovedRuns  int `json:"removedRuns"`
	RemovedItems int `json:"removedItems"`
}

type Reader interface {
	GetProject(id string) (Project, bool)
	ListProjects() []Project
	GetThread(id string) (Thread, bool)
	ListThreads(projectID string) []Thread
	GetRun(id string) (Run, bool)
	ListRuns(threadID string) []Run
	GetItem(id string) (Item, bool)
	ListThreadItems(threadID string) []Item
	ListThreadPins(threadID string) []ThreadPin
	ListRunDiffFiles(runID string) []RunDiffFile
	GetArtifact(id string) (Artifact, bool)
	ListArtifacts(runID string) []Artifact
	GetPreview(id string) (Preview, bool)
	ListPreviews(runID string) []Preview
	GetUserProfile(id string) (UserProfile, bool)
	ListUserProfiles() []UserProfile
	GetCurrentUser() (UserProfile, bool)
	GetAgentProfile(id string) (AgentProfile, bool)
	ListAgentProfiles(adapterID string) []AgentProfile
	GetSettings() UserSettings
}

type Writer interface {
	CreateProject(id, name, ownerID string) (Project, error)
	CreateThread(id, projectID, title, kind, avatarColor, avatarLabel string) (Thread, error)
	UpdateThread(id string, title *string, status *string) (Thread, bool)
	DeleteThread(id string) bool
	CreateRun(id, projectID, threadID string) (Run, error)
	SetRunStatus(id, status string) (Run, bool)
	SetRunStatusIf(id, status string, allowedCurrent ...string) (Run, bool)
	CreateItem(item Item) (Item, error)
	CreateThreadMessage(itemID, threadID, role, content string) (Item, error)
	PinThreadItem(threadID, itemID, pinnedBy string) (ThreadPin, error)
	DeleteThreadPin(threadID, itemID string) bool
	UpsertRunDiffFile(file RunDiffFile) (RunDiffFile, error)
	UpsertArtifact(artifact Artifact) (Artifact, error)
	UpsertPreview(preview Preview) (Preview, error)
	CreateUserProfile(profile UserProfile) (UserProfile, error)
	CreateAgentProfile(profile AgentProfile) (AgentProfile, error)
	UpdateAgentProfile(id string, patch map[string]any) (AgentProfile, error)
	DeleteAgentProfile(id string) error
	UpsertSettings(patch map[string]string) UserSettings
	SetRunEvidenceGate(id, result string) (Run, bool)
	SetRunRetryCount(id string, count int) (Run, bool)
}

type Repository interface {
	Reader
	Writer
}

type RunLifecycleStore interface {
	GetRun(id string) (Run, bool)
	SetRunStatus(id, status string) (Run, bool)
	SetRunStatusIf(id, status string, allowedCurrent ...string) (Run, bool)
	SetRunEvidenceGate(id, result string) (Run, bool)
	SetRunRetryCount(id string, count int) (Run, bool)
}

type RunCleaner interface {
	CleanupRuns(opts RunCleanupOptions) RunCleanupResult
}

type Store struct {
	mu sync.RWMutex

	projects      map[string]Project
	threads       map[string]Thread
	runs          map[string]Run
	items         map[string]Item
	pins          map[string]ThreadPin
	diffs         map[string]RunDiffFile
	artifacts     map[string]Artifact
	previews      map[string]Preview
	userProfiles  map[string]UserProfile
	agentProfiles map[string]AgentProfile
	settings      map[string]string
	settingsMtime string

	projectOrder      []string
	threadOrder       []string
	runOrder          []string
	itemOrder         []string
	pinOrder          []string
	diffOrder         []string
	artifactOrder     []string
	previewOrder      []string
	userProfileOrder  []string
	agentProfileOrder []string
}

func New() *Store {
	return newEmptyStore()
}

func (s *Store) snapshot() fileSnapshot {
	s.mu.RLock()
	defer s.mu.RUnlock()

	return buildFileSnapshot(
		s.projects,
		s.threads,
		s.runs,
		s.items,
		s.pins,
		s.diffs,
		s.artifacts,
		s.previews,
		s.userProfiles,
		s.agentProfiles,
		s.projectOrder,
		s.threadOrder,
		s.runOrder,
		s.itemOrder,
		s.pinOrder,
		s.diffOrder,
		s.artifactOrder,
		s.previewOrder,
		s.userProfileOrder,
		s.agentProfileOrder,
		s.settings,
		s.settingsMtime,
	)
}

func (s *Store) applySnapshot(snapshot fileSnapshot) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.projects, s.threads, s.runs, s.items, s.pins, s.diffs, s.artifacts, s.previews, s.userProfiles, s.agentProfiles,
		s.projectOrder, s.threadOrder, s.runOrder, s.itemOrder, s.pinOrder, s.diffOrder, s.artifactOrder, s.previewOrder, s.userProfileOrder, s.agentProfileOrder =
		materializeFileSnapshot(snapshot)
}

func (s *Store) CreateProject(id, name, ownerID string) (Project, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	project, order, err := createProjectInMaps(s.projects, s.projectOrder, id, name, ownerID, nowString())
	s.projectOrder = order
	return project, err
}

func (s *Store) GetProject(id string) (Project, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return lookupByID(s.projects, id)
}

func (s *Store) ListProjects() []Project {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return collectOrdered(s.projectOrder, s.projects)
}

func (s *Store) CreateThread(id, projectID, title, kind, avatarColor, avatarLabel string) (Thread, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	thread, order, err := createThreadInMaps(s.projects, s.threads, s.threadOrder, id, projectID, title, kind, avatarColor, avatarLabel, nowString())
	s.threadOrder = order
	return thread, err
}

func (s *Store) GetThread(id string) (Thread, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return lookupByID(s.threads, id)
}

func (s *Store) UpdateThread(id string, title *string, status *string) (Thread, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return updateThreadInMaps(s.threads, id, title, status, nowString())
}

func (s *Store) DeleteThread(id string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()

	var ok bool
	s.threadOrder, ok = deleteTracked(s.threads, s.threadOrder, id)
	if !ok {
		return false
	}

	runIDs, itemIDs := collectThreadOwnedKeys(s.runs, s.items, id)
	for runID := range runIDs {
		s.removeRunEvidence(runID)
	}
	s.runOrder, s.itemOrder = applyDeleteThreadOwnedMaps(s.runs, s.items, s.runOrder, s.itemOrder, runIDs, itemIDs)

	s.removePins(pinMatchesThread(id))
	return true
}

func (s *Store) ListThreads(projectID string) []Thread {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return listThreadsForProject(s.threadOrder, s.threads, projectID)
}

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

func (s *Store) removePins(match func(ThreadPin) bool) {
	s.pinOrder = pruneMatchingPins(s.pins, s.pinOrder, match)
}

func (s *Store) removeRunEvidence(runID string) {
	s.diffOrder, s.artifactOrder, s.previewOrder = pruneRunEvidence(
		s.diffs, s.artifacts, s.previews,
		s.diffOrder, s.artifactOrder, s.previewOrder,
		runID,
	)
}

// ── UserProfile CRUD ──────────────────────────────────────

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

func (s *Store) UpsertSettings(patch map[string]string) UserSettings {
	s.mu.Lock()
	defer s.mu.Unlock()

	var view UserSettings
	s.settings, s.settingsMtime, view = upsertSettingsInMaps(s.settings, patch, nowString())
	return view
}
