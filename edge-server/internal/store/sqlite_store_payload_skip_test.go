package store

import (
	"database/sql"
	"path/filepath"
	"strings"
	"testing"

	_ "modernc.org/sqlite"
)

// TestSQLitePersistSkipsLegacyPayloadOnceRowsSeeded proves the #2154 write
// amplification fix: once agenthub_store_rows is the durable source of truth,
// syncPersist no longer rewrites the full-store legacy payload on every write.
func TestSQLitePersistSkipsLegacyPayloadOnceRowsSeeded(t *testing.T) {
	path := filepath.Join(t.TempDir(), "edge-payload-skip.db")

	s, err := NewSQLite(path)
	if err != nil {
		t.Fatalf("NewSQLite returned error: %v", err)
	}
	project, err := s.CreateProject("proj_payload_skip", "Payload Skip", "")
	if err != nil {
		t.Fatalf("CreateProject returned error: %v", err)
	}
	// This write happens after the rows table was durably seeded by the
	// previous persist — its payload must NOT be refreshed.
	thread, err := s.CreateThread("thread_after_seed", project.ID, "After Seed Thread", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread returned error: %v", err)
	}
	s.Close()

	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("sql.Open returned error: %v", err)
	}
	var payload string
	if err := db.QueryRow(`SELECT payload FROM agenthub_store_snapshots WHERE key = 'default'`).Scan(&payload); err != nil {
		db.Close()
		t.Fatalf("read legacy payload returned error: %v", err)
	}
	var threadRowCount int
	if err := db.QueryRow(
		`SELECT count(*) FROM agenthub_store_rows WHERE row_kind = 'thread' AND row_id = ?`,
		thread.ID,
	).Scan(&threadRowCount); err != nil {
		db.Close()
		t.Fatalf("count thread rows returned error: %v", err)
	}
	db.Close()

	if threadRowCount != 1 {
		t.Fatalf("thread row count = %d, want 1 (rows are the durable layer)", threadRowCount)
	}
	if strings.Contains(payload, "After Seed Thread") {
		t.Fatal("legacy payload was refreshed after rows seeding — write amplification regression")
	}
	if !strings.Contains(payload, "proj_payload_skip") {
		t.Fatal("legacy payload must still carry the state written up to seeding")
	}

	// Reopen restores the complete state from rows even though the payload is stale.
	restored, err := NewSQLite(path)
	if err != nil {
		t.Fatalf("NewSQLite reopen returned error: %v", err)
	}
	defer restored.Close()
	threads := restored.ListThreads(project.ID)
	if len(threads) != 1 || threads[0].ID != thread.ID || threads[0].Title != "After Seed Thread" {
		t.Fatalf("restored threads = %#v, want the after-seed thread", threads)
	}
}

// TestSQLiteCheckpointSurvivesReopen proves checkpoints are persisted through
// the rows layer (they used to live only in the legacy payload).
func TestSQLiteCheckpointSurvivesReopen(t *testing.T) {
	path := filepath.Join(t.TempDir(), "edge-checkpoint-rows.db")

	s, err := NewSQLite(path)
	if err != nil {
		t.Fatalf("NewSQLite returned error: %v", err)
	}
	project, err := s.CreateProject("proj_cp", "Checkpoint Rows", "")
	if err != nil {
		t.Fatalf("CreateProject returned error: %v", err)
	}
	thread, err := s.CreateThread("thread_cp", project.ID, "Checkpoint Thread", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread returned error: %v", err)
	}
	run, err := s.CreateRun("run_cp", project.ID, thread.ID)
	if err != nil {
		t.Fatalf("CreateRun returned error: %v", err)
	}
	if _, err := s.UpsertRunCheckpoint(RunCheckpoint{
		RunID:     run.ID,
		WorkDir:   "/tmp/cp",
		FileCount: 2,
	}); err != nil {
		t.Fatalf("UpsertRunCheckpoint returned error: %v", err)
	}
	s.Close()

	// Delete the legacy payload entirely: recovery must come from rows alone.
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("sql.Open returned error: %v", err)
	}
	if _, err := db.Exec(`DELETE FROM agenthub_store_snapshots`); err != nil {
		db.Close()
		t.Fatalf("delete snapshots returned error: %v", err)
	}
	db.Close()

	restored, err := NewSQLite(path)
	if err != nil {
		t.Fatalf("NewSQLite reopen returned error: %v", err)
	}
	defer restored.Close()
	cp, ok := restored.GetRunCheckpoint(run.ID)
	if !ok || cp.WorkDir != "/tmp/cp" || cp.FileCount != 2 {
		t.Fatalf("restored checkpoint = %#v (ok=%v), want durable checkpoint from rows", cp, ok)
	}
}

