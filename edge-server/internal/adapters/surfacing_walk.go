package adapters

import (
	"crypto/md5"
	"encoding/hex"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

// Residual pure-helper peel #1112: workdir walk / current-state snapshot scan.

func walkCurrentState(dir string) map[string]fileRecord {
	result := make(map[string]fileRecord)
	count := 0
	_ = filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			// Skip inaccessible entries; do not abort the walk.
			if d != nil && d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if d.IsDir() {
			if skipDirs[d.Name()] {
				return filepath.SkipDir
			}
			// Guard against excessive depth.
			depth := strings.Count(path[len(dir):], string(filepath.Separator))
			if depth > maxWalkDepth {
				return filepath.SkipDir
			}
			return nil
		}

		// Guard against excessive file count.
		count++
		if count > maxWalkFiles {
			return filepath.SkipAll
		}

		captureWalkEntry(result, dir, path, d)
		return nil
	})
	return result
}

// captureWalkEntry records a single file's state into the current-state map.
// Errors are non-fatal: the entry is skipped and the walk continues.
func captureWalkEntry(result map[string]fileRecord, dir, path string, d fs.DirEntry) {
	fi, err := d.Info()
	if err != nil {
		return
	}

	relPath, err := filepath.Rel(dir, path)
	if err != nil || relPath == "" || relPath == "." {
		return
	}
	relPath = filepath.ToSlash(relPath)

	// Skip binary artifacts (executables, DBs, archives, backups).
	if isBinaryArtifact(relPath) {
		return
	}

	rec := fileRecord{
		Size:    fi.Size(),
		ModTime: fi.ModTime(),
	}

	// Compute hash.
	f, err := os.Open(path)
	if err != nil {
		return
	}
	h := md5.New()
	_, _ = io.Copy(h, io.LimitReader(f, maxSurfacedFileBytes))
	f.Close()
	rec.Hash = hex.EncodeToString(h.Sum(nil))

	// Read content for text files.
	if isTextFilePath(relPath) && fi.Size() <= maxSurfacedFileBytes {
		data, err := os.ReadFile(path)
		if err == nil {
			rec.Content = string(data)
		}
	}

	result[relPath] = rec
}
