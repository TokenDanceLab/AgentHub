package store

import (
	"fmt"
	"path/filepath"
	"sync"
	"testing"
)

// TestFileStoreConcurrentWriteAndCloseNoPanic pins the close-race fix
// (#2154 F2): writers hammering schedulePersist while Close shuts the
// persist channel down must not panic (send-on-closed-channel), and writes
// arriving after Close must be accepted as no-op schedules. Run with -race.
func TestFileStoreConcurrentWriteAndCloseNoPanic(t *testing.T) {
	dir := t.TempDir()
	fs, err := NewFile(filepath.Join(dir, "store.json"))
	if err != nil {
		t.Fatalf("NewFile: %v", err)
	}

	const writers = 4
	const writesPerWriter = 100
	var wg sync.WaitGroup
	for w := 0; w < writers; w++ {
		wg.Add(1)
		go func(w int) {
			defer wg.Done()
			for i := 0; i < writesPerWriter; i++ {
				if _, err := fs.CreateProject(fmt.Sprintf("proj-%d-%d", w, i), "P", ""); err != nil {
					return
				}
			}
		}(w)
	}

	// Close while writers are still running.
	fs.Close()
	wg.Wait()

	// Post-close writes must not panic either (schedule is a no-op).
	if _, err := fs.CreateProject("post-close", "P", ""); err != nil {
		t.Fatalf("post-close CreateProject: %v", err)
	}
	// Flush still works after Close for durability honesty.
	fs.Flush()
	if err := fs.LastPersistError(); err != nil {
		t.Fatalf("LastPersistError after close+flush: %v", err)
	}
}
