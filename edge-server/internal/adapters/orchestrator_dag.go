package adapters

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"regexp"
	"sort"
	"strings"
)

var (
	reDoubleEscapedQuotes = regexp.MustCompile(`([:,\[\{])\s*\\"`)
)

// --- Plan types ---
// TaskStatus / PlanTask / ExecutionPlan 的唯一权威定义在
// internal/orchestration（A-V1 Step 1, #1526）；本包通过 contract_aliases.go
// 的 type alias 继续使用，调用点零改动。

// PlanParseError is returned when all plan parsing strategies fail.
// It wraps the original text and all errors encountered during parsing,
// allowing callers to handle parse failures gracefully instead of crashing.
type PlanParseError struct {
	Text   string   // original text that failed to parse
	Errors []string // errors from each parsing strategy
}

// Error implements the error interface.
func (e *PlanParseError) Error() string {
	return fmt.Sprintf("plan parse failed after %d strategies: %s", len(e.Errors), strings.Join(e.Errors, "; "))
}

// structuredPlanEnvelope is the legacy top-level JSON envelope the orchestrator
// outputs. Retained for backward compatibility with the older nested format
// where tasks were wrapped inside a "plan" object with summary and mode.
type structuredPlanEnvelope struct {
	Plan ExecutionPlan `json:"plan"`
}

// flatPlanEnvelope is the current simplified JSON format where tasks appear
// directly at the top level without a wrapping "plan" object.
type flatPlanEnvelope struct {
	Tasks []PlanTask `json:"tasks"`
}

// initTaskStatuses sets any unset task status to TaskPending and auto-generates
// task IDs from agent names when IDs are not provided (the new schema uses agent
// names as implicit task identifiers).
func initTaskStatuses(tasks []PlanTask) {
	for i := range tasks {
		if tasks[i].Status == "" {
			tasks[i].Status = TaskPending
		}
		if tasks[i].ID == "" && tasks[i].Agent != "" {
			tasks[i].ID = tasks[i].Agent
		}
	}
}

// --- Plan parsing ---

// ParsePlan extracts a structured ExecutionPlan from the orchestrator's text output.
// It supports two JSON formats:
//   - Flat format (current): {"tasks": [...]}
//   - Nested format (legacy): {"plan": {"summary": "...", "mode": "...", "tasks": [...]}}
//
// It first tries to parse the text as flat JSON, then falls back to the nested
// format, and finally scans line-by-line for embedded JSON blocks.
// Returns the parsed plan or an error if no valid plan is found.
func ParsePlan(text string) (*ExecutionPlan, error) {
	// Strategy 1: Try flat format — {"tasks": [...]}.
	var flat flatPlanEnvelope
	if err := json.Unmarshal([]byte(text), &flat); err == nil && len(flat.Tasks) > 0 {
		initTaskStatuses(flat.Tasks)
		return &ExecutionPlan{Tasks: flat.Tasks}, nil
	}

	// Strategy 2: Try legacy nested format — {"plan": {"tasks": [...]}}.
	var env structuredPlanEnvelope
	if err := json.Unmarshal([]byte(text), &env); err == nil && len(env.Plan.Tasks) > 0 {
		initTaskStatuses(env.Plan.Tasks)
		return &env.Plan, nil
	}

	// Strategy 3: Scan for an embedded JSON block (flat or nested).
	plan := scanForPlanBlock(text)
	if plan != nil {
		return plan, nil
	}

	return nil, fmt.Errorf("no structured plan found in orchestrator output")
}

// scanForPlanBlock scans text line-by-line to find a contiguous JSON block
// that contains a plan with a "tasks" array. It tries both the flat format
// ({"tasks":[...]}) and the legacy nested format ({"plan":{"tasks":[...]}}).
func scanForPlanBlock(text string) *ExecutionPlan {
	lines := strings.Split(text, "\n")
	var scanner planBlockScanner

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)

		// Try each line as a standalone JSON object first.
		if strings.HasPrefix(trimmed, "{") && strings.HasSuffix(trimmed, "}") {
			if plan := tryParsePlanCandidate(trimmed); plan != nil {
				return plan
			}
		}

		// Multi-line JSON block accumulation.
		if plan := scanner.scanLine(line); plan != nil {
			return plan
		}
	}
	return nil
}

