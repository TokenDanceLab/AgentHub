package repository

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/jackc/pgx/v5/stdlib"
)

func TestMigration0040AuditEventsRequiresPgcryptoAndTruncateTrigger(t *testing.T) {
	up := readMigration(t, "0040_audit_events_immutable.up.sql")
	down := readMigration(t, "0040_audit_events_immutable.down.sql")

	if !strings.Contains(up, "CREATE EXTENSION IF NOT EXISTS pgcrypto;") {
		t.Fatal("0040 up migration must enable pgcrypto before using digest()")
	}

	normalizedUp := normalizeSQL(up)
	requireSQL(t, normalizedUp, "create trigger trg_audit_events_no_truncate before truncate on audit_events")
	requireSQL(t, normalizedUp, "for each statement execute function audit_events_protect()")

	normalizedDown := normalizeSQL(down)
	requireSQL(t, normalizedDown, "drop trigger if exists trg_audit_events_no_truncate on audit_events")
}

func TestMigration0040AuditEventsPostgresUpProtectsTruncate(t *testing.T) {
	dbURL, cleanup := postgresMigrationTestURL(t)
	defer cleanup()

	m, err := migrate.New(migrationsSourceURL(t), dbURL)
	if err != nil {
		t.Fatalf("create postgres migration runner: %v", err)
	}
	defer m.Close()

	if err := m.Up(); err != nil && err != migrate.ErrNoChange {
		t.Fatalf("run postgres migrations up: %v", err)
	}

	sqlDB, err := sql.Open("pgx", dbURL)
	if err != nil {
		t.Fatalf("open postgres migration test database: %v", err)
	}
	defer sqlDB.Close()
	defer cleanupPostgresAuditEvents(t, sqlDB)

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	var hasPgcrypto bool
	if err := sqlDB.QueryRowContext(ctx, "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto')").Scan(&hasPgcrypto); err != nil {
		t.Fatalf("check pgcrypto extension: %v", err)
	}
	if !hasPgcrypto {
		t.Fatal("0040 migration did not enable pgcrypto")
	}

	digestInput := "agenthub-migration-0040"
	expectedDigest := fmt.Sprintf("%x", sha256.Sum256([]byte(digestInput)))
	var actualDigest string
	if err := sqlDB.QueryRowContext(ctx, "SELECT encode(digest($1::text, 'sha256'), 'hex')", digestInput).Scan(&actualDigest); err != nil {
		t.Fatalf("call pgcrypto digest(): %v", err)
	}
	if actualDigest != expectedDigest {
		t.Fatalf("digest() = %s, want %s", actualDigest, expectedDigest)
	}

	var truncateTriggerState string
	if err := sqlDB.QueryRowContext(ctx, `
		SELECT tgenabled
		FROM pg_trigger
		WHERE tgname = 'trg_audit_events_no_truncate'
		  AND tgrelid = 'audit_events'::regclass
	`).Scan(&truncateTriggerState); err != nil {
		t.Fatalf("check audit_events truncate trigger: %v", err)
	}
	if truncateTriggerState != "O" {
		t.Fatalf("truncate trigger state = %q, want enabled", truncateTriggerState)
	}

	if _, err := sqlDB.ExecContext(ctx, `
		INSERT INTO audit_events (event_type, severity, summary, details)
		VALUES ('migration_test', 'info', 'migration 0040 trigger test', '{}'::jsonb)
	`); err != nil {
		t.Fatalf("insert audit event after migrations: %v", err)
	}

	if _, err := sqlDB.ExecContext(ctx, "TRUNCATE audit_events"); err == nil {
		t.Fatal("TRUNCATE audit_events succeeded; want trigger rejection")
	} else if !strings.Contains(err.Error(), "TRUNCATE is forbidden") {
		t.Fatalf("TRUNCATE audit_events error = %v, want trigger rejection", err)
	}
}

