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
	return &Store{
		projects:      make(map[string]Project),
		threads:       make(map[string]Thread),
		runs:          make(map[string]Run),
		items:         make(map[string]Item),
		pins:          make(map[string]ThreadPin),
		diffs:         make(map[string]RunDiffFile),
		artifacts:     make(map[string]Artifact),
		previews:      make(map[string]Preview),
		userProfiles:  make(map[string]UserProfile),
		agentProfiles: make(map[string]AgentProfile),
		settings:      make(map[string]string),
	}
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

	existing, exists := s.projects[id]
	project, err, created := resolveCreateProject(existing, exists, id, name, ownerID, nowString())
	s.projectOrder = putTracked(s.projects, s.projectOrder, id, project, created)
	return project, err
}

func (s *Store) GetProject(id string) (Project, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	project, ok := s.projects[id]
	return project, ok
}

func (s *Store) ListProjects() []Project {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return collectOrdered(s.projectOrder, s.projects)
}

func (s *Store) CreateThread(id, projectID, title, kind, avatarColor, avatarLabel string) (Thread, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	_, projectExists := s.projects[projectID]
	existing, exists := s.threads[id]
	thread, err, created := resolveCreateThread(existing, exists, projectExists, id, projectID, title, kind, avatarColor, avatarLabel, nowString())
	s.threadOrder = putTracked(s.threads, s.threadOrder, id, thread, created)
	return thread, err
}

func (s *Store) GetThread(id string) (Thread, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	thread, ok := s.threads[id]
	return thread, ok
}

func (s *Store) UpdateThread(id string, title *string, status *string) (Thread, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	thread, ok := s.threads[id]
	if !ok {
		return Thread{}, false
	}
	thread = applyThreadUpdate(thread, title, status, nowString())
	s.threads[id] = thread
	return thread, true
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
	deleteMapKeys(s.runs, runIDs)
	s.runOrder = orderWithoutRemoved(s.runOrder, runIDs)
	deleteMapKeys(s.items, itemIDs)
	s.itemOrder = orderWithoutRemoved(s.itemOrder, itemIDs)

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

	existing, exists := s.runs[id]
	refsOK := validateCreateRunRefs(s.projects, s.threads, projectID, threadID)
	run, err, created := resolveCreateRun(existing, exists, refsOK, id, projectID, threadID, nowString())
	s.runOrder = putTracked(s.runs, s.runOrder, id, run, created)
	return run, err
}

func (s *Store) GetRun(id string) (Run, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	run, ok := s.runs[id]
	return run, ok
}

func (s *Store) ListRuns(threadID string) []Run {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return listRunsForThread(s.runOrder, s.runs, threadID)
}

func (s *Store) UpsertRunDiffFile(file RunDiffFile) (RunDiffFile, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.runs[file.RunID]; !ok {
		return RunDiffFile{}, ErrNotFound
	}
	file = normalizeRunDiffFileInput(file)
	if file.Path == "" {
		return RunDiffFile{}, ErrNotFound
	}
	key := runDiffFileKey(file.RunID, file.Path)
	now := nowString()
	existing, exists := s.diffs[key]
	file, created := resolveRunDiffFileUpsert(existing, exists, file, now)
	s.diffOrder = putUpsert(s.diffs, s.diffOrder, key, file, created)
	return file, nil
}

func (s *Store) ListRunDiffFiles(runID string) []RunDiffFile {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return listDiffsForRun(s.diffOrder, s.diffs, runID)
}

func (s *Store) UpsertArtifact(artifact Artifact) (Artifact, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	run, ok := s.runs[artifact.RunID]
	if !ok {
		return Artifact{}, ErrNotFound
	}
	artifact, ok = prepareArtifactInput(artifact, run.ThreadID)
	if !ok {
		return Artifact{}, ErrNotFound
	}
	now := nowString()
	existing, exists := s.artifacts[artifact.ID]
	artifact = resolveArtifactUpsert(artifact, existing, exists, now)
	s.artifactOrder = putUpsert(s.artifacts, s.artifactOrder, artifact.ID, cloneArtifact(artifact), !exists)
	return cloneArtifact(artifact), nil
}

func (s *Store) ListArtifacts(runID string) []Artifact {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return listClonedArtifacts(s.artifactOrder, s.artifacts, runID)
}

func (s *Store) GetArtifact(id string) (Artifact, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	artifact, ok := s.artifacts[id]
	return cloneArtifact(artifact), ok
}

func (s *Store) UpsertPreview(preview Preview) (Preview, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	run, ok := s.runs[preview.RunID]
	if !ok {
		return Preview{}, ErrNotFound
	}
	preview, ok = preparePreviewInput(preview, run.ThreadID)
	if !ok {
		return Preview{}, ErrNotFound
	}
	now := nowString()
	existing, exists := s.previews[preview.ID]
	preview = resolvePreviewUpsert(preview, existing, exists, now)
	s.previewOrder = putUpsert(s.previews, s.previewOrder, preview.ID, preview, !exists)
	return preview, nil
}

func (s *Store) ListPreviews(runID string) []Preview {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return listPreviewsForRun(s.previewOrder, s.previews, runID)
}

func (s *Store) GetPreview(id string) (Preview, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	preview, ok := s.previews[id]
	return preview, ok
}

