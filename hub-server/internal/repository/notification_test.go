package repository

import (
	"testing"

	"github.com/agenthub/hub-server/internal/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// =============================================================================
// Notification repository tests
// =============================================================================

func TestNotificationRepo_CreateAndList(t *testing.T) {
	db := setupSQLite(t)

	n1 := &model.Notification{UserID: "user-n1", Type: model.TypeMention, Payload: `{"key":"1"}`}
	n2 := &model.Notification{UserID: "user-n1", Type: model.TypeSystem, Payload: `{"key":"2"}`}
	n3 := &model.Notification{UserID: "user-n2", Type: model.TypeFriendRequest, Payload: `{"key":"3"}`}
	require.NoError(t, CreateNotification(db, n1))
	require.NoError(t, CreateNotification(db, n2))
	require.NoError(t, CreateNotification(db, n3))

	// List all for user-n1
	result, err := ListNotifications(db, "user-n1", false, 10, 0)
	require.NoError(t, err)
	assert.Len(t, result, 2)

	// Mark first as read
	require.NoError(t, MarkNotificationRead(db, "user-n1", n1.ID))

	// List unread only
	result, err = ListNotifications(db, "user-n1", true, 10, 0)
	require.NoError(t, err)
	assert.Len(t, result, 1)
	assert.Equal(t, n2.ID, result[0].ID)
}

func TestNotificationRepo_MarkReadRequiresOwningUser(t *testing.T) {
	db := setupSQLite(t)

	n := &model.Notification{UserID: "user-owner", Type: model.TypeMention, Payload: `{}`}
	require.NoError(t, CreateNotification(db, n))

	err := MarkNotificationRead(db, "user-other", n.ID)
	require.ErrorIs(t, err, gorm.ErrRecordNotFound)

	unread, err := ListNotifications(db, "user-owner", true, 10, 0)
	require.NoError(t, err)
	require.Len(t, unread, 1)
	assert.Equal(t, n.ID, unread[0].ID)
}

func TestNotificationRepo_MarkAllRead(t *testing.T) {
	db := setupSQLite(t)

	n1 := &model.Notification{UserID: "user-all", Type: model.TypeMention, Payload: `{}`}
	n2 := &model.Notification{UserID: "user-all", Type: model.TypeSystem, Payload: `{}`}
	require.NoError(t, CreateNotification(db, n1))
	require.NoError(t, CreateNotification(db, n2))

	unread, err := ListNotifications(db, "user-all", true, 10, 0)
	require.NoError(t, err)
	assert.Len(t, unread, 2)

	require.NoError(t, MarkAllNotificationsRead(db, "user-all"))

	unread, err = ListNotifications(db, "user-all", true, 10, 0)
	require.NoError(t, err)
	assert.Len(t, unread, 0)
}
