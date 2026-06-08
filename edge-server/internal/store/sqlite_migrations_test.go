package store

import (
	"database/sql"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

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
	if got, want := migrationVersions(applied), "1,2"; got != want {
		t.Fatalf("applied migration versions = %s, want %s", got, want)
	}
	if applied[0].Name != "snapshot_store" || applied[1].Name != "relational_edge_lifecycle" {
		t.Fatalf("applied migrations = %#v, want snapshot and relational lifecycle migrations", applied)
	}

	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("sql.Open returned error: %v", err)
	}
	defer db.Close()

	assertSQLiteColumns(t, db, "edge_owners", []string{"owner_id", "source", "display_name", "created_at", "updated_at"})
	assertSQLiteColumns(t, db, "edge_workspaces", []string{"workspace_id", "owner_id", "local_path", "name", "status", "created_at", "updated_at"})
	assertSQLiteColumns(t, db, "edge_runs", []string{"run_id", "owner_id", "workspace_id", "thread_id", "status", "created_at", "started_at", "finished_at", "metadata_json"})
	assertSQLiteColumns(t, db, "edge_artifacts", []string{"artifact_id", "owner_id", "workspace_id", "run_id", "kind", "path", "mime_type", "digest", "status", "created_at", "updated_at", "metadata_json"})
	assertSQLiteColumns(t, db, "edge_diffs", []string{"diff_id", "owner_id", "workspace_id", "run_id", "artifact_id", "base_ref", "head_ref", "summary_json", "patch_path", "status", "created_at", "updated_at"})
	assertSQLiteColumns(t, db, "edge_previews", []string{"preview_id", "owner_id", "workspace_id", "run_id", "artifact_id", "url", "local_path", "status", "created_at", "updated_at", "metadata_json"})
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
	if got, want := migrationVersions(applied), "1,2"; got != want {
		t.Fatalf("applied migration versions after reapply = %s, want %s", got, want)
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
