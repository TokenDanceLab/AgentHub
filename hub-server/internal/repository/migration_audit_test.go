package repository

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
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

func readMigration(t *testing.T, filename string) string {
	t.Helper()

	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("cannot locate migration audit test file")
	}

	path := filepath.Join(filepath.Dir(file), "..", "..", "migrations", filename)
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read migration %s: %v", path, err)
	}
	return string(content)
}

func normalizeSQL(sql string) string {
	return strings.Join(strings.Fields(strings.ToLower(sql)), " ")
}

func requireSQL(t *testing.T, sql string, want string) {
	t.Helper()

	if !strings.Contains(sql, want) {
		t.Fatalf("expected SQL to contain %q", want)
	}
}
