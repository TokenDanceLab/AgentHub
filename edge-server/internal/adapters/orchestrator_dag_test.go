package adapters

import (
	"strings"
	"testing"
)

// ── TopologicalSort tests ────────────────────────────────────────────────────

func TestTopologicalSort_Empty(t *testing.T) {
	batches, err := TopologicalSort(nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if batches != nil {
		t.Fatalf("expected nil for empty input, got %v", batches)
	}
}

func TestTopologicalSort_SingleTask(t *testing.T) {
	tasks := []PlanTask{
		{ID: "a", Agent: "codex", Description: "task a", DependsOn: nil},
	}
	batches, err := TopologicalSort(tasks)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(batches) != 1 {
		t.Fatalf("expected 1 batch, got %d", len(batches))
	}
	if len(batches[0]) != 1 || batches[0][0].ID != "a" {
		t.Fatalf("expected batch with [a], got %v", batches[0])
	}
}

func TestTopologicalSort_ParallelTasks(t *testing.T) {
	tasks := []PlanTask{
		{ID: "a", Agent: "codex", Description: "task a", DependsOn: nil},
		{ID: "b", Agent: "codex", Description: "task b", DependsOn: nil},
		{ID: "c", Agent: "codex", Description: "task c", DependsOn: nil},
	}
	batches, err := TopologicalSort(tasks)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(batches) != 1 {
		t.Fatalf("expected 1 batch (all parallel), got %d", len(batches))
	}
	if len(batches[0]) != 3 {
		t.Fatalf("expected 3 tasks in batch, got %d", len(batches[0]))
	}
	// Verify sorted order: a, b, c.
	got := make([]string, len(batches[0]))
	for i, t2 := range batches[0] {
		got[i] = t2.ID
	}
	if got[0] != "a" || got[1] != "b" || got[2] != "c" {
		t.Fatalf("expected sorted order [a b c], got %v", got)
	}
}

func TestTopologicalSort_SequentialChain(t *testing.T) {
	// a -> b -> c (sequential)
	tasks := []PlanTask{
		{ID: "c", Agent: "codex", Description: "task c", DependsOn: []string{"b"}},
		{ID: "a", Agent: "codex", Description: "task a", DependsOn: nil},
		{ID: "b", Agent: "codex", Description: "task b", DependsOn: []string{"a"}},
	}
	batches, err := TopologicalSort(tasks)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(batches) != 3 {
		t.Fatalf("expected 3 batches (sequential), got %d", len(batches))
	}
	if batches[0][0].ID != "a" {
		t.Fatalf("batch 0 should be [a], got %v", batches[0])
	}
	if batches[1][0].ID != "b" {
		t.Fatalf("batch 1 should be [b], got %v", batches[1])
	}
	if batches[2][0].ID != "c" {
		t.Fatalf("batch 2 should be [c], got %v", batches[2])
	}
}

func TestTopologicalSort_DiamondDependency(t *testing.T) {
	//     a
	//    / \
	//   b   c
	//    \ /
	//     d
	tasks := []PlanTask{
		{ID: "a", Agent: "codex", Description: "task a", DependsOn: nil},
		{ID: "b", Agent: "codex", Description: "task b", DependsOn: []string{"a"}},
		{ID: "c", Agent: "codex", Description: "task c", DependsOn: []string{"a"}},
		{ID: "d", Agent: "codex", Description: "task d", DependsOn: []string{"b", "c"}},
	}
	batches, err := TopologicalSort(tasks)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(batches) != 3 {
		t.Fatalf("expected 3 batches, got %d", len(batches))
	}
	// Batch 0: [a]
	if len(batches[0]) != 1 || batches[0][0].ID != "a" {
		t.Fatalf("batch 0 = %v, want [a]", batchIDs(batches[0]))
	}
	// Batch 1: [b, c] (parallel after a)
	if len(batches[1]) != 2 {
		t.Fatalf("batch 1 should have 2 tasks, got %d", len(batches[1]))
	}
	b1IDs := batchIDs(batches[1])
	if b1IDs[0] != "b" || b1IDs[1] != "c" {
		t.Fatalf("batch 1 = %v, want [b c]", b1IDs)
	}
	// Batch 2: [d]
	if len(batches[2]) != 1 || batches[2][0].ID != "d" {
		t.Fatalf("batch 2 = %v, want [d]", batchIDs(batches[2]))
	}
}

func TestTopologicalSort_CircularDependency(t *testing.T) {
	// a -> b -> c -> a
	tasks := []PlanTask{
		{ID: "a", Agent: "codex", Description: "task a", DependsOn: []string{"c"}},
		{ID: "b", Agent: "codex", Description: "task b", DependsOn: []string{"a"}},
		{ID: "c", Agent: "codex", Description: "task c", DependsOn: []string{"b"}},
	}
	_, err := TopologicalSort(tasks)
	if err == nil {
		t.Fatal("expected error for circular dependency")
	}
}

func TestTopologicalSort_SelfDependency(t *testing.T) {
	tasks := []PlanTask{
		{ID: "a", Agent: "codex", Description: "task a", DependsOn: []string{"a"}},
	}
	_, err := TopologicalSort(tasks)
	if err == nil {
		t.Fatal("expected error for self-dependency")
	}
}

func TestTopologicalSort_UnknownDependency(t *testing.T) {
	tasks := []PlanTask{
		{ID: "a", Agent: "codex", Description: "task a", DependsOn: []string{"nonexistent"}},
	}
	_, err := TopologicalSort(tasks)
	if err == nil {
		t.Fatal("expected error for unknown dependency")
	}
}

// ── ValidatePlan tests ──────────────────────────────────────────────────────

func TestValidatePlan_NilPlan(t *testing.T) {
	err := ValidatePlan(nil, nil)
	if err == nil {
		t.Fatal("expected error for nil plan")
	}
}

func TestValidatePlan_EmptyTasks(t *testing.T) {
	err := ValidatePlan(&ExecutionPlan{}, nil)
	if err == nil {
		t.Fatal("expected error for empty tasks")
	}
}

func TestValidatePlan_EmptyTaskID(t *testing.T) {
	plan := &ExecutionPlan{
		Mode: "parallel",
		Tasks: []PlanTask{
			{ID: "", Agent: "codex", Description: "no id"},
		},
	}
	err := ValidatePlan(plan, nil)
	if err == nil {
		t.Fatal("expected error for empty task id")
	}
}

func TestValidatePlan_DuplicateTaskID(t *testing.T) {
	plan := &ExecutionPlan{
		Mode: "parallel",
		Tasks: []PlanTask{
			{ID: "a", Agent: "codex", Description: "first"},
			{ID: "a", Agent: "codex", Description: "duplicate"},
		},
	}
	err := ValidatePlan(plan, nil)
	if err == nil {
		t.Fatal("expected error for duplicate task id")
	}
}

func TestValidatePlan_InvalidMode(t *testing.T) {
	plan := &ExecutionPlan{
		Mode: "invalid",
		Tasks: []PlanTask{
			{ID: "a", Agent: "codex", Description: "task"},
		},
	}
	err := ValidatePlan(plan, nil)
	if err == nil {
		t.Fatal("expected error for invalid mode")
	}
}

func TestValidatePlan_EmptyMode(t *testing.T) {
	plan := &ExecutionPlan{
		Mode: "",
		Tasks: []PlanTask{
			{ID: "a", Agent: "codex", Description: "task"},
		},
	}
	err := ValidatePlan(plan, nil)
	if err != nil {
		t.Fatalf("empty mode should default to parallel: %v", err)
	}
	if plan.Mode != "parallel" {
		t.Fatalf("mode should be normalized to parallel, got %q", plan.Mode)
	}
}

func TestValidatePlan_EmptyAgent(t *testing.T) {
	plan := &ExecutionPlan{
		Mode: "parallel",
		Tasks: []PlanTask{
			{ID: "a", Agent: "", Description: "no agent"},
		},
	}
	err := ValidatePlan(plan, nil)
	if err == nil {
		t.Fatal("expected error for empty agent")
	}
}

func TestValidatePlan_UnknownAgent(t *testing.T) {
	plan := &ExecutionPlan{
		Mode: "parallel",
		Tasks: []PlanTask{
			{ID: "a", Agent: "unknown-agent", Description: "task"},
		},
	}
	err := ValidatePlan(plan, []string{"codex", "claude-code"})
	if err == nil {
		t.Fatal("expected error for unknown agent")
	}
}

func TestValidatePlan_UnknownDependency(t *testing.T) {
	plan := &ExecutionPlan{
		Mode: "parallel",
		Tasks: []PlanTask{
			{ID: "a", Agent: "codex", Description: "task", DependsOn: []string{"ghost"}},
		},
	}
	err := ValidatePlan(plan, nil)
	if err == nil {
		t.Fatal("expected error for unknown dependency")
	}
}

func TestValidatePlan_ValidPlan(t *testing.T) {
	plan := &ExecutionPlan{
		Mode: "parallel",
		Tasks: []PlanTask{
			{ID: "task-1", Agent: "codex", Description: "setup", DependsOn: nil},
			{ID: "task-2", Agent: "claude-code", Description: "implement", DependsOn: []string{"task-1"}},
		},
	}
	err := ValidatePlan(plan, []string{"codex", "claude-code"})
	if err != nil {
		t.Fatalf("valid plan should pass: %v", err)
	}
}

func TestValidatePlan_CircularFails(t *testing.T) {
	plan := &ExecutionPlan{
		Mode: "parallel",
		Tasks: []PlanTask{
			{ID: "a", Agent: "codex", Description: "task a", DependsOn: []string{"b"}},
			{ID: "b", Agent: "codex", Description: "task b", DependsOn: []string{"a"}},
		},
	}
	err := ValidatePlan(plan, nil)
	if err == nil {
		t.Fatal("expected error for circular dependency")
	}
}

// ── ParsePlan tests ─────────────────────────────────────────────────────────

func TestParsePlan_FullJSON(t *testing.T) {
	input := `{"plan":{"mode":"parallel","tasks":[{"id":"task-1","agent":"codex","description":"Write tests","dependsOn":[],"expectedOutput":"test file"}]}}`
	plan, err := ParsePlan(input)
	if err != nil {
		t.Fatalf("ParsePlan error: %v", err)
	}
	if plan.Mode != "parallel" {
		t.Fatalf("mode = %q, want parallel", plan.Mode)
	}
	if len(plan.Tasks) != 1 {
		t.Fatalf("expected 1 task, got %d", len(plan.Tasks))
	}
	if plan.Tasks[0].ID != "task-1" {
		t.Fatalf("task ID = %q, want task-1", plan.Tasks[0].ID)
	}
	if plan.Tasks[0].Status != TaskPending {
		t.Fatalf("task status = %q, want pending", plan.Tasks[0].Status)
	}
}

func TestParsePlan_EmbeddedInText(t *testing.T) {
	input := `I will break this down into tasks.
{"plan":{"mode":"sequential","tasks":[{"id":"t1","agent":"codex","description":"step1"},{"id":"t2","agent":"codex","description":"step2","dependsOn":["t1"]}]}}
Now dispatching...`
	plan, err := ParsePlan(input)
	if err != nil {
		t.Fatalf("ParsePlan error: %v", err)
	}
	if plan.Mode != "sequential" {
		t.Fatalf("mode = %q, want sequential", plan.Mode)
	}
	if len(plan.Tasks) != 2 {
		t.Fatalf("expected 2 tasks, got %d", len(plan.Tasks))
	}
	if plan.Tasks[1].DependsOn[0] != "t1" {
		t.Fatalf("task-2 dependsOn = %v, want [t1]", plan.Tasks[1].DependsOn)
	}
}

func TestParsePlan_NoPlan(t *testing.T) {
	input := "I will just do this myself."
	_, err := ParsePlan(input)
	if err == nil {
		t.Fatal("expected error when no plan found")
	}
}

func TestParsePlan_EmptyTasks(t *testing.T) {
	input := `{"plan":{"mode":"parallel","tasks":[]}}`
	_, err := ParsePlan(input)
	if err == nil {
		t.Fatal("expected error when plan has no tasks")
	}
}

func TestParsePlan_PrettyPrinted(t *testing.T) {
	input := `{
  "plan": {
    "mode": "pipeline",
    "tasks": [
      {
        "id": "task-1",
        "agent": "codex",
        "description": "Analyze codebase",
        "targetFiles": ["src/main.go"],
        "dependsOn": [],
        "expectedOutput": "analysis report"
      },
      {
        "id": "task-2",
        "agent": "claude-code",
        "description": "Implement feature",
        "targetFiles": ["src/feature.go"],
        "dependsOn": ["task-1"],
        "expectedOutput": "feature implemented"
      }
    ]
  }
}`
	plan, err := ParsePlan(input)
	if err != nil {
		t.Fatalf("ParsePlan error: %v", err)
	}
	if plan.Mode != "pipeline" {
		t.Fatalf("mode = %q, want pipeline", plan.Mode)
	}
	if len(plan.Tasks) != 2 {
		t.Fatalf("expected 2 tasks, got %d", len(plan.Tasks))
	}
	if plan.Tasks[1].TargetFiles[0] != "src/feature.go" {
		t.Fatalf("task-2 targetFiles = %v, want [src/feature.go]", plan.Tasks[1].TargetFiles)
	}
}

// ── DefaultOrchestratorPrompt integration test ──────────────────────────────

func TestDefaultOrchestratorPrompt_ContainsSchema(t *testing.T) {
	prompt := DefaultOrchestratorPrompt([]string{"codex", "claude-code"})
	if prompt == "" {
		t.Fatal("prompt should not be empty")
	}
	// Must contain the schema instruction.
	if !containsStr(prompt, `"plan"`) {
		t.Fatal("prompt should contain plan schema")
	}
	if !containsStr(prompt, `"tasks"`) {
		t.Fatal("prompt should contain tasks schema")
	}
	if !containsStr(prompt, `"dependsOn"`) {
		t.Fatal("prompt should contain dependsOn schema")
	}
	if !containsStr(prompt, `"mode"`) {
		t.Fatal("prompt should contain mode schema")
	}
	// Must list available agents.
	if !containsStr(prompt, "codex") {
		t.Fatal("prompt should mention codex agent")
	}
	if !containsStr(prompt, "claude-code") {
		t.Fatal("prompt should mention claude-code agent")
	}
}

// ── helper ───────────────────────────────────────────────────────────────────

func batchIDs(tasks []PlanTask) []string {
	ids := make([]string, len(tasks))
	for i, t := range tasks {
		ids[i] = t.ID
	}
	return ids
}

func containsStr(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > 0 && containsSubstr(s, substr))
}

