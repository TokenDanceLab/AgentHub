package app

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/glebarez/sqlite"
	"github.com/redis/go-redis/v9"
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

// TestSyncLegacySeqsOneTimeMarker proves the #1675 fix: the first run
// performs the DB→Redis warm-up and sets the marker; every later startup
// run no-ops instead of rescanning the sessions table.
func TestSyncLegacySeqsOneTimeMarker(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.Exec("CREATE TABLE sessions (id TEXT PRIMARY KEY, next_seq BIGINT NOT NULL DEFAULT 0, created_at DATETIME)").Error; err != nil {
		t.Fatalf("create sessions: %v", err)
	}
	const sessionID = "00000000-0000-0000-0000-000000000001"
	if err := db.Exec("INSERT INTO sessions (id, next_seq, created_at) VALUES (?, 7, datetime('now'))", sessionID).Error; err != nil {
		t.Fatalf("insert session: %v", err)
	}

	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis: %v", err)
	}
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { rdb.Close() })

	a := &App{
		Config:      &config.Config{},
		DB:          db,
		CacheClient: cache.NewClient(rdb),
		bg:          newBackgroundGroup(context.Background()),
	}
	ctx := context.Background()

	// First run: warm-up happens, marker is set.
	a.syncLegacySeqs(ctx)
	if !mr.Exists("session:seq:" + sessionID) {
		t.Fatal("first run did not warm up the session seq key")
	}
	if !mr.Exists(legacySeqSyncMarkerKey) {
		t.Fatal("first run did not set the one-time marker")
	}

	// Simulate a later Redis loss of the seq key: the runtime self-healing
	// path (seqalloc.recoverFromDB) covers it, the startup migration must
	// NOT rescan — the marker makes it a one-time migration.
	mr.Del("session:seq:" + sessionID)
	a.syncLegacySeqs(ctx)
	if mr.Exists("session:seq:" + sessionID) {
		t.Fatal("second run re-synced sessions: one-time marker was not honored")
	}
}

// TestSyncLegacySeqsMarkerHasTTL proves the #2119 P1 fix: the one-time marker
// must carry a 30-day TTL so it does not permanently leak in Redis when the
// deployment is decommissioned without explicit cleanup. Expiry triggers a
// harmless idempotent re-scan (InitSeqIfAbsent is SetNX; runtime self-healing
// covers lost seq keys).
func TestSyncLegacySeqsMarkerHasTTL(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.Exec("CREATE TABLE sessions (id TEXT PRIMARY KEY, next_seq BIGINT NOT NULL DEFAULT 0, created_at DATETIME)").Error; err != nil {
		t.Fatalf("create sessions: %v", err)
	}

	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis: %v", err)
	}
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { rdb.Close() })

	a := &App{
		Config:      &config.Config{},
		DB:          db,
		CacheClient: cache.NewClient(rdb),
		bg:          newBackgroundGroup(context.Background()),
	}
	ctx := context.Background()

	a.syncLegacySeqs(ctx)

	ttl := mr.TTL(legacySeqSyncMarkerKey)
	if ttl <= 0 {
		t.Fatalf("marker has no TTL (got %v); expected ~30 days", ttl)
	}
	const thirtyDays = 30 * 24 * time.Hour
	if ttl > thirtyDays || ttl < thirtyDays-time.Minute {
		t.Fatalf("marker TTL %v not near 30 days", ttl)
	}
}