func TestMigration0042MessageSearchTsvectorCreatesPartialGINExpressionIndex(t *testing.T) {
	up := readMigration(t, "0042_message_search_tsvector.up.sql")
	down := readMigration(t, "0042_message_search_tsvector.down.sql")

	normalizedUp := normalizeSQL(up)
	requireSQL(t, normalizedUp, "create index if not exists idx_messages_content_text_tsvector")
	requireSQL(t, normalizedUp, "on messages using gin (to_tsvector('simple', coalesce(content->>'text', '')))")
	requireSQL(t, normalizedUp, "where recalled = false")

	normalizedDown := normalizeSQL(down)
	requireSQL(t, normalizedDown, "drop index if exists idx_messages_content_text_tsvector")
}

func TestMigration0044MessagesEditAddsEditedColumnsAndPartialIndex(t *testing.T) {
	up := readMigration(t, "0044_messages_edit.up.sql")
	down := readMigration(t, "0044_messages_edit.down.sql")

	normalizedUp := normalizeSQL(up)
	requireSQL(t, normalizedUp, "alter table messages add column if not exists edited boolean not null default false")
	requireSQL(t, normalizedUp, "alter table messages add column if not exists edited_at timestamptz")
	requireSQL(t, normalizedUp, "create index if not exists idx_messages_edited on messages (session_id, edited_at) where edited = true")

	normalizedDown := normalizeSQL(down)
	requireSQL(t, normalizedDown, "drop index if exists idx_messages_edited")
	requireSQL(t, normalizedDown, "alter table messages drop column if exists edited_at")
	requireSQL(t, normalizedDown, "alter table messages drop column if exists edited")
}

func TestMigration0045MessageReactionsCreatesUniqueUserReactionTable(t *testing.T) {
	up := readMigration(t, "0045_message_reactions.up.sql")
	down := readMigration(t, "0045_message_reactions.down.sql")

	normalizedUp := normalizeSQL(up)
	requireSQL(t, normalizedUp, "create table if not exists message_reactions")
	requireSQL(t, normalizedUp, "session_id uuid not null references sessions(id) on delete cascade")
	requireSQL(t, normalizedUp, "message_id uuid not null")
	requireSQL(t, normalizedUp, "user_id uuid not null references users(id) on delete cascade")
	requireSQL(t, normalizedUp, "emoji varchar(64) not null")
	requireSQL(t, normalizedUp, "constraint fk_message_reactions_message_session foreign key (session_id, message_id) references messages (session_id, id) on delete cascade")
	requireSQL(t, normalizedUp, "constraint uq_message_reaction unique (session_id, message_id, user_id, emoji)")
	requireSQL(t, normalizedUp, "create index if not exists idx_message_reactions_message on message_reactions (session_id, message_id)")
	requireSQL(t, normalizedUp, "create index if not exists idx_message_reactions_user on message_reactions (user_id)")

	normalizedDown := normalizeSQL(down)
	requireSQL(t, normalizedDown, "drop index if exists idx_message_reactions_user")
	requireSQL(t, normalizedDown, "drop index if exists idx_message_reactions_message")
	requireSQL(t, normalizedDown, "drop table if exists message_reactions")
}

func TestMigration0047ExecutionTargetsCreatesActiveLocalEdgeDeviceUniqueness(t *testing.T) {
	up := readMigration(t, "0047_execution_target_local_edge_uniqueness.up.sql")
	down := readMigration(t, "0047_execution_target_local_edge_uniqueness.down.sql")

	normalizedUp := normalizeSQL(up)
	requireSQL(t, normalizedUp, "create unique index if not exists idx_execution_targets_active_local_edge_device_unique")
	requireSQL(t, normalizedUp, "on execution_targets (owner_id, target_type, device_id)")
	requireSQL(t, normalizedUp, "where deleted_at is null and target_type = 'local_edge' and device_id is not null")

	normalizedDown := normalizeSQL(down)
	requireSQL(t, normalizedDown, "drop index if exists idx_execution_targets_active_local_edge_device_unique")
}

