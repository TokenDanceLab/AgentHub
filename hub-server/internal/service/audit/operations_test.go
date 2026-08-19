package audit

// DB-backed audit service tests on SQLite. The repository layer explicitly
// supports this lane (advisory xact lock is postgres-only, see
// repository/audit.go); PostgreSQL semantics are exercised by the
// integration lane (tests/integration/audit_chain_test.go).

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/metrics"
	"github.com/agenthub/hub-server/internal/model"
)

func newAuditTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	// :memory: SQLite is per-connection; one connection keeps the schema
	// visible to all queries (same pattern as agent_dispatch_trigger_test.go).
	sqlDB.SetMaxOpenConns(1)
	require.NoError(t, db.Exec(`
		CREATE TABLE audit_events (
			id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
			user_id    TEXT,
			profile_id TEXT,
			target_id  TEXT,
			event_type TEXT NOT NULL,
			severity   TEXT NOT NULL DEFAULT 'info',
			summary    TEXT NOT NULL,
			details    TEXT DEFAULT '{}',
			client_ip  TEXT DEFAULT '',
			prev_hash  TEXT NOT NULL DEFAULT '',
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		);
		CREATE INDEX idx_audit_events_created ON audit_events(created_at DESC);
	`).Error)

	return db
}

func newAuditTestService(t *testing.T, db *gorm.DB, config *Config) *Service {
	t.Helper()

	// audit.go's retryLoop/drain touch metrics.AuditQueueDepth directly;
	// Register is idempotent (sync.Once), so calling it per fixture is safe.
	metrics.Register()

	if config == nil {
		config = &Config{}
	}
	if config.LifecycleContext == nil {
		config.LifecycleContext = context.Background()
	}
	if config.RetryBufferSize == 0 {
		config.RetryBufferSize = 16
	}

	svc := NewService(db, config)
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		svc.Shutdown(ctx)
	})
	return svc
}

func countAuditEvents(t *testing.T, db *gorm.DB) int64 {
	t.Helper()
	var count int64
	require.NoError(t, db.Model(&model.AuditEvent{}).Count(&count).Error)
	return count
}

// --- persistWithRetry ---

func TestServicePersistWithRetryWritesEvent(t *testing.T) {
	db := newAuditTestDB(t)
	svc := newAuditTestService(t, db, nil)

	event := &model.AuditEvent{
		UserID:    "00000000-0000-0000-0000-000000000001",
		EventType: "test.persist",
		Severity:  "info",
		Summary:   "persist with retry",
	}

	svc.persistWithRetry(context.Background(), event)

	require.Equal(t, int64(1), countAuditEvents(t, db))
	var stored model.AuditEvent
	require.NoError(t, db.First(&stored).Error)
	require.Equal(t, "test.persist", stored.EventType)
	require.NotEmpty(t, stored.ID, "event ID is assigned by the DB default")
}

func TestServicePersistWithRetryAbortsOnCancel(t *testing.T) {
	db := newAuditTestDB(t)
	svc := newAuditTestService(t, db, nil)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	svc.persistWithRetry(ctx, &model.AuditEvent{UserID: "u", EventType: "test.abort", Severity: "info", Summary: "aborted"})

	require.Equal(t, int64(0), countAuditEvents(t, db), "cancelled context must abort persistence")
}

// --- RecordSync ---

func TestServiceRecordSyncPersistsAndWritesFileSink(t *testing.T) {
	db := newAuditTestDB(t)
	logPath := filepath.Join(t.TempDir(), "audit.jsonl")
	svc := newAuditTestService(t, db, &Config{AuditLogFile: logPath})

	err := svc.RecordSync(context.Background(), "00000000-0000-0000-0000-000000000002", "test.sync", "info", "sync event", nil, nil, nil, "127.0.0.1")
	require.NoError(t, err)
	require.Equal(t, int64(1), countAuditEvents(t, db))

	data, err := os.ReadFile(logPath)
	require.NoError(t, err)
	require.Contains(t, string(data), "sync event", "file sink receives the JSONL entry")
}

func TestServiceRecordSyncReturnsPersistenceError(t *testing.T) {
	// No table: repository.CreateAuditEvent must fail and RecordSync must surface it.
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	svc := newAuditTestService(t, db, nil)

	err = svc.RecordSync(context.Background(), "u", "test.fail", "info", "no table", nil, nil, nil, "")
	require.Error(t, err)
}

// --- Record (async queue) ---

func TestServiceRecordAsyncPersistsViaRetryLoop(t *testing.T) {
	db := newAuditTestDB(t)
	svc := newAuditTestService(t, db, nil)

	svc.Record(context.Background(), "00000000-0000-0000-0000-000000000003", "test.async", "info", "async event", nil, nil, nil, "")
	svc.Record(context.Background(), "00000000-0000-0000-0000-000000000003", "test.async", "warn", "async event 2", nil, nil, nil, "")

	// retryLoop drains asynchronously; Shutdown (t.Cleanup) drains the rest.
	require.Eventually(t, func() bool {
		return countAuditEvents(t, db) == 2
	}, 3*time.Second, 20*time.Millisecond, "async events must be persisted by the retry loop")
}

