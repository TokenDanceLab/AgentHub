package store

import (
	"path"
	"path/filepath"
	"strings"
)

const (
	ArtifactContentSourceWorkspaceRelative = "workspace_relative"
	ArtifactContentSourceBasename          = "basename"
)

func NewArtifactContentSource(workspaceRoot, sourcePath string) *ArtifactContentSource {
	sourcePath = strings.TrimSpace(sourcePath)
	if sourcePath == "" {
		return nil
	}

	if isPathAbsolute(sourcePath) {
		if relPath, ok := workspaceRelativeSourcePath(workspaceRoot, sourcePath); ok {
			return &ArtifactContentSource{
				Kind:     ArtifactContentSourceWorkspaceRelative,
				Path:     relPath,
				Readable: true,
			}
		}
		base := artifactBaseName(sourcePath)
		if base == "" {
			return nil
		}
		return &ArtifactContentSource{
			Kind:     ArtifactContentSourceBasename,
			Path:     base,
			Readable: false,
		}
	}

	if relPath, ok := safeWorkspaceRelativePath(sourcePath); ok {
		return &ArtifactContentSource{
			Kind:     ArtifactContentSourceWorkspaceRelative,
			Path:     relPath,
			Readable: true,
		}
	}
	base := artifactBaseName(sourcePath)
	if base == "" {
		return nil
	}
	return &ArtifactContentSource{
		Kind:     ArtifactContentSourceBasename,
		Path:     base,
		Readable: false,
	}
}

func normalizeArtifactContentSource(source *ArtifactContentSource) *ArtifactContentSource {
	if source == nil {
		return nil
	}
	sourcePath := strings.TrimSpace(source.Path)
	if source.Kind == ArtifactContentSourceWorkspaceRelative {
		if relPath, ok := safeWorkspaceRelativePath(sourcePath); ok {
			return &ArtifactContentSource{
				Kind:     ArtifactContentSourceWorkspaceRelative,
				Path:     relPath,
				Readable: true,
			}
		}
	}

	base := artifactBaseName(sourcePath)
	if base == "" {
		return nil
	}
	return &ArtifactContentSource{
		Kind:     ArtifactContentSourceBasename,
		Path:     base,
		Readable: false,
	}
}

func sanitizeArtifactDisplayPath(value string) string {
	if relPath, ok := safeWorkspaceRelativePath(value); ok {
		return relPath
	}
	return artifactBaseName(value)
}

func workspaceRelativeSourcePath(workspaceRoot, sourcePath string) (string, bool) {
	workspaceRoot = strings.TrimSpace(workspaceRoot)
	if workspaceRoot == "" {
		return "", false
	}
	root, err := filepath.Abs(workspaceRoot)
	if err != nil {
		return "", false
	}
	source, err := filepath.Abs(sourcePath)
	if err != nil {
		return "", false
	}
	relPath, err := filepath.Rel(root, source)
	if err != nil {
		return "", false
	}
	return safeWorkspaceRelativePath(relPath)
}

func safeWorkspaceRelativePath(value string) (string, bool) {
	value = strings.ReplaceAll(strings.TrimSpace(value), "\\", "/")
	if isWindowsDriveQualifiedPath(value) {
		return "", false
	}
	value = path.Clean(value)
	if value == "." || value == "" || isPathAbsolute(value) || value == ".." || strings.HasPrefix(value, "../") {
		return "", false
	}
	return value, true
}

func artifactBaseName(value string) string {
	value = strings.ReplaceAll(strings.TrimSpace(value), "\\", "/")
	if isWindowsDriveQualifiedPath(value) {
		value = strings.TrimPrefix(value[2:], "/")
	}
	value = path.Clean(value)
	if value == "." || value == "" {
		return ""
	}
	base := path.Base(value)
	if base == "." || base == "/" {
		return ""
	}
	return base
}

func isPathAbsolute(value string) bool {
	value = strings.TrimSpace(value)
	return filepath.IsAbs(value) || isPortablePathAbsolute(value)
}

func isPortablePathAbsolute(value string) bool {
	value = strings.ReplaceAll(strings.TrimSpace(value), "\\", "/")
	return path.IsAbs(value) || isWindowsDriveAbsolutePath(value) || isWindowsUNCPath(value)
}

func isWindowsDriveAbsolutePath(value string) bool {
	return isWindowsDriveQualifiedPath(value) && len(value) >= 3 && value[2] == '/'
}

func isWindowsDriveQualifiedPath(value string) bool {
	return len(value) >= 2 && isASCIIAlpha(value[0]) && value[1] == ':'
}

func isWindowsUNCPath(value string) bool {
	return strings.HasPrefix(value, "//")
}

func isASCIIAlpha(value byte) bool {
	return (value >= 'A' && value <= 'Z') || (value >= 'a' && value <= 'z')
}

func normalizeEvidenceStatus(status string) string {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "added", "created", "add":
		return "added"
	case "deleted", "delete", "removed", "remove":
		return "deleted"
	default:
		return "modified"
	}
}
