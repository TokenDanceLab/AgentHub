// Package router provides task-level routing logic for the Edge Server.
//
// # Prompt Complexity Classification
//
// ClassifyComplexity heuristically determines the execution complexity of a
// user prompt using regex and keyword matching only — no LLM is called.
// The resulting ComplexityLevel feeds into the orchestration layer:
//
//   - ComplexitySimple: direct single-agent execution, skip orchestration
//     and planning overhead entirely.
//   - ComplexityMedium: single-agent execution with standard defaults.
//   - ComplexityComplex: may trigger multi-agent TeamRun planning,
//     supervisor routing, or human-in-the-loop approval gates.
//
// Classification is deterministic, runs in microseconds, and is called at
// the Edge /v1/runs handler before the lifecycle executor starts, so routing
// decisions happen before any CLI process is spawned.
//
// # Orchestrator Routing
//
// This package also provides the orchestration dispatch helpers that route
// sub-agent tasks to the appropriate adapters based on the TeamRun plan.
package router

import (
	"regexp"
	"strings"
)

// ComplexityLevel classifies a user prompt by expected execution difficulty.
//
// The level informs routing and orchestration decisions downstream:
//
//   - ComplexitySimple: direct single-agent execution with no orchestration
//     overhead — the prompt is a single, clearly-scoped task.
//   - ComplexityMedium: single-agent execution with standard defaults.
//   - ComplexityComplex: may benefit from multi-agent planning, orchestrated
//     TeamRun with supervisor routing, or human-in-the-loop approval gates.
//
// The classifier is deterministic (regex + keyword matching, zero LLM cost) and
// runs at the Edge /v1/runs entry point before the lifecycle executor starts.
type ComplexityLevel string

const (
	// ComplexitySimple describes a single, clearly-scoped task with no
	// inter-file dependencies. Examples: "fix typo in README", "run npm install".
	ComplexitySimple ComplexityLevel = "simple"

	// ComplexityMedium describes a multi-step task that requires moderate
	// reasoning and may span a few files or modules. Example: "add auth
	// middleware with JWT validation".
	ComplexityMedium ComplexityLevel = "medium"

	// ComplexityComplex describes a cross-module, multi-file task that
	// benefits from upfront planning or team orchestration. Example:
	// "design and implement a real-time notification system with WebSocket".
	ComplexityComplex ComplexityLevel = "complex"
)

var (
	// multiStepRE matches step-sequence phrases ("step 1", "step 2",
	// "after that", "finally,") that indicate multi-step tasks.
	// Note: "first ... then" is handled separately via a co-occurrence
	// check (hasFirstThen) which is faster, handles multi-line prompts,
	// and avoids regex scanning across long prompts.
	multiStepRE = regexp.MustCompile(
		`(?i)\b(?:step\s*\d+|after\s+that|finally[,.])`,
	)

	// crossModuleRE matches keywords that imply changes across module
	// boundaries or architectural restructuring.
	// NOTE: \b is an ASCII word boundary — it does NOT match CJK characters
	// because CJK runes are not \w in Go regex. For CJK prompts, use
	// crossModuleCJKH instead (checked first, below).
	crossModuleRE = regexp.MustCompile(
		`(?i)\b(?:refactor|migrate|restructure|architecture|redesign|overhaul)\b`,
	)

	// crossModuleCJK matches CJK keywords that imply cross-module or
	// architectural restructuring, WITHOUT \b word boundaries (CJK chars
	// are not \w in Go regex, making \b ineffective for pure-CJK text).
	// Checked BEFORE crossModuleRE to avoid misclassification of CJK prompts.
	crossModuleCJK = regexp.MustCompile(
		`重构|迁移|架构|重新设计|模块|改造|重建`,
	)

	// dependencyRE matches phrases that signal the task cannot start until
	// another piece of work is complete.
	dependencyRE = regexp.MustCompile(
		`(?i)\b(?:depends\s+on|requires\s+(?:that\s+)?|blocked\s+by)\b`,
	)

	// fileCountRE matches phrases that scope the task to an entire codebase
	// or large set of files.
	fileCountRE = regexp.MustCompile(
		`(?i)\b(?:all\s+files|every\s+module|entire\s+codebase)\b`,
	)

	// simpleCmdRE matches command-like phrases that indicate a trivial,
	// single-operation task.
	simpleCmdRE = regexp.MustCompile(
		`(?i)\b(?:fix\s+typo|run\s+test|check\s+status|show\s+me)\b`,
	)
)

