package sessionindex

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type codexIndexLine struct {
	ID         string `json:"id"`
	ThreadName string `json:"thread_name"`
	UpdatedAt  string `json:"updated_at"`
}

// listCodexSessions discovers rollout-*.jsonl under sessions/** and enriches
// titles from session_index.jsonl when present.
func listCodexSessions(sessionsRoot, indexPath string) ([]SessionSummary, error) {
	if sessionsRoot == "" {
		return nil, nil
	}
	info, err := os.Stat(sessionsRoot)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	if !info.IsDir() {
		return nil, nil
	}

	return collectCodexSessions(sessionsRoot, loadCodexSessionIndex(indexPath))
}

// collectCodexSessions walks sessionsRoot and collects rollout session summaries.
func collectCodexSessions(sessionsRoot string, index map[string]codexIndexLine) ([]SessionSummary, error) {
	var out []SessionSummary
	err := filepath.WalkDir(sessionsRoot, func(path string, d os.DirEntry, walkErr error) error {
		if walkErr != nil {
			// Skip unreadable branches.
			if d != nil && d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if d.IsDir() {
			return nil
		}
		name := d.Name()
		if !strings.HasSuffix(name, ".jsonl") {
			return nil
		}
		if !strings.HasPrefix(name, "rollout-") {
			return nil
		}
		id := codexSessionIDFromFilename(name)
		if id == "" {
			return nil
		}
		if fi, statErr := d.Info(); statErr == nil {
			out = append(out, codexSessionSummary(path, id, fi, index))
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// codexSessionSummary builds a session summary enriched with index metadata.
func codexSessionSummary(path, id string, fi os.FileInfo, index map[string]codexIndexLine) SessionSummary {
	title := id
	updated := fi.ModTime().UTC().Format(time.RFC3339)
	if meta, ok := index[id]; ok {
		if meta.ThreadName != "" {
			title = meta.ThreadName
		}
		if meta.UpdatedAt != "" {
			if t, err := time.Parse(time.RFC3339Nano, meta.UpdatedAt); err == nil {
				updated = t.UTC().Format(time.RFC3339)
			} else if t, err := time.Parse(time.RFC3339, meta.UpdatedAt); err == nil {
				updated = t.UTC().Format(time.RFC3339)
			}
		}
	}
	return SessionSummary{
		Runtime:    RuntimeCodex,
		ID:         id,
		Title:      truncateTitle(title, 120),
		Path:       path,
		UpdatedAt:  updated,
		SourceMode: SourceModeImport,
	}
}

func codexSessionIDFromFilename(name string) string {
	// rollout-2026-07-15T12-26-33-019f6406-c61e-7421-bb97-74e9db7342dd.jsonl
	base := strings.TrimSuffix(name, ".jsonl")
	base = strings.TrimPrefix(base, "rollout-")
	parts := strings.Split(base, "-")
	if len(parts) < 5 {
		return base
	}
	// Prefer last 5 segments as UUID (8-4-4-4-12).
	uuidParts := parts[len(parts)-5:]
	return strings.Join(uuidParts, "-")
}

func loadCodexSessionIndex(indexPath string) map[string]codexIndexLine {
	out := make(map[string]codexIndexLine)
	if indexPath == "" {
		return out
	}
	// #nosec G304 -- index path is built from the user's Codex config dir
	f, err := os.Open(indexPath)
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
		var row codexIndexLine
		if err := json.Unmarshal([]byte(line), &row); err != nil {
			continue
		}
		if row.ID == "" {
			continue
		}
		// Last write wins (index may append updates).
		out[row.ID] = row
	}
	return out
}
