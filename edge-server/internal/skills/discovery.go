package skills

import (
	"fmt"
	"os"
	"path/filepath"
)

// SKILLDirNames lists directory names that conventionally contain SKILL.md files.
// These are scanned relative to the project root or working directory.
var SKILLDirNames = []string{
	".agents/skills",
	".codex/skills",
}

// DiscoverSKILL scans a base directory (e.g. ".agents/skills") for subdirectories
// containing SKILL.md files. It expects the structure:
//
//	base/
//	  skill-name/
//	    SKILL.md
//
// Returns absolute paths to all found SKILL.md files.
// If the base directory does not exist, it returns nil silently.
func DiscoverSKILL(baseDir string) ([]string, error) {
	// Resolve to absolute path for reliable tracking.
	abs, err := filepath.Abs(baseDir)
	if err != nil {
		return nil, fmt.Errorf("skills: resolve %s: %w", baseDir, err)
	}

	info, err := os.Stat(abs)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("skills: stat %s: %w", abs, err)
	}
	if !info.IsDir() {
		return nil, nil
	}

	var paths []string
	entries, err := os.ReadDir(abs)
	if err != nil {
		return nil, fmt.Errorf("skills: read dir %s: %w", abs, err)
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		skillMD := filepath.Join(abs, entry.Name(), "SKILL.md")
		if _, err := os.Stat(skillMD); err == nil {
			paths = append(paths, skillMD)
		}
	}

	return paths, nil
}

// DefaultDirs returns the list of default skill directories to scan,
// resolved relative to the project root (workDir). If workDir is empty,
// returns only ".agents/skills" and ".codex/skills" as-is.
func DefaultDirs(workDir string) []string {
	dirs := make([]string, 0, 2)
	for _, name := range SKILLDirNames {
		if workDir != "" {
			dirs = append(dirs, filepath.Join(workDir, name))
		} else {
			dirs = append(dirs, name)
		}
	}
	return dirs
}
