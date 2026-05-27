// Package skills provides SKILL.md discovery, parsing, and progressive loading.
//
// SKILL.md files follow the Codex CLI standard with YAML frontmatter:
//
//	---
//	name: my-skill
//	description: "What this skill does"
//	---
//	# Markdown body
//
// The SkillRegistry supports lazy loading: Discover loads only name+description;
// LoadBody reads the full markdown body on demand, typically triggered by
// explicit invocation ($skill-name) or trigger-word matching.
package skills

import (
	"strings"
	"sync"
)

// Skill represents a parsed SKILL.md file.
type Skill struct {
	Name        string   // from YAML frontmatter "name"
	Description string   // from YAML frontmatter "description"
	Triggers    []string // from YAML frontmatter "triggers" (comma-separated or list)
	Body        string   // full markdown body (after frontmatter)
	Path        string   // absolute file path to the SKILL.md
}

// SkillSummary is the lightweight view of a skill (name + description only).
// It is produced by Discover without reading the full markdown body,
// enabling fast startup with progressive loading.
type SkillSummary struct {
	Name        string
	Description string
	Path        string
}

// SkillRegistry holds discovered skills and supports name lookup and
// trigger-word matching.
type SkillRegistry struct {
	mu      sync.RWMutex
	skills  map[string]*Skill     // name -> skill
	dirs    []string              // search directories
	loaded  bool                  // true after Discover ran at least once
}

// NewSkillRegistry creates a registry that scans the given directories
// for SKILL.md files.
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
	r.loaded = true
	return nil
}

// LoadBody reads the full markdown body for a skill identified by name.
// If the body is already loaded, it returns immediately.
// Returns false if the skill is not found.
func (r *SkillRegistry) LoadBody(name string) (string, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()

	s, ok := r.skills[name]
	if !ok {
		return "", false
	}
	if s.Body != "" {
		return s.Body, true
	}

	body, err := ParseBody(s.Path)
	if err != nil {
		return "", false
	}
	s.Body = body
	return body, true
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

// MatchTrigger returns skills whose trigger words appear in the input.
// Matching is case-insensitive and checks both substring and word-boundary.
// Skills with no triggers defined are never matched.
func (r *SkillRegistry) MatchTrigger(input string) []*Skill {
	r.mu.RLock()
	defer r.mu.RUnlock()

	lower := strings.ToLower(input)
	var matched []*Skill
	for _, s := range r.skills {
		if len(s.Triggers) == 0 {
			continue
		}
		for _, t := range s.Triggers {
			if strings.Contains(lower, strings.ToLower(strings.TrimSpace(t))) {
				matched = append(matched, s)
				break
			}
		}
	}
	return matched
}

// SystemPromptContext builds the "Available skills:" block for injection
// into the agent system prompt. Only includes name + description (lightweight).
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
