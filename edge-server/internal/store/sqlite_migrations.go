package store

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"

	// modernc.org/sqlite registers its pure-Go sqlite driver via a side-effect import.
	_ "modernc.org/sqlite"
)

type SQLiteMigrationInfo struct {
	Version   int
	Name      string
	AppliedAt string
}

type sqliteMigration struct {
	version int
	name    string
	up      []string
	down    []string
}

var sqliteMigrations = []sqliteMigration{
	{
		version: 1,
		name:    "snapshot_store",
		up: []string{
			`CREATE TABLE IF NOT EXISTS agenthub_store_snapshots (
  key TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`,
		},
	},
	{
		version: 2,
		name:    "relational_edge_lifecycle",
		up: []string{
			`CREATE TABLE IF NOT EXISTS edge_owners (
  owner_id TEXT PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'local',
  display_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`,
			`CREATE TABLE IF NOT EXISTS edge_workspaces (
  workspace_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  local_path TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(owner_id, local_path),
  FOREIGN KEY(owner_id) REFERENCES edge_owners(owner_id) ON DELETE CASCADE
)`,
			`CREATE INDEX IF NOT EXISTS idx_edge_workspaces_owner ON edge_workspaces(owner_id)`,
			`CREATE TABLE IF NOT EXISTS edge_runs (
  run_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  thread_id TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY(owner_id) REFERENCES edge_owners(owner_id) ON DELETE CASCADE,
  FOREIGN KEY(workspace_id) REFERENCES edge_workspaces(workspace_id) ON DELETE CASCADE
)`,
			`CREATE INDEX IF NOT EXISTS idx_edge_runs_workspace_status ON edge_runs(workspace_id, status, created_at)`,
			`CREATE INDEX IF NOT EXISTS idx_edge_runs_thread ON edge_runs(thread_id)`,
			`CREATE TABLE IF NOT EXISTS edge_artifacts (
  artifact_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  run_id TEXT,
  kind TEXT NOT NULL,
  path TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT '',
  digest TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'created',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY(owner_id) REFERENCES edge_owners(owner_id) ON DELETE CASCADE,
  FOREIGN KEY(workspace_id) REFERENCES edge_workspaces(workspace_id) ON DELETE CASCADE,
  FOREIGN KEY(run_id) REFERENCES edge_runs(run_id) ON DELETE SET NULL
)`,
			`CREATE INDEX IF NOT EXISTS idx_edge_artifacts_run ON edge_artifacts(run_id, kind, created_at)`,
			`CREATE TABLE IF NOT EXISTS edge_diffs (
  diff_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  run_id TEXT,
  artifact_id TEXT,
  base_ref TEXT NOT NULL DEFAULT '',
  head_ref TEXT NOT NULL DEFAULT '',
  summary_json TEXT NOT NULL DEFAULT '{}',
  patch_path TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'created',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(owner_id) REFERENCES edge_owners(owner_id) ON DELETE CASCADE,
  FOREIGN KEY(workspace_id) REFERENCES edge_workspaces(workspace_id) ON DELETE CASCADE,
  FOREIGN KEY(run_id) REFERENCES edge_runs(run_id) ON DELETE SET NULL,
  FOREIGN KEY(artifact_id) REFERENCES edge_artifacts(artifact_id) ON DELETE SET NULL
)`,
			`CREATE INDEX IF NOT EXISTS idx_edge_diffs_run ON edge_diffs(run_id, created_at)`,
			`CREATE TABLE IF NOT EXISTS edge_previews (
  preview_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  run_id TEXT,
  artifact_id TEXT,
  url TEXT NOT NULL DEFAULT '',
  local_path TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'created',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY(owner_id) REFERENCES edge_owners(owner_id) ON DELETE CASCADE,
  FOREIGN KEY(workspace_id) REFERENCES edge_workspaces(workspace_id) ON DELETE CASCADE,
  FOREIGN KEY(run_id) REFERENCES edge_runs(run_id) ON DELETE SET NULL,
  FOREIGN KEY(artifact_id) REFERENCES edge_artifacts(artifact_id) ON DELETE SET NULL
)`,
			`CREATE INDEX IF NOT EXISTS idx_edge_previews_run ON edge_previews(run_id, created_at)`,
		},
		down: []string{
			`DROP TABLE IF EXISTS edge_previews`,
			`DROP TABLE IF EXISTS edge_diffs`,
			`DROP TABLE IF EXISTS edge_artifacts`,
			`DROP TABLE IF EXISTS edge_runs`,
			`DROP TABLE IF EXISTS edge_workspaces`,
			`DROP TABLE IF EXISTS edge_owners`,
		},
	},
	{
		version: 3,
		name:    "artifact_content_source_readiness",
		up: []string{
			`ALTER TABLE edge_artifacts ADD COLUMN content_source_kind TEXT NOT NULL DEFAULT ''`,
			`ALTER TABLE edge_artifacts ADD COLUMN content_source_path TEXT NOT NULL DEFAULT ''`,
			`ALTER TABLE edge_artifacts ADD COLUMN content_source_readable INTEGER NOT NULL DEFAULT 0`,
		},
		down: []string{
			`ALTER TABLE edge_artifacts DROP COLUMN content_source_readable`,
			`ALTER TABLE edge_artifacts DROP COLUMN content_source_path`,
			`ALTER TABLE edge_artifacts DROP COLUMN content_source_kind`,
		},
	},
	{
		version: 4,
		name:    "row_first_store_contract",
		up: []string{
			`CREATE TABLE IF NOT EXISTS agenthub_store_rows (
  row_kind TEXT NOT NULL,
  row_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  order_index INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(row_kind, row_id)
)`,
			`CREATE INDEX IF NOT EXISTS idx_agenthub_store_rows_kind_order ON agenthub_store_rows(row_kind, order_index)`,
		},
		down: []string{
			`DROP TABLE IF EXISTS agenthub_store_rows`,
		},
	},
	{
		version: 5,
		name:    "edge_runs_hub_task_id",
		up: []string{
			`ALTER TABLE edge_runs ADD COLUMN hub_task_id TEXT DEFAULT ''`,
			`CREATE INDEX IF NOT EXISTS idx_edge_runs_hub_task_id ON edge_runs(hub_task_id) WHERE hub_task_id != ''`,
		},
		down: []string{
			`DROP INDEX IF EXISTS idx_edge_runs_hub_task_id`,
		},
	},
}

