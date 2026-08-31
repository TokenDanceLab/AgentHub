package providerbinding

import (
	"context"
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
)

func newProviderBindingTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.ProviderBinding{}))
	return db
}

func seedProviderBinding(t *testing.T, db *gorm.DB, id, ownerID, provider string) {
	t.Helper()
	pb := &model.ProviderBinding{
		ID:       id,
		OwnerID:  ownerID,
		Provider: provider,
	}
	require.NoError(t, db.Create(pb).Error)
}

// TestProviderBindingGetIsOwnerScoped ensures a non-owner cannot read another
// user's provider binding (#2100 P1 audit).
func TestProviderBindingGetIsOwnerScoped(t *testing.T) {
	db := newProviderBindingTestDB(t)
	seedProviderBinding(t, db, "pb-1", "owner-1", "openai")
	svc := NewService(db)

	got, err := svc.Get(context.Background(), "pb-1", "owner-1")
	require.NoError(t, err)
	require.Equal(t, "pb-1", got.ID)

	_, err = svc.Get(context.Background(), "pb-1", "other-owner")
	require.ErrorIs(t, err, errcode.AuthDeviceMismatch)
}

// TestProviderBindingUpdateIsOwnerScoped ensures PUT by a non-owner returns
// AuthDeviceMismatch and does not mutate the row (#2100 P1 audit).
func TestProviderBindingUpdateIsOwnerScoped(t *testing.T) {
	db := newProviderBindingTestDB(t)
	seedProviderBinding(t, db, "pb-1", "owner-1", "openai")
	svc := NewService(db)

	_, err := svc.Update(context.Background(), "pb-1", "other-owner", &model.ProviderBinding{
		BaseURL: "https://evil.example.com",
	})
	require.ErrorIs(t, err, errcode.AuthDeviceMismatch)

	var pb model.ProviderBinding
	require.NoError(t, db.Where("id = ?", "pb-1").First(&pb).Error)
	require.Empty(t, pb.BaseURL, "base_url must not be mutated by non-owner")
}

// TestProviderBindingDeleteIsOwnerScoped ensures DELETE by a non-owner returns
// AuthDeviceMismatch and leaves the row intact (#2100 P1 audit).
func TestProviderBindingDeleteIsOwnerScoped(t *testing.T) {
	db := newProviderBindingTestDB(t)
	seedProviderBinding(t, db, "pb-1", "owner-1", "openai")
	svc := NewService(db)

	err := svc.Delete(context.Background(), "pb-1", "other-owner")
	require.ErrorIs(t, err, errcode.AuthDeviceMismatch)

	var count int64
	require.NoError(t, db.Model(&model.ProviderBinding{}).Where("id = ?", "pb-1").Count(&count).Error)
	require.Equal(t, int64(1), count, "binding must not be deleted by non-owner")
}
