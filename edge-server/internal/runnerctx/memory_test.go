package runnerctx

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// ── parseFrontmatter Tests ───────────────────────────────────────────────────

func TestParseFrontmatter(t *testing.T) {
	yaml := "id: mem_abc123\ncreated: 2026-06-10T08:00:00Z\nupdated: 2026-06-10T12:00:00Z\ntags: [setup, go]\nsource: user"
	body := "The user prefers Go for backend development."

	entry, err := parseFrontmatter(yaml, body)
	if err != nil {
		t.Fatalf("parseFrontmatter returned error: %v", err)
	}

	if entry.ID != "mem_abc123" {
		t.Errorf("ID = %q, want %q", entry.ID, "mem_abc123")
	}
	if entry.Content != body {
		t.Errorf("Content = %q, want %q", entry.Content, body)
	}
	if entry.Source != "user" {
		t.Errorf("Source = %q, want %q", entry.Source, "user")
	}
	if entry.CreatedAt != "2026-06-10T08:00:00Z" {
		t.Errorf("CreatedAt = %q, want %q", entry.CreatedAt, "2026-06-10T08:00:00Z")
	}
	if len(entry.Tags) != 2 || entry.Tags[0] != "setup" || entry.Tags[1] != "go" {
		t.Errorf("Tags = %v, want [setup go]", entry.Tags)
	}
}

func TestParseFrontmatterMissingID(t *testing.T) {
	yaml := "created: 2026-06-10T08:00:00Z\nsource: agent"
	_, err := parseFrontmatter(yaml, "some content")
	if err == nil {
		t.Error("expected error for missing id, got nil")
	}
}

func TestParseFrontmatterDefaults(t *testing.T) {
	yaml := "id: mem_only_id"
	entry, err := parseFrontmatter(yaml, "content here")
	if err != nil {
		t.Fatalf("parseFrontmatter returned error: %v", err)
	}
	if entry.Source != "agent" {
		t.Errorf("default Source = %q, want %q", entry.Source, "agent")
	}
	if entry.Tags != nil {
		t.Errorf("default Tags = %v, want nil", entry.Tags)
	}
}

func TestParseFrontmatterInvalidSource(t *testing.T) {
	yaml := "id: mem_x\nsource: invalid"
	entry, _ := parseFrontmatter(yaml, "content")
	if entry.Source != "agent" {
		t.Errorf("invalid source fallback = %q, want %q", entry.Source, "agent")
	}
}

// ── parseInlineArray Tests ───────────────────────────────────────────────────

func TestParseInlineArray(t *testing.T) {
	tests := []struct {
		input string
		want  []string
	}{
		{"[tag1, tag2, tag3]", []string{"tag1", "tag2", "tag3"}},
		{"[single]", []string{"single"}},
		{"[]", nil},
		{"not-an-array", nil},
		{"[ a , b , c ]", []string{"a", "b", "c"}},
	}

	for _, tt := range tests {
		got := parseInlineArray(tt.input)
		if len(got) != len(tt.want) {
			t.Errorf("parseInlineArray(%q) = %v, want %v", tt.input, got, tt.want)
			continue
		}
		for i := range got {
			if got[i] != tt.want[i] {
				t.Errorf("parseInlineArray(%q)[%d] = %q, want %q", tt.input, i, got[i], tt.want[i])
			}
		}
	}
}

// ── readMemoryFile Tests ─────────────────────────────────────────────────────