// tryParsePlanCandidate attempts to parse a JSON candidate as flat then
// nested format, returning the parsed plan or nil when neither matches.
func tryParsePlanCandidate(candidate string) *ExecutionPlan {
	// Try flat format first.
	var flat flatPlanEnvelope
	if err := json.Unmarshal([]byte(candidate), &flat); err == nil && len(flat.Tasks) > 0 {
		initTaskStatuses(flat.Tasks)
		return &ExecutionPlan{Tasks: flat.Tasks}
	}
	// Fall back to nested format.
	var env structuredPlanEnvelope
	if err := json.Unmarshal([]byte(candidate), &env); err == nil && len(env.Plan.Tasks) > 0 {
		initTaskStatuses(env.Plan.Tasks)
		return &env.Plan
	}
	return nil
}

// planBlockScanner accumulates multi-line JSON blocks across lines while
// tracking brace depth, and returns a parsed plan as soon as a block closes.
type planBlockScanner struct {
	buf        strings.Builder
	inBlock    bool
	braceDepth int
}

func (s *planBlockScanner) scanLine(line string) *ExecutionPlan {
	for _, ch := range line {
		if ch == '{' {
			if s.braceDepth == 0 {
				s.inBlock = true
				s.buf.Reset()
			}
			s.braceDepth++
		}
		if s.inBlock {
			s.buf.WriteRune(ch)
		}
		if ch == '}' {
			s.braceDepth--
			if s.braceDepth == 0 && s.inBlock {
				s.inBlock = false
				if plan := tryParsePlanCandidate(s.buf.String()); plan != nil {
					return plan
				}
			}
		}
	}
	return nil
}

// --- Robust plan parsing with JSON repair and heuristic fallback ---

// ParsePlanRobust attempts to parse an execution plan from text with progressive
// fallbacks. It first tries the standard ParsePlan, then attempts JSON repair
// on the raw text, and finally falls back to heuristic line-by-line parsing.
// Each fallback is logged at WARN level so operators can monitor parse quality.
//
// Returns the parsed plan, or a *PlanParseError wrapping all failures if every
// strategy is exhausted.
func ParsePlanRobust(text string) (*ExecutionPlan, error) {
	// Strategy 1: Standard ParsePlan (handles flat, nested, and embedded JSON).
	plan, err := ParsePlan(text)
	if err == nil {
		return plan, nil
	}
	origErr := err.Error()

	// Strategy 2: JSON repair — fix common LLM formatting issues then retry.
	repaired := repairJSON(text)
	if repaired != text {
		slog.Warn("plan parse: attempting JSON repair",
			"originalLength", len(text),
			"repairedLength", len(repaired),
			"originalError", origErr,
		)
		plan, err = ParsePlan(repaired)
		if err == nil {
			slog.Warn("plan parse: JSON repair succeeded")
			return plan, nil
		}
		slog.Warn("plan parse: JSON repair failed",
			"error", err,
		)
	}

	// Strategy 3: Heuristic fallback — treat input as a single task.
	slog.Warn("plan parse: attempting heuristic fallback",
		"originalError", origErr,
		"textLength", len(text),
	)
	plan = heuristicParsePlan(text)
	if plan != nil {
		slog.Warn("plan parse: heuristic fallback succeeded, created single-task plan")
		return plan, nil
	}

	// All strategies exhausted.
	return nil, &PlanParseError{
		Text:   text,
		Errors: []string{origErr},
	}
}

// repairJSON attempts to fix common JSON formatting issues in LLM outputs:
//   - Strips markdown code fences (```json ... ```)
//   - Fixes trailing commas in arrays and objects
//   - Unescapes double-escaped quotes (\\\" -> \")
//   - Balances unmatched braces and brackets
//
// This is a best-effort repair; the result is re-parsed by ParsePlan and
// failures are handled gracefully by the caller.
func repairJSON(text string) string {
	t := strings.TrimSpace(text)

	// Step 1: Strip markdown code fences.
	t = stripMarkdownFences(t)

	// Step 2: Fix trailing commas (common LLM JSON mistake).
	t = fixTrailingCommas(t)

	// Step 3: Unescape double-escaped quotes only at JSON structural positions.
	// Blind global replacement of \" → " is destructive to valid JSON that
	// contains escaped literal quotes inside string values (e.g.
	// {"text": "he said \"hello\""} would be corrupted to {"text": "he said "hello""}).
	// Instead, we only fix double-escaped quotes appearing after JSON structural
	// characters (: { , [) where they indicate incorrectly escaped string delimiters.
	t = fixDoubleEscapedQuotes(t)

	// Step 4: Balance unmatched braces and brackets.
	t = balanceDelimiters(t)

	return t
}