// ClassifyComplexity heuristically determines the execution complexity of a
// user prompt using regex and keyword matching. It does NOT call any LLM —
// classification is deterministic and runs in microseconds.
//
// Called at the Edge /v1/runs handler before the lifecycle executor starts
// a CLI process, so routing decisions (single-agent vs. orchestrated TeamRun)
// happen with zero added latency.
//
// Heuristics are applied in priority order. Keyword signals (complex, then
// medium) take precedence over word count; word count acts as a fallback when
// no keyword signal matches. When multiple signals conflict, the highest
// complexity wins.
//
// Rules (all regex/keyword, zero LLM):
//
//  1. Word-count hard rule: >100 words → ComplexityComplex
//  2. Rune-count fallback (CJK): <20 words && >200 runes → at least Medium;
//     >800 runes → ComplexityComplex
//  3. Cross-module keywords (CJK first, then ASCII): "重构", "迁移", "架构",
//     "重新设计", "模块", "改造", "重建", "refactor", "migrate",
//     "restructure", "architecture", "redesign", "overhaul" → ComplexityComplex
//     CJK patterns use no \b (CJK chars are not \w in Go regex) and are
//     checked FIRST to avoid misclassification of pure-CJK prompts.
//  4. Dependency indicators: "depends on", "requires", "blocked by"
//     → ComplexityComplex
//  5. File-count indicators: "all files", "every module", "entire codebase"
//     → ComplexityComplex
//  6. Multi-step indicators: "first…then", "step N", "after that", "finally"
//     → at least ComplexityMedium
//  7. Simple command patterns: "fix typo", "run test", "check status",
//     "show me" → ComplexitySimple (only when no stronger signal matched)
//  8. Word-count fallback: <20 words → ComplexitySimple
//  9. Default: ComplexityMedium
func ClassifyComplexity(prompt string) ComplexityLevel {
	words := countWords(prompt)
	runes := len([]rune(prompt))

	// Hard rule: very long prompts are complex regardless of keywords.
	if words > 100 {
		return ComplexityComplex
	}

	// Rune-count fallback for CJK and other non-whitespace-delimited languages.
	// Check the highest rune threshold FIRST so that lengthy CJK prompts
	// (e.g., 900-rune architectural refactoring) are correctly classified as
	// Complex rather than being short-circuited by the Medium check.
	// Previous ordering (words<20 && runes>200 before runes>800) made the
	// runes>800 branch unreachable for all pure-CJK inputs.
	if runes > 800 {
		return ComplexityComplex
	}
	if words < 20 && runes > 200 {
		return ComplexityMedium
	}

	// Complex keyword signals take highest priority after extreme word count.
	// CJK patterns checked FIRST — without \b boundaries, CJK chars are not
	// \w in Go regex, so ASCII \b patterns won't match pure-CJK text.
	if crossModuleCJK.MatchString(prompt) {
		return ComplexityComplex
	}
	if crossModuleRE.MatchString(prompt) {
		return ComplexityComplex
	}
	if dependencyRE.MatchString(prompt) {
		return ComplexityComplex
	}
	if fileCountRE.MatchString(prompt) {
		return ComplexityComplex
	}

	// Multi-step signals imply at least medium complexity.
	if multiStepRE.MatchString(prompt) || hasFirstThen(prompt) {
		return ComplexityMedium
	}

	// Simple command patterns: only apply when no stronger signal matched.
	if simpleCmdRE.MatchString(prompt) {
		return ComplexitySimple
	}

	// Word-count fallback: very short prompts with no keyword signals
	// are likely trivial one-liners.
	if words < 20 {
		return ComplexitySimple
	}

	// Default: medium complexity when the prompt is between 20-100 words
	// with no strong signal in either direction.
	return ComplexityMedium
}

// countWords returns the number of whitespace-delimited tokens in s.
// It is a lightweight approximation: no Unicode segmentation, no
// punctuation stripping. For non-whitespace-delimited languages (CJK),
// ClassifyComplexity supplements this with a rune-count fallback —
// when word count is low but the prompt has >200 runes, it is bumped
// to at least Medium; >800 runes bumps to Complex.
func countWords(s string) int {
	return len(strings.Fields(s))
}

// hasFirstThen checks whether both "first" and "then" appear as whole words
// in the prompt, indicating a multi-step task. This replaces the previous
// regex `first\b.*\bthen` which was fragile (did not match across newlines)
// and wasted work scanning from "first" to end-of-string in long prompts.
// The co-occurrence check is O(n), handles multi-line, and is simpler to
// reason about than the combined regex.
func hasFirstThen(prompt string) bool {
	lower := strings.ToLower(prompt)
	return strings.Contains(lower, "first") && strings.Contains(lower, "then")
}