func TestReadMemoryFileSingleEntry(t *testing.T) {
	content := `---
id: mem_001
created: 2026-06-10T08:00:00Z
updated: 2026-06-10T08:00:00Z
tags: [setup, preferences]
source: user
---

The user prefers dark theme.`

	dir := t.TempDir()
	path := filepath.Join(dir, "project.md")
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}

	entries, err := readMemoryFile(path)
	if err != nil {
		t.Fatalf("readMemoryFile returned error: %v", err)
	}

	if len(entries) != 1 {
		t.Fatalf("len(entries) = %d, want 1", len(entries))
	}

	e := entries[0]
	if e.ID != "mem_001" {
		t.Errorf("ID = %q, want %q", e.ID, "mem_001")
	}
	if e.Source != "user" {
		t.Errorf("Source = %q, want %q", e.Source, "user")
	}
	if e.Content != "The user prefers dark theme." {
		t.Errorf("Content = %q, unexpected", e.Content)
	}
	if len(e.Tags) != 2 {
		t.Errorf("Tags = %v, want 2 tags", e.Tags)
	}
}

func TestReadMemoryFileMultipleEntries(t *testing.T) {
	content := `---
id: mem_001
created: 2026-06-10T08:00:00Z
updated: 2026-06-10T08:00:00Z
source: user
---

First entry content.

---
id: mem_002
created: 2026-06-10T09:00:00Z
updated: 2026-06-10T09:00:00Z
source: agent
---

Second entry content.`

	dir := t.TempDir()
	path := filepath.Join(dir, "project.md")
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}

	entries, err := readMemoryFile(path)
	if err != nil {
		t.Fatalf("readMemoryFile returned error: %v", err)
	}

	if len(entries) != 2 {
		t.Fatalf("len(entries) = %d, want 2", len(entries))
	}

	if entries[0].ID != "mem_001" {
		t.Errorf("entries[0].ID = %q, want %q", entries[0].ID, "mem_001")
	}
	if entries[1].ID != "mem_002" {
		t.Errorf("entries[1].ID = %q, want %q", entries[1].ID, "mem_002")
	}
}

func TestReadMemoryFileEmpty(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "project.md")
	if err := os.WriteFile(path, []byte(""), 0644); err != nil {
		t.Fatal(err)
	}

	entries, err := readMemoryFile(path)
	if err != nil {
		t.Fatalf("readMemoryFile returned error: %v", err)
	}

	if len(entries) != 0 {
		t.Errorf("len(entries) = %d, want 0", len(entries))
	}
}

func TestReadMemoryFileNotFound(t *testing.T) {
	_, err := readMemoryFile("/nonexistent/path/project.md")
	if err == nil {
		t.Error("expected error for nonexistent file, got nil")
	}
}

// ── ReadMemory Integration Tests ─────────────────────────────────────────────

func TestReadMemoryNoDir(t *testing.T) {
	result := ReadMemory("/nonexistent/workspace", "thread_123", "agent_456")
	if len(result.Entries) != 0 {
		t.Errorf("expected empty entries, got %d", len(result.Entries))
	}
	if result.PromptText != "" {
		t.Errorf("expected empty prompt, got %q", result.PromptText)
	}
}

func TestReadMemoryWithProjectFile(t *testing.T) {
	dir := t.TempDir()
	memDir := filepath.Join(dir, ".agenthub", "memory")
	if err := os.MkdirAll(memDir, 0755); err != nil {
		t.Fatal(err)
	}

	projectContent := `---
id: mem_proj
created: 2026-06-10T08:00:00Z
updated: 2026-06-10T08:00:00Z
source: system
---

This project uses React and TypeScript.`

	if err := os.WriteFile(filepath.Join(memDir, "project.md"), []byte(projectContent), 0644); err != nil {
		t.Fatal(err)
	}

	result := ReadMemory(dir, "", "")
	if len(result.Entries) != 1 {
		t.Fatalf("len(entries) = %d, want 1", len(result.Entries))
	}

	if result.Entries[0].ID != "mem_proj" {
		t.Errorf("ID = %q, want %q", result.Entries[0].ID, "mem_proj")
	}
	if result.FilesRead != 1 {
		t.Errorf("FilesRead = %d, want 1", result.FilesRead)
	}
	if result.PromptText == "" {
		t.Error("PromptText is empty, expected formatted memory prompt")
	}
	if !contains(result.PromptText, "[AgentHub Memory - project]") {
		t.Errorf("PromptText missing project header: %q", result.PromptText)
	}
	if !contains(result.PromptText, "[End of AgentHub Memory]") {
		t.Errorf("PromptText missing end marker: %q", result.PromptText)
	}
}

