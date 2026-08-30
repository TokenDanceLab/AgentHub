// #2067: lightweight integration test verifying privileged-action audit events
// persist to the audit_events table via RecordPrivilegedAction → RecordSync.
package audit

import (
	"context"
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/model"
)

func newPrivilegedActionTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.AuditEvent{}))
	return db
}

func TestRecordPrivilegedAction_PersistsToDB(t *testing.T) {
	db := newPrivilegedActionTestDB(t)
	svc := NewService(db, &Config{RetryBufferSize: 0}) // sync-only, no retry goroutine

	ctx := context.Background()
	svc.RecordPrivilegedAction(ctx, PrivilegedActionInput{
		ActorUserID:  "user-integ-1",
		Action:       EventTaskCancel,
		ResourceType: "task",
		ResourceID:   "task-integ-42",
		Outcome:      OutcomeSuccess,
		AuthBasis:    "owner",
		Reason:       "",
	})

	var events []model.AuditEvent
	require.NoError(t, db.Where("event_type = ?", EventTaskCancel).Find(&events).Error)
	require.Len(t, events, 1)

	e := events[0]
	assert.Equal(t, "user-integ-1", e.UserID)
	assert.Equal(t, EventTaskCancel, e.EventType)
	assert.Equal(t, "info", e.Severity)
	assert.Contains(t, e.Summary, EventTaskCancel)
	assert.Contains(t, e.Details, `"outcome":"success"`)
	assert.Contains(t, e.Details, `"resource_id":"task-integ-42"`)
	assert.Contains(t, e.Details, `"auth_basis":"owner"`)
	require.NotNil(t, e.TargetID)
	assert.Equal(t, "task-integ-42", *e.TargetID)
}

func TestRecordPrivilegedAction_DeniedSeverityWarn(t *testing.T) {
	db := newPrivilegedActionTestDB(t)
	svc := NewService(db, &Config{RetryBufferSize: 0})

	ctx := context.Background()
	svc.RecordPrivilegedAction(ctx, PrivilegedActionInput{
		ActorUserID:  "user-integ-2",
		Action:       EventMemberRemove,
		ResourceType: "session_member",
		ResourceID:   "sess-integ-1",
		Outcome:      OutcomeDenied,
		AuthBasis:    "member-role-owner",
		Reason:       "not owner",
	})

	var events []model.AuditEvent
	require.NoError(t, db.Where("event_type = ?", EventMemberRemove).Find(&events).Error)
	require.Len(t, events, 1)
	assert.Equal(t, "warn", events[0].Severity)
	assert.Contains(t, events[0].Details, `"outcome":"denied"`)
	assert.Contains(t, events[0].Details, `"reason":"not owner"`)
}

func TestRecordPrivilegedAction_NoSecretFields(t *testing.T) {
	db := newPrivilegedActionTestDB(t)
	svc := NewService(db, &Config{RetryBufferSize: 0})

	ctx := context.Background()
	svc.RecordPrivilegedAction(ctx, PrivilegedActionInput{
		ActorUserID:  "user-integ-3",
		Action:       EventTargetCreate,
		ResourceType: "execution_target",
		ResourceID:   "target-integ-1",
		Outcome:      OutcomeSuccess,
		AuthBasis:    "owner",
	})

	var events []model.AuditEvent
	require.NoError(t, db.Find(&events).Error)
	for _, e := range events {
		// Verify no secret/token/password fields leak into details.
		assert.NotContains(t, e.Details, "password")
		assert.NotContains(t, e.Details, "token")
		assert.NotContains(t, e.Details, "secret")
		assert.NotContains(t, e.Details, "api_key")
	}
}
