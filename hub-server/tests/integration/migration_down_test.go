//go:build integration

package integration

import (
	"fmt"
	"net/url"
	"testing"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"

	"github.com/agenthub/hub-server/internal/config"
)

// TestMigration0016DownRoundTrip proves that migration 0016 (workspace_refactor)
// can be rolled back via its .down.sql and re-applied without error against the
// real integration PostgreSQL. Regression gate for #2125 slice A.
//
// Strategy: from whatever version the shared DB is at (typically latest), step
// down to 16, seed placeholder rows needed by the down, step down one more to
// 15, assert schema shape, step back up to 16, assert again. Finally restore
// to the original version so subsequent tests are unaffected.
func TestMigration0016DownRoundTrip(t *testing.T) {
	cfg, err := config.Load("../../configs/config.yaml")
	if err != nil {
		t.Fatalf("load config: %v", err)
	}

	m := openMigrate(t, cfg)
	defer m.Close()

	// Snapshot current state so we can restore even on failure.
	origVersion, origDirty, origErr := m.Version()
	if origErr != nil {
		t.Fatalf("read initial migration version: %v", origErr)
	}
	if origDirty {
		t.Fatalf("database is dirty at version %d before test; fix first", origVersion)
	}
	if origVersion < 16 {
		t.Fatalf("database at version %d; need >= 16 for this test", origVersion)
	}

	restore := func() {
		cur, _, _ := m.Version()
		if cur != origVersion {
			if err := m.Migrate(uint(origVersion)); err != nil && err != migrate.ErrNoChange {
				t.Logf("restore Migrate(%d): %v", origVersion, err)
			}
		}
	}
	t.Cleanup(restore)

	// Step down to exactly 16 if we're above it.
	if origVersion > 16 {
		stepsDown := int(origVersion) - 16
		if err := m.Steps(-stepsDown); err != nil && err != migrate.ErrNoChange {
			t.Fatalf("step down from %d to 16: %v", origVersion, err)
		}
	}
	v, dirty, err := m.Version()
	if err != nil {
		t.Fatalf("version after step-to-16: %v", err)
	}
	if v != 16 || dirty {
		t.Fatalf("expected version=16 dirty=false, got %d dirty=%v", v, dirty)
	}

	// Sanity-check 0016-up shape.
	assertWorkspacesColumns(t, []string{"name", "description", "owner_id", "updated_at"}, true)
	assertWorkspacesColumns(t, []string{"device_id", "local_path", "display_name"}, false)

	// Pre-seed placeholder rows required by 0016 down: workspaces.device_id
	// defaults to zero UUID and the down adds FK → devices(id). devices.user_id
	// is NOT NULL, so we also need a zero-UUID users row with all NOT NULL cols.
	seedZeroUUIDPlaceholderRows(t)

	// Execute ONE down step → should land on 0015.
	if err := m.Steps(-1); err != nil && err != migrate.ErrNoChange {
		t.Fatalf("migrate down one step from 16: %v", err)
	}
	v, dirty, err = m.Version()
	if err != nil {
		t.Fatalf("version after down: %v", err)
	}
	if v != 15 {
		t.Fatalf("expected version=15 after down, got %d (dirty=%v)", v, dirty)
	}
	if dirty {
		t.Fatalf("schema_migrations.dirty=true after 0016 down; expected clean rollback")
	}

	// Schema-shape assertions for the 0015 state.
	assertWorkspacesColumns(t, []string{"device_id", "local_path", "display_name"}, true)
	assertWorkspacesColumns(t, []string{"name", "description", "owner_id", "updated_at"}, false)
	assertIndexExists(t, "workspaces", "idx_workspaces_owner", false)
	assertFKExists(t, "workspaces", "fk_workspaces_device", true)

	// Re-apply 0016 to prove round-trip.
	if err := m.Steps(1); err != nil && err != migrate.ErrNoChange {
		t.Fatalf("migrate up one step back to 16: %v", err)
	}
	v, dirty, err = m.Version()
	if err != nil {
		t.Fatalf("version after re-up: %v", err)
	}
	if v != 16 || dirty {
		t.Fatalf("expected version=16 dirty=false after re-up, got %d dirty=%v", v, dirty)
	}
	assertWorkspacesColumns(t, []string{"name", "owner_id"}, true)
	assertWorkspacesColumns(t, []string{"device_id"}, false)
}

