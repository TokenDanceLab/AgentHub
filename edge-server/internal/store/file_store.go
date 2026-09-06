package store

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/agenthub/pkg/safego"
)

var _ Repository = (*FileStore)(nil)
var _ RunLifecycleStore = (*FileStore)(nil)

type fileSnapshot struct {
	Projects  map[string]Project     `json:"projects"`
	Threads   map[string]Thread      `json:"threads"`
	Runs      map[string]Run         `json:"runs"`
	Items     map[string]Item        `json:"items"`
	Pins      map[string]ThreadPin   `json:"pins"`
	Diffs     map[string]RunDiffFile `json:"diffs"`
	Artifacts map[string]Artifact    `json:"artifacts"`
	Previews  map[string]Preview     `json:"previews"`

	Checkpoints map[string]RunCheckpoint `json:"checkpoints,omitempty"`

	UserProfiles  map[string]UserProfile  `json:"userProfiles,omitempty"`
	AgentProfiles map[string]AgentProfile `json:"agentProfiles,omitempty"`

	ProjectOrder      []string `json:"projectOrder"`
	ThreadOrder       []string `json:"threadOrder"`
	RunOrder          []string `json:"runOrder"`
	ItemOrder         []string `json:"itemOrder"`
	PinOrder          []string `json:"pinOrder"`
	DiffOrder         []string `json:"diffOrder"`
	ArtifactOrder     []string `json:"artifactOrder"`
	PreviewOrder      []string `json:"previewOrder"`
	UserProfileOrder  []string `json:"userProfileOrder,omitempty"`
	AgentProfileOrder []string `json:"agentProfileOrder,omitempty"`

	Settings      map[string]string `json:"settings,omitempty"`
	SettingsMtime string            `json:"settingsMtime,omitempty"`
}

// FileStore wraps the in-memory store with a JSON snapshot saved asynchronously after writes.
// Writes within a fixed window batch into one disk write; continuous traffic
// cannot postpone persistence by repeatedly restarting that window.
type FileStore struct {
	path string

	persistMu sync.Mutex
	store     *Store
	lastErr   error

	persistCh chan struct{}
	done      chan struct{}
	closeOnce sync.Once

	// persistChMu + closed guard schedulePersist against Close: sending on
	// a closed channel panics even inside a select, so the check-and-send
	// must be atomic with the close (#2154 F2).
	persistChMu sync.RWMutex
	closed      bool
}

const debounceInterval = 50 * time.Millisecond

func NewFile(path string) (*FileStore, error) {
	if path == "" {
		return nil, errors.New("store file path is required")
	}

	if err := ensureFileSnapshotDirectory(path); err != nil {
		return nil, fmt.Errorf("verify store snapshot write: %w", err)
	}

	s := New()
	if err := loadFileSnapshot(path, s); err != nil {
		return nil, err
	}

	f := &FileStore{
		path:      path,
		store:     s,
		persistCh: make(chan struct{}, 1),
		done:      make(chan struct{}),
	}
	safego.SafeGo("store.file_persist_loop", f.persistLoop)

	// Initial persist to verify write path works.
	if err := f.syncPersist(); err != nil {
		f.Close()
		return nil, fmt.Errorf("verify store snapshot write: %w", err)
	}
	return f, nil
}

// Close stops the background persist goroutine and flushes pending writes.
// Concurrent schedulePersist callers are fenced by persistChMu: after Close
// returns, further writes are accepted in memory but no longer scheduled.
func (f *FileStore) Close() {
	f.closeOnce.Do(func() {
		f.persistChMu.Lock()
		f.closed = true
		close(f.persistCh)
		f.persistChMu.Unlock()
		<-f.done
	})
}

// Flush writes the current in-memory state to disk synchronously.
// Failures are retained on LastPersistError; callers that need durability
// honesty must check that API rather than treat Flush as infallible.
func (f *FileStore) Flush() {
	if err := f.syncPersist(); err != nil {
		// Keep the existing Flush() signature; surface the failure via lastErr.
		return
	}
}

func (f *FileStore) LastPersistError() error {
	f.persistMu.Lock()
	defer f.persistMu.Unlock()
	return f.lastErr
}