func TestMigration0057DevicesRestoresPrimaryKey(t *testing.T) {
	up := readMigration(t, "0057_devices_primary_key.up.sql")
	down := readMigration(t, "0057_devices_primary_key.down.sql")

	normalizedUp := normalizeSQL(stripSQLComments(up))
	requireSQL(t, normalizedUp, "from pg_constraint")
	requireSQL(t, normalizedUp, "where conrelid = 'devices'::regclass")
	requireSQL(t, normalizedUp, "and contype = 'p'")
	const alterPrimaryKey = "alter table devices add constraint devices_pkey primary key (id)"
	if strings.Count(normalizedUp, alterPrimaryKey) != 1 {
		t.Fatalf("0057 up migration must contain exactly one guarded primary-key repair: %q", normalizedUp)
	}
	ifStart := strings.Index(normalizedUp, "if not exists (")
	alterIndex := strings.Index(normalizedUp, alterPrimaryKey)
	endIfIndex := strings.Index(normalizedUp, "end if;")
	if ifStart < 0 || alterIndex <= ifStart || endIfIndex <= alterIndex {
		t.Fatalf("0057 primary-key repair must be inside the IF NOT EXISTS block: %q", normalizedUp)
	}

	normalizedDown := normalizeSQL(stripSQLComments(down))
	if normalizedDown != "select 1;" {
		t.Fatalf("0057 down migration must be exactly SELECT 1 after comments, got %q", normalizedDown)
	}
}

func readMigration(t *testing.T, filename string) string {
	t.Helper()

	path := filepath.Join(migrationsDir(t), filename)
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read migration %s: %v", path, err)
	}
	return string(content)
}

func migrationsSourceURL(t *testing.T) string {
	t.Helper()

	return (&url.URL{
		Scheme: "file",
		Path:   filepath.ToSlash(migrationsDir(t)),
	}).String()
}

func migrationsDir(t *testing.T) string {
	t.Helper()

	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("cannot locate migration audit test file")
	}

	return filepath.Join(filepath.Dir(file), "..", "..", "migrations")
}

func postgresMigrationTestURL(t *testing.T) (string, func()) {
	t.Helper()

	if adminURL := strings.TrimSpace(os.Getenv("AGENTHUB_PG_MIGRATION_TEST_ADMIN_URL")); adminURL != "" {
		dbName := fmt.Sprintf("agenthub_migration_test_%d", time.Now().UnixNano())
		adminDB := openPostgresTestDB(t, adminURL)
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()

		if _, err := adminDB.ExecContext(ctx, "CREATE DATABASE "+quotePostgresIdentifier(dbName)); err != nil {
			adminDB.Close()
			t.Fatalf("create postgres migration test database: %v", err)
		}

		testURL := postgresURLWithDatabase(t, adminURL, dbName)
		return testURL, func() {
			cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 15*time.Second)
			defer cleanupCancel()
			_, _ = adminDB.ExecContext(cleanupCtx, "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()", dbName)
			_, _ = adminDB.ExecContext(cleanupCtx, "DROP DATABASE IF EXISTS "+quotePostgresIdentifier(dbName))
			adminDB.Close()
		}
	}

	if dbURL := strings.TrimSpace(os.Getenv("AGENTHUB_PG_MIGRATION_TEST_URL")); dbURL != "" {
		return dbURL, func() {}
	}

	t.Skip("set AGENTHUB_PG_MIGRATION_TEST_URL or AGENTHUB_PG_MIGRATION_TEST_ADMIN_URL to run real PostgreSQL migration-up coverage")
	return "", func() {}
}

func postgresURLWithDatabase(t *testing.T, rawURL, database string) string {
	t.Helper()

	parsed, err := url.Parse(rawURL)
	if err != nil {
		t.Fatalf("parse postgres admin URL: %v", err)
	}
	parsed.Path = "/" + database
	return parsed.String()
}

