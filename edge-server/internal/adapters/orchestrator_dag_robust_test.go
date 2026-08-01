package adapters

import (
	"fmt"
	"strings"
	"testing"
)

func TestParsePlanRobust_FlatJSON(t *testing.T) {
	input := `{"tasks":[{"agent":"codex","description":"do stuff"}]}`
	plan, err := ParsePlanRobust(input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(plan.Tasks) != 1 {
		t.Fatalf("expected 1 task, got %d", len(plan.Tasks))
	}
	if plan.Tasks[0].Agent != "codex" {
		t.Fatalf("expected agent codex, got %q", plan.Tasks[0].Agent)
	}
}

func TestParsePlanRobust_NestedJSON(t *testing.T) {
	input := `{"plan":{"mode":"parallel","tasks":[{"agent":"codex","description":"do stuff"}]}}`
	plan, err := ParsePlanRobust(input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if plan.Mode != "parallel" {
		t.Fatalf("expected mode parallel, got %q", plan.Mode)
	}
}

func TestParsePlanRobust_MarkdownFenced(t *testing.T) {
	input := "```json\n{\"tasks\":[{\"agent\":\"codex\",\"description\":\"do stuff\"}]}\n```"
	plan, err := ParsePlanRobust(input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(plan.Tasks) != 1 {
		t.Fatalf("expected 1 task, got %d", len(plan.Tasks))
	}
}

func TestParsePlanRobust_TrailingCommaArray(t *testing.T) {
	input := `{"tasks":[{"agent":"codex","description":"do stuff"},]}`
	plan, err := ParsePlanRobust(input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(plan.Tasks) != 1 {
		t.Fatalf("expected 1 task, got %d", len(plan.Tasks))
	}
}

func TestParsePlanRobust_TrailingCommaObject(t *testing.T) {
	input := `{"tasks":[{"agent":"codex","description":"do stuff",}]}`
	plan, err := ParsePlanRobust(input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(plan.Tasks) != 1 {
		t.Fatalf("expected 1 task, got %d", len(plan.Tasks))
	}
}

func TestParsePlanRobust_UnbalancedBrace(t *testing.T) {
	input := `{"tasks":[{"agent":"codex","description":"do stuff"}]`
	plan, err := ParsePlanRobust(input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(plan.Tasks) != 1 {
		t.Fatalf("expected 1 task, got %d", len(plan.Tasks))
	}
}

func TestParsePlanRobust_HeuristicPlainText(t *testing.T) {
	input := "Please analyze the codebase and write tests."
	plan, err := ParsePlanRobust(input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if plan.Mode != "sequential" {
		t.Fatalf("expected mode sequential, got %q", plan.Mode)
	}
	if plan.Summary != "Please analyze the codebase and write tests." {
		t.Fatalf("expected summary to match input, got %q", plan.Summary)
	}
	if len(plan.Tasks) != 1 || plan.Tasks[0].ID != "task-1" {
		t.Fatalf("expected single task-1, got %d tasks", len(plan.Tasks))
	}
}

func TestParsePlanRobust_HeuristicWithFences(t *testing.T) {
	input := "```\nPlease analyze the codebase.\n```"
	plan, err := ParsePlanRobust(input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if plan.Summary != "Please analyze the codebase." {
		t.Fatalf("expected summary 'Please analyze the codebase.', got %q", plan.Summary)
	}
}

func TestParsePlanRobust_EmptyText(t *testing.T) {
	_, err := ParsePlanRobust("")
	if err == nil {
		t.Fatal("expected error for empty text")
	}
	if _, ok := err.(*PlanParseError); !ok {
		t.Fatalf("expected PlanParseError, got %T: %v", err, err)
	}
}

func TestParsePlanRobust_WhitespaceOnly(t *testing.T) {
	_, err := ParsePlanRobust("   \n  \n  ")
	if err == nil {
		t.Fatal("expected error for whitespace-only text")
	}
	if _, ok := err.(*PlanParseError); !ok {
		t.Fatalf("expected PlanParseError, got %T: %v", err, err)
	}
}

// ── ParsePlanRobust comprehensive table-driven tests ─────────────────────────

// TestParsePlanRobust_TableDriven consolidates the six core scenarios into a
// single table-driven test for maintainability and regression coverage.
func TestParsePlanRobust_TableDriven(t *testing.T) {
	tests := []struct {
		name        string
		input       string
		wantErr     bool
		wantTasks   int
		wantAgent   string // first task's agent
		wantContain string // substring expected in summary or call
	}{
		{
			name:      "valid flat JSON",
			input:     `{"tasks":[{"agent":"codex","description":"do stuff"}]}`,
			wantErr:   false,
			wantTasks: 1,
			wantAgent: "codex",
		},
		{
			name:      "missing closing brace",
			input:     `{"tasks":[{"agent":"codex","description":"do stuff"}]`,
			wantErr:   false, // repair balances the brace
			wantTasks: 1,
			wantAgent: "codex",
		},
		{
			name:      "trailing comma in array",
			input:     `{"tasks":[{"agent":"codex","description":"do stuff"},]}`,
			wantErr:   false,
			wantTasks: 1,
			wantAgent: "codex",
		},
		{
			name:      "trailing comma in object",
			input:     `{"tasks":[{"agent":"codex","description":"do stuff",}]}`,
			wantErr:   false,
			wantTasks: 1,
			wantAgent: "codex",
		},
		{
			name:      "markdown-wrapped JSON",
			input:     "```json\n{\"tasks\":[{\"agent\":\"codex\",\"description\":\"do stuff\"}]}\n```",
			wantErr:   false,
			wantTasks: 1,
			wantAgent: "codex",
		},
		{
			name:        "completely malformed text",
			input:       "Please analyze the codebase and write tests.",
			wantErr:     false, // heuristic fallback creates single-task plan
			wantTasks:   1,
			wantContain: "Please analyze the codebase and write tests.",
		},
		{
			name:      "empty string",
			input:     "",
			wantErr:   true,
			wantTasks: 0,
		},
		{
			name:      "whitespace only",
			input:     "   \n  \t  ",
			wantErr:   true,
			wantTasks: 0,
		},
		{
			name:      "valid nested JSON",
			input:     `{"plan":{"mode":"parallel","summary":"test","tasks":[{"agent":"codex","description":"do stuff"}]}}`,
			wantErr:   false,
			wantTasks: 1,
			wantAgent: "codex",
		},
		{
			name:      "embedded JSON in text",
			input:     "I will do this:\n{\"plan\":{\"mode\":\"sequential\",\"tasks\":[{\"id\":\"t1\",\"agent\":\"codex\",\"description\":\"step1\"}]}}\nNow executing...",
			wantErr:   false,
			wantTasks: 1,
			wantAgent: "codex",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			plan, err := ParsePlanRobust(tt.input)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("expected error, got plan: %+v", plan)
				}
				if _, ok := err.(*PlanParseError); !ok {
					t.Fatalf("expected *PlanParseError, got %T: %v", err, err)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if plan == nil {
				t.Fatal("expected non-nil plan")
			}
			if len(plan.Tasks) != tt.wantTasks {
				t.Fatalf("task count = %d, want %d", len(plan.Tasks), tt.wantTasks)
			}
			if tt.wantAgent != "" {
				if len(plan.Tasks) == 0 || plan.Tasks[0].Agent != tt.wantAgent {
					t.Fatalf("first task agent = %q, want %q", plan.Tasks[0].Agent, tt.wantAgent)
				}
			}
			if tt.wantContain != "" {
				if plan.Summary != tt.wantContain && !stringsContains(plan.Summary, tt.wantContain) {
					t.Fatalf("summary = %q, want containing %q", plan.Summary, tt.wantContain)
				}
			}
		})
	}
}

// TestParsePlanRobust_EdgeCases covers additional malformed JSON scenarios
// beyond the core six that exercise the repair and fallback pipeline more deeply.
func TestParsePlanRobust_EdgeCases(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		wantErr  bool
		hasTasks bool
	}{
		{
			name:     "only opening brace",
			input:    `{`,
			wantErr:  false, // heuristic fallback treats "{" as text and creates single-task plan
			hasTasks: true,
		},
		{
			name:     "corrupted JSON with garbage in middle",
			input:    `{"tasks":[{"agent":"codex",NOT_JSON_HERE"description":"do"}]}`,
			wantErr:  false, // should fall back to heuristic
			hasTasks: true,
		},
		{
			name:     "null tasks array",
			input:    `{"tasks":null}`,
			wantErr:  false, // heuristic fallback
			hasTasks: true,
		},
		{
			name:     "tasks array with empty object",
			input:    `{"tasks":[{}]}`,
			wantErr:  false,
			hasTasks: true,
		},
		{
			name:     "very long valid JSON (stress test)",
			input:    buildPlanJSON(100),
			wantErr:  false,
			hasTasks: true,
		},
		{
			name:     "JSON with comments (non-standard)",
			input:    `{"tasks":/* comment */[{"agent":"codex","description":"do"}]}`,
			wantErr:  false, // should fall back to heuristic
			hasTasks: true,
		},
		{
			name:     "mixed content with multiple JSON candidates",
			input:    "Let's plan.\n{\"summary\":\"not a plan\"}\nThen {\"tasks\":[{\"agent\":\"codex\",\"description\":\"real work\"}]}",
			wantErr:  false,
			hasTasks: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			plan, err := ParsePlanRobust(tt.input)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("expected error, got plan: %+v", plan)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if plan == nil {
				t.Fatal("expected non-nil plan")
			}
			if tt.hasTasks && len(plan.Tasks) == 0 {
				t.Fatal("expected at least one task")
			}
		})
	}
}

// buildPlanJSON creates a plan JSON string with n tasks for stress testing.
func buildPlanJSON(n int) string {
	var parts []string
	for i := 0; i < n; i++ {
		parts = append(parts, fmt.Sprintf(`{"agent":"codex","description":"task-%d"}`, i))
	}
	return fmt.Sprintf(`{"tasks":[%s]}`, strings.Join(parts, ","))
}

// stringsContains checks if s contains substr without importing strings
// (reuses the pattern from this package's test).
func stringsContains(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
