package adapters

import (
	"encoding/json"
	"log/slog"
	slashpath "path"
	"path/filepath"
	"strings"
)

// Residual pure-helper peel #1103: file_change emitters and path safety helpers.

// emitFileChange handles file_change items. Per the Codex exec protocol
// (codex-rs/exec/src/exec_events.rs), this item is only emitted as
// item.completed once the patch succeeds or fails. The handler is also
// wired to item.started/updated defensively.
func (a *CodexAdapter) emitFileChange(raw json.RawMessage, scope map[string]any, emitter EventEmitter, workDir string) {
	var item struct {
		ID      string `json:"id"`
		Status  string `json:"status"`
		Changes []struct {
			Path string `json:"path"`
			Kind string `json:"kind"`
		} `json:"changes"`
	}
	if err := json.Unmarshal(raw, &item); err != nil {
		slog.Debug("codex: emitFileChange unmarshal failed", "error", err)
		return
	}
	files := make([]map[string]any, 0, len(item.Changes))
	filePaths := make([]string, 0, len(item.Changes))
	for _, ch := range item.Changes {
		path, outsideWorkspace := safeCodexFileChangePath(ch.Path, workDir)
		kind, action := codexFileChangeKindAction(ch.Kind)
		filePaths = append(filePaths, path)
		files = append(files, map[string]any{
			"path":    path,
			"kind":    kind,
			"action":  action,
			"rawKind": ch.Kind,
		})
		if outsideWorkspace {
			files[len(files)-1]["outsideWorkspace"] = true
		}
	}
	for _, file := range files {
		payload := map[string]any{
			"callId":   item.ID,
			"toolName": "apply_patch",
			"status":   item.Status,
			"path":     file["path"],
			"kind":     file["kind"],
			"action":   file["action"],
			"rawKind":  file["rawKind"],
			"files":    filePaths,
		}
		if file["outsideWorkspace"] == true {
			payload["outsideWorkspace"] = true
		}
		emitter.Emit(BusEventFileChange, scope, payload)
	}
}

func codexFileChangeKindAction(rawKind string) (string, string) {
	switch rawKind {
	case "add":
		return "created", "created"
	case "delete":
		return "deleted", "deleted"
	default:
		return "modified", "modified"
	}
}

func safeCodexFileChangePath(rawPath string, workDir string) (string, bool) {
	path := strings.ReplaceAll(rawPath, "\\", "/")
	path = slashpath.Clean(path)
	if path == "." || path == "" {
		return slashpath.Base(strings.ReplaceAll(rawPath, "\\", "/")), true
	}

	if workDir != "" {
		if rel, ok := codexRelPathInWorkspace(path, workDir); ok {
			return filepath.ToSlash(rel), false
		}
	}

	if codexPathIsAbs(path) {
		return "<outside-workspace>/" + slashpath.Base(path), true
	}

	if path == ".." || strings.HasPrefix(path, "../") {
		return slashpath.Base(path), true
	}

	return path, false
}

func codexRelPathInWorkspace(path string, workDir string) (string, bool) {
	normalizedPath := strings.ReplaceAll(path, "\\", "/")
	normalizedWorkDir := slashpath.Clean(strings.ReplaceAll(workDir, "\\", "/"))
	pathVolume := codexPathVolumeName(normalizedPath)
	workDirVolume := codexPathVolumeName(normalizedWorkDir)
	if pathVolume != "" || workDirVolume != "" {
		if !strings.EqualFold(pathVolume, workDirVolume) {
			return "", false
		}
		if pathVolume != "" {
			normalizedPath = strings.TrimPrefix(normalizedPath, pathVolume)
			normalizedWorkDir = strings.TrimPrefix(normalizedWorkDir, workDirVolume)
		}
	}
	if !strings.HasSuffix(normalizedWorkDir, "/") {
		normalizedWorkDir += "/"
	}
	if strings.EqualFold(normalizedPath, strings.TrimSuffix(normalizedWorkDir, "/")) {
		return ".", true
	}
	if !strings.HasPrefix(strings.ToLower(normalizedPath), strings.ToLower(normalizedWorkDir)) {
		return "", false
	}
	rel := strings.TrimPrefix(normalizedPath, normalizedWorkDir)
	if rel == "" || rel == "." || strings.HasPrefix(rel, "../") || rel == ".." {
		return "", false
	}
	return rel, true
}

func codexPathIsAbs(path string) bool {
	return filepath.IsAbs(path) || strings.HasPrefix(path, "/") || codexPathVolumeName(path) != ""
}

func codexPathVolumeName(path string) string {
	if len(path) >= 2 && path[1] == ':' && ((path[0] >= 'A' && path[0] <= 'Z') || (path[0] >= 'a' && path[0] <= 'z')) {
		return path[:2]
	}
	return ""
}
