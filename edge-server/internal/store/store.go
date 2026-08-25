package store

// In-memory Store core after residual peel #1144. Zero behavior change.
// Companions: store_types, store_interfaces, store_projects, store_domain.

import (
	"errors"
	"sync"
)

var ErrNotFound = errors.New("not found")
var ErrProjectExists = errors.New("project already exists")

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
	checkpoints   map[string]RunCheckpoint
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
		s.checkpoints,
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

	s.projects, s.threads, s.runs, s.items, s.pins, s.diffs, s.artifacts, s.previews, s.checkpoints, s.userProfiles, s.agentProfiles,
		s.projectOrder, s.threadOrder, s.runOrder, s.itemOrder, s.pinOrder, s.diffOrder, s.artifactOrder, s.previewOrder, s.userProfileOrder, s.agentProfileOrder,
		s.settings, s.settingsMtime =
		materializeFileSnapshot(snapshot)
}