// schedulePersist signals the background loop to persist. Non-blocking.
// The closed-check and the send happen under persistChMu.RLock so they can
// never race Close's channel shutdown (send-on-closed panics even in a
// select). Post-close calls are no-ops; Flush remains available.
func (f *FileStore) schedulePersist() {
	f.persistChMu.RLock()
	defer f.persistChMu.RUnlock()
	if f.closed {
		return
	}
	select {
	case f.persistCh <- struct{}{}:
	default:
	}
}

// persistLoop coalesces writes until the first pending signal's deadline.
func (f *FileStore) persistLoop() {
	defer close(f.done)

	timer := time.NewTimer(0)
	if !timer.Stop() {
		<-timer.C
	}
	defer timer.Stop()
	pending := false

	for {
		select {
		case _, ok := <-f.persistCh:
			if !ok {
				// Failure is surfaced via LastPersistError, matching Flush() semantics.
				_ = f.syncPersist()
				return
			}
			if !pending {
				timer.Reset(debounceInterval)
				pending = true
			}
		case <-timer.C:
			pending = false
			// Failure is surfaced via LastPersistError, matching Flush() semantics.
			_ = f.syncPersist()
		}
	}
}

// syncPersist performs the actual file write. Called by persistLoop and Close.
func (f *FileStore) syncPersist() error {
	f.persistMu.Lock()
	defer f.persistMu.Unlock()

	err := saveFileSnapshot(f.path, f.store.snapshot())
	f.lastErr = err
	return err
}

func (f *FileStore) CreateProject(id, name, ownerID string) (Project, error) {
	project, err := f.store.CreateProject(id, name, ownerID)
	if errors.Is(err, ErrProjectExists) {
		return project, err
	}
	if err != nil {
		return Project{}, err
	}
	f.schedulePersist()
	return project, nil
}

func (f *FileStore) GetProject(id string) (Project, bool) {
	return f.store.GetProject(id)
}

func (f *FileStore) ListProjects() []Project {
	return f.store.ListProjects()
}

func (f *FileStore) CreateThread(id, projectID, title, kind, avatarColor, avatarLabel string) (Thread, error) {
	thread, err := f.store.CreateThread(id, projectID, title, kind, avatarColor, avatarLabel)
	if err != nil {
		return Thread{}, err
	}
	f.schedulePersist()
	return thread, nil
}

func (f *FileStore) GetThread(id string) (Thread, bool) {
	return f.store.GetThread(id)
}

func (f *FileStore) UpdateThread(id string, title *string, status *string) (Thread, bool) {
	thread, ok := f.store.UpdateThread(id, title, status)
	if !ok {
		return Thread{}, false
	}
	f.schedulePersist()
	return thread, true
}

func (f *FileStore) DeleteThread(id string) bool {
	ok := f.store.DeleteThread(id)
	if !ok {
		return false
	}
	f.schedulePersist()
	return true
}

func (f *FileStore) ListThreads(projectID string) []Thread {
	return f.store.ListThreads(projectID)
}

func (f *FileStore) CreateRun(id, projectID, threadID string) (Run, error) {
	run, err := f.store.CreateRun(id, projectID, threadID)
	if err != nil {
		return Run{}, err
	}
	f.schedulePersist()
	return run, nil
}

func (f *FileStore) GetRun(id string) (Run, bool) {
	return f.store.GetRun(id)
}

func (f *FileStore) ListRuns(threadID string) []Run {
	return f.store.ListRuns(threadID)
}

func (f *FileStore) CleanupRuns(opts RunCleanupOptions) RunCleanupResult {
	result := f.store.CleanupRuns(opts)
	if result.RemovedRuns > 0 || result.RemovedItems > 0 {
		f.schedulePersist()
	}
	return result
}

func (f *FileStore) SetRunStatus(id, status string) (Run, bool) {
	run, ok := f.store.SetRunStatus(id, status)
	if ok {
		f.schedulePersist()
	}
	return run, ok
}

func (f *FileStore) SetRunStatusIf(id, status string, allowedCurrent ...string) (Run, bool) {
	run, ok := f.store.SetRunStatusIf(id, status, allowedCurrent...)
	if ok {
		f.schedulePersist()
	}
	return run, ok
}

