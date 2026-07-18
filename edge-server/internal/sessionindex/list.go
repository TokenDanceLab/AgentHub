package sessionindex

import (
	"sort"
)

// ListOptions bounds a read-only directory scan.
type ListOptions struct {
	Home            string
	ClaudeConfigDir string // optional override (CLAUDE_CONFIG_DIR)
	CodexHome       string // optional override (CODEX_HOME)
	OpenCodeHome    string // optional override; stub-ready
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
		switch rt {
		case RuntimeClaudeCode:
			root := ResolveClaudeCodeSessionsDir(opts.Home, opts.ClaudeConfigDir)
			history := ResolveClaudeCodeHistoryPath(opts.Home, opts.ClaudeConfigDir)
			items, err := listClaudeCodeSessions(root, history)
			if err != nil {
				return nil, err
			}
			out = append(out, items...)
		case RuntimeCodex:
			root := ResolveCodexSessionsDir(opts.Home, opts.CodexHome)
			index := ResolveCodexSessionIndexPath(opts.Home, opts.CodexHome)
			items, err := listCodexSessions(root, index)
			if err != nil {
				return nil, err
			}
			out = append(out, items...)
		case RuntimeOpenCode:
			// Stub-ready: resolve path but only list when layout is productized.
			root := ResolveOpenCodeSessionsDir(opts.Home, opts.OpenCodeHome)
			if root == "" {
				continue
			}
			items, err := listOpenCodeStub(root)
			if err != nil {
				return nil, err
			}
			out = append(out, items...)
		default:
			continue
		}
	}

	sort.SliceStable(out, func(i, j int) bool {
		return out[i].UpdatedAt > out[j].UpdatedAt
	})
	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

// listOpenCodeStub returns empty until OpenCode on-disk layout is productized.
func listOpenCodeStub(root string) ([]SessionSummary, error) {
	_ = root
	return nil, nil
}

// ListRecentFromEnv builds options from process env + DefaultHome.
func ListRecentFromEnv(limit int, runtimes []RuntimeID) ([]SessionSummary, error) {
	return ListRecent(ListOptions{
		Home:            DefaultHome(),
		ClaudeConfigDir: EnvClaudeConfigDir(),
		CodexHome:       EnvCodexHome(),
		Limit:           limit,
		IncludeRuntimes: runtimes,
	})
}
