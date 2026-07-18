package security

import (
	"errors"
	"path/filepath"
	"strings"
)

// Path-containment sentinels used by REST and MCP workDir allowlist checks
// (AH-SR-006 / #998). Call sites map these to transport-specific error codes.
var (
	// ErrWorkspaceAllowlistEmpty is returned when no allowlist roots are configured.
	// Fail-closed: any non-empty workDir is rejected until an operator configures roots.
	ErrWorkspaceAllowlistEmpty = errors.New("workspace allowlist is not configured")
	// ErrWorkspaceOutsideAllowlist is returned when the resolved workDir is not
	// contained by any allowlisted root after EvalSymlinks normalization.
	ErrWorkspaceOutsideAllowlist = errors.New("workDir is outside the workspace allowlist")
)

// NormalizedRealPath returns the absolute, symlink-resolved, cleaned form of path.
// Callers must use this before containment checks so symlink escapes cannot pass
// an Abs+Rel-only allowlist.
func NormalizedRealPath(path string) (string, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	realPath, err := filepath.EvalSymlinks(abs)
	if err != nil {
		return "", err
	}
	return filepath.Clean(realPath), nil
}

// IsPathWithin reports whether path is the root itself or a descendant of root.
// Both arguments should already be cleaned absolute paths (preferably
// NormalizedRealPath results).
func IsPathWithin(root, path string) bool {
	rel, err := filepath.Rel(root, path)
	if err != nil {
		return false
	}
	return rel == "." || (rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && !filepath.IsAbs(rel))
}

// ValidateWorkDirAgainstAllowlist enforces the shared REST/MCP workDir policy:
// non-empty allowlist required, both workDir and each root resolved via
// EvalSymlinks, then IsPathWithin containment.
//
// Empty workDir is the caller's responsibility (REST optional paths allow it;
// run-start requires it). This function assumes workDir is already non-empty.
func ValidateWorkDirAgainstAllowlist(workDir string, allowlist []string) error {
	if len(allowlist) == 0 {
		return ErrWorkspaceAllowlistEmpty
	}
	candidate, err := NormalizedRealPath(workDir)
	if err != nil {
		return err
	}
	for _, root := range allowlist {
		root = strings.TrimSpace(root)
		if root == "" {
			continue
		}
		allowedRoot, err := NormalizedRealPath(root)
		if err != nil {
			continue
		}
		if IsPathWithin(allowedRoot, candidate) {
			return nil
		}
	}
	return ErrWorkspaceOutsideAllowlist
}
