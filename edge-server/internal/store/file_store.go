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
)

var _ Repository = (*FileStore)(nil)
var _ RunLifecycleStore = (*FileStore)(nil)

type fileSnapshot struct {
	Projects map[string]Project   `json:"projects"`
	Threads  map[string]Thread    `json:"threads"`
	Runs     map[string]Run       `json:"runs"`
	Items    map[string]Item      `json:"items"`
	Pins     map[string]ThreadPin `json:"pins"`

	ProjectOrder []string `json:"projectOrder"`
	ThreadOrder  []string `json:"threadOrder"`
	RunOrder     []string `json:"runOrder"`
	ItemOrder    []string `json:"itemOrder"`
	PinOrder     []string `json:"pinOrder"`
}

// FileStore wraps the in-memory store with a JSON snapshot saved asynchronously after writes.
// Writes are debounced — rapid mutations batch into a single disk write.
type FileStore struct {
	path string

	persistMu sync.Mutex
	store     *Store
	lastErr   error

	persistCh chan struct{}
	done      chan struct{}
	closeOnce sync.Once
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
	go f.persistLoop()

	// Initial persist to verify write path works.
	if err := f.syncPersist(); err != nil {
		f.Close()
		return nil, fmt.Errorf("verify store snapshot write: %w", err)
	}
	return f, nil
}

// Close stops the background persist goroutine and flushes pending writes.
func (f *FileStore) Close() {
	f.closeOnce.Do(func() {
		close(f.persistCh)
		<-f.done
	})
}

// Flush writes the current in-memory state to disk synchronously.
func (f *FileStore) Flush() {
	f.syncPersist()
}

func (f *FileStore) LastPersistError() error {
	f.persistMu.Lock()
	defer f.persistMu.Unlock()
	return f.lastErr
}

// schedulePersist signals the background loop to persist. Non-blocking.
func (f *FileStore) schedulePersist() {
	select {
	case f.persistCh <- struct{}{}:
	default:
	}
}

// persistLoop runs in the background, debouncing persist calls.
func (f *FileStore) persistLoop() {
	defer close(f.done)

	timer := time.NewTimer(0)
	if !timer.Stop() {
		<-timer.C
	}

	for {
		select {
		case _, ok := <-f.persistCh:
			if !ok {
				f.syncPersist()
				return
			}
			timer.Reset(debounceInterval)
		case <-timer.C:
			f.syncPersist()
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

func (f *FileStore) CreateProject(id, name string) (Project, error) {
	project, err := f.store.CreateProject(id, name)
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

func (f *FileStore) CreateThread(id, projectID, title string) (Thread, error) {
	thread, err := f.store.CreateThread(id, projectID, title)
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

func ensureFileSnapshotDirectory(path string) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
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
	// Close before rename — required on Windows where open handles block os.Rename.
	if err := temp.Close(); err != nil {
		return fmt.Errorf("close store snapshot temp: %w", err)
	}
	if err := os.Rename(tempPath, path); err != nil {
		return fmt.Errorf("replace store snapshot: %w", err)
	}
	return nil
}