// TestSQLiteLegacyRowsAdoptsSettingsAndCheckpointsFromPayload covers the
// upgrade path: an existing DB whose rows table predates the settings and
// checkpoint row kinds adopts those fields from the legacy payload on load,
// and the first persist completes the migration by writing them as rows.
func TestSQLiteLegacyRowsAdoptsSettingsAndCheckpointsFromPayload(t *testing.T) {
	path := filepath.Join(t.TempDir(), "edge-legacy-adoption.db")

	s, err := NewSQLite(path)
	if err != nil {
		t.Fatalf("NewSQLite returned error: %v", err)
	}
	project, err := s.CreateProject("proj_legacy", "Legacy Adoption", "")
	if err != nil {
		t.Fatalf("CreateProject returned error: %v", err)
	}
	thread, err := s.CreateThread("thread_legacy", project.ID, "Legacy Thread", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread returned error: %v", err)
	}
	run, err := s.CreateRun("run_legacy", project.ID, thread.ID)
	if err != nil {
		t.Fatalf("CreateRun returned error: %v", err)
	}
	s.Close()

	// Rewrite the DB into legacy shape: drop any post-upgrade row kinds and
	// move settings + checkpoint knowledge into the legacy payload only.
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("sql.Open returned error: %v", err)
	}
	if _, err := db.Exec(`DELETE FROM agenthub_store_rows WHERE row_kind IN ('settings', 'checkpoint')`); err != nil {
		db.Close()
		t.Fatalf("delete rows returned error: %v", err)
	}
	legacySnapshot := fileSnapshot{
		Settings:      map[string]string{"theme": "dark", "locale": "zh-CN"},
		SettingsMtime: "2026-09-01T00:00:00Z",
		Checkpoints: map[string]RunCheckpoint{
			run.ID: {ID: "cp_legacy", RunID: run.ID, WorkDir: "/tmp/legacy", FileCount: 3},
		},
	}
	payload, err := encodeSQLiteSnapshotPayload(legacySnapshot)
	if err != nil {
		db.Close()
		t.Fatalf("encode legacy payload returned error: %v", err)
	}
	if _, err := db.Exec(
		`INSERT INTO agenthub_store_snapshots (key, payload, updated_at) VALUES ('default', ?, '2026-09-01T00:00:00Z')
ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
		string(payload),
	); err != nil {
		db.Close()
		t.Fatalf("write legacy payload returned error: %v", err)
	}
	db.Close()

	// Reopen: adoption must restore settings + checkpoints from the payload.
	restored, err := NewSQLite(path)
	if err != nil {
		t.Fatalf("NewSQLite reopen returned error: %v", err)
	}
	settings := restored.GetSettings()
	if settings.Values["theme"] != "dark" || settings.Values["locale"] != "zh-CN" {
		t.Fatalf("adopted settings = %#v, want legacy theme/locale", settings)
	}
	cp, ok := restored.GetRunCheckpoint(run.ID)
	if !ok || cp.WorkDir != "/tmp/legacy" || cp.FileCount != 3 {
		t.Fatalf("adopted checkpoint = %#v (ok=%v), want legacy checkpoint", cp, ok)
	}
	restored.Close()

	// After the reopen's persists, rows must carry the settings marker so a
	// second reopen no longer needs the payload at all.
	db, err = sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("sql.Open returned error: %v", err)
	}
	var settingsRows int
	if err := db.QueryRow(`SELECT count(*) FROM agenthub_store_rows WHERE row_kind = 'settings'`).Scan(&settingsRows); err != nil {
		db.Close()
		t.Fatalf("count settings rows returned error: %v", err)
	}
	if _, err := db.Exec(`DELETE FROM agenthub_store_snapshots`); err != nil {
		db.Close()
		t.Fatalf("delete snapshots returned error: %v", err)
	}
	db.Close()
	if settingsRows != 1 {
		t.Fatalf("settings rows = %d, want 1 (migration marker)", settingsRows)
	}

	final, err := NewSQLite(path)
	if err != nil {
		t.Fatalf("NewSQLite final reopen returned error: %v", err)
	}
	defer final.Close()
	if got := final.GetSettings(); got.Values["theme"] != "dark" {
		t.Fatalf("settings after migration = %#v, want rows-sourced theme", got)
	}
	if got, ok := final.GetRunCheckpoint(run.ID); !ok || got.WorkDir != "/tmp/legacy" {
		t.Fatalf("checkpoint after migration = %#v (ok=%v), want rows-sourced checkpoint", got, ok)
	}
}
