// Package adapters — ACP fs/terminal frame design + workspace allowlist
// (#1743 item 1, follow-up of #1404).
//
// The seven fs/terminal endpoints of acp.Client (see the STUB INVENTORY in
// acp_client.go) are still unwired: nothing in this package executes real
// filesystem or terminal I/O. Before they can be wired, every inbound
// request needs two things, defined here:
//
//  1. A frame — the edge-side representation of the request, i.e. what a
//     future executor consumes. Building a frame from an SDK request is a
//     pure transformation: normalized fields, no I/O, no side effects.
//
//  2. The workspace allowlist gate — every path a frame carries must
//     resolve inside the workspace root the run was started with
//     (runACPSession passes the session workdir). The gate is pure string
//     containment on normalized paths (no filesystem access) and fails
//     closed: an empty root, an empty or relative path, or any ".."
//     escape rejects.
//
// Layering in the unwired stubs (acp_client.go):
//
//	SDK request → frame builder (allowlist gate)
//	    → gate rejects: JSON-RPC error wrapping errACPPathOutsideWorkspace
//	      AND errACPEndpointNotWired (unwiredFrameError)
//	    → gate accepts: JSON-RPC error wrapping errACPEndpointNotWired
//	      until real execution is approved
//
// Real fs/terminal execution is deliberately NOT part of this file — it is
// #1743 item 3 (real-run verification, requires approval). The future
// executor must re-check resolved paths (e.g. after symlink resolution)
// against the allowlist before any I/O; the pure containment check here is
// the first, not the only, line of defense.
package acp

import (
	"errors"
	"fmt"
	"path"
	"strings"

	"github.com/coder/acp-go-sdk"
)

// ACP method names for the unwired fs/terminal endpoints (SSOT shared by
// the STUB INVENTORY stubs in acp_client.go and the frame builders below).
const (
	acpMethodReadTextFile     = "fs/read_text_file"
	acpMethodWriteTextFile    = "fs/write_text_file"
	acpMethodCreateTerminal   = "terminal/create"
	acpMethodKillTerminal     = "terminal/kill"
	acpMethodTerminalOutput   = "terminal/output"
	acpMethodReleaseTerminal  = "terminal/release"
	acpMethodWaitTerminalExit = "terminal/wait_for_exit"
)

// errACPPathOutsideWorkspace is the fail-closed rejection returned by the
// workspace allowlist gate when a frame carries a path that does not
// resolve inside the session's workspace root.
var errACPPathOutsideWorkspace = errors.New("acp: path outside workspace allowlist")

// errACPMalformedFrame is the fail-closed rejection returned when a frame
// cannot be built from an SDK request (missing required fields).
var errACPMalformedFrame = errors.New("acp: malformed frame")

// workspaceAllowlist is the path boundary for fs/terminal frames: a frame
// is only built when every path it carries resolves inside the workspace
// root the run was started with.
//
// The check is pure string containment on normalized paths — no filesystem
// access, no symlink resolution — so the gate is side-effect free and
// fails closed on any ambiguity.
type workspaceAllowlist struct {
	// workspaceRoot is the normalized absolute workspace root; "" means
	// no workspace is configured and every path is rejected.
	workspaceRoot string
}

// newWorkspaceAllowlist builds the allowlist for a session workspace root.
// An empty root yields an allowlist that rejects every path (fail-closed).
func newWorkspaceAllowlist(workspaceRoot string) *workspaceAllowlist {
	return &workspaceAllowlist{workspaceRoot: normalizeWorkspacePath(workspaceRoot)}
}

// AllowsPath reports whether candidate resolves inside the workspace root.
func (a *workspaceAllowlist) AllowsPath(candidate string) bool {
	return a.validatePath(candidate) == nil
}