func TestReadMemoryWithThreadAndAgent(t *testing.T) {
	dir := t.TempDir()
	memDir := filepath.Join(dir, ".agenthub", "memory")
	if err := os.MkdirAll(memDir, 0755); err != nil {
		t.Fatal(err)
	}

	projectContent := `---
id: mem_proj
created: 2026-06-10T08:00:00Z
updated: 2026-06-10T08:00:00Z
source: system
---

Project uses Go.`

	threadContent := `---
id: mem_thread
created: 2026-06-10T09:00:00Z
updated: 2026-06-10T09:00:00Z
source: user
---

User asked about testing.`

	agentContent := `---
id: mem_agent
created: 2026-06-10T10:00:00Z
updated: 2026-06-10T10:00:00Z
source: agent
---

Claude Code adapter works well.`

	if err := os.WriteFile(filepath.Join(memDir, "project.md"), []byte(projectContent), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(memDir, "thread_t1.md"), []byte(threadContent), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(memDir, "agent_a1.md"), []byte(agentContent), 0644); err != nil {
		t.Fatal(err)
	}

	result := ReadMemory(dir, "t1", "a1")
	if len(result.Entries) != 3 {
		t.Fatalf("len(entries) = %d, want 3", len(result.Entries))
	}
	if result.FilesRead != 3 {
		t.Errorf("FilesRead = %d, want 3", result.FilesRead)
	}
	if result.EstimatedTokens == 0 {
		t.Error("EstimatedTokens is 0, expected non-zero for non-empty prompt")
	}
}

func TestReadMemoryEmptyWorkDir(t *testing.T) {
	result := ReadMemory("", "thread_123", "agent_456")
	if len(result.Entries) != 0 {
		t.Errorf("expected empty result for empty workDir")
	}
}

// ── BuildMemoryPrompt Tests ─────────────────────────────────────────────────

func TestBuildMemoryPrompt(t *testing.T) {
	dir := t.TempDir()
	memDir := filepath.Join(dir, ".agenthub", "memory")
	if err := os.MkdirAll(memDir, 0755); err != nil {
		t.Fatal(err)
	}

	content := `---
id: mem_test
created: 2026-06-10T08:00:00Z
updated: 2026-06-10T08:00:00Z
source: user
---

User likes dark mode.`

	if err := os.WriteFile(filepath.Join(memDir, "project.md"), []byte(content), 0644); err != nil {
		t.Fatal(err)
	}

	prompt := BuildMemoryPrompt(dir, "", "")
	if prompt == "" {
		t.Error("BuildMemoryPrompt returned empty string")
	}
	if !contains(prompt, "[AgentHub Memory - project]") {
		t.Errorf("prompt missing project header: %q", prompt)
	}
}

func TestBuildMemoryPromptNoMemory(t *testing.T) {
	prompt := BuildMemoryPrompt("/nonexistent", "", "")
	if prompt != "" {
		t.Errorf("expected empty prompt for nonexistent dir, got %q", prompt)
	}
}

// ── Helper ───────────────────────────────────────────────────────────────────

func contains(s, substr string) bool {
	return len(s) >= len(substr) && strings.Contains(s, substr)
}

// ── EnsureMemoryDir Tests ──────────────────────────────────────────────────

func TestEnsureMemoryDir(t *testing.T) {
	dir := t.TempDir()

	if err := EnsureMemoryDir(dir); err != nil {
		t.Fatalf("EnsureMemoryDir returned error: %v", err)
	}

	memDir := filepath.Join(dir, ".agenthub", "memory")
	info, err := os.Stat(memDir)
	if err != nil {
		t.Fatalf("memory dir not created: %v", err)
	}
	if !info.IsDir() {
		t.Error("memory path is not a directory")
	}

	// Check default project.md was created
	projectPath := filepath.Join(memDir, "project.md")
	data, err := os.ReadFile(projectPath)
	if err != nil {
		t.Fatalf("project.md not created: %v", err)
	}
	if !contains(string(data), "project-onboarding") {
		t.Errorf("project.md missing default entry: %q", string(data))
	}
}

