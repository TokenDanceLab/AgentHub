// Package skills provides SKILL.md discovery, parsing, and system-prompt
// injection for Edge runs.
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
// Discover loads name + description + triggers from the frontmatter only
// (lightweight); SystemPromptContext injects the "Available skills:" block
// into the agent system prompt during run creation (handlers_runs.go).
//
// Historical trigger-word matching and fsnotify hot reload were removed:
// they had zero production callers, and restoring them from git history is
// straightforward if a future feature needs them (#2154).
package skills

import (
	"strings"
	"sync"
)

// Skill represents a parsed SKILL.md file frontmatter.
type Skill struct {
	Name        string   // from YAML frontmatter "name"
	Description string   // from YAML frontmatter "description"
	Triggers    []string // from YAML frontmatter "triggers" (comma-separated or list); case-insensitive
	Path        string   // absolute file path to the SKILL.md
}

// SkillRegistry holds discovered skills and supports name lookup and
// system-prompt injection. Thread-safe: all methods take the registry lock.
type SkillRegistry struct {
	mu     sync.RWMutex
	skills map[string]*Skill // name -> skill
	dirs   []string          // search directories passed to NewSkillRegistry
}

// NewSkillRegistry creates a registry that scans the given directories
// for SKILL.md files. Directories are resolved to absolute paths during
// Discover. Call Discover() after construction to populate skills.
func NewSkillRegistry(dirs []string) *SkillRegistry {
	return &SkillRegistry{
		skills: make(map[string]*Skill),
		dirs:   dirs,
	}
}

// Discover scans all configured directories and populates the registry
// with Skill objects containing frontmatter fields (lightweight, no body).
// Existing entries with the same name are overwritten (last wins).
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
			r.skills[skill.Name] = skill
		}
	}
	return nil
}

// Count returns the number of discovered skills. Used for the startup log.
func (r *SkillRegistry) Count() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.skills)
}

// SystemPromptContext builds the "Available skills:" block for injection
// into the agent system prompt. Only includes name + description
// (lightweight). Returns an empty string when no skills are loaded.
func (r *SkillRegistry) SystemPromptContext() string {
	r.mu.RLock()
	defer r.mu.RUnlock()

	if len(r.skills) == 0 {
		return ""
	}

	var b strings.Builder
	b.WriteString("Available skills:\n")
	for _, s := range r.skills {
		b.WriteString("- ")
		b.WriteString(s.Name)
		if s.Description != "" {
			b.WriteString(": ")
			b.WriteString(s.Description)
		}
		b.WriteString("\n")
	}
	return b.String()
}
