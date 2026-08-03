package skills

import (
	"log/slog"
	"os"
	"path/filepath"
	"time"

	"github.com/fsnotify/fsnotify"
)

// hotReloadDebounce is the debounce window for file-system events during
// hot reload. Multiple events for the same path within this window are
// coalesced into a single reload.
const hotReloadDebounce = 500 * time.Millisecond

// LoadBody reads the full markdown body for a skill identified by name.
// If the body is already loaded, it returns the cached value immediately.
//
// Lock strategy: acquires a write lock (even for reads) because the first
// caller populates the Body field; subsequent callers return the cached value.
//
// Returns false if the skill is not found or the file cannot be read.
func (r *SkillRegistry) LoadBody(name string) (string, bool) {
	r.mu.RLock()
	s, ok := r.skills[name]
	r.mu.RUnlock()
	if !ok {
		return "", false
	}
	if s.Body != "" {
		return s.Body, true
	}

	r.mu.Lock()
	if s.Body != "" {
		defer r.mu.Unlock()
		return s.Body, true
	}
	body, err := ParseBody(s.Path)
	if err != nil {
		r.mu.Unlock()
		return "", false
	}
	s.Body = body
	r.mu.Unlock()
	return body, true
}

// Count returns the number of loaded skills.
func (r *SkillRegistry) Count() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.skills)
}

// IsLoaded reports whether Discover has been called.
func (r *SkillRegistry) IsLoaded() bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.loaded
}

// StartWatch begins watching skillsDir for SKILL.md changes and hot-reloads
// skills as files are created, modified, or removed. The watch is recursive
// on the top-level subdirectories (skill-name/SKILL.md structure).
//
// A 500ms debounce coalesces rapid successive events for the same path into
// a single reload. Only the changed skill file is reloaded — no full rescan.
// If the watcher cannot be created (e.g. fsnotify unavailable), a WARNING
// is logged and the method returns nil (graceful degradation).
//
// StartWatch is safe to call after Discover — it watches the same directory
// structure and keeps the registry in sync without a full rescan.
//
// To stop watching, call StopWatch.
func (r *SkillRegistry) StartWatch(skillsDir string) error {
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		slog.Warn("skills: fsnotify unavailable, hot reload disabled", "error", err, "dir", skillsDir)
		return nil // graceful degradation
	}

	// Add the top-level skills directory if it exists.
	if info, err := os.Stat(skillsDir); err == nil && info.IsDir() {
		if err := watcher.Add(skillsDir); err != nil {
			slog.Warn("skills: cannot watch skills directory, hot reload disabled", "error", err, "dir", skillsDir)
			_ = watcher.Close()
			return nil
		}
		// Add existing subdirectories for recursive watch.
		entries, err := os.ReadDir(skillsDir)
		if err == nil {
			for _, entry := range entries {
				if entry.IsDir() {
					subDir := filepath.Join(skillsDir, entry.Name())
					if err := watcher.Add(subDir); err != nil {
						slog.Warn("skills: cannot watch skill subdirectory", "error", err, "dir", subDir)
					}
				}
			}
		}
	}

	r.debounceMu.Lock()
	r.watcher = watcher
	r.stopCh = make(chan struct{})
	r.pendingPaths = make(map[string]struct{})
	r.watchStarted = true
	r.debounceMu.Unlock()

	go r.watchLoop(watcher)

	slog.Info("skills: hot reload started", "dir", skillsDir)
	return nil
}

// StopWatch shuts down the file watcher, drains pending events, and stops the
// hot reload goroutine. It is safe to call even if StartWatch was never called
// or failed — the method is a no-op when watchStarted is false.
func (r *SkillRegistry) StopWatch() error {
	r.debounceMu.Lock()
	defer r.debounceMu.Unlock()

	if !r.watchStarted || r.watcher == nil {
		return nil
	}

	// Signal the event loop to exit.
	close(r.stopCh)
	err := r.watcher.Close()
	r.watcher = nil
	r.watchStarted = false
	r.pendingPaths = nil
	if r.debounceTimer != nil {
		r.debounceTimer.Stop()
		r.debounceTimer = nil
	}

	slog.Info("skills: hot reload stopped")
	return err
}

// watchLoop is the event loop run in a goroutine by StartWatch.
// It processes file-system events from the fsnotify watcher and triggers
// debounced reloads or removes. The loop exits when stopCh is closed or
// the watcher's event/error channels are closed.
func (r *SkillRegistry) watchLoop(watcher *fsnotify.Watcher) {
	for {
		select {
		case <-r.stopCh:
			return
		case event, ok := <-watcher.Events:
			if !ok {
				return
			}
			r.handleWatchEvent(watcher, event)
		case err, ok := <-watcher.Errors:
			if !ok {
				return
			}
			slog.Warn("skills: watcher error", "error", err)
		}
	}
}

