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
)

var _ Repository = (*FileStore)(nil)
var _ RunLifecycleStore = (*FileStore)(nil)

type fileSnapshot struct {
	Projects map[string]Project `json:"projects"`
	Threads  map[string]Thread  `json:"threads"`
	Runs     map[string]Run     `json:"runs"`
	Items    map[string]Item    `json:"items"`

	ProjectOrder []string `json:"projectOrder"`
	ThreadOrder  []string `json:"threadOrder"`
	RunOrder     []string `json:"runOrder"`
	ItemOrder    []string `json:"itemOrder"`
}

// FileStore wraps the in-memory store with a JSON snapshot saved after writes.
type FileStore struct {
	path string

	persistMu sync.Mutex
	store     *Store
	lastErr   error
}

func NewFile(path string) (*FileStore, error) {
	if path == "" {
		return nil, errors.New("store file path is required")
	}

	s := New()
	if err := loadFileSnapshot(path, s); err != nil {
		return nil, err
	}

	f := &FileStore{
		path:  path,
		store: s,
	}
	if err := f.persist(); err != nil {
		return nil, fmt.Errorf("verify store snapshot write: %w", err)
	}
	return f, nil
}

func (f *FileStore) LastPersistError() error {
	f.persistMu.Lock()
	defer f.persistMu.Unlock()
	return f.lastErr
}

func (f *FileStore) CreateProject(id, name string) (Project, error) {
	project, err := f.store.CreateProject(id, name)
	if errors.Is(err, ErrProjectExists) {
		return project, err
	}
	if err != nil {
		return Project{}, err
	}
	if err := f.persist(); err != nil {
		return project, err
	}
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
	if err := f.persist(); err != nil {
		return thread, err
	}
	return thread, nil
}

func (f *FileStore) GetThread(id string) (Thread, bool) {
	return f.store.GetThread(id)
}

func (f *FileStore) ListThreads(projectID string) []Thread {
	return f.store.ListThreads(projectID)
}

func (f *FileStore) CreateRun(id, projectID, threadID string) (Run, error) {
	run, err := f.store.CreateRun(id, projectID, threadID)
	if err != nil {
		return Run{}, err
	}
	if err := f.persist(); err != nil {
		return run, err
	}
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
		_ = f.persist()
	}
	return result
}

func (f *FileStore) SetRunStatus(id, status string) (Run, bool) {
	run, ok := f.store.SetRunStatus(id, status)
	if ok {
		// Persist error is surfaced via LastPersistError() for callers.
		_ = f.persist()
	}
	return run, ok
}

func (f *FileStore) SetRunStatusIf(id, status string, allowedCurrent ...string) (Run, bool) {
	run, ok := f.store.SetRunStatusIf(id, status, allowedCurrent...)
	if ok {
		// Persist error is surfaced via LastPersistError() for callers.
		_ = f.persist()
	}
	return run, ok
}

func (f *FileStore) CreateItem(item Item) (Item, error) {
	created, err := f.store.CreateItem(item)
	if err != nil {
		return Item{}, err
	}
	if err := f.persist(); err != nil {
		return created, err
	}
	return created, nil
}

func (f *FileStore) CreateThreadMessage(itemID, threadID, role, content string) (Item, error) {
	item, err := f.store.CreateThreadMessage(itemID, threadID, role, content)
	if err != nil {
		return Item{}, err
	}
	if err := f.persist(); err != nil {
		return item, err
	}
	return item, nil
}

func (f *FileStore) GetItem(id string) (Item, bool) {
	return f.store.GetItem(id)
}

func (f *FileStore) ListThreadItems(threadID string) []Item {
	return f.store.ListThreadItems(threadID)
}

func (f *FileStore) persist() error {
	f.persistMu.Lock()
	defer f.persistMu.Unlock()

	err := saveFileSnapshot(f.path, f.store.snapshot())
	f.lastErr = err
	return err
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
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("create store snapshot directory: %w", err)
	}

	temp, err := os.CreateTemp(dir, filepath.Base(path)+".tmp-*")
	if err != nil {
		return fmt.Errorf("create store snapshot temp file: %w", err)
	}
	tempPath := temp.Name()
	defer os.Remove(tempPath)

	encoder := json.NewEncoder(temp)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(snapshot); err != nil {
		_ = temp.Close()
		return fmt.Errorf("encode store snapshot: %w", err)
	}
	if err := temp.Close(); err != nil {
		return fmt.Errorf("close store snapshot temp file: %w", err)
	}
	if err := os.Rename(tempPath, path); err != nil {
		return fmt.Errorf("replace store snapshot: %w", err)
	}
	return nil
}
