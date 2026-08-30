package store

import (
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	_ "modernc.org/sqlite"
)

func TestSQLiteStoreAppliesRelationalMigrationPlan(t *testing.T) {
	path := filepath.Join(t.TempDir(), "edge-store.db")

	s, err := NewSQLite(path)
	if err != nil {
		t.Fatalf("NewSQLite returned error: %v", err)
	}
	s.Close()

	applied, err := SQLiteAppliedMigrations(path)
	if err != nil {
		t.Fatalf("SQLiteAppliedMigrations returned error: %v", err)
	}
	if got, want := migrationVersions(applied), "1,2,3,4,5"; got != want {
		t.Fatalf("applied migration versions = %s, want %s", got, want)
	}
	if applied[0].Name != "snapshot_store" || applied[1].Name != "relational_edge_lifecycle" || applied[2].Name != "artifact_content_source_readiness" || applied[3].Name != "row_first_store_contract" {
		t.Fatalf("applied migrations = %#v, want snapshot, relational lifecycle, content source, and row-first migrations", applied)
	}

	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("sql.Open returned error: %v", err)
	}
	defer db.Close()

	assertSQLiteColumns(t, db, "edge_owners", []string{"owner_id", "source", "display_name", "created_at", "updated_at"})
	assertSQLiteColumns(t, db, "edge_workspaces", []string{"workspace_id", "owner_id", "local_path", "name", "status", "created_at", "updated_at"})
	assertSQLiteColumns(t, db, "edge_runs", []string{"run_id", "owner_id", "workspace_id", "thread_id", "status", "created_at", "started_at", "finished_at", "metadata_json", "hub_task_id"})
	assertSQLiteColumns(t, db, "edge_artifacts", []string{"artifact_id", "owner_id", "workspace_id", "run_id", "kind", "path", "mime_type", "digest", "status", "created_at", "updated_at", "metadata_json", "content_source_kind", "content_source_path", "content_source_readable"})
	assertSQLiteColumns(t, db, "edge_diffs", []string{"diff_id", "owner_id", "workspace_id", "run_id", "artifact_id", "base_ref", "head_ref", "summary_json", "patch_path", "status", "created_at", "updated_at"})
	assertSQLiteColumns(t, db, "edge_previews", []string{"preview_id", "owner_id", "workspace_id", "run_id", "artifact_id", "url", "local_path", "status", "created_at", "updated_at", "metadata_json"})
	assertSQLiteColumns(t, db, "agenthub_store_rows", []string{"row_kind", "row_id", "payload", "order_index", "updated_at"})
}

func TestRollbackSQLiteMigrationsReturnsToSnapshotOnlySchema(t *testing.T) {
	path := filepath.Join(t.TempDir(), "edge-store.db")
	s, err := NewSQLite(path)
	if err != nil {
		t.Fatalf("NewSQLite returned error: %v", err)
	}
	s.Close()

	if err := RollbackSQLiteMigrations(path, 1); err != nil {
		t.Fatalf("RollbackSQLiteMigrations returned error: %v", err)
	}

	applied, err := SQLiteAppliedMigrations(path)
	if err != nil {
		t.Fatalf("SQLiteAppliedMigrations returned error: %v", err)
	}
	if got, want := migrationVersions(applied), "1"; got != want {
		t.Fatalf("applied migration versions after rollback = %s, want %s", got, want)
	}

	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("sql.Open returned error: %v", err)
	}
	defer db.Close()
	if !sqliteTableExists(t, db, "agenthub_store_snapshots") {
		t.Fatal("snapshot table was removed by relational rollback")
	}
	if sqliteTableExists(t, db, "edge_runs") {
		t.Fatal("edge_runs still exists after rollback to migration 1")
	}

	reopened, err := NewSQLite(path)
	if err != nil {
		t.Fatalf("NewSQLite after rollback returned error: %v", err)
	}
	reopened.Close()
	applied, err = SQLiteAppliedMigrations(path)
	if err != nil {
		t.Fatalf("SQLiteAppliedMigrations after reapply returned error: %v", err)
	}
	if got, want := migrationVersions(applied), "1,2,3,4,5"; got != want {
		t.Fatalf("applied migration versions after reapply = %s, want %s", got, want)
	}
}

func TestSQLiteMigrationsAreIdempotentAcrossReopen(t *testing.T) {
	path := filepath.Join(t.TempDir(), "edge-store.db")
	first, err := NewSQLite(path)
	if err != nil {
		t.Fatalf("first NewSQLite returned error: %v", err)
	}
	first.Close()
	applied, err := SQLiteAppliedMigrations(path)
	if err != nil {
		t.Fatalf("SQLiteAppliedMigrations after first open returned error: %v", err)
	}
	if got, want := migrationVersions(applied), "1,2,3,4,5"; got != want {
		t.Fatalf("applied migration versions after first open = %s, want %s", got, want)
	}

	second, err := NewSQLite(path)
	if err != nil {
		t.Fatalf("second NewSQLite returned error: %v", err)
	}
	second.Close()
	reapplied, err := SQLiteAppliedMigrations(path)
	if err != nil {
		t.Fatalf("SQLiteAppliedMigrations after second open returned error: %v", err)
	}
	if got, want := migrationVersions(reapplied), "1,2,3,4,5"; got != want {
		t.Fatalf("applied migration versions after second open = %s, want %s", got, want)
	}
	if len(reapplied) != len(applied) {
		t.Fatalf("applied migration count after second open = %d, want %d", len(reapplied), len(applied))
	}
	for i := range applied {
		if reapplied[i] != applied[i] {
			t.Fatalf("migration %d after second open = %#v, want %#v", i, reapplied[i], applied[i])
		}
	}
}

