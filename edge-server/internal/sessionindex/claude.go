package sessionindex

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// listClaudeCodeSessions walks {projects}/{projectKey}/*.jsonl (top-level only).
// Nested subagents/tool-results directories are ignored.
func listClaudeCodeSessions(projectsRoot, historyPath string) ([]SessionSummary, error) {
	if projectsRoot == "" {
		return nil, nil
	}
	info, err := os.Stat(projectsRoot)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	if !info.IsDir() {
		return nil, nil
	}

	titles := loadClaudeHistoryTitles(historyPath)

	entries, err := os.ReadDir(projectsRoot)
	if err != nil {
		return nil, err
	}

	var out []SessionSummary
	for _, projectEntry := range entries {
		if !projectEntry.IsDir() {
			continue
		}
		projectKey := projectEntry.Name()
		// Skip internal non-project dirs.
		if projectKey == "memory" || strings.HasPrefix(projectKey, ".") {
			continue
		}
		projectDir := filepath.Join(projectsRoot, projectKey)
		files, err := os.ReadDir(projectDir)
		if err != nil {
			continue
		}
		for _, f := range files {
			if f.IsDir() {
				continue
			}
			name := f.Name()
			if !strings.HasSuffix(name, ".jsonl") {
				continue
			}
			id := strings.TrimSuffix(name, ".jsonl")
			if id == "" {
				continue
			}
			fi, err := f.Info()
			if err != nil {
				continue
			}
			path := filepath.Join(projectDir, name)
			title := titles[id]
			if title == "" {
				title = id
			}
			out = append(out, SessionSummary{
				Runtime:    RuntimeClaudeCode,
				ID:         id,
				Title:      truncateTitle(title, 120),
				Path:       path,
				ProjectKey: projectKey,
				UpdatedAt:  fi.ModTime().UTC().Format(time.RFC3339),
				SourceMode: SourceModeImport,
			})
		}
	}
	return out, nil
}

type claudeHistoryLine struct {
	Display   string `json:"display"`
	SessionID string `json:"sessionId"`
	Project   string `json:"project"`
}

// loadClaudeHistoryTitles maps sessionId -> first non-empty display line.
func loadClaudeHistoryTitles(historyPath string) map[string]string {
	out := make(map[string]string)
	if historyPath == "" {
		return out
	}
	f, err := os.Open(historyPath)
	if err != nil {
		return out
	}
	defer f.Close()

	sc := bufio.NewScanner(f)
	buf := make([]byte, 0, 64*1024)
	sc.Buffer(buf, 1024*1024)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" {
			continue
		}
		var row claudeHistoryLine
		if err := json.Unmarshal([]byte(line), &row); err != nil {
			continue
		}
		if row.SessionID == "" || row.Display == "" {
			continue
		}
		if _, exists := out[row.SessionID]; exists {
			continue // keep first display as title
		}
		// Skip pure local-command noise for titles.
		if strings.HasPrefix(row.Display, "<") {
			continue
		}
		out[row.SessionID] = row.Display
	}
	return out
}

func truncateTitle(s string, max int) string {
	s = strings.TrimSpace(s)
	if max <= 0 || len(s) <= max {
		return s
	}
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max-1]) + "…"
}