func TestEnsureMemoryDirIdempotent(t *testing.T) {
	dir := t.TempDir()

	// First call creates the directory and default file
	if err := EnsureMemoryDir(dir); err != nil {
		t.Fatal(err)
	}

	// Write custom content to project.md
	memDir := filepath.Join(dir, ".agenthub", "memory")
	customContent := "---\nid: custom\n---\n\nCustom content."
	if err := os.WriteFile(filepath.Join(memDir, "project.md"), []byte(customContent), 0644); err != nil {
		t.Fatal(err)
	}

	// Second call should NOT overwrite the file
	if err := EnsureMemoryDir(dir); err != nil {
		t.Fatal(err)
	}

	data, err := os.ReadFile(filepath.Join(memDir, "project.md"))
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != customContent {
		t.Errorf("EnsureMemoryDir overwrote existing project.md")
	}
}

func TestEnsureMemoryDirEmptyWorkDir(t *testing.T) {
	if err := EnsureMemoryDir(""); err != nil {
		t.Errorf("expected nil for empty workDir, got: %v", err)
	}
}

// ── WriteMemoryEntry Tests ─────────────────────────────────────────────────

func TestWriteMemoryEntryProject(t *testing.T) {
	dir := t.TempDir()

	entry, err := WriteMemoryEntry(MemoryWriteRequest{
		WorkDir: dir,
		Entry: MemoryEntry{
			ID:      "test-write-1",
			Content: "The user prefers dark mode in the IDE.",
			Tags:    []string{"ui", "preference"},
			Source:  "user",
		},
	})
	if err != nil {
		t.Fatalf("WriteMemoryEntry returned error: %v", err)
	}

	if entry.ID != "test-write-1" {
		t.Errorf("ID = %q, want %q", entry.ID, "test-write-1")
	}
	if entry.Source != "user" {
		t.Errorf("Source = %q, want %q", entry.Source, "user")
	}
	if entry.CreatedAt == "" {
		t.Error("CreatedAt is empty")
	}

	// Verify the file was written
	memDir := filepath.Join(dir, ".agenthub", "memory")
	data, err := os.ReadFile(filepath.Join(memDir, "project.md"))
	if err != nil {
		t.Fatalf("project.md not found: %v", err)
	}
	content := string(data)
	if !contains(content, "test-write-1") {
		t.Errorf("project.md missing entry ID: %q", content)
	}
	if !contains(content, "dark mode") {
		t.Errorf("project.md missing entry content: %q", content)
	}
}

func TestWriteMemoryEntryThread(t *testing.T) {
	dir := t.TempDir()

	entry, err := WriteMemoryEntry(MemoryWriteRequest{
		WorkDir:  dir,
		ThreadID: "t1",
		Entry: MemoryEntry{
			ID:      "thread-mem-1",
			Content: "User asked about deployment.",
			Source:  "agent",
		},
	})
	if err != nil {
		t.Fatalf("WriteMemoryEntry returned error: %v", err)
	}
	if entry.Source != "agent" {
		t.Errorf("Source = %q, want %q", entry.Source, "agent")
	}

	// Verify the thread file was written
	memDir := filepath.Join(dir, ".agenthub", "memory")
	data, err := os.ReadFile(filepath.Join(memDir, "thread_t1.md"))
	if err != nil {
		t.Fatalf("thread_t1.md not found: %v", err)
	}
	if !contains(string(data), "thread-mem-1") {
		t.Errorf("thread file missing entry ID")
	}
}

