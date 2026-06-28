// Package runnerctx provides shared types for passing run-level context
// between the API handler, lifecycle executor, and agent adapters.
//
// This file implements filesystem-based Agent Memory reading. Memory entries
// are stored as Markdown files with YAML frontmatter under
// {workspace}/.agenthub/memory/ and are injected into agent prompts before
// each run.
package runnerctx

import (
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// ── Constants ──────────────────────────────────────────────────────────────────

// DefaultMemoryTTL is the default expiration duration for memory entries.
// Entries older than this are expired and filtered out on read.
// Set to 30 days.
const DefaultMemoryTTL = 30 * 24 * time.Hour

// ── Types ────────────────────────────────────────────────────────────────────

// MemoryEntry represents a single memory entry read from a Markdown file.
type MemoryEntry struct {
	ID        string   `json:"id"`
	Content   string   `json:"content"`
	Tags      []string `json:"tags,omitempty"`
	CreatedAt string   `json:"createdAt"`
	UpdatedAt string   `json:"updatedAt"`
	Source    string   `json:"source"` // "user" | "agent" | "system"

	// ExpiresAt, when set, defines an expiration time after which the entry
	// is skipped on read. nil means no expiration.
	ExpiresAt *time.Time `json:"expiresAt,omitempty"`

	// LastAccessed records the last time this entry was read.
	LastAccessed *time.Time `json:"lastAccessed,omitempty"`
}

// MemoryReadResult contains the result of reading memory files from a workspace.
type MemoryReadResult struct {
	Entries        []MemoryEntry `json:"entries"`
	PromptText     string        `json:"promptText"`
	EstimatedTokens int          `json:"estimatedTokens"`
	FilesRead      int           `json:"filesRead"`
	Warnings       []string      `json:"warnings,omitempty"`
}

// ── File Naming ──────────────────────────────────────────────────────────────

const (
	memorySubdir = ".agenthub/memory"
	projectFile  = "project.md"
)

// threadMemoryFile returns the memory file name for a given thread ID.
func threadMemoryFile(threadID string) string {
	return fmt.Sprintf("thread_%s.md", threadID)
}

// agentMemoryFile returns the memory file name for a given agent ID.
func agentMemoryFile(agentID string) string {
	return fmt.Sprintf("agent_%s.md", agentID)
}

// ── Reading ──────────────────────────────────────────────────────────────────

// ReadMemory reads AgentHub memory files from the workspace directory.
// It reads:
//   - project.md (project-level facts)
//   - thread_{threadID}.md (thread-specific context)
//   - agent_{agentID}.md (agent-specific preferences)
//
// The resulting MemoryReadResult contains formatted prompt text suitable for
// injection into the agent's system prompt via --append-system-prompt.
// If the .agenthub/memory/ directory does not exist, it returns an empty result
// with no error (memory is optional).
func ReadMemory(workDir, threadID, agentID string) MemoryReadResult {
	result := MemoryReadResult{}

	if workDir == "" {
		return result
	}

	memDir := filepath.Join(workDir, memorySubdir)

	// Check if memory directory exists. Absence is not an error.
	info, err := os.Stat(memDir)
	if err != nil || !info.IsDir() {
		return result
	}

	// Build the list of files to read.
	filesToRead := []struct {
		path     string
		category string
	}{
		{filepath.Join(memDir, projectFile), "project"},
	}

	if threadID != "" {
		filesToRead = append(filesToRead, struct {
			path     string
			category string
		}{
			filepath.Join(memDir, threadMemoryFile(threadID)),
			fmt.Sprintf("thread %s", threadID),
		})
	}

	if agentID != "" {
		filesToRead = append(filesToRead, struct {
			path     string
			category string
		}{
			filepath.Join(memDir, agentMemoryFile(agentID)),
			fmt.Sprintf("agent %s", agentID),
		})
	}

	var promptSections []string
	now := time.Now()
	var expiredCount int

	for _, f := range filesToRead {
		entries, err := readMemoryFile(f.path)
		if err != nil {
			if !os.IsNotExist(err) {
				result.Warnings = append(result.Warnings,
					fmt.Sprintf("memory file %s: %v", filepath.Base(f.path), err))
			}
			continue
		}

		if len(entries) == 0 {
			continue
		}

		// Filter out expired entries and update LastAccessed.
		var live []MemoryEntry
		for i := range entries {
			if entries[i].ExpiresAt != nil && entries[i].ExpiresAt.Before(now) {
				expiredCount++
				continue
			}
			accessed := now
			entries[i].LastAccessed = &accessed
			live = append(live, entries[i])
		}

		if len(live) == 0 {
			continue
		}

		result.FilesRead++
		result.Entries = append(result.Entries, live...)

		// Format entries for prompt injection.
		var sectionLines []string
		sectionLines = append(sectionLines, fmt.Sprintf("[AgentHub Memory - %s]", f.category))
		for _, e := range live {
			tagLine := ""
			if len(e.Tags) > 0 {
				tagLine = " (" + strings.Join(e.Tags, ", ") + ")"
			}
			sectionLines = append(sectionLines,
				fmt.Sprintf("- [%s%s] %s", e.Source, tagLine, e.Content))
		}
		promptSections = append(promptSections, strings.Join(sectionLines, "\n"))
	}

	if expiredCount > 0 {
		msg := fmt.Sprintf("memory: skipped %d expired entries", expiredCount)
		result.Warnings = append(result.Warnings, msg)
		slog.Warn(msg, "workDir", workDir, "threadID", threadID, "agentID", agentID)
	}

	if len(promptSections) > 0 {
		result.PromptText = strings.Join(promptSections, "\n\n") + "\n[End of AgentHub Memory]"
		result.EstimatedTokens = EstimateTokens(result.PromptText)
	}

	return result
}

// ── File Parsing ─────────────────────────────────────────────────────────────

// readMemoryFile reads and parses a single memory Markdown file.
// Each entry is a YAML frontmatter block delimited by "---" on its own line,
// followed by a Markdown body. Multiple entries can appear in one file.
func readMemoryFile(path string) ([]MemoryEntry, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	content := strings.TrimSpace(string(data))
	if content == "" {
		return nil, nil
	}

	var entries []MemoryEntry

	// Split the file into sections at "---" delimiters.
	// Each entry consists of: frontmatter lines (between pairs of "---")
	// followed by body content (until the next "---" or end of file).
	lines := strings.Split(content, "\n")
	var inFrontmatter bool
	var yamlLines []string
	var bodyLines []string
	var pendingFrontmatter []string // collected frontmatter waiting for body

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "---" {
			if !inFrontmatter {
				// Start of frontmatter. If we had accumulated body text,
				// flush the previous entry first.
				if len(pendingFrontmatter) > 0 && len(bodyLines) > 0 {
					body := strings.TrimSpace(strings.Join(bodyLines, "\n"))
					if body != "" {
						entry, err := parseFrontmatter(
							strings.Join(pendingFrontmatter, "\n"), body)
						if err == nil {
							entries = append(entries, entry)
						}
					}
				}
				inFrontmatter = true
				yamlLines = nil
				bodyLines = nil
			} else {
				// End of frontmatter — body follows.
				inFrontmatter = false
				pendingFrontmatter = append([]string{}, yamlLines...)
				bodyLines = nil
			}
		} else if inFrontmatter {
			yamlLines = append(yamlLines, line)
		} else {
			bodyLines = append(bodyLines, line)
		}
	}

	// Flush the last entry.
	if len(pendingFrontmatter) > 0 && len(bodyLines) > 0 {
		body := strings.TrimSpace(strings.Join(bodyLines, "\n"))
		if body != "" {
			entry, err := parseFrontmatter(
				strings.Join(pendingFrontmatter, "\n"), body)
			if err == nil {
				entries = append(entries, entry)
			}
		}
	}

	return entries, nil
}