// stripMarkdownFences removes opening and closing markdown code fence markers
// (```json, ```, or bare ```) from the text.
func stripMarkdownFences(text string) string {
	t := strings.TrimSpace(text)
	if strings.HasPrefix(t, "```json") {
		t = strings.TrimPrefix(t, "```json")
	} else if strings.HasPrefix(t, "```") {
		t = strings.TrimPrefix(t, "```")
	}
	t = strings.TrimSpace(t)
	t = strings.TrimSuffix(t, "```")
	return strings.TrimSpace(t)
}

// fixTrailingCommas removes trailing commas before closing brackets and braces,
// a common LLM JSON formatting mistake (e.g., [a, b,] or {"x": 1,}).
func fixTrailingCommas(text string) string {
	s := strings.ReplaceAll(text, ",]", "]")
	s = strings.ReplaceAll(s, ",}", "}")
	return s
}

// balanceDelimiters appends missing closing braces and brackets so that
// the JSON has a chance to parse. This is a best-effort heuristic: it
// naively appends at the end and does not handle nested mismatch.
func balanceDelimiters(text string) string {
	t := text
	openBraces := strings.Count(t, "{")
	closeBraces := strings.Count(t, "}")
	openBrackets := strings.Count(t, "[")
	closeBrackets := strings.Count(t, "]")

	if closeBraces < openBraces {
		t += strings.Repeat("}", openBraces-closeBraces)
	}
	if closeBrackets < openBrackets {
		t += strings.Repeat("]", openBrackets-closeBrackets)
	}
	return t
}

// fixDoubleEscapedQuotes unescapes double-escaped quotes (\" → ") only at
// JSON structural positions. Unlike a blind global replace, this preserves
// valid escaped quotes inside string values (e.g., "he said \"hello\"").
//
// It matches \" when preceded by : { , [  — characters that appear at JSON
// structural boundaries. This catches the common LLM output pattern where the
// entire JSON is double-escaped ({\"key\": \"value\"}) without corrupting
// properly escaped quotes inside string literals.
func fixDoubleEscapedQuotes(text string) string {
	// Match \": only when preceded by a structural JSON character
	// (colon, comma, open-brace, open-bracket), allowing optional whitespace.
	return reDoubleEscapedQuotes.ReplaceAllString(text, `${1}"`)
}

// heuristicParsePlan constructs a single-task plan from unstructured text by
// treating the entire input as a task description. This is the last-resort
// fallback when both standard parsing and JSON repair fail. It picks the
// first non-empty, non-code-fence line as the summary and creates a single
// pending task with that description.
func heuristicParsePlan(text string) *ExecutionPlan {
	lines := strings.Split(strings.TrimSpace(text), "\n")
	desc := ""
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		if strings.HasPrefix(trimmed, "```") {
			continue
		}
		desc = trimmed
		break
	}
	if desc == "" {
		return nil
	}

	return &ExecutionPlan{
		Summary: desc,
		Mode:    "sequential",
		Tasks: []PlanTask{
			{
				ID:          "task-1",
				Description: desc,
				Status:      TaskPending,
			},
		},
	}
}