// handleWatchEvent processes a single fsnotify event.
//
// The watcher is passed as a parameter (same instance the loop was started
// with) so event handling never races with StopWatch, which nils the
// r.watcher field under debounceMu while the loop goroutine may still be
// draining an in-flight event.
//
// Event handling rules:
//   - Only SKILL.md files are tracked; all other paths are ignored.
//   - Directory CREATE events are handled specially: the new directory is added
//     to the watcher (recursive watch), and any SKILL.md already inside it is
//     queued for reload.
//   - SKILL.md CREATE, WRITE, and RENAME events trigger a debounced reload.
//   - SKILL.md REMOVE events remove the skill from the registry immediately.
//
// Other fsnotify event types (CHMOD, etc.) are ignored.
func (r *SkillRegistry) handleWatchEvent(watcher *fsnotify.Watcher, event fsnotify.Event) {
	// We only care about SKILL.md files.
	if filepath.Base(event.Name) != "SKILL.md" {
		// If a new directory is created, add it to the watcher and
		// scan for any SKILL.md already inside it (the file CREATE
		// event may have been missed before we added the directory).
		if event.Has(fsnotify.Create) {
			if info, err := os.Stat(event.Name); err == nil && info.IsDir() {
				if err := watcher.Add(event.Name); err != nil {
					slog.Warn("skills: cannot watch new skill directory", "error", err, "dir", event.Name)
				}
				// Check if SKILL.md already exists inside the new directory.
				skillPath := filepath.Join(event.Name, "SKILL.md")
				if _, err := os.Stat(skillPath); err == nil {
					r.enqueueReload(skillPath)
				}
			}
		}
		return
	}

	// React to CREATE, WRITE, RENAME (reload) and REMOVE (delete).
	if !event.Has(fsnotify.Create) && !event.Has(fsnotify.Write) &&
		!event.Has(fsnotify.Rename) && !event.Has(fsnotify.Remove) {
		return
	}

	if event.Has(fsnotify.Remove) {
		r.removeSkillByPath(event.Name)
	} else {
		r.enqueueReload(event.Name)
	}
}

// enqueueReload adds a path to the pending reload set and resets the debounce
// timer. Multiple events for the same path within hotReloadDebounce are
// coalesced — only the last one triggers a reload.
func (r *SkillRegistry) enqueueReload(path string) {
	r.debounceMu.Lock()
	defer r.debounceMu.Unlock()

	if r.pendingPaths == nil {
		return // StopWatch was called
	}
	r.pendingPaths[path] = struct{}{}

	if r.debounceTimer != nil {
		r.debounceTimer.Stop()
	}
	r.debounceTimer = time.AfterFunc(hotReloadDebounce, r.flushPendingReloads)
}

// removeSkillByPath removes a skill from the registry by its SKILL.md path.
// Called immediately on REMOVE events (not debounced) to keep the registry
// consistent: queries between the remove event and the next debounce window
// will not see a deleted skill.
func (r *SkillRegistry) removeSkillByPath(path string) {
	r.mu.Lock()
	defer r.mu.Unlock()

	for name, s := range r.skills {
		if s.Path == path {
			delete(r.skills, name)
			slog.Info("skills: hot reload removed skill", "name", name, "path", path)
			return
		}
	}
}

// flushPendingReloads processes all queued paths after the debounce window
// expires. It drains the pendingPaths map under debounceMu, then reloads each
// path under r.mu. New paths queued during the reload are handled by the next
// debounce cycle.
func (r *SkillRegistry) flushPendingReloads() {
	r.debounceMu.Lock()
	if len(r.pendingPaths) == 0 {
		r.debounceMu.Unlock()
		return
	}
	paths := r.pendingPaths
	r.pendingPaths = make(map[string]struct{})
	r.debounceMu.Unlock()

	for p := range paths {
		r.reloadSkill(p)
	}
}

// reloadSkill parses a single SKILL.md file and updates or inserts it into
// the registry. If the file is unparseable (e.g. missing name field), a
// WARNING is logged and the file is skipped — the old entry (if any) remains.
//
// Body carry-forward: if the previous entry had its body loaded but the new
// ParseFrontmatter result has no body (always the case since ParseFrontmatter
// never reads the body), the old body is carried forward. The carried-forward
// body may be stale if the markdown body changed on disk; call LoadBody
// explicitly to refresh it.
func (r *SkillRegistry) reloadSkill(path string) {
	skill, err := ParseFrontmatter(path)
	if err != nil {
		slog.Warn("skills: hot reload skipped unparseable file", "path", "path", "error", err)
		return
	}
	skill.compileTriggers()

	r.mu.Lock()
	// If a skill with the same name already exists, carry forward its Body
	// if it was previously loaded (ParseFrontmatter never loads the body).
	// NOTE: The carried-forward body may be stale if the markdown body changed
	// on disk. LoadBody must be called explicitly to refresh it.
	if old, ok := r.skills[skill.Name]; ok && old.Body != "" && skill.Body == "" {
		skill.Body = old.Body
		slog.Debug("skills: hot reload carried forward old body (may be stale until LoadBody)", "name", skill.Name, "path", path)
	}
	r.skills[skill.Name] = skill
	r.loaded = true
	r.mu.Unlock()

	slog.Info("skills: hot reload updated skill", "name", skill.Name, "path", path)
}
