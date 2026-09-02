package workspace

import (
	"context"
	"fmt"
	"sync/atomic"
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
	createWorkspaceTestSchema(t, db)
	return db
}

// newWorkspaceSharedTestDB opens a shared-cache in-memory database so
// concurrent callers see one database (plain ":memory:" gives each
// connection a private database). busy_timeout absorbs write contention.
// workspaceSharedFixtureSeq numbers each newWorkspaceSharedTestDB call (#2260).
var workspaceSharedFixtureSeq atomic.Uint64

func newWorkspaceSharedTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	// The fixed name made this ONE process-global database: createWorkspaceTestSchema
	// runs plain CREATE TABLE, so the second -count round (and the second test in
	// this package) died on "table workspaces already exists" (#2260). A unique
	// name per call plus close-on-cleanup keeps the shared-cache semantics the
	// concurrent callers need without leaking schema or rows across rounds.
	dsn := fmt.Sprintf("file:workspace-seq-race-%d?mode=memory&cache=shared&_pragma=busy_timeout(10000)", workspaceSharedFixtureSeq.Add(1))
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { _ = sqlDB.Close() })
	createWorkspaceTestSchema(t, db)
	return db
}

func createWorkspaceTestSchema(t *testing.T, db *gorm.DB) {
	t.Helper()
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
	require.NoError(t, db.Exec(`
		CREATE TABLE sessions (
			id TEXT PRIMARY KEY,
			type TEXT NOT NULL,
			name TEXT,
			avatar_url TEXT,
			announcement TEXT,
			owner_user_id TEXT,
			workspace_id TEXT,
			next_seq INTEGER NOT NULL DEFAULT 0,
			last_message_at DATETIME,
			dissolved BOOLEAN NOT NULL DEFAULT false,
			created_at DATETIME
		)
	`).Error)
	require.NoError(t, db.Exec(`
		CREATE TABLE session_members (
			id TEXT PRIMARY KEY,
			session_id TEXT NOT NULL,
			member_type TEXT NOT NULL,
			member_id TEXT NOT NULL,
			role TEXT NOT NULL,
			pinned BOOLEAN NOT NULL DEFAULT false,
			archived BOOLEAN NOT NULL DEFAULT false,
			muted BOOLEAN NOT NULL DEFAULT false,
			last_read_seq INTEGER NOT NULL DEFAULT 0,
			joined_at DATETIME,
			left_at DATETIME,
			updated_at DATETIME
		)
	`).Error)
	require.NoError(t, db.Exec(`
		CREATE TABLE messages (
			id TEXT PRIMARY KEY,
			session_id TEXT NOT NULL,
			seq_id INTEGER NOT NULL,
			client_msg_id TEXT NOT NULL,
			sender_type TEXT NOT NULL,
			sender_id TEXT NOT NULL,
			content_type TEXT NOT NULL,
			content TEXT NOT NULL,
			reply_to_message_id TEXT,
			recalled BOOLEAN NOT NULL DEFAULT false,
			edited BOOLEAN NOT NULL DEFAULT false,
			edited_at DATETIME,
			created_at DATETIME
		)
	`).Error)
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
	svc := NewService(db)

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
	svc := NewService(db)

	_, err := svc.Create(context.Background(), "owner-1", &model.Workspace{Name: "AgentHub"})
	require.ErrorIs(t, err, errcode.UserInvalidParam)

	_, err = svc.Create(context.Background(), "owner-2", &model.Workspace{Name: "AgentHub"})
	require.NoError(t, err)
}