func TestSQLiteStoreRejectsUnknownAppliedMigrationVersion(t *testing.T) {
	path := filepath.Join(t.TempDir(), "edge-store.db")
	s, err := NewSQLite(path)
	if err != nil {
		t.Fatalf("NewSQLite returned error: %v", err)
	}
	s.Close()

	db, err := openSQLiteDatabase(path)
	if err != nil {
		t.Fatalf("openSQLiteDatabase returned error: %v", err)
	}
	if _, err := db.Exec(
		`INSERT INTO agenthub_sqlite_migrations (version, name, applied_at) VALUES (?, ?, ?)`,
		99,
		"future_row_store",
		nowString(),
	); err != nil {
		db.Close()
		t.Fatalf("insert future migration returned error: %v", err)
	}
	db.Close()

	reopened, err := NewSQLite(path)
	if err == nil {
		reopened.Close()
		t.Fatal("NewSQLite returned nil error for database with unknown future migration")
	}
	if !strings.Contains(err.Error(), "unknown sqlite migration version 99") {
		t.Fatalf("NewSQLite error = %v, want unknown sqlite migration version 99", err)
	}
}

func TestRollbackSQLiteMigrationsIsIdempotentAtTargetVersion(t *testing.T) {
	path := filepath.Join(t.TempDir(), "edge-store.db")
	s, err := NewSQLite(path)
	if err != nil {
		t.Fatalf("NewSQLite returned error: %v", err)
	}
	s.Close()

	if err := RollbackSQLiteMigrations(path, 1); err != nil {
		t.Fatalf("first RollbackSQLiteMigrations returned error: %v", err)
	}
	if err := RollbackSQLiteMigrations(path, 1); err != nil {
		t.Fatalf("second RollbackSQLiteMigrations returned error: %v", err)
	}
	applied, err := SQLiteAppliedMigrations(path)
	if err != nil {
		t.Fatalf("SQLiteAppliedMigrations returned error: %v", err)
	}
	if got, want := migrationVersions(applied), "1"; got != want {
		t.Fatalf("applied migration versions after repeated rollback = %s, want %s", got, want)
	}
}

func TestSQLiteForeignKeysAreEnabledForStoreConnections(t *testing.T) {
	path := filepath.Join(t.TempDir(), "edge-store.db")
	s, err := NewSQLite(path)
	if err != nil {
		t.Fatalf("NewSQLite returned error: %v", err)
	}
	s.Close()

	db, err := openSQLiteDatabase(path)
	if err != nil {
		t.Fatalf("openSQLiteDatabase returned error: %v", err)
	}
	defer db.Close()
	if _, err := db.Exec(`INSERT INTO edge_workspaces (workspace_id, owner_id, local_path, name, created_at, updated_at)
VALUES ('workspace_orphan', 'missing_owner', 'C:\agenthub\workspace', 'Orphan', 'now', 'now')`); err == nil {
		t.Fatal("insert orphan workspace succeeded, want foreign key constraint failure")
	}
}

func TestSQLiteStoreCreatesNestedWindowsStylePath(t *testing.T) {
	path := filepath.Join(t.TempDir(), "AgentHub Edge DB", "Nested Folder With Spaces", "edge-store.db")
	s, err := NewSQLite(path)
	if err != nil {
		t.Fatalf("NewSQLite returned error for nested path: %v", err)
	}
	s.Close()
	if !sqliteFileExists(t, path) {
		t.Fatalf("sqlite db file was not created at %s", path)
	}
}

// TestSQLiteMigrationUsesDedicatedConnection ensures readiness/migration helpers
// open an independent connection (MaxOpenConns=1, busy_timeout set) so they do
// not share the live store handle and create flaky lock races.
func TestSQLiteMigrationUsesDedicatedConnection(t *testing.T) {
	path := filepath.Join(t.TempDir(), "edge-migration-dedicated.db")
	s, err := NewSQLite(path)
	if err != nil {
		t.Fatalf("NewSQLite returned error: %v", err)
	}
	defer s.Close()

	applied, err := SQLiteAppliedMigrations(path)
	if err != nil {
		t.Fatalf("SQLiteAppliedMigrations on live store path returned error: %v", err)
	}
	if got, want := migrationVersions(applied), "1,2,3,4,5"; got != want {
		t.Fatalf("applied migrations via dedicated connection = %s, want %s", got, want)
	}

	manifest, err := SQLiteReadinessManifestForPath(path)
	if err != nil {
		t.Fatalf("SQLiteReadinessManifestForPath on live store path returned error: %v", err)
	}
	if manifest.Status != "ready" || manifest.MigrationStatus != "current" {
		t.Fatalf("readiness via dedicated connection = status=%q migration=%q, want ready/current", manifest.Status, manifest.MigrationStatus)
	}
}