func (f *FileStore) SetRunEvidenceGate(id, result string) (Run, bool) {
	run, ok := f.store.SetRunEvidenceGate(id, result)
	if ok {
		f.schedulePersist()
	}
	return run, ok
}

func (f *FileStore) SetRunRetryCount(id string, count int) (Run, bool) {
	run, ok := f.store.SetRunRetryCount(id, count)
	if ok {
		f.schedulePersist()
	}
	return run, ok
}

func (f *FileStore) SetRunWorkDir(id, workDir string) (Run, bool) {
	run, ok := f.store.SetRunWorkDir(id, workDir)
	if ok {
		f.schedulePersist()
	}
	return run, ok
}

func (f *FileStore) GetRunByHubTaskID(hubTaskID string) (Run, bool) {
	return f.store.GetRunByHubTaskID(hubTaskID)
}

func (f *FileStore) SetRunHubTaskID(id, hubTaskID string) (Run, bool) {
	run, ok := f.store.SetRunHubTaskID(id, hubTaskID)
	if ok {
		f.schedulePersist()
	}
	return run, ok
}

func (f *FileStore) CreateItem(item Item) (Item, error) {
	created, err := f.store.CreateItem(item)
	if err != nil {
		return Item{}, err
	}
	f.schedulePersist()
	return created, nil
}

func (f *FileStore) CreateThreadMessage(itemID, threadID, role, content string) (Item, error) {
	item, err := f.store.CreateThreadMessage(itemID, threadID, role, content)
	if err != nil {
		return Item{}, err
	}
	f.schedulePersist()
	return item, nil
}

func (f *FileStore) GetItem(id string) (Item, bool) {
	return f.store.GetItem(id)
}

func (f *FileStore) ListThreadItems(threadID string) []Item {
	return f.store.ListThreadItems(threadID)
}

func (f *FileStore) PinThreadItem(threadID, itemID, pinnedBy string) (ThreadPin, error) {
	pin, err := f.store.PinThreadItem(threadID, itemID, pinnedBy)
	if err != nil {
		return ThreadPin{}, err
	}
	f.schedulePersist()
	return pin, nil
}

func (f *FileStore) DeleteThreadPin(threadID, itemID string) bool {
	ok := f.store.DeleteThreadPin(threadID, itemID)
	if ok {
		f.schedulePersist()
	}
	return ok
}

func (f *FileStore) ListThreadPins(threadID string) []ThreadPin {
	return f.store.ListThreadPins(threadID)
}

func (f *FileStore) UpsertRunDiffFile(file RunDiffFile) (RunDiffFile, error) {
	diffFile, err := f.store.UpsertRunDiffFile(file)
	if err != nil {
		return RunDiffFile{}, err
	}
	f.schedulePersist()
	return diffFile, nil
}

func (f *FileStore) ListRunDiffFiles(runID string) []RunDiffFile {
	return f.store.ListRunDiffFiles(runID)
}

func (f *FileStore) UpsertRunCheckpoint(cp RunCheckpoint) (RunCheckpoint, error) {
	checkpoint, err := f.store.UpsertRunCheckpoint(cp)
	if err != nil {
		return RunCheckpoint{}, err
	}
	f.schedulePersist()
	return checkpoint, nil
}

func (f *FileStore) GetRunCheckpoint(runID string) (RunCheckpoint, bool) {
	return f.store.GetRunCheckpoint(runID)
}

func (f *FileStore) UpsertArtifact(artifact Artifact) (Artifact, error) {
	created, err := f.store.UpsertArtifact(artifact)
	if err != nil {
		return Artifact{}, err
	}
	f.schedulePersist()
	return created, nil
}

func (f *FileStore) ListArtifacts(runID string) []Artifact {
	return f.store.ListArtifacts(runID)
}

func (f *FileStore) GetArtifact(id string) (Artifact, bool) {
	return f.store.GetArtifact(id)
}

func (f *FileStore) UpsertPreview(preview Preview) (Preview, error) {
	created, err := f.store.UpsertPreview(preview)
	if err != nil {
		return Preview{}, err
	}
	f.schedulePersist()
	return created, nil
}

func (f *FileStore) ListPreviews(runID string) []Preview {
	return f.store.ListPreviews(runID)
}

func (f *FileStore) GetPreview(id string) (Preview, bool) {
	return f.store.GetPreview(id)
}

