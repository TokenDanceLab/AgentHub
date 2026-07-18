package skills

import (
	"regexp"
	"strings"
)

// MatchTrigger returns skills whose trigger words appear in the input.
// Matching is case-insensitive.
//
// NOTE: MatchTrigger and MatchTriggerWordBoundary have zero production callers
// as of 2026-06-25. Only SystemPromptContext() is wired into the edge server
// (handlers.go:1364). Trigger matching is implemented and tested but not yet
// activated in any production code path.
//
// When UseWordBoundary is false (default), triggers are matched via substring
// (e.g. trigger "build" matches "rebuilding").
//
// When UseWordBoundary is true, triggers are matched as whole words using
// compiled regexp (\b boundaries). This uses regexp cached during Discover,
// and is safe from ReDoS because regexp.QuoteMeta escapes all metacharacters.
//
// Skills with no triggers defined are never matched.
func (r *SkillRegistry) MatchTrigger(input string) []*Skill {
	r.mu.RLock()
	defer r.mu.RUnlock()

	if r.UseWordBoundary {
		return r.matchTriggerWordBoundaryLocked(input)
	}

	lower := strings.ToLower(input)
	var matched []*Skill
	for _, s := range r.skills {
		if len(s.Triggers) == 0 {
			continue
		}
		for _, t := range s.Triggers {
			if strings.Contains(lower, t) {
				matched = append(matched, s)
				break
			}
		}
	}
	return matched
}

// matchTriggerWordBoundaryLocked matches using pre-compiled word-boundary regexp.
// Caller must hold r.mu (at least RLock).
func (r *SkillRegistry) matchTriggerWordBoundaryLocked(input string) []*Skill {
	var matched []*Skill
	for _, s := range r.skills {
		if len(s.compiledTriggers) == 0 {
			continue
		}
		for _, re := range s.compiledTriggers {
			if re.MatchString(input) {
				matched = append(matched, s)
				break
			}
		}
	}
	return matched
}

// compileTriggers pre-compiles word-boundary regexp for all triggers.
// Safe from ReDoS: regexp.QuoteMeta escapes all metacharacters, and \b is a
// zero-width assertion with no backtracking amplification.
func (s *Skill) compileTriggers() {
	if len(s.Triggers) == 0 {
		return
	}
	s.compiledTriggers = make([]*regexp.Regexp, 0, len(s.Triggers))
	for _, t := range s.Triggers {
		t = strings.TrimSpace(t)
		if t == "" {
			continue
		}
		// (?i) = case-insensitive, \b = word boundary, QuoteMeta = safe from ReDoS
		re := regexp.MustCompile(`(?i)\b` + regexp.QuoteMeta(t) + `\b`)
		s.compiledTriggers = append(s.compiledTriggers, re)
	}
}

// MatchTriggerWordBoundary reports whether trigger appears as a whole word in
// message. Matching is case-insensitive. This is a stateless convenience
// function; for repeated use, prefer SkillRegistry with UseWordBoundary=true
// which caches compiled regexp per skill load.
//
// Safe from ReDoS: regexp.QuoteMeta escapes all metacharacters in trigger.
// Returns false when trigger is empty.
func MatchTriggerWordBoundary(trigger, message string) bool {
	if trigger == "" {
		return false
	}
	re := regexp.MustCompile(`(?i)\b` + regexp.QuoteMeta(trigger) + `\b`)
	return re.MatchString(message)
}

// SystemPromptContext builds the "Available skills:" block for injection
// into the agent system prompt. Only includes name + description (lightweight).
// This is the primary integration point: called from handlers.go at line 1364
// during run creation to populate SkillsPrompt, which is then prefixed to the
// agent's system prompt by the context builder.
//
// Returns an empty string when no skills are loaded.
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
