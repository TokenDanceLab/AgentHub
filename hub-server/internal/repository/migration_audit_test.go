package repository

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestMigration0040AuditEventsRequiresPgcryptoAndTruncateTrigger(t *testing.T) {
	up := readMigration0040(t, "up")
	down := readMigration0040(t, "down")

	if !strings.Contains(up, "CREATE EXTENSION IF NOT EXISTS pgcrypto;") {
		t.Fatal("0040 up migration must enable pgcrypto before using digest()")
	}

	normalizedUp := normalizeSQL(up)
	requireSQL(t, normalizedUp, "create trigger trg_audit_events_no_truncate before truncate on audit_events")
	requireSQL(t, normalizedUp, "for each statement execute function audit_events_protect()")

	normalizedDown := normalizeSQL(down)
	requireSQL(t, normalizedDown, "drop trigger if exists trg_audit_events_no_truncate on audit_events")
}

func readMigration0040(t *testing.T, direction string) string {
	t.Helper()

	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("cannot locate migration audit test file")
	}

	path := filepath.Join(filepath.Dir(file), "..", "..", "migrations", "0040_audit_events_immutable."+direction+".sql")
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