// ── AgentProfile delegating methods ──

func (f *FileStore) CreateAgentProfile(profile AgentProfile) (AgentProfile, error) {
	created, err := f.store.CreateAgentProfile(profile)
	if err != nil {
		return AgentProfile{}, err
	}
	f.schedulePersist()
	return created, nil
}

func (f *FileStore) GetAgentProfile(id string) (AgentProfile, bool) {
	return f.store.GetAgentProfile(id)
}

func (f *FileStore) ListAgentProfiles(adapterID string) []AgentProfile {
	return f.store.ListAgentProfiles(adapterID)
}

func (f *FileStore) UpdateAgentProfile(id string, patch map[string]any) (AgentProfile, error) {
	profile, err := f.store.UpdateAgentProfile(id, patch)
	if err != nil {
		return AgentProfile{}, err
	}
	f.schedulePersist()
	return profile, nil
}

func (f *FileStore) DeleteAgentProfile(id string) error {
	if err := f.store.DeleteAgentProfile(id); err != nil {
		return err
	}
	f.schedulePersist()
	return nil
}

func (f *FileStore) CreateUserProfile(profile UserProfile) (UserProfile, error) {
	created, err := f.store.CreateUserProfile(profile)
	if err != nil {
		return UserProfile{}, err
	}
	f.schedulePersist()
	return created, nil
}

func (f *FileStore) GetUserProfile(id string) (UserProfile, bool) {
	return f.store.GetUserProfile(id)
}

func (f *FileStore) ListUserProfiles() []UserProfile {
	return f.store.ListUserProfiles()
}

func ensureFileSnapshotDirectory(path string) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return fmt.Errorf("create store snapshot directory: %w", err)
	}
	info, err := os.Stat(dir)
	if err != nil {
		return fmt.Errorf("stat store snapshot directory: %w", err)
	}
	if !info.IsDir() {
		return fmt.Errorf("create store snapshot directory: %s is not a directory", dir)
	}
	return nil
}

func loadFileSnapshot(path string, s *Store) error {
	// #nosec G304 -- snapshot path is under the edge's own data dir
	content, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("read store snapshot: %w", err)
	}
	if strings.TrimSpace(string(content)) == "" {
		return nil
	}

	var snapshot fileSnapshot
	decoder := json.NewDecoder(strings.NewReader(string(content)))
	if err := decoder.Decode(&snapshot); err != nil {
		return fmt.Errorf("decode store snapshot: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return fmt.Errorf("decode store snapshot: trailing data")
	}
	s.applySnapshot(snapshot)
	return nil
}

func saveFileSnapshot(path string, snapshot fileSnapshot) error {
	if err := ensureFileSnapshotDirectory(path); err != nil {
		return err
	}
	dir := filepath.Dir(path)

	temp, err := os.CreateTemp(dir, filepath.Base(path)+".tmp-*")
	if err != nil {
		return fmt.Errorf("create store snapshot temp file: %w", err)
	}
	defer temp.Close()
	tempPath := temp.Name()
	defer os.Remove(tempPath)

	encoder := json.NewEncoder(temp)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(snapshot); err != nil {
		return fmt.Errorf("encode store snapshot: %w", err)
	}
	// Durable stage-swap: fsync the temp payload before rename so a crash between
	// write and replace cannot leave a zero-length/partial target after promotion.
	if err := temp.Sync(); err != nil {
		return fmt.Errorf("sync store snapshot temp: %w", err)
	}
	// Close before rename — required on Windows where open handles block os.Rename.
	if err := temp.Close(); err != nil {
		return fmt.Errorf("close store snapshot temp: %w", err)
	}
	if err := os.Rename(tempPath, path); err != nil {
		return fmt.Errorf("replace store snapshot: %w", err)
	}
	return nil
}

func (f *FileStore) GetCurrentUser() (UserProfile, bool) {
	return f.store.GetCurrentUser()
}

// ── UserSettings delegating methods ──

func (f *FileStore) GetSettings() UserSettings {
	return f.store.GetSettings()
}

func (f *FileStore) UpsertSettings(patch map[string]string) (UserSettings, error) {
	result, err := f.store.UpsertSettings(patch)
	if err != nil {
		return result, err
	}
	f.schedulePersist()
	return result, nil
}
