package store

import (
	"errors"
	"sort"
	"strings"
	"sync"
	"time"
)

var ErrNotFound = errors.New("not found")
var ErrProjectExists = errors.New("project already exists")

type Project struct {
	ID        string `json:"projectId"`
	Name      string `json:"name"`
	Status    string `json:"status"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

type Thread struct {
	ID        string `json:"threadId"`
	ProjectID string `json:"projectId"`
	Title     string `json:"title"`
	Status    string `json:"status"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

type Run struct {
	ID         string `json:"runId"`
	ProjectID  string `json:"projectId"`
	ThreadID   string `json:"threadId"`
	Status     string `json:"status"`
	CreatedAt  string `json:"createdAt"`
	StartedAt  string `json:"startedAt,omitempty"`
	FinishedAt string `json:"finishedAt,omitempty"`
}

type Item struct {
	ID        string `json:"itemId"`
	ProjectID string `json:"projectId"`
	ThreadID  string `json:"threadId"`
	RunID     string `json:"runId,omitempty"`
	Type      string `json:"type"`
	Role      string `json:"role,omitempty"`
	Status    string `json:"status"`
	Content   string `json:"content,omitempty"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
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
}

type Writer interface {
	CreateProject(id, name string) (Project, error)
	CreateThread(id, projectID, title string) (Thread, error)
	CreateRun(id, projectID, threadID string) (Run, error)
	SetRunStatus(id, status string) (Run, bool)
	SetRunStatusIf(id, status string, allowedCurrent ...string) (Run, bool)
	CreateItem(item Item) (Item, error)
	CreateThreadMessage(itemID, threadID, role, content string) (Item, error)
}

type Repository interface {
	Reader
	Writer
}

type RunLifecycleStore interface {
	GetRun(id string) (Run, bool)
	SetRunStatus(id, status string) (Run, bool)
	SetRunStatusIf(id, status string, allowedCurrent ...string) (Run, bool)
}

type RunCleaner interface {
	CleanupRuns(opts RunCleanupOptions) RunCleanupResult
}

type Store struct {
	mu sync.RWMutex

	projects map[string]Project
	threads  map[string]Thread
	runs     map[string]Run
	items    map[string]Item

	projectOrder []string
	threadOrder  []string
	runOrder     []string
	itemOrder    []string
}

func New() *Store {
	return &Store{
		projects: make(map[string]Project),
		threads:  make(map[string]Thread),
		runs:     make(map[string]Run),
		items:    make(map[string]Item),
	}
}

func (s *Store) snapshot() fileSnapshot {
	s.mu.RLock()
	defer s.mu.RUnlock()

	return fileSnapshot{
		Projects:     copyMap(s.projects),
		Threads:      copyMap(s.threads),
		Runs:         copyMap(s.runs),
		Items:        copyMap(s.items),
		ProjectOrder: append([]string(nil), s.projectOrder...),
		ThreadOrder:  append([]string(nil), s.threadOrder...),
		RunOrder:     append([]string(nil), s.runOrder...),
		ItemOrder:    append([]string(nil), s.itemOrder...),
	}
}

func (s *Store) applySnapshot(snapshot fileSnapshot) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.projects = copyMap(snapshot.Projects)
	s.threads = copyMap(snapshot.Threads)
	s.runs = copyMap(snapshot.Runs)
	s.items = copyMap(snapshot.Items)
	s.projectOrder = normalizeOrder(snapshot.ProjectOrder, s.projects)
	s.threadOrder = normalizeOrder(snapshot.ThreadOrder, s.threads)
	s.runOrder = normalizeOrder(snapshot.RunOrder, s.runs)
	s.itemOrder = normalizeOrder(snapshot.ItemOrder, s.items)
}

func copyMap[K comparable, V any](source map[K]V) map[K]V {
	copied := make(map[K]V, len(source))
	for key, value := range source {
		copied[key] = value
	}
	return copied
}

func normalizeOrder[V any](order []string, items map[string]V) []string {
	normalized := make([]string, 0, len(items))
	seen := make(map[string]struct{}, len(items))
	for _, id := range order {
		if _, ok := items[id]; !ok {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		normalized = append(normalized, id)
		seen[id] = struct{}{}
	}

	missing := make([]string, 0, len(items)-len(seen))
	for id := range items {
		if _, ok := seen[id]; !ok {
			missing = append(missing, id)
		}
	}
	sort.Strings(missing)
	return append(normalized, missing...)
}

func (s *Store) CreateProject(id, name string) (Project, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if existing, ok := s.projects[id]; ok {
		return existing, ErrProjectExists
	}
	if name == "" {
		name = "Local Project"
	}
	now := nowString()
	project := Project{
		ID:        id,
		Name:      name,
		Status:    "active",
		CreatedAt: now,
		UpdatedAt: now,
	}
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

	projects := make([]Project, 0, len(s.projectOrder))
	for _, id := range s.projectOrder {
		projects = append(projects, s.projects[id])
	}
	return projects
}

func (s *Store) CreateThread(id, projectID, title string) (Thread, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.projects[projectID]; !ok {
		return Thread{}, ErrNotFound
	}
	if existing, ok := s.threads[id]; ok {
		return existing, nil
	}
	if title == "" {
		title = "New Thread"
	}
	now := nowString()
	thread := Thread{
		ID:        id,
		ProjectID: projectID,
		Title:     title,
		Status:    "active",
		CreatedAt: now,
		UpdatedAt: now,
	}
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

func (s *Store) ListThreads(projectID string) []Thread {
	s.mu.RLock()
	defer s.mu.RUnlock()

	threads := make([]Thread, 0, len(s.threadOrder))
	for _, id := range s.threadOrder {
		thread := s.threads[id]
		if projectID == "" || thread.ProjectID == projectID {
			threads = append(threads, thread)
		}
	}
	return threads
}

func (s *Store) CreateRun(id, projectID, threadID string) (Run, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.projects[projectID]; !ok {
		return Run{}, ErrNotFound
	}
	thread, ok := s.threads[threadID]
	if !ok || thread.ProjectID != projectID {
		return Run{}, ErrNotFound
	}
	if existing, ok := s.runs[id]; ok {
		return existing, nil
	}
	run := Run{
		ID:        id,
		ProjectID: projectID,
		ThreadID:  threadID,
		Status:    "queued",
		CreatedAt: nowString(),
	}
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

	runs := make([]Run, 0, len(s.runOrder))
	for _, id := range s.runOrder {
		run := s.runs[id]
		if threadID == "" || run.ThreadID == threadID {
			runs = append(runs, run)
		}
	}
	return runs
}

func (s *Store) CleanupRuns(opts RunCleanupOptions) RunCleanupResult {
	s.mu.Lock()
	defer s.mu.Unlock()

	if opts.Now.IsZero() {
		opts.Now = time.Now().UTC()
	}

	type cleanupCandidate struct {
		id         string
		threadID   string
		terminalAt time.Time
		hasTime    bool
		order      int
	}

	candidates := make([]cleanupCandidate, 0, len(s.runOrder))
	removeRuns := map[string]struct{}{}
	for idx, id := range s.runOrder {
		run, ok := s.runs[id]
		if !ok || !isTerminalRunStatus(run.Status) {
			continue
		}

		terminalAt, hasTime := runTerminalTime(run)
		candidates = append(candidates, cleanupCandidate{
			id:         id,
			threadID:   run.ThreadID,
			terminalAt: terminalAt,
			hasTime:    hasTime,
			order:      idx,
		})
		if opts.TerminalTTL > 0 && hasTime && !terminalAt.After(opts.Now.Add(-opts.TerminalTTL)) {
			removeRuns[id] = struct{}{}
		}
	}

	if opts.MaxTerminalRunsPerThread > 0 {
		byThread := make(map[string][]cleanupCandidate)
		for _, candidate := range candidates {
			if _, deleting := removeRuns[candidate.id]; deleting {
				continue
			}
			byThread[candidate.threadID] = append(byThread[candidate.threadID], candidate)
		}
		for _, threadRuns := range byThread {
			sort.SliceStable(threadRuns, func(i, j int) bool {
				left := threadRuns[i]
				right := threadRuns[j]
				if left.hasTime && right.hasTime && !left.terminalAt.Equal(right.terminalAt) {
					return left.terminalAt.After(right.terminalAt)
				}
				if left.hasTime != right.hasTime {
					return left.hasTime
				}
				return left.order > right.order
			})
			if len(threadRuns) <= opts.MaxTerminalRunsPerThread {
				continue
			}
			for _, candidate := range threadRuns[opts.MaxTerminalRunsPerThread:] {
				removeRuns[candidate.id] = struct{}{}
			}
		}
	}

	if len(removeRuns) == 0 {
		return RunCleanupResult{}
	}

	for id := range removeRuns {
		delete(s.runs, id)
	}
	s.runOrder = filterIDs(s.runOrder, func(id string) bool {
		_, remove := removeRuns[id]
		return !remove
	})

	removedItems := 0
	for id, item := range s.items {
		if _, remove := removeRuns[item.RunID]; remove {
			delete(s.items, id)
			removedItems++
		}
	}
	if removedItems > 0 {
		s.itemOrder = filterIDs(s.itemOrder, func(id string) bool {
			_, ok := s.items[id]
			return ok
		})
	}

	return RunCleanupResult{
		RemovedRuns:  len(removeRuns),
		RemovedItems: removedItems,
	}
}

func filterIDs(ids []string, keep func(string) bool) []string {
	filtered := ids[:0]
	for _, id := range ids {
		if keep(id) {
			filtered = append(filtered, id)
		}
	}
	return filtered
}

func isTerminalRunStatus(status string) bool {
	switch status {
	case "cancelled", "failed", "finished":
		return true
	default:
		return false
	}
}

func runTerminalTime(run Run) (time.Time, bool) {
	if run.FinishedAt != "" {
		if t, err := time.Parse(time.RFC3339, run.FinishedAt); err == nil {
			return t, true
		}
	}
	if run.CreatedAt != "" {
		if t, err := time.Parse(time.RFC3339, run.CreatedAt); err == nil {
			return t, true
		}
	}
	return time.Time{}, false
}

func (s *Store) SetRunStatus(id, status string) (Run, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	run, ok := s.runs[id]
	if !ok {
		return Run{}, false
	}
	switch status {
	case "started":
		run.StartedAt = nowString()
	case "cancelled", "finished", "failed":
		run.FinishedAt = nowString()
	}
	run.Status = status
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
	allowed := len(allowedCurrent) == 0
	for _, current := range allowedCurrent {
		if run.Status == current {
			allowed = true
			break
		}
	}
	if !allowed {
		return run, false
	}
	switch status {
	case "started":
		run.StartedAt = nowString()
	case "finished", "failed", "cancelled":
		run.FinishedAt = nowString()
	}
	run.Status = status
	s.runs[id] = run
	return run, true
}

func (s *Store) CreateItem(item Item) (Item, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.projects[item.ProjectID]; !ok {
		return Item{}, ErrNotFound
	}
	thread, ok := s.threads[item.ThreadID]
	if !ok || thread.ProjectID != item.ProjectID {
		return Item{}, ErrNotFound
	}
	if item.RunID != "" {
		run, ok := s.runs[item.RunID]
		if !ok || run.ThreadID != item.ThreadID {
			return Item{}, ErrNotFound
		}
	}
	if existing, ok := s.items[item.ID]; ok {
		return existing, nil
	}
	if item.Type == "" {
		item.Type = "event"
	}
	if item.Status == "" {
		item.Status = "created"
	}
	now := nowString()
	item.CreatedAt = now
	item.UpdatedAt = now
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
	role = strings.TrimSpace(role)
	if role == "" {
		role = "user"
	}
	return s.CreateItem(Item{
		ID:        itemID,
		ProjectID: thread.ProjectID,
		ThreadID:  thread.ID,
		Type:      "user_message",
		Role:      role,
		Status:    "created",
		Content:   content,
	})
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

	items := make([]Item, 0, len(s.itemOrder))
	for _, id := range s.itemOrder {
		item := s.items[id]
		if item.ThreadID == threadID {
			items = append(items, item)
		}
	}
	sort.SliceStable(items, func(i, j int) bool {
		return items[i].CreatedAt < items[j].CreatedAt
	})
	return items
}

func nowString() string {
	return time.Now().UTC().Format(time.RFC3339)
}