// validatePath returns a fail-closed error wrapping
// errACPPathOutsideWorkspace unless rawPath resolves inside the workspace
// root. Reject rules: absent allowlist, unconfigured root, empty path,
// relative path (ACP requires absolute paths), and any path whose cleaned
// form is neither the root itself nor nested under it.
func (a *workspaceAllowlist) validatePath(rawPath string) error {
	if a == nil || a.workspaceRoot == "" {
		return fmt.Errorf("%w: no workspace configured (path %q)", errACPPathOutsideWorkspace, rawPath)
	}
	normalized := normalizeWorkspacePath(rawPath)
	if normalized == "" {
		return fmt.Errorf("%w: empty path", errACPPathOutsideWorkspace)
	}
	if !normalizedPathIsAbsolute(normalized) {
		return fmt.Errorf("%w: relative path %q (ACP requires absolute paths)", errACPPathOutsideWorkspace, rawPath)
	}
	if !pathInsideWorkspace(normalized, a.workspaceRoot) {
		return fmt.Errorf("%w: %q does not resolve under workspace %q", errACPPathOutsideWorkspace, rawPath, a.workspaceRoot)
	}
	return nil
}

// normalizeWorkspacePath reduces a client-supplied path to the canonical
// slash-separated form the allowlist compares: backslashes become slashes
// (Windows inputs), "." and ".." segments are resolved by path.Clean, and
// a leading drive letter is upper-cased so containment matches the case
// insensitivity of Windows roots ("c:/work" ≡ "C:/work"). Pure string
// handling — no filesystem access.
//
// Whitespace-only input is rejected (""), but every character of a
// non-empty path is preserved: trimming would rewrite a legitimate
// trailing-space workdir ("/work ") into "/work" and let the gate accept
// paths outside the real root.
func normalizeWorkspacePath(rawPath string) string {
	if strings.TrimSpace(rawPath) == "" {
		return ""
	}
	slashed := strings.ReplaceAll(rawPath, "\\", "/")
	cleaned := path.Clean(slashed)
	if len(cleaned) >= 2 && cleaned[1] == ':' {
		drive := cleaned[0]
		if 'a' <= drive && drive <= 'z' {
			cleaned = strings.ToUpper(string(drive)) + cleaned[1:]
		}
		// path.Clean drops the trailing separator of drive roots
		// ("C:/" → "C:"); restore it so drive roots stay canonical
		// filesystem roots for the containment check.
		if len(cleaned) == 2 && strings.HasSuffix(slashed, "/") {
			cleaned += "/"
		}
	}
	return cleaned
}

// normalizedPathIsAbsolute reports whether a normalized path is absolute:
// POSIX ("/...") or Windows drive-rooted ("X:/...").
func normalizedPathIsAbsolute(normalized string) bool {
	return strings.HasPrefix(normalized, "/") || isWindowsDrivePath(normalized)
}

// isWindowsDrivePath reports whether a normalized path is Windows
// drive-rooted ("X:/...").
func isWindowsDrivePath(normalized string) bool {
	return len(normalized) >= 3 && normalized[1] == ':' && normalized[2] == '/'
}

// pathInsideWorkspace reports whether candidate is the root itself or a
// descendant of it, using component-boundary containment so adjacent
// prefixes ("/work" vs "/work-evil") never match. Filesystem roots
// ("/", "C:/") act as boundaries without appending a duplicate separator,
// and Windows drive paths compare case-insensitively (NTFS/FAT semantics)
// while keeping the boundary check. Pure string handling — no filesystem
// access.
func pathInsideWorkspace(candidate, root string) bool {
	if isWindowsDrivePath(candidate) && isWindowsDrivePath(root) {
		boundary := root
		if !strings.HasSuffix(boundary, "/") {
			boundary += "/"
		}
		return strings.EqualFold(candidate, root) ||
			strings.HasPrefix(strings.ToLower(candidate), strings.ToLower(boundary))
	}
	if candidate == root {
		return true
	}
	if strings.HasSuffix(root, "/") {
		return strings.HasPrefix(candidate, root)
	}
	return strings.HasPrefix(candidate, root+"/")
}

// acpFsFrame is the edge-side frame for the fs/* endpoints: the validated
// representation a future executor consumes. Building one never touches
// the filesystem.
type acpFsFrame struct {
	// Method is the ACP method the frame answers (acpMethodReadTextFile
	// or acpMethodWriteTextFile).
	Method string
	// Path is the normalized absolute file path, allowlist-validated.
	// Executors must use this field, never the raw request path.
	Path string
	// Content carries the bytes to write (write frames only).
	Content string
	// Line / Limit bound the read window (read frames only); nil means
	// "from the start" / "no limit" per the ACP schema.
	Line  *int
	Limit *int
}

