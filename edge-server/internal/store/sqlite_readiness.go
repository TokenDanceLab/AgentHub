package store

import (
	"database/sql"
	"fmt"
)

type SQLiteReadinessReport struct {
	Path                   string
	IntegrityCheck         string
	LatestMigrationVersion int
	AppliedMigrations      []SQLiteMigrationInfo
	RowCounts              map[string]int
	ProjectionCounts       map[string]int
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
	for _, table := range []string{
		"edge_owners",
		"edge_workspaces",
		"edge_runs",
		"edge_artifacts",
		"edge_diffs",
		"edge_previews",
	} {
		var count int
		if err := db.QueryRow(`SELECT COUNT(*) FROM ` + table).Scan(&count); err != nil {
			return fmt.Errorf("read sqlite projection count %s: %w", table, err)
		}
		counts[table] = count
	}
	return nil
}