func runSQLiteMigrations(db *sql.DB) error {
	if err := prepareSQLiteMigrationTable(db); err != nil {
		return err
	}
	applied, err := readSQLiteAppliedMigrationMap(db)
	if err != nil {
		return err
	}
	if err := validateSQLiteAppliedMigrations(applied); err != nil {
		return err
	}
	for _, migration := range sqliteMigrations {
		if _, ok := applied[migration.version]; ok {
			continue
		}
		if err := applySQLiteMigration(db, migration); err != nil {
			return err
		}
	}
	return nil
}

func SQLiteAppliedMigrations(path string) ([]SQLiteMigrationInfo, error) {
	db, err := openSQLiteDatabase(path)
	if err != nil {
		return nil, err
	}
	defer db.Close()
	if err := prepareSQLiteMigrationTable(db); err != nil {
		return nil, err
	}
	return readSQLiteAppliedMigrations(db)
}

func RollbackSQLiteMigrations(path string, targetVersion int) error {
	if targetVersion < 1 {
		return fmt.Errorf("sqlite migration rollback target must be >= 1")
	}
	db, err := openSQLiteDatabase(path)
	if err != nil {
		return err
	}
	defer db.Close()
	if err := prepareSQLiteMigrationTable(db); err != nil {
		return err
	}

	applied, err := readSQLiteAppliedMigrations(db)
	if err != nil {
		return err
	}
	for i := len(applied) - 1; i >= 0; i-- {
		info := applied[i]
		if info.Version <= targetVersion {
			continue
		}
		migration, ok := sqliteMigrationByVersion(info.Version)
		if !ok {
			return fmt.Errorf("sqlite migration %d has no rollback plan", info.Version)
		}
		if len(migration.down) == 0 {
			return fmt.Errorf("sqlite migration %d (%s) cannot be rolled back", migration.version, migration.name)
		}
		if err := rollbackSQLiteMigration(db, migration); err != nil {
			return err
		}
	}
	return nil
}

