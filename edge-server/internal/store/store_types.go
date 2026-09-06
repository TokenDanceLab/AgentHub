package store

// Residual pure-helper peel #1144: domain types. Same package; zero behavior change.

import (
	"time"
)

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
	WorkDir            string `json:"workDir,omitempty"`
	HubTaskID          string `json:"hubTaskId,omitempty"`
	AdmissionState     string `json:"admissionState,omitempty"`
	AdmissionErrorCode string `json:"admissionErrorCode,omitempty"`
}

type RunDiffFile struct {
	RunID     string `json:"runId"`
	Path      string `json:"path"`
	Diff      string `json:"diff"`
	Status    string `json:"status"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

// CheckpointFile captures one file's pre-run state for the run checkpoint
// preview (#1968).
type CheckpointFile struct {
	Path    string `json:"path"`
	Size    int64  `json:"sizeBytes"`
	Hash    string `json:"hash"`
	Content string `json:"content,omitempty"`
}

// RunCheckpoint is the pre-run workdir snapshot of a run (#1968), keyed by
// RunID (1:1). Read-only evidence: it survives run completion and feeds the
// timeline checkpoint-card preview. Restore/write-back is deliberately NOT
// wired here — see docs/architecture/02-edge-server.md restore semantics.
type RunCheckpoint struct {
	ID         string           `json:"checkpointId"`
	RunID      string           `json:"runId"`
	WorkDir    string           `json:"workDir"`
	FileCount  int              `json:"fileCount"`
	TotalBytes int64            `json:"totalBytes"`
	CreatedAt  string           `json:"createdAt"`
	Files      []CheckpointFile `json:"files"`
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