func openPostgresTestDB(t *testing.T, dbURL string) *sql.DB {
	t.Helper()

	sqlDB, err := sql.Open("pgx", dbURL)
	if err != nil {
		t.Fatalf("open postgres test database: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := sqlDB.PingContext(ctx); err != nil {
		sqlDB.Close()
		t.Fatalf("ping postgres test database: %v", err)
	}
	return sqlDB
}

func cleanupPostgresAuditEvents(t *testing.T, sqlDB *sql.DB) {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	if _, err := sqlDB.ExecContext(ctx, "ALTER TABLE audit_events DISABLE TRIGGER USER"); err != nil {
		t.Logf("disable audit_events triggers during cleanup: %v", err)
		return
	}
	defer func() {
		if _, err := sqlDB.ExecContext(ctx, "ALTER TABLE audit_events ENABLE TRIGGER USER"); err != nil {
			t.Logf("enable audit_events triggers during cleanup: %v", err)
		}
	}()

	if _, err := sqlDB.ExecContext(ctx, "DELETE FROM audit_events WHERE event_type = 'migration_test'"); err != nil {
		t.Logf("delete audit_events test rows: %v", err)
	}
}

func quotePostgresIdentifier(identifier string) string {
	return `"` + strings.ReplaceAll(identifier, `"`, `""`) + `"`
}

func normalizeSQL(sql string) string {
	return strings.Join(strings.Fields(strings.ToLower(sql)), " ")
}

func stripSQLComments(sql string) string {
	for {
		start := strings.Index(sql, "/*")
		if start < 0 {
			break
		}
		end := strings.Index(sql[start+2:], "*/")
		if end < 0 {
			sql = sql[:start]
			break
		}
		end += start + 4
		sql = sql[:start] + " " + sql[end:]
	}

	lines := strings.Split(sql, "\n")
	for i, line := range lines {
		if comment := strings.Index(line, "--"); comment >= 0 {
			lines[i] = line[:comment]
		}
	}
	return strings.Join(lines, "\n")
}

func requireSQL(t *testing.T, sql string, want string) {
	t.Helper()

	if !strings.Contains(sql, want) {
		t.Fatalf("expected SQL to contain %q", want)
	}
}

func TestMigration0068IndexCoverageFixes(t *testing.T) {
	up := readMigration(t, "0068_index_coverage_fixes.up.sql")
	down := readMigration(t, "0068_index_coverage_fixes.down.sql")

	normalizedUp := normalizeSQL(up)
	// 1. 冗余的裸 prev_hash 索引必须删除（唯一索引 0061 已覆盖同列）。
	requireSQL(t, normalizedUp, "drop index if exists idx_audit_events_prev_hash")
	// 2-6. 五个确定性缺失索引必须以幂等方式创建。
	requireSQL(t, normalizedUp, "create index if not exists idx_session_members_member_active on session_members (member_id) where left_at is null")
	requireSQL(t, normalizedUp, "create index if not exists idx_agent_teams_owner_created on agent_teams (owner_id, created_at desc)")
	requireSQL(t, normalizedUp, "create index if not exists idx_pending_agent_tasks_instance_created on pending_agent_tasks (agent_instance_id, created_at desc)")
	requireSQL(t, normalizedUp, "create index if not exists idx_custom_agents_owner on custom_agents (owner_user_id) where deleted_at is null")
	requireSQL(t, normalizedUp, "create index if not exists idx_friendships_friend_status on friendships (friend_id, status)")

	normalizedDown := normalizeSQL(down)
	// down 必须逆序删除五个新索引，并恢复 0040 的裸 prev_hash 索引
	// （0061.down 注释预期该索引在其回滚后仍存在）。
	requireSQL(t, normalizedDown, "drop index if exists idx_friendships_friend_status")
	requireSQL(t, normalizedDown, "drop index if exists idx_custom_agents_owner")
	requireSQL(t, normalizedDown, "drop index if exists idx_pending_agent_tasks_instance_created")
	requireSQL(t, normalizedDown, "drop index if exists idx_agent_teams_owner_created")
	requireSQL(t, normalizedDown, "drop index if exists idx_session_members_member_active")
	requireSQL(t, normalizedDown, "create index if not exists idx_audit_events_prev_hash on audit_events(prev_hash)")
}
