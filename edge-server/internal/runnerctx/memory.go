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
	"os"
	"path/filepath"
	"strings"
	"time"
)

// ── Types ────────────────────────────────────────────────────────────────────

// MemoryEntry represents a single memory entry read from a Markdown file.
type MemoryEntry struct {
	ID        string   `json:"id"`
	Content   string   `json:"content"`
	Tags      []string `json:"tags,omitempty"`
	CreatedAt string   `json:"createdAt"`
	UpdatedAt string   `json:"updatedAt"`
	Source    string   `json:"source"` // "user" | "agent" | "system"
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

		result.FilesRead++
		result.Entries = append(result.Entries, entries...)

		// Format entries for prompt injection.
		var sectionLines []string
		sectionLines = append(sectionLines, fmt.Sprintf("[AgentHub Memory - %s]", f.category))
		for _, e := range entries {
			tagLine := ""
			if len(e.Tags) > 0 {
				tagLine = " (" + strings.Join(e.Tags, ", ") + ")"
			}
			sectionLines = append(sectionLines,
				fmt.Sprintf("- [%s%s] %s", e.Source, tagLine, e.Content))
		}
		promptSections = append(promptSections, strings.Join(sectionLines, "\n"))
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
	}, nil
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