func (s *Store) CleanupRuns(opts RunCleanupOptions) RunCleanupResult {
	s.mu.Lock()
	defer s.mu.Unlock()

	opts.Now = resolveCleanupNow(opts.Now, time.Now().UTC())

	candidates := buildTerminalCleanupCandidates(s.runOrder, s.runs)
	removeRuns := selectRunsForCleanup(candidates, opts.Now, opts.TerminalTTL, opts.MaxTerminalRunsPerThread)

	if len(removeRuns) == 0 {
		return RunCleanupResult{}
	}

	for id := range removeRuns {
		s.removeRunEvidence(id)
	}
	var removedItemIDs map[string]struct{}
	var removedItems int
	s.runOrder, s.itemOrder, removedItemIDs, removedItems = applyRunCleanupMaps(
		s.runs, s.items, s.runOrder, s.itemOrder, removeRuns,
	)
	if removedItems > 0 {
		s.removePins(pinMatchesRemovedItems(removedItemIDs))
	}

	return buildRunCleanupResult(len(removeRuns), removedItems)
}

func (s *Store) SetRunStatus(id, status string) (Run, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	run, ok := s.runs[id]
	if !ok {
		return Run{}, false
	}
	run = applyRunStatus(run, status, nowString())
	s.runs[id] = run
	return run, true
}

func (s *Store) SetRunStatusIf(id, status string, allowedCurrent ...string) (Run, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	run, ok := s.runs[id]
	if !ok {
		return Run{}, false
	}
	if !isAllowedCurrentStatus(run.Status, allowedCurrent) {
		return run, false
	}
	run = applyRunStatus(run, status, nowString())
	s.runs[id] = run
	return run, true
}

// SetRunEvidenceGate stores the evidence gate verification result on a run.
// The result should be a JSON-encoded string.
func (s *Store) SetRunEvidenceGate(id, result string) (Run, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	run, ok := s.runs[id]
	if !ok {
		return Run{}, false
	}
	run = applyRunEvidenceGate(run, result)
	s.runs[id] = run
	return run, true
}

// SetRunRetryCount updates the retry count on a run. Used by the fault
// escalation chain to track auto-retry attempts before escalation.
func (s *Store) SetRunRetryCount(id string, count int) (Run, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	run, ok := s.runs[id]
	if !ok {
		return Run{}, false
	}
	run = applyRunRetryCount(run, count)
	s.runs[id] = run
	return run, true
}

func (s *Store) CreateItem(item Item) (Item, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	existing, exists := s.items[item.ID]
	refsOK := validateCreateItemRefs(s.projects, s.threads, s.runs, item)
	item, err, created := resolveCreateItem(existing, exists, refsOK, item, nowString())
	s.itemOrder = putTracked(s.items, s.itemOrder, item.ID, item, created)
	return item, err
}

func (s *Store) CreateThreadMessage(itemID, threadID, role, content string) (Item, error) {
	s.mu.RLock()
	thread, ok := s.threads[threadID]
	s.mu.RUnlock()
	if !ok {
		return Item{}, ErrNotFound
	}
	return s.CreateItem(buildUserMessageItem(itemID, thread.ProjectID, thread.ID, role, content))
}

func (s *Store) GetItem(id string) (Item, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	item, ok := s.items[id]
	return item, ok
}

func (s *Store) ListThreadItems(threadID string) []Item {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return listSortedThreadItems(s.itemOrder, s.items, threadID)
}

func (s *Store) PinThreadItem(threadID, itemID, pinnedBy string) (ThreadPin, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.threads[threadID]; !ok {
		return ThreadPin{}, ErrNotFound
	}
	if _, ok := lookupItemInThread(s.items, itemID, threadID); !ok {
		return ThreadPin{}, ErrNotFound
	}

	now := nowString()
	key := threadPinKey(threadID, itemID)
	existing, exists := s.pins[key]
	pin, created := resolveThreadPinUpsert(existing, exists, threadID, itemID, pinnedBy, now)
	s.pinOrder = putUpsert(s.pins, s.pinOrder, key, pin, created)
	return pin, nil
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

	existing, exists := s.userProfiles[profile.ID]
	profile, created := resolveCreateUserProfile(existing, exists, profile, nowString())
	s.userProfileOrder = putTracked(s.userProfiles, s.userProfileOrder, profile.ID, profile, created)
	return profile, nil
}

func (s *Store) GetUserProfile(id string) (UserProfile, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	profile, ok := s.userProfiles[id]
	return profile, ok
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

	existing, exists := s.agentProfiles[profile.ID]
	profile, err, created := resolveCreateAgentProfile(existing, exists, profile, nowString())
	s.agentProfileOrder = putTracked(s.agentProfiles, s.agentProfileOrder, profile.ID, profile, created)
	return profile, err
}

func (s *Store) GetAgentProfile(id string) (AgentProfile, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	profile, ok := s.agentProfiles[id]
	return profile, ok
}

func (s *Store) ListAgentProfiles(adapterID string) []AgentProfile {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return listAgentProfilesForAdapter(s.agentProfileOrder, s.agentProfiles, adapterID)
}

func (s *Store) UpdateAgentProfile(id string, patch map[string]any) (AgentProfile, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	profile, ok := s.agentProfiles[id]
	if !ok {
		return AgentProfile{}, ErrNotFound
	}
	profile = touchAgentProfile(applyAgentProfilePatch(profile, patch), nowString())
	s.agentProfiles[id] = profile
	return profile, nil
}

func (s *Store) DeleteAgentProfile(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	var ok bool
	s.agentProfileOrder, ok = deleteTracked(s.agentProfiles, s.agentProfileOrder, id)
	if !ok {
		return ErrNotFound
	}
	return nil
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

	s.settingsMtime = nowString()
	var view UserSettings
	s.settings, view = applySettingsUpsert(s.settings, patch, s.settingsMtime)
	return view
}
