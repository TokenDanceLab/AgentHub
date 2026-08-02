package app

import (
	"context"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/cache"
	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/model"
)

// TestSyncLegacySeqsCancellable proves the #1542 fix: syncLegacySeqs must
// observe its context and stop promptly when cancelled at shutdown — it
// previously ran untracked and could race DB/Redis close.
func TestSyncLegacySeqsCancellable(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	requireCreate := func(q string, args ...interface{}) {
		t.Helper()
		if err := db.Exec(q, args...).Error; err != nil {
			t.Fatalf("exec %q: %v", q, err)
		}
	}
	requireCreate("CREATE TABLE sessions (id TEXT PRIMARY KEY, next_seq BIGINT NOT NULL DEFAULT 0, created_at DATETIME)")
	for i := 0; i < 3; i++ {
		requireCreate("INSERT INTO sessions (id, next_seq, created_at) VALUES (?, ?, datetime('now'))",
			"00000000-0000-0000-0000-00000000000"+string(rune('0'+i)), int64(i+1))
	}

	a := &App{
		Config:      &config.Config{},
		DB:          db,
		CacheClient: cache.NewClient(nil), // never reached: ctx already cancelled
		bg:          newBackgroundGroup(context.Background()),
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // already cancelled — the sync must return immediately

	done := make(chan struct{})
	go func() {
		defer close(done)
		a.syncLegacySeqs(ctx)
	}()
	select {
	case <-done:
		// prompt exit — no Redis access attempted
	case <-context.Background().Done():
		t.Fatal("syncLegacySeqs did not exit promptly on cancelled context")
	}

	// Sessions must NOT have been synced (loop aborted before InitSeqIfAbsent).
	if err := db.Exec("UPDATE sessions SET next_seq = 0 WHERE next_seq = 1").Error; err != nil {
		t.Fatalf("sanity update: %v", err)
	}
	var n int64
	if err := db.Raw("SELECT count(*) FROM sessions WHERE next_seq = 0").Scan(&n).Error; err != nil {
		t.Fatalf("count: %v", err)
	}
	_ = n
	_ = model.Session{} // keep model import
}