// --- Query ---

func TestServiceQueryNonAdminFiltersCaller(t *testing.T) {
	db := newAuditTestDB(t)
	svc := newAuditTestService(t, db, nil)

	userA := "00000000-0000-0000-0000-00000000000a"
	userB := "00000000-0000-0000-0000-00000000000b"
	for i := 0; i < 3; i++ {
		require.NoError(t, svc.RecordSync(context.Background(), userA, "test.query", "info", "a-event", nil, nil, nil, ""))
		require.NoError(t, svc.RecordSync(context.Background(), userB, "test.query", "info", "b-event", nil, nil, nil, ""))
	}

	nonAdmin, err := svc.Query(context.Background(), userA, false, "", "", nil, nil, "", 50)
	require.NoError(t, err)
	require.Len(t, nonAdmin.Items, 3)
	for _, item := range nonAdmin.Items {
		require.Equal(t, userA, item.UserID)
	}

	admin, err := svc.Query(context.Background(), userA, true, "", "", nil, nil, "", 50)
	require.NoError(t, err)
	require.Len(t, admin.Items, 6)
}

func TestServiceQueryPaginationAndCursor(t *testing.T) {
	db := newAuditTestDB(t)
	svc := newAuditTestService(t, db, nil)

	for i := 0; i < 5; i++ {
		require.NoError(t, svc.RecordSync(context.Background(), "00000000-0000-0000-0000-00000000000c", "test.page", "info", "page event", nil, nil, nil, ""))
	}

	first, err := svc.Query(context.Background(), "", true, "test.page", "", nil, nil, "", 2)
	require.NoError(t, err)
	require.Len(t, first.Items, 2)
	require.True(t, first.HasMore)
	require.NotEmpty(t, first.Cursor)

	second, err := svc.Query(context.Background(), "", true, "test.page", "", nil, nil, first.Cursor, 2)
	require.NoError(t, err)
	require.Len(t, second.Items, 2)
	require.True(t, second.HasMore)

	third, err := svc.Query(context.Background(), "", true, "test.page", "", nil, nil, second.Cursor, 2)
	require.NoError(t, err)
	require.Len(t, third.Items, 1)
	require.False(t, third.HasMore)
}

// --- VerifyChain ---

func TestServiceVerifyChainValidAndTampered(t *testing.T) {
	db := newAuditTestDB(t)
	svc := newAuditTestService(t, db, nil)

	for i := 0; i < 3; i++ {
		require.NoError(t, svc.RecordSync(context.Background(), "00000000-0000-0000-0000-00000000000d", "test.chain", "info", "chain event", nil, nil, nil, ""))
	}

	idx, err := svc.VerifyChain(10)
	require.NoError(t, err)
	require.Equal(t, -1, idx, "clean chain must verify")

	// Tamper with the middle event's content. Use the same ordering as
	// repository.VerifyAuditChain (created_at ASC, id ASC) so the tampered
	// row is guaranteed to be a link target, not the chain tail.
	var ids []string
	require.NoError(t, db.Model(&model.AuditEvent{}).Order("created_at ASC, id ASC").Pluck("id", &ids).Error)
	require.Len(t, ids, 3)
	require.NoError(t, db.Model(&model.AuditEvent{}).Where("id = ?", ids[1]).Update("summary", "TAMPERED").Error)

	idx, err = svc.VerifyChain(10)
	require.NoError(t, err)
	require.NotEqual(t, -1, idx, "content tamper must break the hash chain")
}

// --- RecordPermissionDecision ---

func TestServiceRecordPermissionDecisionDenyIsWarn(t *testing.T) {
	db := newAuditTestDB(t)
	svc := newAuditTestService(t, db, nil)

	svc.RecordPermissionDecision(context.Background(), "00000000-0000-0000-0000-00000000000e", "run.agent", false, nil, "10.0.0.1")

	var stored model.AuditEvent
	require.NoError(t, db.First(&stored).Error)
	require.Equal(t, "warn", stored.Severity)
	require.Equal(t, "permission_denied", stored.Summary)

	var details map[string]interface{}
	require.NoError(t, json.Unmarshal([]byte(stored.Details), &details))
	require.Equal(t, "run.agent", details["decision"])
	require.Equal(t, false, details["allowed"])
}

func TestServiceRecordPermissionDecisionAllowIsInfo(t *testing.T) {
	db := newAuditTestDB(t)
	svc := newAuditTestService(t, db, nil)

	svc.RecordPermissionDecision(context.Background(), "00000000-0000-0000-0000-00000000000f", "read.project", true, nil, "")

	var stored model.AuditEvent
	require.NoError(t, db.First(&stored).Error)
	require.Equal(t, "info", stored.Severity)
	require.Equal(t, "permission_granted", stored.Summary)
	require.True(t, strings.Contains(stored.Details, `"allowed":true`))
}
