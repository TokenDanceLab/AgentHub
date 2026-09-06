package store

import (
	"fmt"
	"path/filepath"
	"testing"
	"testing/synctest"
	"time"
)

func TestFileStorePersistsDuringContinuousWrites(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		path := filepath.Join(t.TempDir(), "store.json")
		s, err := NewFile(path)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(s.Close)
		if _, err := s.CreateProject("project", "Project", ""); err != nil {
			t.Fatal(err)
		}
		if _, err := s.CreateThread("thread", "project", "Thread", "", "", ""); err != nil {
			t.Fatal(err)
		}
		if _, err := s.CreateItem(Item{ID: "first-message", ProjectID: "project", ThreadID: "thread", Type: "user_message", Content: "must become durable while writes continue"}); err != nil {
			t.Fatal(err)
		}
		synctest.Wait()

		// Drive the real constructor-owned loop with virtual time. A fresh
		// write before each quiet-period deadline must not starve persistence.
		for i := range 40 {
			<-time.After(debounceInterval / 2)
			if _, err := s.CreateItem(Item{ID: fmt.Sprintf("busy-%d", i), ProjectID: "project", ThreadID: "thread", Type: "event"}); err != nil {
				t.Fatal(err)
			}
			synctest.Wait()
		}
		if err := s.LastPersistError(); err != nil {
			t.Fatal(err)
		}
		// Exercise the actual disk restore path without Flush/Close repairing
		// the snapshot. This is a scheduling regression, not a load benchmark.
		restored := New()
		if err := loadFileSnapshot(path, restored); err != nil {
			t.Fatal(err)
		}
		if _, ok := restored.GetItem("first-message"); !ok {
			t.Fatalf("continuous writes starved FileStore persistence for 20 batch intervals: memory items=%d, durable items=%d", len(s.ListThreadItems("thread")), len(restored.ListThreadItems("thread")))
		}
	})
}
