package sessionindex

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// ListOptions bounds a read-only directory scan.
type ListOptions struct {
	Home            string
	ClaudeConfigDir string // optional override
	CodexHome       string // optional override
	Limit           int
	IncludeRuntimes []RuntimeID // empty = claude-code + codex
}

// ListRecent scans configured runtime session roots and returns newest-first summaries.
// Read-only: never writes or deletes under session roots.
func ListRecent(opts ListOptions) ([]SessionSummary, error) {
	limit := opts.Limit
	if limit <= 0 {
		limit = 50
	}
	runtimes := opts.IncludeRuntimes
	if len(runtimes) == 0 {
		runtimes = []RuntimeID{RuntimeClaudeCode, RuntimeCodex}
	}

	var out []SessionSummary
	for _, rt := range runtimes {
		var root string
		switch rt {
		case RuntimeClaudeCode:
			root = ResolveClaudeCodeSessionsDir(opts.Home, opts.ClaudeConfigDir)
		case RuntimeCodex:
			root = ResolveCodexSessionsDir(opts.Home, opts.CodexHome)
		default:
			continue
		}
		if root == "" {
			continue
		}
		entries, err := os.ReadDir(root)
		if err != nil {
			// Missing root is not fatal — runtime simply not installed / empty.
			if os.IsNotExist(err) {
				continue
			}
			return nil, err
		}
		for _, e := range entries {
			if !e.IsDir() && !strings.HasSuffix(e.Name(), ".jsonl") && !strings.HasSuffix(e.Name(), ".json") {
				// Keep dirs and common session file extensions.
				if !e.IsDir() {
					continue
				}
			}
			info, err := e.Info()
			if err != nil {
				continue
			}
			// Skip very shallow noise
			name := e.Name()
			if name == "." || name == ".." {
				continue
			}
			out = append(out, SessionSummary{
				Runtime:    rt,
				ID:         name,
				Title:      name,
				Path:       filepath.Join(root, name),
				UpdatedAt:  info.ModTime().UTC().Format(time.RFC3339),
				SourceMode: "import",
			})
		}
	}

	sort.Slice(out, func(i, j int) bool {
		return out[i].UpdatedAt > out[j].UpdatedAt
	})
	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}