// ValidatePlan checks a plan for structural correctness:
//   - at least one task
//   - all tasks have a non-empty agent
//   - task IDs are auto-generated from agent names when not provided
//   - all task IDs are unique after auto-generation
//   - all DependsOn references resolve to existing task IDs
//   - no circular dependencies (via Kahn's algorithm)
//   - all agent IDs are valid (against the adapter registry, if provided)
//   - mode is one of "parallel", "sequential", "pipeline" (defaults to "parallel" if empty)
func ValidatePlan(plan *ExecutionPlan, validAgents []string) error {
	if plan == nil {
		return fmt.Errorf("plan is nil")
	}
	if len(plan.Tasks) == 0 {
		return fmt.Errorf("plan has no tasks")
	}

	// Validate task IDs and uniqueness. When tasks come from ParsePlan, IDs
	// are already auto-generated from agent names. For manually constructed
	// plans, IDs must be set explicitly.
	ids := make(map[string]int, len(plan.Tasks))
	for i, task := range plan.Tasks {
		if task.ID == "" {
			return fmt.Errorf("task at index %d has empty id", i)
		}
		if prev, exists := ids[task.ID]; exists {
			return fmt.Errorf("duplicate task id %q at indices %d and %d", task.ID, prev, i)
		}
		ids[task.ID] = i
	}

	// Normalize mode.
	if plan.Mode == "" {
		plan.Mode = "parallel"
	}
	switch plan.Mode {
	case "parallel", "sequential", "pipeline":
		// ok
	default:
		return fmt.Errorf("invalid plan mode %q; must be parallel, sequential, or pipeline", plan.Mode)
	}

	// Validate DependsOn references.
	for _, task := range plan.Tasks {
		for _, dep := range task.DependsOn {
			if _, ok := ids[dep]; !ok {
				return fmt.Errorf("task %q depends on unknown task %q", task.ID, dep)
			}
		}
	}

	// Validate agent IDs.
	validSet := make(map[string]struct{}, len(validAgents))
	for _, a := range validAgents {
		validSet[a] = struct{}{}
	}
	for _, task := range plan.Tasks {
		if task.Agent == "" {
			return fmt.Errorf("task %q has empty agent", task.ID)
		}
		if len(validSet) > 0 {
			if _, ok := validSet[task.Agent]; !ok {
				return fmt.Errorf("task %q references unknown agent %q", task.ID, task.Agent)
			}
		}
	}

	// Check for circular dependencies by running Kahn's algorithm.
	_, err := TopologicalSort(plan.Tasks)
	if err != nil {
		return err
	}

	return nil
}

// --- Topological sort (Kahn's algorithm) ---

// TopologicalSort uses Kahn's algorithm to produce an ordered list of task batches.
// Each batch contains tasks that can run in parallel (i.e., all their dependencies
// have been satisfied by earlier batches). Returns an error if a cycle is detected.
//
// The result is a slice of slices: [][]PlanTask where result[0] are tasks with
// no dependencies, result[1] are tasks that depend only on result[0], etc.
func TopologicalSort(tasks []PlanTask) ([][]PlanTask, error) {
	n := len(tasks)
	if n == 0 {
		return nil, nil
	}

	// Build index.
	idx := make(map[string]int, n)
	for i, t := range tasks {
		idx[t.ID] = i
	}

	// Build adjacency list and in-degree count.
	adj := make([][]int, n) // adj[i] = tasks that depend on task i
	inDegree := make([]int, n)

	for i, t := range tasks {
		for _, dep := range t.DependsOn {
			depIdx, ok := idx[dep]
			if !ok {
				return nil, fmt.Errorf("task %q depends on unknown task %q", t.ID, dep)
			}
			adj[depIdx] = append(adj[depIdx], i)
			inDegree[i]++
		}
	}

	// BFS: collect tasks with in-degree 0 as the first batch.
	var batches [][]PlanTask
	queue := make([]int, 0, n)
	for i := range inDegree {
		if inDegree[i] == 0 {
			queue = append(queue, i)
		}
	}

	processed := 0
	for len(queue) > 0 {
		// Sort current batch for deterministic ordering.
		sort.Ints(queue)

		batch := make([]PlanTask, 0, len(queue))
		var nextQueue []int
		for _, i := range queue {
			batch = append(batch, tasks[i])
			for _, dependent := range adj[i] {
				inDegree[dependent]--
				if inDegree[dependent] == 0 {
					nextQueue = append(nextQueue, dependent)
				}
			}
			processed++
		}
		batches = append(batches, batch)
		queue = nextQueue
	}

	if processed != n {
		// Find a task involved in the cycle for a helpful error message.
		for i, d := range inDegree {
			if d > 0 {
				return nil, fmt.Errorf("circular dependency detected involving task %q", tasks[i].ID)
			}
		}
		return nil, fmt.Errorf("circular dependency detected")
	}

	return batches, nil
}