// TestOpenSQLiteDatabaseConfiguresHardenedPRAGMAs pins the migration/open path
// busy_timeout + single-connection readiness contract used to avoid flaky locks.
func TestOpenSQLiteDatabaseConfiguresHardenedPRAGMAs(t *testing.T) {
	path := filepath.Join(t.TempDir(), "edge-pragma.db")
	db, err := openSQLiteDatabase(path)
	if err != nil {
		t.Fatalf("openSQLiteDatabase returned error: %v", err)
	}
	defer db.Close()

	if got := db.Stats().MaxOpenConnections; got != 1 {
		t.Fatalf("MaxOpenConnections = %d, want 1 (migration/store dedicated connection)", got)
	}
	var busyTimeout int
	if err := db.QueryRow(`PRAGMA busy_timeout`).Scan(&busyTimeout); err != nil {
		t.Fatalf("PRAGMA busy_timeout returned error: %v", err)
	}
	if busyTimeout < 5000 {
		t.Fatalf("busy_timeout = %d, want >= 5000", busyTimeout)
	}
	var journalMode string
	if err := db.QueryRow(`PRAGMA journal_mode`).Scan(&journalMode); err != nil {
		t.Fatalf("PRAGMA journal_mode returned error: %v", err)
	}
	if !strings.EqualFold(journalMode, "wal") {
		t.Fatalf("journal_mode = %q, want wal", journalMode)
	}
	var foreignKeys int
	if err := db.QueryRow(`PRAGMA foreign_keys`).Scan(&foreignKeys); err != nil {
		t.Fatalf("PRAGMA foreign_keys returned error: %v", err)
	}
	if foreignKeys != 1 {
		t.Fatalf("foreign_keys = %d, want 1", foreignKeys)
	}
}

func TestSQLiteStoreWaitsForTransientDatabaseLock(t *testing.T) {
	path := filepath.Join(t.TempDir(), "edge-store.db")
	s, err := NewSQLite(path)
	if err != nil {
		t.Fatalf("NewSQLite returned error: %v", err)
	}
	s.Close()

	lockedDB, err := openSQLiteDatabase(path)
	if err != nil {
		t.Fatalf("openSQLiteDatabase for lock holder returned error: %v", err)
	}
	defer lockedDB.Close()
	if _, err := lockedDB.Exec(`BEGIN IMMEDIATE`); err != nil {
		t.Fatalf("BEGIN IMMEDIATE returned error: %v", err)
	}

	done := make(chan error, 1)
	go func() {
		reopened, err := NewSQLite(path)
		if err == nil {
			reopened.Close()
		}
		done <- err
	}()

	select {
	case err := <-done:
		if err == nil {
			t.Fatal("NewSQLite completed while write lock was still held")
		}
		t.Fatalf("NewSQLite returned before transient lock was released: %v", err)
	case <-time.After(100 * time.Millisecond):
	}

	if _, err := lockedDB.Exec(`COMMIT`); err != nil {
		t.Fatalf("COMMIT returned error: %v", err)
	}

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("NewSQLite after transient lock release returned error: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("NewSQLite did not complete after transient lock was released")
	}
}

func migrationVersions(applied []SQLiteMigrationInfo) string {
	versions := make([]string, 0, len(applied))
	for _, migration := range applied {
		versions = append(versions, strconv.Itoa(migration.Version))
	}
	return strings.Join(versions, ",")
}

func assertSQLiteColumns(t *testing.T, db *sql.DB, table string, want []string) {
	t.Helper()
	rows, err := db.Query(`SELECT name FROM pragma_table_info(?) ORDER BY cid`, table)
	if err != nil {
		t.Fatalf("pragma_table_info(%s) returned error: %v", table, err)
	}
	defer rows.Close()

	got := []string{}
	for rows.Next() {
		var column string
		if err := rows.Scan(&column); err != nil {
			t.Fatalf("scan %s column returned error: %v", table, err)
		}
		got = append(got, column)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate %s columns returned error: %v", table, err)
	}
	if strings.Join(got, "\x00") != strings.Join(want, "\x00") {
		t.Fatalf("%s columns = %#v, want %#v", table, got, want)
	}
}

func sqliteTableExists(t *testing.T, db *sql.DB, table string) bool {
	t.Helper()
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?`, table).Scan(&count); err != nil {
		t.Fatalf("query table existence for %s returned error: %v", table, err)
	}
	return count == 1
}

func sqliteFileExists(t *testing.T, path string) bool {
	t.Helper()
	info, err := os.Stat(path)
	if errors.Is(err, os.ErrNotExist) {
		return false
	}
	if err != nil {
		t.Fatalf("stat sqlite db file returned error: %v", err)
	}
	return !info.IsDir()
}
