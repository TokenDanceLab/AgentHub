package adapters

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

// --- Plan types ---

// TaskStatus represents the execution status of a plan task.
type TaskStatus string

const (
	TaskPending   TaskStatus = "pending"
	TaskRunning   TaskStatus = "running"
	TaskCompleted TaskStatus = "completed"
	TaskFailed    TaskStatus = "failed"
)

// PlanTask represents a single task within an execution plan.
type PlanTask struct {
	ID             string     `json:"id"`
	Agent          string     `json:"agent"`
	Description    string     `json:"description"`
	Mode           string     `json:"mode,omitempty"`           // "parallel" or "sequential" execution hint for this task
	TargetFiles    []string   `json:"targetFiles,omitempty"`
	DependsOn      []string   `json:"dependsOn,omitempty"`
	ExpectedOutput string     `json:"expectedOutput,omitempty"`
	Status         TaskStatus `json:"status"`
}

// ExecutionPlan represents a structured plan output by the orchestrator.
type ExecutionPlan struct {
	Summary string     `json:"summary,omitempty"` // one-line description of the overall plan
	Mode    string     `json:"mode"`              // "parallel", "sequential", "pipeline"
	Tasks   []PlanTask `json:"tasks"`
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
	var buf strings.Builder
	inBlock := false
	braceDepth := 0

	// tryParse attempts to parse a JSON candidate as flat then nested format.
	tryParse := func(candidate string) *ExecutionPlan {
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

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)

		// Try each line as a standalone JSON object first.
		if strings.HasPrefix(trimmed, "{") && strings.HasSuffix(trimmed, "}") {
			if plan := tryParse(trimmed); plan != nil {
				return plan
			}
		}

		// Multi-line JSON block accumulation.
		for _, ch := range line {
			if ch == '{' {
				if braceDepth == 0 {
					inBlock = true
					buf.Reset()
				}
				braceDepth++
			}
			if inBlock {
				buf.WriteRune(ch)
			}
			if ch == '}' {
				braceDepth--
				if braceDepth == 0 && inBlock {
					inBlock = false
					if plan := tryParse(buf.String()); plan != nil {
						return plan
					}
				}
			}
		}
	}
	return nil
}

// --- Plan validation ---

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
