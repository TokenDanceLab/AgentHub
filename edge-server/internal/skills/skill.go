// Package skills provides SKILL.md discovery, parsing, progressive loading,
// trigger-word matching, and hot reload via filesystem watch (fsnotify).
//
// SKILL.md files follow the Codex CLI standard with YAML frontmatter:
//
//	---
//	name: my-skill
//	description: "What this skill does"
//	triggers:
//	  - build
//	  - deploy
//	---
//	# Markdown body
//
// The SkillRegistry supports lazy loading: Discover loads only name+description;
// LoadBody reads the full markdown body on demand, typically triggered by
// explicit invocation ($skill-name) or trigger-word matching.
//
// Hot reload watches the skills directory tree for SKILL.md changes (create,
// modify, rename, delete) and updates the registry in real time without a full
// rescan. The watch is recursive on top-level subdirectories and uses a 500ms
// debounce to coalesce rapid successive events.
package skills

import (
	"regexp"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
)

// Skill represents a parsed SKILL.md file.
// All fields except Body are populated by Discover/ParseFrontmatter.
// Body is loaded lazily via LoadBody to keep startup fast with progressive loading.
type Skill struct {
	Name        string   // from YAML frontmatter "name"
	Description string   // from YAML frontmatter "description"
	Triggers    []string // from YAML frontmatter "triggers" (comma-separated or list); case-insensitive matching
	Body        string   // full markdown body (after frontmatter); empty until LoadBody is called
	Path        string   // absolute file path to the SKILL.md

	// compiledTriggers caches pre-compiled regexp for word-boundary matching.
	// Populated by compileTriggers() during Discover or reloadSkill.
	// Each regexp is (?i)\b + regexp.QuoteMeta(trigger) + \b, safe from ReDoS
	// because regexp.QuoteMeta escapes all metacharacters.
	compiledTriggers []*regexp.Regexp
}

// SkillSummary is the lightweight view of a skill (name + description only).
// It is produced by Discover without reading the full markdown body,
// enabling fast startup with progressive loading.
type SkillSummary struct {
	Name        string
	Description string
	Path        string
}

// SkillRegistry holds discovered skills and supports name lookup, body loading,
// trigger-word matching, and hot reload via filesystem watch.
//
// Thread-safety: all exported methods acquire the appropriate lock (RWMutex).
// Internal methods (matchTriggerWordBoundaryLocked) require the caller to hold
// at least a read lock.
type SkillRegistry struct {
	mu     sync.RWMutex
	skills map[string]*Skill // name -> skill
	dirs   []string          // search directories passed to NewSkillRegistry
	loaded bool              // true after Discover ran at least once

	// UseWordBoundary toggles word-boundary matching in MatchTrigger.
	// When false (default), triggers are matched via case-insensitive substring.
	// When true, triggers are matched as whole words using pre-compiled regexp (\b).
	UseWordBoundary bool

	// Hot reload fields. Managed by StartWatch/StopWatch; accessed under
	// debounceMu for coordination and r.mu for registry mutations.
	watcher       *fsnotify.Watcher
	stopCh        chan struct{}
	pendingPaths  map[string]struct{} // paths queued for reload (accessed under debounceMu)
	debounceTimer *time.Timer
	debounceMu    sync.Mutex
	watchStarted  bool // true after StartWatch succeeds
}

// NewSkillRegistry creates a registry that scans the given directories
// for SKILL.md files. Directories are resolved to absolute paths during
// Discover. Call Discover() after construction to populate skills, then
// optionally StartWatch() for hot reload.
func NewSkillRegistry(dirs []string) *SkillRegistry {
	return &SkillRegistry{
		skills: make(map[string]*Skill),
		dirs:   dirs,
	}
}

// Discover scans all configured directories and populates the registry
// with Skill objects containing name + description (lightweight).
// It does NOT read the full body — use LoadBody for that.
// Existing entries with the same name are overwritten (last wins).
// Word-boundary regexp are compiled eagerly for each skill during this call.
func (r *SkillRegistry) Discover() error {
	r.mu.Lock()
	defer r.mu.Unlock()

	for _, dir := range r.dirs {
		paths, err := DiscoverSKILL(dir)
		if err != nil {
			return err
		}
		for _, p := range paths {
			skill, err := ParseFrontmatter(p)
			if err != nil {
				continue // skip unparseable files
			}
			skill.compileTriggers()
			r.skills[skill.Name] = skill
		}
	}
	r.loaded = true
	return nil
}

// Get returns a skill by name (may or may not have body loaded).
func (r *SkillRegistry) Get(name string) (*Skill, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	s, ok := r.skills[name]
	return s, ok
}

// List returns all discovered skill summaries.
func (r *SkillRegistry) List() []SkillSummary {
	r.mu.RLock()
	defer r.mu.RUnlock()

	out := make([]SkillSummary, 0, len(r.skills))
	for _, s := range r.skills {
		out = append(out, SkillSummary{
			Name:        s.Name,
			Description: s.Description,
			Path:        s.Path,
		})
	}
	return out
}
