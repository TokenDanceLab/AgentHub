package service

import (
	"context"
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
)

func newWorkspaceTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.Exec(`
		CREATE TABLE workspaces (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			description TEXT,
			owner_id TEXT NOT NULL,
			created_at DATETIME,
			updated_at DATETIME
		)
	`).Error)
	return db
}

func seedWorkspace(t *testing.T, db *gorm.DB, id, ownerID, name string) {
	t.Helper()
	require.NoError(t, db.Create(&model.Workspace{
		ID:          id,
		OwnerID:     ownerID,
		Name:        name,
		Description: "Project " + name,
	}).Error)
}

func TestWorkspaceCreateRequiresNameAndOwnerScope(t *testing.T) {
	db := newWorkspaceTestDB(t)
	svc := NewWorkspaceService(db)

	_, err := svc.Create(context.Background(), "owner-1", &model.Workspace{Name: "   "})
	require.ErrorIs(t, err, errcode.ErrBadRequest)

	workspace, err := svc.Create(context.Background(), "owner-1", &model.Workspace{
		Name:        "  AgentHub Demo  ",
		Description: "  E2E workspace  ",
	})
	require.NoError(t, err)
	require.Equal(t, "owner-1", workspace.OwnerID)
	require.Equal(t, "AgentHub Demo", workspace.Name)
	require.Equal(t, "E2E workspace", workspace.Description)

	_, err = svc.Get(context.Background(), workspace.ID, "other-owner")
	require.ErrorIs(t, err, errcode.AuthDeviceMismatch)
}

func TestWorkspaceCreateRejectsDuplicateOwnerName(t *testing.T) {
	db := newWorkspaceTestDB(t)
	seedWorkspace(t, db, "workspace-1", "owner-1", "AgentHub")
	svc := NewWorkspaceService(db)

	_, err := svc.Create(context.Background(), "owner-1", &model.Workspace{Name: "AgentHub"})
	require.ErrorIs(t, err, errcode.UserInvalidParam)

	_, err = svc.Create(context.Background(), "owner-2", &model.Workspace{Name: "AgentHub"})
	require.NoError(t, err)
}

func TestWorkspaceUpdateIsOwnerScopedAndChecksDuplicateName(t *testing.T) {
	db := newWorkspaceTestDB(t)
	seedWorkspace(t, db, "workspace-1", "owner-1", "First")
	seedWorkspace(t, db, "workspace-2", "owner-1", "Second")
	svc := NewWorkspaceService(db)

	updatedName := "Updated"
	_, err := svc.Update(context.Background(), "workspace-1", "other-owner", &WorkspaceUpdate{Name: &updatedName})
	require.ErrorIs(t, err, errcode.AuthDeviceMismatch)

	duplicateName := "Second"
	_, err = svc.Update(context.Background(), "workspace-1", "owner-1", &WorkspaceUpdate{Name: &duplicateName})
	require.ErrorIs(t, err, errcode.UserInvalidParam)

	nextName := " Updated "
	nextDescription := " New description "
	workspace, err := svc.Update(context.Background(), "workspace-1", "owner-1", &WorkspaceUpdate{
		Name:        &nextName,
		Description: &nextDescription,
	})
	require.NoError(t, err)
	require.Equal(t, "Updated", workspace.Name)
	require.Equal(t, "New description", workspace.Description)
}

func TestWorkspaceUpdatePreservesOmittedFieldsAndAllowsExplicitDescriptionClear(t *testing.T) {
	db := newWorkspaceTestDB(t)
	seedWorkspace(t, db, "workspace-1", "owner-1", "First")
	svc := NewWorkspaceService(db)

	nextName := "Renamed"
	workspace, err := svc.Update(context.Background(), "workspace-1", "owner-1", &WorkspaceUpdate{Name: &nextName})
	require.NoError(t, err)
	require.Equal(t, "Renamed", workspace.Name)
	require.Equal(t, "Project First", workspace.Description)

	emptyDescription := ""
	workspace, err = svc.Update(context.Background(), "workspace-1", "owner-1", &WorkspaceUpdate{Description: &emptyDescription})
	require.NoError(t, err)
	require.Equal(t, "Renamed", workspace.Name)
	require.Empty(t, workspace.Description)

	blankName := "  "
	_, err = svc.Update(context.Background(), "workspace-1", "owner-1", &WorkspaceUpdate{Name: &blankName})
	require.ErrorIs(t, err, errcode.ErrBadRequest)
}

func TestWorkspaceListSupportsOwnerScopeSearchAndPagination(t *testing.T) {
	db := newWorkspaceTestDB(t)
	seedWorkspace(t, db, "workspace-1", "owner-1", "Alpha")
	seedWorkspace(t, db, "workspace-2", "owner-1", "Beta")
	seedWorkspace(t, db, "workspace-3", "owner-1", "Gamma")
	seedWorkspace(t, db, "workspace-4", "owner-2", "Alpha")
	svc := NewWorkspaceService(db)

	page, err := svc.List(context.Background(), "owner-1", "", "", 2)
	require.NoError(t, err)
	require.Len(t, page.Items, 2)
	require.True(t, page.HasMore)
	require.Equal(t, "workspace-2", page.Cursor)

	next, err := svc.List(context.Background(), "owner-1", "", page.Cursor, 2)
	require.NoError(t, err)
	require.Len(t, next.Items, 1)
	require.False(t, next.HasMore)
	require.Equal(t, "workspace-3", next.Items[0].ID)

	search, err := svc.List(context.Background(), "owner-1", "alp", "", 50)
	require.NoError(t, err)
	require.Len(t, search.Items, 1)
	require.Equal(t, "workspace-1", search.Items[0].ID)
}