func containsSubstr(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}

// ── DefaultOrchestratorPrompt XML Tags Tests (T2-I11) ───────────────────────

func TestDefaultOrchestratorPrompt_RequiredXMLTags(t *testing.T) {
	requiredTags := []string{
		"<ROLE>",
		"</ROLE>",
		"<LIMITS>",
		"</LIMITS>",
		"<WORKFLOW>",
		"</WORKFLOW>",
		"<OUTPUT>",
		"</OUTPUT>",
		"<CONSTRAINTS>",
		"</CONSTRAINTS>",
	}

	tests := []struct {
		name   string
		agents []string
	}{
		{
			name:   "with multiple agents",
			agents: []string{"builder", "reviewer", "tester"},
		},
		{
			name:   "with single agent",
			agents: []string{"code-reviewer"},
		},
		{
			name:   "with empty agent list",
			agents: []string{},
		},
		{
			name:   "nil agents",
			agents: nil,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			prompt := DefaultOrchestratorPrompt(tt.agents)

			for _, tag := range requiredTags {
				if !strings.Contains(prompt, tag) {
					t.Errorf("DefaultOrchestratorPrompt(%v) missing required tag %q", tt.agents, tag)
				}
			}
		})
	}
}

func TestDefaultOrchestratorPrompt_ContainsExpectedSections(t *testing.T) {
	prompt := DefaultOrchestratorPrompt([]string{"builder", "reviewer", "researcher"})

	// ROLE section should mention the orchestrator's identity.
	if !strings.Contains(prompt, "Orchestrator") {
		t.Error("prompt should mention 'Orchestrator' in ROLE section")
	}
	if !strings.Contains(prompt, "multi-agent system") {
		t.Error("prompt should mention 'multi-agent system'")
	}

	// LIMITS section should list available agents.
	if !strings.Contains(prompt, "builder") {
		t.Error("prompt should list 'builder' in available agents")
	}
	if !strings.Contains(prompt, "reviewer") {
		t.Error("prompt should list 'reviewer' in available agents")
	}
	if !strings.Contains(prompt, "researcher") {
		t.Error("prompt should list 'researcher' in available agents")
	}

	// WORKFLOW section should contain the 5-step workflow.
	if !strings.Contains(prompt, "ANALYZE") {
		t.Error("prompt should contain 'ANALYZE' step in WORKFLOW")
	}
	if !strings.Contains(prompt, "PLAN") {
		t.Error("prompt should contain 'PLAN' step in WORKFLOW")
	}
	if !strings.Contains(prompt, "DISPATCH") {
		t.Error("prompt should contain 'DISPATCH' step in WORKFLOW")
	}
	if !strings.Contains(prompt, "AGGREGATE") {
		t.Error("prompt should contain 'AGGREGATE' step in WORKFLOW")
	}
	if !strings.Contains(prompt, "TERMINATE") {
		t.Error("prompt should contain 'TERMINATE' step in WORKFLOW")
	}

	// OUTPUT section should contain the JSON schema structure.
	if !strings.Contains(prompt, `"tasks"`) {
		t.Error("prompt should contain JSON schema with 'tasks' array")
	}
	if !strings.Contains(prompt, `"agent"`) {
		t.Error("prompt should contain JSON schema with 'agent' field")
	}
	if !strings.Contains(prompt, `"dependsOn"`) {
		t.Error("prompt should contain JSON schema with 'dependsOn' field")
	}

	// CONSTRAINTS section should restrict behavior.
	if !strings.Contains(prompt, "NEVER") {
		t.Error("prompt CONSTRAINTS should contain 'NEVER' directives")
	}
	if !strings.Contains(prompt, "circular dependencies") {
		t.Error("prompt should mention 'circular dependencies' constraint")
	}
}