func openSQLiteDatabase(path string) (*sql.DB, error) {
	if strings.TrimSpace(path) == "" {
		return nil, errors.New("store db path is required")
	}
	if err := ensureSQLiteDirectory(path); err != nil {
		return nil, fmt.Errorf("verify sqlite store path: %w", err)
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open sqlite database: %w", err)
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(`PRAGMA busy_timeout = 5000`); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("configure sqlite busy timeout: %w", err)
	}
	if _, err := db.Exec(`PRAGMA journal_mode = WAL`); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("enable sqlite WAL mode: %w", err)
	}
	if _, err := db.Exec(`PRAGMA synchronous = NORMAL`); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("configure sqlite synchronous: %w", err)
	}
	if _, err := db.Exec(`PRAGMA foreign_keys = ON`); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("enable sqlite foreign keys: %w", err)
	}
	// Auto-checkpoint WAL every 100 frames to prevent unbounded WAL growth.
	// Default is 1000; lowering to 100 keeps the WAL and in-memory page cache small.
	if _, err := db.Exec(`PRAGMA wal_autocheckpoint = 100`); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("configure sqlite wal autocheckpoint: %w", err)
	}
	return db, nil
}

func prepareSQLiteMigrationTable(db *sql.DB) error {
	_, err := db.Exec(`CREATE TABLE IF NOT EXISTS agenthub_sqlite_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
)`)
	if err != nil {
		return fmt.Errorf("prepare sqlite migrations table: %w", err)
	}
	return nil
}

func readSQLiteAppliedMigrationMap(db *sql.DB) (map[int]SQLiteMigrationInfo, error) {
	applied := map[int]SQLiteMigrationInfo{}
	infos, err := readSQLiteAppliedMigrations(db)
	if err != nil {
		return nil, err
	}
	for _, info := range infos {
		applied[info.Version] = info
	}
	return applied, nil
}

func validateSQLiteAppliedMigrations(applied map[int]SQLiteMigrationInfo) error {
	for version, info := range applied {
		migration, ok := sqliteMigrationByVersion(version)
		if !ok {
			return fmt.Errorf("unknown sqlite migration version %d (%s)", version, info.Name)
		}
		if info.Name != migration.name {
			return fmt.Errorf("sqlite migration version %d name mismatch: got %s, want %s", version, info.Name, migration.name)
		}
	}
	return nil
}

func readSQLiteAppliedMigrations(db *sql.DB) ([]SQLiteMigrationInfo, error) {
	rows, err := db.Query(`SELECT version, name, applied_at FROM agenthub_sqlite_migrations ORDER BY version`)
	if err != nil {
		return nil, fmt.Errorf("read sqlite migrations: %w", err)
	}
	defer rows.Close()

	applied := []SQLiteMigrationInfo{}
	for rows.Next() {
		var info SQLiteMigrationInfo
		if err := rows.Scan(&info.Version, &info.Name, &info.AppliedAt); err != nil {
			return nil, fmt.Errorf("scan sqlite migration: %w", err)
		}
		applied = append(applied, info)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate sqlite migrations: %w", err)
	}
	return applied, nil
}

func applySQLiteMigration(db *sql.DB, migration sqliteMigration) error {
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("begin sqlite migration %d: %w", migration.version, err)
	}
	if err := execSQLiteStatements(tx, migration.up); err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("apply sqlite migration %d (%s): %w", migration.version, migration.name, err)
	}
	if _, err := tx.Exec(
		`INSERT INTO agenthub_sqlite_migrations (version, name, applied_at) VALUES (?, ?, ?)`,
		migration.version,
		migration.name,
		nowString(),
	); err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("record sqlite migration %d (%s): %w", migration.version, migration.name, err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit sqlite migration %d (%s): %w", migration.version, migration.name, err)
	}
	return nil
}

func rollbackSQLiteMigration(db *sql.DB, migration sqliteMigration) error {
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("begin sqlite rollback %d: %w", migration.version, err)
	}
	if err := execSQLiteStatements(tx, migration.down); err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("rollback sqlite migration %d (%s): %w", migration.version, migration.name, err)
	}
	if _, err := tx.Exec(`DELETE FROM agenthub_sqlite_migrations WHERE version = ?`, migration.version); err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("remove sqlite migration %d (%s): %w", migration.version, migration.name, err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit sqlite rollback %d (%s): %w", migration.version, migration.name, err)
	}
	return nil
}

func execSQLiteStatements(tx *sql.Tx, statements []string) error {
	for _, statement := range statements {
		if _, err := tx.Exec(statement); err != nil {
			return err
		}
	}
	return nil
}

func sqliteMigrationByVersion(version int) (sqliteMigration, bool) {
	for _, migration := range sqliteMigrations {
		if migration.version == version {
			return migration, true
		}
	}
	return sqliteMigration{}, false
}