func TestWorkspaceUpdateIsOwnerScopedAndChecksDuplicateName(t *testing.T) {
	db := newWorkspaceTestDB(t)
	seedWorkspace(t, db, "workspace-1", "owner-1", "First")
	seedWorkspace(t, db, "workspace-2", "owner-1", "Second")
	svc := NewService(db)

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
	svc := NewService(db)

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
	svc := NewService(db)

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

func TestWorkspaceProjectThreadsPreserveProjectAndMessageContext(t *testing.T) {
	db := newWorkspaceTestDB(t)
	seedWorkspace(t, db, "workspace-1", "owner-1", "AgentHub")
	svc := NewService(db)

	thread, err := svc.CreateThread(context.Background(), "workspace-1", "owner-1", &CreateWorkspaceThreadRequest{
		Name: "项目群",
	})
	require.NoError(t, err)
	require.Equal(t, "workspace-1", thread.ProjectID)
	require.Equal(t, model.SessionTypeGroup, thread.Type)
	require.Equal(t, "项目群", thread.Name)
	require.Equal(t, model.MemberRoleOwner, thread.Role)
	require.Equal(t, int64(1), thread.MemberCount)

	threads, err := svc.ListThreads(context.Background(), "workspace-1", "owner-1")
	require.NoError(t, err)
	require.Len(t, threads, 1)
	require.Equal(t, thread.ID, threads[0].ID)
	require.Equal(t, "workspace-1", threads[0].ProjectID)

	message, err := svc.CreateThreadMessage(context.Background(), "workspace-1", thread.ID, "owner-1", SendWorkspaceThreadMessageRequest{
		ClientMsgID: "00000000-0000-0000-0000-000000000c01",
		Content:     "保留项目线程上下文",
	})
	require.NoError(t, err)
	require.Equal(t, "workspace-1", message.ProjectID)
	require.Equal(t, thread.ID, message.ThreadID)
	require.Equal(t, int64(1), message.SeqID)

	messages, err := svc.ListThreadMessages(context.Background(), "workspace-1", thread.ID, "owner-1", 50)
	require.NoError(t, err)
	require.Len(t, messages, 1)
	require.Equal(t, "workspace-1", messages[0].ProjectID)
	require.Equal(t, thread.ID, messages[0].ThreadID)
	require.Equal(t, model.ContentTypeText, messages[0].ContentType)
	require.Equal(t, `{"text":"保留项目线程上下文"}`, messages[0].Content)
}

func TestWorkspaceProjectThreadMessagePreservesA2AMetadata(t *testing.T) {
	db := newWorkspaceTestDB(t)
	seedWorkspace(t, db, "workspace-1", "owner-1", "AgentHub")
	svc := NewService(db)

	thread, err := svc.CreateThread(context.Background(), "workspace-1", "owner-1", &CreateWorkspaceThreadRequest{Name: "项目群"})
	require.NoError(t, err)

	content := `{"text":"@Reviewer 请审查这个切片","metadata":{"im_kind":"project_group","mentions":[{"type":"agent","id":"agent-reviewer","display_name":"Reviewer"}],"orchestrator_queue":{"status":"queued","route":"review","correlation_id":"corr-1"}}}`
	message, err := svc.CreateThreadMessage(context.Background(), "workspace-1", thread.ID, "owner-1", SendWorkspaceThreadMessageRequest{
		ClientMsgID: "00000000-0000-0000-0000-000000000c02",
		Content:     content,
	})
	require.NoError(t, err)
	require.JSONEq(t, content, message.Content)

	messages, err := svc.ListThreadMessages(context.Background(), "workspace-1", thread.ID, "owner-1", 50)
	require.NoError(t, err)
	require.Len(t, messages, 1)
	require.JSONEq(t, content, messages[0].Content)
}

func TestWorkspaceProjectThreadsAreOwnerAndProjectScoped(t *testing.T) {
	db := newWorkspaceTestDB(t)
	seedWorkspace(t, db, "workspace-1", "owner-1", "AgentHub")
	seedWorkspace(t, db, "workspace-2", "owner-1", "Other")
	svc := NewService(db)

	thread, err := svc.CreateThread(context.Background(), "workspace-1", "owner-1", &CreateWorkspaceThreadRequest{Name: "项目群"})
	require.NoError(t, err)

	_, err = svc.ListThreads(context.Background(), "workspace-1", "other-owner")
	require.ErrorIs(t, err, errcode.AuthDeviceMismatch)

	_, err = svc.CreateThreadMessage(context.Background(), "workspace-2", thread.ID, "owner-1", SendWorkspaceThreadMessageRequest{
		ClientMsgID: "00000000-0000-0000-0000-000000000c03",
		Content:     "wrong project",
	})
	require.ErrorIs(t, err, errcode.SessionNotFound)
}

// TestWorkspaceThreadMessageSeqAllocatesWithoutRace pins the seq-allocation
// fix (#2154): concurrent sends in one thread must all succeed with a
// contiguous duplicate-free sequence (the old read-modify-write collided on
// the (session_id, seq_id) unique index under concurrency).
func TestWorkspaceThreadMessageSeqAllocatesWithoutRace(t *testing.T) {
	db := newWorkspaceSharedTestDB(t)
	seedWorkspace(t, db, "workspace-1", "owner-1", "AgentHub")
	svc := NewService(db)

	thread, err := svc.CreateThread(context.Background(), "workspace-1", "owner-1", &CreateWorkspaceThreadRequest{Name: "并发群"})
	require.NoError(t, err)

	const senders = 8
	errCh := make(chan error, senders)
	for i := 0; i < senders; i++ {
		go func(n int) {
			_, err := svc.CreateThreadMessage(context.Background(), "workspace-1", thread.ID, "owner-1", SendWorkspaceThreadMessageRequest{
				ClientMsgID: fmt.Sprintf("race-%d", n),
				Content:     "concurrent message",
			})
			errCh <- err
		}(i)
	}
	for i := 0; i < senders; i++ {
		require.NoError(t, <-errCh)
	}

	messages, err := svc.ListThreadMessages(context.Background(), "workspace-1", thread.ID, "owner-1", 100)
	require.NoError(t, err)
	require.Len(t, messages, senders)
	seen := map[int64]bool{}
	for _, m := range messages {
		require.False(t, seen[m.SeqID], "duplicate seq %d", m.SeqID)
		seen[m.SeqID] = true
	}
	for i := int64(1); i <= senders; i++ {
		require.True(t, seen[i], "missing seq %d (want contiguous 1..%d)", i, senders)
	}
}
