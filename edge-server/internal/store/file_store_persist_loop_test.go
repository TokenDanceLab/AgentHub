package store

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"testing/synctest"
	"time"
)

func TestFileStorePersistsDuringContinuousWrites(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		s, path := newFilePersistLoopFixture(t)
		addFilePersistLoopItem(t, s, "first-message")
		synctest.Wait()

		// Drive the real constructor-owned loop with virtual time. A fresh
		// write before each quiet-period deadline must not starve persistence.
		for i := range 40 {
			<-time.After(debounceInterval / 2)
			addFilePersistLoopItem(t, s, fmt.Sprintf("busy-%d", i))
			synctest.Wait()
		}
		if err := s.LastPersistError(); err != nil {
			t.Fatal(err)
		}
		// Use real disk recovery before Flush/Close can repair the snapshot.
		// A late item requires repeated progress, not only the first flush.
		restored := readFilePersistLoopDisk(t, path)
		for _, id := range []string{"first-message", "busy-36"} {
			if _, ok := restored.GetItem(id); !ok {
				t.Errorf("continuous writes starved FileStore persistence for 20 batch intervals: missing %s, memory items=%d, durable items=%d", id, len(s.ListThreadItems("thread")), len(restored.ListThreadItems("thread")))
			}
		}
	})
}

func TestFileStoreCoalescesWithoutPostponingBatchDeadline(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		s, path := newFilePersistLoopFixture(t)
		addFilePersistLoopItem(t, s, "first-message")
		synctest.Wait()
		<-time.After(debounceInterval / 2)
		addFilePersistLoopItem(t, s, "second-message")
		synctest.Wait()
		if got := len(readFilePersistLoopDisk(t, path).ListThreadItems("thread")); got != 0 {
			t.Fatalf("batch persisted %d items before its first-write deadline", got)
		}
		<-time.After(debounceInterval / 2)
		synctest.Wait()
		restored := readFilePersistLoopDisk(t, path)
		for _, id := range []string{"first-message", "second-message"} {
			if _, ok := restored.GetItem(id); !ok {
				t.Errorf("later write postponed the first batch: missing %s", id)
			}
		}

		addFilePersistLoopItem(t, s, "next-batch")
		synctest.Wait()
		<-time.After(debounceInterval / 2)
		synctest.Wait()
		if _, ok := readFilePersistLoopDisk(t, path).GetItem("next-batch"); ok {
			t.Error("next batch was not coalesced")
		}
		<-time.After(debounceInterval / 2)
		synctest.Wait()
		if _, ok := readFilePersistLoopDisk(t, path).GetItem("next-batch"); !ok {
			t.Error("next batch did not re-arm persistence")
		}
	})
}

func TestFileStoreIdleDoesNotPersistAndNewBatchReportsFailure(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		s, path := newFilePersistLoopFixture(t)
		addFilePersistLoopItem(t, s, "first-message")
		synctest.Wait()
		<-time.After(debounceInterval)
		synctest.Wait()
		if _, ok := readFilePersistLoopDisk(t, path).GetItem("first-message"); !ok {
			t.Fatal("initial batch did not persist")
		}
		// An actual filesystem failure makes an unwanted idle persist visible.
		// The next real write below checks that the fault is effective.
		if err := os.Remove(path); err != nil {
			t.Fatal(err)
		}
		if err := os.Mkdir(path, 0o755); err != nil {
			t.Fatal(err)
		}
		<-time.After(4 * debounceInterval)
		synctest.Wait()
		if err := s.LastPersistError(); err != nil {
			t.Errorf("idle store attempted persistence without a write: %v", err)
		}
		addFilePersistLoopItem(t, s, "after-idle")
		synctest.Wait()
		<-time.After(debounceInterval)
		synctest.Wait()
		if err := s.LastPersistError(); err == nil {
			t.Error("new batch did not surface the real snapshot write failure")
		}
		if err := os.Remove(path); err != nil {
			t.Fatal(err)
		}
		s.Flush()
		if err := s.LastPersistError(); err != nil {
			t.Fatalf("explicit Flush did not recover: %v", err)
		}
		if _, ok := readFilePersistLoopDisk(t, path).GetItem("after-idle"); !ok {
			t.Error("failed batch was not retained for explicit Flush")
		}
	})
}

func TestFileStoreCloseFlushesPendingBatch(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		s, path := newFilePersistLoopFixture(t)
		addFilePersistLoopItem(t, s, "pending-at-close")
		synctest.Wait()
		// No timer advance or explicit Flush: shutdown itself must save it.
		s.Close()
		if err := s.LastPersistError(); err != nil {
			t.Fatal(err)
		}
		if _, ok := readFilePersistLoopDisk(t, path).GetItem("pending-at-close"); !ok {
			t.Error("Close did not persist the pending batch")
		}
	})
}

func newFilePersistLoopFixture(t *testing.T) (*FileStore, string) {
	t.Helper()
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
	return s, path
}

func addFilePersistLoopItem(t *testing.T, s *FileStore, id string) {
	t.Helper()
	if _, err := s.CreateItem(Item{ID: id, ProjectID: "project", ThreadID: "thread", Type: "event"}); err != nil {
		t.Fatal(err)
	}
}

func readFilePersistLoopDisk(t *testing.T, path string) *Store {
	t.Helper()
	restored := New()
	if err := loadFileSnapshot(path, restored); err != nil {
		t.Fatal(err)
	}
	return restored
}
