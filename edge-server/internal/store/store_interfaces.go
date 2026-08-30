package store

// Residual pure-helper peel #1144: store interfaces. Same package; zero behavior change.

type Reader interface {
	GetProject(id string) (Project, bool)
	ListProjects() []Project
	GetThread(id string) (Thread, bool)
	ListThreads(projectID string) []Thread
	GetRun(id string) (Run, bool)
	ListRuns(threadID string) []Run
	GetRunByHubTaskID(hubTaskID string) (Run, bool)
	GetRunCheckpoint(runID string) (RunCheckpoint, bool)
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
	UpsertRunCheckpoint(cp RunCheckpoint) (RunCheckpoint, error)
	UpsertArtifact(artifact Artifact) (Artifact, error)
	UpsertPreview(preview Preview) (Preview, error)
	CreateUserProfile(profile UserProfile) (UserProfile, error)
	CreateAgentProfile(profile AgentProfile) (AgentProfile, error)
	UpdateAgentProfile(id string, patch map[string]any) (AgentProfile, error)
	DeleteAgentProfile(id string) error
	UpsertSettings(patch map[string]string) (UserSettings, error)
	SetRunEvidenceGate(id, result string) (Run, bool)
	SetRunRetryCount(id string, count int) (Run, bool)
	SetRunWorkDir(id, workDir string) (Run, bool)
	SetRunHubTaskID(id, hubTaskID string) (Run, bool)
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
	SetRunWorkDir(id, workDir string) (Run, bool)
	SetRunHubTaskID(id, hubTaskID string) (Run, bool)
	UpsertRunCheckpoint(cp RunCheckpoint) (RunCheckpoint, error)
}

type RunCleaner interface {
	CleanupRuns(opts RunCleanupOptions) RunCleanupResult
}