func TestWriteMemoryEntryAgent(t *testing.T) {
	dir := t.TempDir()

	_, err := WriteMemoryEntry(MemoryWriteRequest{
		WorkDir: dir,
		AgentID: "codex",
		Entry: MemoryEntry{
			ID:      "agent-mem-1",
			Content: "Codex works best with -c model=gpt-4.",
			Source:  "system",
		},
	})
	if err != nil {
		t.Fatalf("WriteMemoryEntry returned error: %v", err)
	}

	memDir := filepath.Join(dir, ".agenthub", "memory")
	data, err := os.ReadFile(filepath.Join(memDir, "agent_codex.md"))
	if err != nil {
		t.Fatalf("agent_codex.md not found: %v", err)
	}
	if !contains(string(data), "agent-mem-1") {
		t.Errorf("agent file missing entry ID")
	}
}

func TestWriteMemoryEntryAppend(t *testing.T) {
	dir := t.TempDir()

	// Write first entry
	_, err := WriteMemoryEntry(MemoryWriteRequest{
		WorkDir: dir,
		Entry: MemoryEntry{
			ID:      "entry-1",
			Content: "First entry.",
			Source:  "user",
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	// Write second entry (append)
	_, err = WriteMemoryEntry(MemoryWriteRequest{
		WorkDir: dir,
		Entry: MemoryEntry{
			ID:      "entry-2",
			Content: "Second entry.",
			Source:  "user",
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	// Both entries should be readable
	result := ReadMemory(dir, "", "")
	if len(result.Entries) != 2 {
		t.Fatalf("expected 2 entries, got %d", len(result.Entries))
	}
}

func TestWriteMemoryEntryOverwrite(t *testing.T) {
	dir := t.TempDir()

	// Write initial entry
	_, err := WriteMemoryEntry(MemoryWriteRequest{
		WorkDir: dir,
		Entry: MemoryEntry{
			ID:      "old-entry",
			Content: "Old content.",
			Source:  "user",
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	// Overwrite with new entry
	_, err = WriteMemoryEntry(MemoryWriteRequest{
		WorkDir: dir,
		Overwrite: true,
		Entry: MemoryEntry{
			ID:      "new-entry",
			Content: "New content.",
			Source:  "user",
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	// Only the new entry should exist
	result := ReadMemory(dir, "", "")
	if len(result.Entries) != 1 {
		t.Fatalf("expected 1 entry after overwrite, got %d", len(result.Entries))
	}
	if result.Entries[0].ID != "new-entry" {
		t.Errorf("ID = %q, want %q", result.Entries[0].ID, "new-entry")
	}
}

func TestWriteMemoryEntryDefaultSource(t *testing.T) {
	dir := t.TempDir()

	entry, err := WriteMemoryEntry(MemoryWriteRequest{
		WorkDir: dir,
		Entry: MemoryEntry{
			ID:      "no-source",
			Content: "Content without explicit source.",
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if entry.Source != "user" {
		t.Errorf("Source = %q, want %q (default)", entry.Source, "user")
	}
}

func TestWriteThenReadRoundTrip(t *testing.T) {
	dir := t.TempDir()

	// Write entries across all three scopes
	_, _ = WriteMemoryEntry(MemoryWriteRequest{
		WorkDir: dir,
		Entry: MemoryEntry{ID: "p1", Content: "Project fact.", Source: "system"},
	})
	_, _ = WriteMemoryEntry(MemoryWriteRequest{
		WorkDir: dir, ThreadID: "t1",
		Entry: MemoryEntry{ID: "t1", Content: "Thread fact.", Source: "user"},
	})
	_, _ = WriteMemoryEntry(MemoryWriteRequest{
		WorkDir: dir, AgentID: "a1",
		Entry: MemoryEntry{ID: "a1", Content: "Agent fact.", Source: "agent"},
	})

	result := ReadMemory(dir, "t1", "a1")
	if len(result.Entries) != 3 {
		t.Fatalf("expected 3 entries, got %d", len(result.Entries))
	}
	if result.PromptText == "" {
		t.Error("PromptText is empty after round-trip")
	}
}