// buildReadTextFileFrame validates an fs/read_text_file request against
// the workspace allowlist and returns its edge-side frame.
func buildReadTextFileFrame(allowlist *workspaceAllowlist, req acp.ReadTextFileRequest) (acpFsFrame, error) {
	if err := allowlist.validatePath(req.Path); err != nil {
		return acpFsFrame{}, fmt.Errorf("%s: %w", acpMethodReadTextFile, err)
	}
	return acpFsFrame{
		Method: acpMethodReadTextFile,
		Path:   normalizeWorkspacePath(req.Path),
		Line:   req.Line,
		Limit:  req.Limit,
	}, nil
}

// buildWriteTextFileFrame validates an fs/write_text_file request against
// the workspace allowlist and returns its edge-side frame.
func buildWriteTextFileFrame(allowlist *workspaceAllowlist, req acp.WriteTextFileRequest) (acpFsFrame, error) {
	if err := allowlist.validatePath(req.Path); err != nil {
		return acpFsFrame{}, fmt.Errorf("%s: %w", acpMethodWriteTextFile, err)
	}
	return acpFsFrame{
		Method:  acpMethodWriteTextFile,
		Path:    normalizeWorkspacePath(req.Path),
		Content: req.Content,
	}, nil
}

// acpTerminalFrame is the edge-side frame for the terminal/* endpoints.
type acpTerminalFrame struct {
	// Method is the ACP method the frame answers (one of the terminal
	// acpMethod* constants).
	Method string
	// TerminalID addresses an existing terminal (kill/output/release/
	// wait_for_exit frames).
	TerminalID string
	// Command / Args / Env describe the process to spawn (create frames).
	Command string
	Args    []string
	Env     map[string]string
	// Cwd is the normalized working directory (create frames); "" means
	// "the session workdir", which is the workspace root itself and thus
	// inside the allowlist by construction (runACPSession requires it
	// for session/new).
	Cwd string
	// OutputByteLimit bounds retained output (create frames).
	OutputByteLimit *int
}

// buildCreateTerminalFrame validates a terminal/create request and returns
// its edge-side frame. An explicit cwd must resolve inside the workspace
// allowlist; an absent cwd stays "" and defaults to the session workdir at
// execution time.
func buildCreateTerminalFrame(allowlist *workspaceAllowlist, req acp.CreateTerminalRequest) (acpTerminalFrame, error) {
	if strings.TrimSpace(req.Command) == "" {
		return acpTerminalFrame{}, fmt.Errorf("%s: %w: command is required", acpMethodCreateTerminal, errACPMalformedFrame)
	}
	frame := acpTerminalFrame{
		Method:          acpMethodCreateTerminal,
		Command:         req.Command,
		Args:            append([]string(nil), req.Args...),
		Env:             acpEnvVariablesToMap(req.Env),
		OutputByteLimit: req.OutputByteLimit,
	}
	if req.Cwd != nil && strings.TrimSpace(*req.Cwd) != "" {
		if err := allowlist.validatePath(*req.Cwd); err != nil {
			return acpTerminalFrame{}, fmt.Errorf("%s: %w", acpMethodCreateTerminal, err)
		}
		frame.Cwd = normalizeWorkspacePath(*req.Cwd)
	}
	return frame, nil
}

// buildTerminalIDFrame validates the terminal-addressing endpoints
// (kill/output/release/wait_for_exit), which carry no paths — only a
// non-empty terminalId.
func buildTerminalIDFrame(method, terminalID string) (acpTerminalFrame, error) {
	if strings.TrimSpace(terminalID) == "" {
		return acpTerminalFrame{}, fmt.Errorf("%s: %w: terminalId is required", method, errACPMalformedFrame)
	}
	return acpTerminalFrame{Method: method, TerminalID: terminalID}, nil
}

// acpEnvVariablesToMap flattens the ACP env list into a map (later entries
// win, mirroring process-env semantics). Returns nil for an empty list.
func acpEnvVariablesToMap(variables []acp.EnvVariable) map[string]string {
	if len(variables) == 0 {
		return nil
	}
	merged := make(map[string]string, len(variables))
	for _, variable := range variables {
		merged[variable.Name] = variable.Value
	}
	return merged
}