// parseFrontmatter parses a minimal YAML frontmatter block into a MemoryEntry.
func parseFrontmatter(yaml, body string) (MemoryEntry, error) {
	fields := make(map[string]string)

	for _, line := range strings.Split(yaml, "\n") {
		idx := strings.Index(line, ":")
		if idx == -1 {
			continue
		}
		key := strings.TrimSpace(line[:idx])
		value := strings.TrimSpace(line[idx+1:])
		fields[key] = value
	}

	id, ok := fields["id"]
	if !ok || id == "" {
		return MemoryEntry{}, fmt.Errorf("missing id in frontmatter")
	}

	created, ok := fields["created"]
	if !ok || created == "" {
		created = time.Now().Format(time.RFC3339)
	}

	updated, ok := fields["updated"]
	if !ok || updated == "" {
		updated = created
	}

	source := fields["source"]
	if source == "" {
		source = "agent"
	}

	// Validate source.
	if source != "user" && source != "agent" && source != "system" {
		source = "agent"
	}

	var tags []string
	if tagsStr, ok := fields["tags"]; ok {
		tags = parseInlineArray(tagsStr)
	}

	return MemoryEntry{
		ID:        id,
		Content:   body,
		Tags:      tags,
		CreatedAt: created,
		UpdatedAt: updated,
		Source:    source,
		ExpiresAt: parseOptionalTime(fields["expires_at"]),
		LastAccessed: parseOptionalTime(fields["last_accessed"]),
	}, nil
}

// parseOptionalTime parses an optional RFC 3339 timestamp from a frontmatter
// field. Returns nil if the string is empty or unparseable.
func parseOptionalTime(s string) *time.Time {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return nil
	}
	return &t
}

// parseInlineArray parses a YAML inline array like "[tag1, tag2, tag3]".
func parseInlineArray(s string) []string {
	s = strings.TrimSpace(s)
	if !strings.HasPrefix(s, "[") || !strings.HasSuffix(s, "]") {
		return nil
	}
	s = s[1 : len(s)-1]
	if s == "" {
		return nil
	}
	parts := strings.Split(s, ",")
	result := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			result = append(result, p)
		}
	}
	return result
}

// ── Prompt Integration ──────────────────────────────────────────────────────