func TestDefaultOrchestratorPrompt_EmptyAgentList(t *testing.T) {
	prompt := DefaultOrchestratorPrompt([]string{})

	// With empty agent list, all XML tags must still be present.
	requiredTags := []string{"<ROLE>", "</ROLE>", "<LIMITS>", "</LIMITS>",
		"<WORKFLOW>", "</WORKFLOW>", "<OUTPUT>", "</OUTPUT>",
		"<CONSTRAINTS>", "</CONSTRAINTS>"}
	for _, tag := range requiredTags {
		if !strings.Contains(prompt, tag) {
			t.Errorf("DefaultOrchestratorPrompt([]) missing required tag %q", tag)
		}
	}

	// With empty agent list, the agent list should say "none".
	if !strings.Contains(prompt, "none") {
		t.Error("prompt with empty agents should contain 'none' as agent list placeholder")
	}
}

func TestDefaultOrchestratorPrompt_XMLTagOrder(t *testing.T) {
	prompt := DefaultOrchestratorPrompt([]string{"builder"})

	// Verify tags appear in the expected order: ROLE -> LIMITS -> WORKFLOW -> OUTPUT -> CONSTRAINTS.
	tags := []string{"<ROLE>", "<LIMITS>", "<WORKFLOW>", "<OUTPUT>", "<CONSTRAINTS>"}
	prevIdx := -1
	for _, tag := range tags {
		idx := strings.Index(prompt, tag)
		if idx == -1 {
			t.Errorf("tag %q not found in prompt", tag)
			continue
		}
		if idx <= prevIdx {
			t.Errorf("tag %q (at index %d) should appear after previous tag (at index %d)", tag, idx, prevIdx)
		}
		prevIdx = idx
	}
}

func BenchmarkDefaultOrchestratorPrompt(b *testing.B) {
	agents := []string{"builder", "reviewer", "tester", "researcher", "deployer"}
	for b.Loop() {
		DefaultOrchestratorPrompt(agents)
	}
}
