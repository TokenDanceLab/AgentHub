package store

import (
	"database/sql"
	"fmt"
	"sort"
)

const SQLiteReadinessManifestSchema = "agenthub-edge-sqlite-readiness-v1"

type SQLiteReadinessReport struct {
	Path                   string                `json:"path"`
	IntegrityCheck         string                `json:"integrity_check"`
	LatestMigrationVersion int                   `json:"latest_migration_version"`
	AppliedMigrations      []SQLiteMigrationInfo `json:"applied_migrations"`
	RowCounts              map[string]int        `json:"row_counts"`
	ProjectionCounts       map[string]int        `json:"projection_counts"`
}

type SQLiteReadinessManifest struct {
	Schema                   string                `json:"schema"`
	Status                   string                `json:"status"`
	Path                     string                `json:"path"`
	IntegrityCheck           string                `json:"integrity_check"`
	LatestMigrationVersion   int                   `json:"latest_migration_version"`
	ExpectedMigrationVersion int                   `json:"expected_migration_version"`
	MigrationStatus          string                `json:"migration_status"`
	AppliedMigrations        []SQLiteMigrationInfo `json:"applied_migrations"`
	MissingMigrationVersions []int                 `json:"missing_migration_versions"`
	UnknownMigrationVersions []int                 `json:"unknown_migration_versions"`
	RequiredRowKinds         []string              `json:"required_row_kinds"`
	RequiredProjectionTables []string              `json:"required_projection_tables"`
	RowCounts                map[string]int        `json:"row_counts"`
	ProjectionCounts         map[string]int        `json:"projection_counts"`
}

func SQLiteReadiness(path string) (SQLiteReadinessReport, error) {
	db, err := openSQLiteDatabase(path)
	if err != nil {
		return SQLiteReadinessReport{}, err
	}
	defer db.Close()

	if err := prepareSQLiteMigrationTable(db); err != nil {
		return SQLiteReadinessReport{}, err
	}
	migrations, err := readSQLiteAppliedMigrations(db)
	if err != nil {
		return SQLiteReadinessReport{}, err
	}

	report := SQLiteReadinessReport{
		Path:              path,
		AppliedMigrations: migrations,
		RowCounts:         map[string]int{},
		ProjectionCounts:  map[string]int{},
	}
	for _, migration := range migrations {
		if migration.Version > report.LatestMigrationVersion {
			report.LatestMigrationVersion = migration.Version
		}
	}

	if err := db.QueryRow(`PRAGMA integrity_check`).Scan(&report.IntegrityCheck); err != nil {
		return SQLiteReadinessReport{}, fmt.Errorf("sqlite integrity check: %w", err)
	}
	if err := readSQLiteStoreRowCounts(db, report.RowCounts); err != nil {
		return SQLiteReadinessReport{}, err
	}
	if err := readSQLiteProjectionCounts(db, report.ProjectionCounts); err != nil {
		return SQLiteReadinessReport{}, err
	}
	return report, nil
}

func (report SQLiteReadinessReport) Manifest() SQLiteReadinessManifest {
	manifest := SQLiteReadinessManifest{
		Schema:                   SQLiteReadinessManifestSchema,
		Status:                   "ready",
		Path:                     report.Path,
		IntegrityCheck:           report.IntegrityCheck,
		LatestMigrationVersion:   report.LatestMigrationVersion,
		ExpectedMigrationVersion: LatestSQLiteMigrationVersion(),
		MigrationStatus:          "current",
		AppliedMigrations:        append([]SQLiteMigrationInfo(nil), report.AppliedMigrations...),
		RequiredRowKinds:         sqliteReadinessRowKinds(),
		RequiredProjectionTables: sqliteReadinessProjectionTables(),
		RowCounts:                copyIntMap(report.RowCounts),
		ProjectionCounts:         copyIntMap(report.ProjectionCounts),
	}

	applied := map[int]bool{}
	for _, migration := range report.AppliedMigrations {
		applied[migration.Version] = true
		if _, ok := sqliteMigrationByVersion(migration.Version); !ok {
			manifest.UnknownMigrationVersions = append(manifest.UnknownMigrationVersions, migration.Version)
		}
	}
	for _, migration := range sqliteMigrations {
		if !applied[migration.version] {
			manifest.MissingMigrationVersions = append(manifest.MissingMigrationVersions, migration.version)
		}
	}

	switch {
	case report.IntegrityCheck != "ok":
		manifest.Status = "blocked"
	case len(manifest.UnknownMigrationVersions) > 0:
		manifest.Status = "blocked"
		manifest.MigrationStatus = "unknown"
	case len(manifest.MissingMigrationVersions) > 0:
		manifest.Status = "blocked"
		manifest.MigrationStatus = "behind"
	case report.LatestMigrationVersion > manifest.ExpectedMigrationVersion:
		manifest.Status = "blocked"
		manifest.MigrationStatus = "ahead"
	}

	sort.Ints(manifest.MissingMigrationVersions)
	sort.Ints(manifest.UnknownMigrationVersions)
	return manifest
}

func SQLiteReadinessManifestForPath(path string) (SQLiteReadinessManifest, error) {
	report, err := SQLiteReadiness(path)
	if err != nil {
		return SQLiteReadinessManifest{}, err
	}
	return report.Manifest(), nil
}

func LatestSQLiteMigrationVersion() int {
	if len(sqliteMigrations) == 0 {
		return 0
	}
	return sqliteMigrations[len(sqliteMigrations)-1].version
}

func readSQLiteStoreRowCounts(db *sql.DB, counts map[string]int) error {
	rows, err := db.Query(`SELECT row_kind, COUNT(*) FROM agenthub_store_rows GROUP BY row_kind`)
	if err != nil {
		return fmt.Errorf("read sqlite store row counts: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var kind string
		var count int
		if err := rows.Scan(&kind, &count); err != nil {
			return fmt.Errorf("scan sqlite store row count: %w", err)
		}
		counts[kind] = count
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate sqlite store row counts: %w", err)
	}
	return nil
}

func readSQLiteProjectionCounts(db *sql.DB, counts map[string]int) error {
	for _, table := range sqliteReadinessProjectionTables() {
		var count int
		if err := db.QueryRow(`SELECT COUNT(*) FROM ` + table).Scan(&count); err != nil {
			return fmt.Errorf("read sqlite projection count %s: %w", table, err)
		}
		counts[table] = count
	}
	return nil
}

func sqliteReadinessRowKinds() []string {
	return []string{
		sqliteRowKindProject,
		sqliteRowKindThread,
		sqliteRowKindRun,
		sqliteRowKindItem,
		sqliteRowKindPin,
		sqliteRowKindDiff,
		sqliteRowKindArtifact,
		sqliteRowKindPreview,
	}
}

func sqliteReadinessProjectionTables() []string {
	return []string{
		"edge_owners",
		"edge_workspaces",
		"edge_runs",
		"edge_artifacts",
		"edge_diffs",
		"edge_previews",
	}
}

func copyIntMap(values map[string]int) map[string]int {
	out := make(map[string]int, len(values))
	for key, value := range values {
		out[key] = value
	}
	return out
}
