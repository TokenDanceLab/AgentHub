//go:build integration

package integration

import (
	"sync"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
)

// TestAuditChainContentTamperDetected proves the #1541 fix end to end on
// PostgreSQL: the link hash covers event content, so tampering with any
// field (bypassing the append-only trigger the way a superuser, offline
// edit, backup restore or broken trigger would) is detected by the chain.
func TestAuditChainContentTamperDetected(t *testing.T) {
	require.NoError(t, cleanDBTables(db))
	registerAsAdmin(t, "audit-tamper-user", "password123", "Audit Tamper")

	// Build a three-event chain through the real write path.
	var ids []string
	for i := 0; i < 3; i++ {
		ev := &model.AuditEvent{
			UserID:    testAdminUserID,
			EventType: "test.tamper",
			Severity:  "info",
			Summary:   "chain event",
			Details:   `{"n":1}`,
		}
		require.NoError(t, repository.CreateAuditEvent(db, ev))
		ids = append(ids, ev.ID)
	}

	chain := loadAuditChain(t)
	require.Equal(t, -1, model.VerifyChain(chain), "clean chain must verify")

	// Bypass the append-only trigger the way an attacker with DB access
	// would (superuser / offline modification / broken trigger), then edit
	// the middle event's content. id and prev_hash stay untouched — the old
	// chain (id+prev_hash only) would have verified clean.
	require.NoError(t, db.Exec("ALTER TABLE audit_events DISABLE TRIGGER USER").Error)
	require.NoError(t, db.Exec("UPDATE audit_events SET summary = 'TAMPERED BY ATTACKER' WHERE id = ?", ids[1]).Error)
	require.NoError(t, db.Exec("ALTER TABLE audit_events ENABLE TRIGGER USER").Error)

	chain = loadAuditChain(t)
	idx := model.VerifyChain(chain)
	require.NotEqual(t, -1, idx, "content tamper must break the hash chain")
}

// TestAuditChainConcurrentWritesNoFork runs concurrent writers against the
// same tail. The FOR UPDATE tail lock (repository.CreateAuditEvent) plus the
// unique prev_hash index (migration 0058) must produce a single linear chain
// with no forked (duplicate prev_hash) nodes.
func TestAuditChainConcurrentWritesNoFork(t *testing.T) {
	require.NoError(t, cleanDBTables(db))
	registerAsAdmin(t, "audit-concurrent-user", "password123", "Audit Concurrent")

	const writers = 20
	var wg sync.WaitGroup
	errs := make(chan error, writers)
	for i := 0; i < writers; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			ev := &model.AuditEvent{
				UserID:    testAdminUserID,
				EventType: "test.concurrent",
				Severity:  "info",
				Summary:   "concurrent write",
			}
			if err := repository.CreateAuditEvent(db, ev); err != nil {
				errs <- err
			}
		}(i)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Fatalf("concurrent create failed: %v", err)
	}

	// Every prev_hash must be unique (no two events share a predecessor).
	var total, distinct int64
	require.NoError(t, db.Raw("SELECT count(*) FROM audit_events").Scan(&total).Error)
	require.NoError(t, db.Raw("SELECT count(DISTINCT prev_hash) FROM audit_events").Scan(&distinct).Error)
	require.Equal(t, total, distinct, "fork detected: %d events but only %d distinct prev_hash", total, distinct)

	chain := loadAuditChain(t)
	require.Equal(t, -1, model.VerifyChain(chain), "concurrent chain must verify linearly")
}

// loadAuditChain reads the whole audit_events table in chain order.
func loadAuditChain(t *testing.T) []model.AuditEvent {
	t.Helper()
	var chain []model.AuditEvent
	require.NoError(t, db.Order("created_at ASC, id ASC").Find(&chain).Error)
	return chain
}
