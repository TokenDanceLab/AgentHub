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

	if existing, ok := s.projects[id]; ok {
		return existing, ErrProjectExists
	}
	project := buildProject(id, name, ownerID, nowString())
	s.projects[id] = project
	s.projectOrder = append(s.projectOrder, id)
	return project, nil
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

	if _, ok := s.projects[projectID]; !ok {
		return Thread{}, ErrNotFound
	}
	if existing, ok := s.threads[id]; ok {
		if existingThreadConflict(existing, projectID) {
			return Thread{}, errThreadExistsInProject(id, existing.ProjectID)
		}
		return existing, nil
	}
	thread := buildThread(id, projectID, title, kind, avatarColor, avatarLabel, nowString())
	s.threads[id] = thread
	s.threadOrder = append(s.threadOrder, id)
	return thread, nil
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

	if _, ok := s.threads[id]; !ok {
		return false
	}
	delete(s.threads, id)
	s.threadOrder = removeString(s.threadOrder, id)

	runIDs := collectKeysByThreadID(s.runs, id, func(run Run) string { return run.ThreadID })
	for runID := range runIDs {
		s.removeRunEvidence(runID)
	}
	deleteMapKeys(s.runs, runIDs)
	s.runOrder = orderWithoutRemoved(s.runOrder, runIDs)

	itemIDs := collectKeysByThreadID(s.items, id, func(item Item) string { return item.ThreadID })
	deleteMapKeys(s.items, itemIDs)
	s.itemOrder = orderWithoutRemoved(s.itemOrder, itemIDs)

	s.removePins(func(pin ThreadPin) bool {
		return pin.ThreadID == id
	})
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

	if _, ok := s.projects[projectID]; !ok {
		return Run{}, ErrNotFound
	}
	if _, ok := lookupThreadInProject(s.threads, threadID, projectID); !ok {
		return Run{}, ErrNotFound
	}
	if existing, ok := s.runs[id]; ok {
		return existing, nil
	}
	run := buildQueuedRun(id, projectID, threadID, nowString())
	s.runs[id] = run
	s.runOrder = append(s.runOrder, id)
	return run, nil
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
	s.diffs[key] = file
	if created {
		s.diffOrder = append(s.diffOrder, key)
	}
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
	s.artifacts[artifact.ID] = cloneArtifact(artifact)
	if !exists {
		s.artifactOrder = append(s.artifactOrder, artifact.ID)
	}
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
	s.previews[preview.ID] = preview
	if !exists {
		s.previewOrder = append(s.previewOrder, preview.ID)
	}
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
	deleteMapKeys(s.runs, removeRuns)
	s.runOrder = orderWithoutRemoved(s.runOrder, removeRuns)

	removedItemIDs := collectItemIDsForRemovedRuns(s.items, removeRuns)
	deleteMapKeys(s.items, removedItemIDs)
	removedItems := len(removedItemIDs)
	if removedItems > 0 {
		s.itemOrder = orderKeepPresent(s.itemOrder, s.items)
		s.removePins(func(pin ThreadPin) bool {
			_, removed := removedItemIDs[pin.ItemID]
			return removed
		})
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

	if _, ok := s.projects[item.ProjectID]; !ok {
		return Item{}, ErrNotFound
	}
	if _, ok := lookupThreadInProject(s.threads, item.ThreadID, item.ProjectID); !ok {
		return Item{}, ErrNotFound
	}
	if item.RunID != "" {
		if _, ok := lookupRunInThread(s.runs, item.RunID, item.ThreadID); !ok {
			return Item{}, ErrNotFound
		}
	}
	if existing, ok := s.items[item.ID]; ok {
		return existing, nil
	}
	item = prepareItemDefaults(item, nowString())
	s.items[item.ID] = item
	s.itemOrder = append(s.itemOrder, item.ID)
	return item, nil
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
	s.pins[key] = pin
	if created {
		s.pinOrder = append(s.pinOrder, key)
	}
	return pin, nil
}

func (s *Store) DeleteThreadPin(threadID, itemID string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()

	key := threadPinKey(threadID, itemID)
	if _, ok := s.pins[key]; !ok {
		return false
	}
	delete(s.pins, key)
	s.pinOrder = removeString(s.pinOrder, key)
	return true
}

func (s *Store) ListThreadPins(threadID string) []ThreadPin {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return listSortedThreadPins(s.pinOrder, s.pins, threadID)
}

func (s *Store) removePins(match func(ThreadPin) bool) {
	if len(s.pins) == 0 {
		return
	}
	deleteMapKeys(s.pins, collectMatchingPinKeys(s.pins, match))
	s.pinOrder = orderKeepPresent(s.pinOrder, s.pins)
}

func (s *Store) removeRunEvidence(runID string) {
	diffKeys, artifactKeys, previewKeys := collectRunEvidenceKeys(s.diffs, s.artifacts, s.previews, runID)
	deleteMapKeys(s.diffs, diffKeys)
	s.diffOrder = orderKeepPresent(s.diffOrder, s.diffs)
	deleteMapKeys(s.artifacts, artifactKeys)
	s.artifactOrder = orderKeepPresent(s.artifactOrder, s.artifacts)
	deleteMapKeys(s.previews, previewKeys)
	s.previewOrder = orderKeepPresent(s.previewOrder, s.previews)
}

// ── UserProfile CRUD ──────────────────────────────────────

func (s *Store) CreateUserProfile(profile UserProfile) (UserProfile, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if existing, ok := s.userProfiles[profile.ID]; ok {
		return existing, nil
	}
	profile = prepareUserProfileCreate(profile, nowString())
	s.userProfiles[profile.ID] = profile
	s.userProfileOrder = append(s.userProfileOrder, profile.ID)
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

	if err := validateAgentProfileCreate(profile); err != nil {
		return AgentProfile{}, err
	}
	if _, exists := s.agentProfiles[profile.ID]; exists {
		return AgentProfile{}, errAgentProfileExists(profile.ID)
	}
	profile = prepareAgentProfileCreate(profile, nowString())
	s.agentProfiles[profile.ID] = profile
	s.agentProfileOrder = append(s.agentProfileOrder, profile.ID)
	return profile, nil
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

	if _, ok := s.agentProfiles[id]; !ok {
		return ErrNotFound
	}
	delete(s.agentProfiles, id)
	s.agentProfileOrder = removeString(s.agentProfileOrder, id)
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

	s.settings = ensureSettingsMap(s.settings)
	applySettingsPatch(s.settings, patch)
	s.settingsMtime = nowString()
	return cloneUserSettings(s.settings, s.settingsMtime)
}