func openMigrate(t *testing.T, cfg *config.Config) *migrate.Migrate {
	t.Helper()
	password := url.QueryEscape(cfg.DB.Password)
	sslmode := cfg.DB.SSLMode
	if sslmode == "" {
		sslmode = "disable"
	}
	pgURL := fmt.Sprintf("postgres://%s:%s@%s:%d/%s?sslmode=%s",
		cfg.DB.User, password, cfg.DB.Host, cfg.DB.Port, cfg.DB.Name, sslmode)
	m, err := migrate.New("file://../../migrations", pgURL)
	if err != nil {
		t.Fatalf("create migrate instance: %v", err)
	}
	return m
}

func seedZeroUUIDPlaceholderRows(t *testing.T) {
	t.Helper()
	const zeroUUID = "00000000-0000-0000-0000-000000000000"
	if err := db.Exec(`
		INSERT INTO users(id, username, password_hash, nickname)
		VALUES (?, 'system-placeholder', 'placeholder-not-a-real-hash', 'System')
		ON CONFLICT (id) DO NOTHING
	`, zeroUUID).Error; err != nil {
		t.Fatalf("seed zero-UUID user placeholder: %v", err)
	}
	if err := db.Exec(`
		INSERT INTO devices(id, user_id, device_type)
		VALUES (?, ?, 'system')
		ON CONFLICT (id) DO NOTHING
	`, zeroUUID, zeroUUID).Error; err != nil {
		t.Fatalf("seed zero-UUID device placeholder: %v", err)
	}
}

func assertWorkspacesColumns(t *testing.T, cols []string, wantExist bool) {
	t.Helper()
	for _, col := range cols {
		var exists bool
		if err := db.Raw(`
			SELECT EXISTS (
				SELECT 1 FROM information_schema.columns
				WHERE table_schema = current_schema()
				  AND table_name   = ?
				  AND column_name  = ?
			)`, "workspaces", col).Scan(&exists).Error; err != nil {
			t.Fatalf("check column workspaces.%s: %v", col, err)
		}
		if wantExist && !exists {
			t.Errorf("column workspaces.%s missing; want present", col)
		}
		if !wantExist && exists {
			t.Errorf("column workspaces.%s present; want absent", col)
		}
	}
}

func assertIndexExists(t *testing.T, table, index string, wantExist bool) {
	t.Helper()
	var exists bool
	if err := db.Raw(`
		SELECT EXISTS (
			SELECT 1 FROM pg_indexes
			WHERE schemaname = current_schema()
			  AND tablename  = ?
			  AND indexname  = ?
		)`, table, index).Scan(&exists).Error; err != nil {
		t.Fatalf("check index %s: %v", index, err)
	}
	if wantExist && !exists {
		t.Errorf("index %s missing on %s; want present", index, table)
	}
	if !wantExist && exists {
		t.Errorf("index %s present on %s; want absent", index, table)
	}
}

func assertFKExists(t *testing.T, table, constraint string, wantExist bool) {
	t.Helper()
	var exists bool
	if err := db.Raw(`
		SELECT EXISTS (
			SELECT 1 FROM information_schema.table_constraints
			WHERE table_schema    = current_schema()
			  AND table_name      = ?
			  AND constraint_name = ?
			  AND constraint_type = 'FOREIGN KEY'
		)`, table, constraint).Scan(&exists).Error; err != nil {
		t.Fatalf("check FK %s: %v", constraint, err)
	}
	if wantExist && !exists {
		t.Errorf("FK %s missing on %s; want present", constraint, table)
	}
	if !wantExist && exists {
		t.Errorf("FK %s present on %s; want absent", constraint, table)
	}
}
