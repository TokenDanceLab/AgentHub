package store

// Residual pure-helper peel #1144: project/thread methods. Same package; zero behavior change.

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

func (s *Store) removePins(match func(ThreadPin) bool) {
	s.pinOrder = pruneMatchingPins(s.pins, s.pinOrder, match)
}

func (s *Store) removeRunEvidence(runID string) {
	delete(s.checkpoints, runID)
	s.diffOrder, s.artifactOrder, s.previewOrder = pruneRunEvidence(
		s.diffs, s.artifacts, s.previews,
		s.diffOrder, s.artifactOrder, s.previewOrder,
		runID,
	)
}

// ── UserProfile CRUD ──────────────────────────────────────