// BuildMemoryPrompt reads memory files and returns a formatted prompt section
// ready for injection into --append-system-prompt. Returns an empty string if
// no memory files exist or if all files are empty.
func BuildMemoryPrompt(workDir, threadID, agentID string) string {
	result := ReadMemory(workDir, threadID, agentID)
	return result.PromptText
}

// EnsureMemoryDir creates the .agenthub/memory/ directory tree under workDir
// and seeds it with a default project.md if it does not already exist.
// This is called lazily on first memory access so that users get a visible
// onboarding file without any manual setup.
func EnsureMemoryDir(workDir string) error {
	if workDir == "" {
		return nil
	}
	memDir := filepath.Join(workDir, memorySubdir)
	if err := os.MkdirAll(memDir, 0755); err != nil {
		return fmt.Errorf("create memory dir %s: %w", memDir, err)
	}
	projectPath := filepath.Join(memDir, projectFile)
	if _, err := os.Stat(projectPath); err == nil {
		return nil // already exists
	}
	defaultContent := `---
id: project-onboarding
source: system
created: ` + time.Now().Format(time.RFC3339) + `
---

This is the project memory file. AgentHub will load entries here before each run.
You can add facts, preferences, and context that the agent should remember.
`
	return os.WriteFile(projectPath, []byte(defaultContent), 0644)
}

// ── Writing ──────────────────────────────────────────────────────────────────

// MemoryWriteRequest describes a memory entry to write.
type MemoryWriteRequest struct {
	WorkDir   string
	ThreadID  string
	AgentID   string
	Entry     MemoryEntry
	Overwrite bool // replace the entire file instead of appending
}

// WriteMemoryEntry appends (or overwrites) a memory entry to the appropriate
// file under {workDir}/.agenthub/memory/. The target file is selected by scope:
//   - agentID set  -> agent_{agentID}.md
//   - threadID set -> thread_{threadID}.md
//   - otherwise    -> project.md
//
// When Overwrite is true, the file is replaced with just this entry.
// When Overwrite is false (default), the entry is appended to the end of the file.
func WriteMemoryEntry(req MemoryWriteRequest) (MemoryEntry, error) {
	if req.WorkDir == "" {
		return MemoryEntry{}, fmt.Errorf("workDir is required")
	}

	memDir := filepath.Join(req.WorkDir, memorySubdir)

	// Ensure the memory directory exists before writing.
	if err := os.MkdirAll(memDir, 0755); err != nil {
		return MemoryEntry{}, fmt.Errorf("create memory dir: %w", err)
	}

	// Determine target file
	var targetFile string
	var category string
	switch {
	case req.AgentID != "":
		targetFile = filepath.Join(memDir, agentMemoryFile(req.AgentID))
		category = "agent " + req.AgentID
	case req.ThreadID != "":
		targetFile = filepath.Join(memDir, threadMemoryFile(req.ThreadID))
		category = "thread " + req.ThreadID
	default:
		targetFile = filepath.Join(memDir, projectFile)
		category = "project"
	}

	// Validate source
	source := req.Entry.Source
	if source == "" {
		source = "user"
	}
	if source != "user" && source != "agent" && source != "system" {
		source = "user"
	}
	entry := req.Entry
	entry.Source = source
	if entry.CreatedAt == "" {
		entry.CreatedAt = time.Now().Format(time.RFC3339)
	}
	entry.UpdatedAt = time.Now().Format(time.RFC3339)

	// Format the entry as YAML frontmatter + Markdown body
	var tagsLine string
	if len(entry.Tags) > 0 {
		tagsLine = fmt.Sprintf("tags: [%s]", strings.Join(entry.Tags, ", "))
	}
	var sb strings.Builder
	sb.WriteString("---\n")
	sb.WriteString(fmt.Sprintf("id: %s\n", entry.ID))
	sb.WriteString(fmt.Sprintf("source: %s\n", entry.Source))
	if tagsLine != "" {
		sb.WriteString(tagsLine + "\n")
	}
	sb.WriteString(fmt.Sprintf("created: %s\n", entry.CreatedAt))
	sb.WriteString(fmt.Sprintf("updated: %s\n", entry.UpdatedAt))
	if entry.ExpiresAt != nil {
		sb.WriteString(fmt.Sprintf("expires_at: %s\n", entry.ExpiresAt.Format(time.RFC3339)))
	}
	if entry.LastAccessed != nil {
		sb.WriteString(fmt.Sprintf("last_accessed: %s\n", entry.LastAccessed.Format(time.RFC3339)))
	}
	sb.WriteString("---\n\n")
	sb.WriteString(entry.Content + "\n")

	if req.Overwrite {
		if err := os.WriteFile(targetFile, []byte(sb.String()), 0644); err != nil {
			return MemoryEntry{}, fmt.Errorf("write memory file %s: %w", category, err)
		}
	} else {
		// Append to existing file
		f, err := os.OpenFile(targetFile, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
		if err != nil {
			return MemoryEntry{}, fmt.Errorf("open memory file %s: %w", category, err)
		}
		defer f.Close()
		if _, err := f.WriteString("\n" + sb.String()); err != nil {
			return MemoryEntry{}, fmt.Errorf("append memory file %s: %w", category, err)
		}
	}

	return entry, nil
}
