package handler_test

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/agenthub/hub-server/internal/handler"
	"github.com/agenthub/hub-server/internal/service"
)

type mockSessionService struct {
	createPrivateFn        func(ctx context.Context, currentUserID, targetUserID string) (*service.CreateSessionResponse, error)
	createGroupFn          func(ctx context.Context, ownerUserID, name string, memberIDs []string) (*service.CreateSessionResponse, error)
	listFn                 func(ctx context.Context, userID string) ([]service.SessionListItem, error)
	addMembersFn           func(ctx context.Context, currentUserID, sessionID string, memberIDs []string) error
	removeMemberFn         func(ctx context.Context, currentUserID, sessionID, targetUserID string) error
	leaveFn                func(ctx context.Context, currentUserID, sessionID string) error
	transferOwnerFn        func(ctx context.Context, currentUserID, sessionID, newOwnerID string) error
	dissolveFn             func(ctx context.Context, currentUserID, sessionID string) error
	updateGroupInfoFn      func(ctx context.Context, currentUserID, sessionID string, name, avatarURL, announcement *string) error
	updateMemberSettingsFn func(ctx context.Context, currentUserID, sessionID string, pinned, archived, muted *bool) error
	deleteForMeFn          func(ctx context.Context, currentUserID, sessionID string) error
	searchFn               func(ctx context.Context, userID, q string) ([]service.SessionListItem, error)
}

func (m *mockSessionService) CreatePrivateSession(ctx context.Context, currentUserID, targetUserID string) (*service.CreateSessionResponse, error) {
	return m.createPrivateFn(ctx, currentUserID, targetUserID)
}
func (m *mockSessionService) CreateGroupSession(ctx context.Context, ownerUserID, name string, memberIDs []string) (*service.CreateSessionResponse, error) {
	return m.createGroupFn(ctx, ownerUserID, name, memberIDs)
}
func (m *mockSessionService) ListSessions(ctx context.Context, userID string) ([]service.SessionListItem, error) {
	return m.listFn(ctx, userID)
}
func (m *mockSessionService) AddGroupMembers(ctx context.Context, currentUserID, sessionID string, memberIDs []string) error {
	return m.addMembersFn(ctx, currentUserID, sessionID, memberIDs)
}
func (m *mockSessionService) RemoveGroupMember(ctx context.Context, currentUserID, sessionID, targetUserID string) error {
	return m.removeMemberFn(ctx, currentUserID, sessionID, targetUserID)
}
func (m *mockSessionService) LeaveGroup(ctx context.Context, currentUserID, sessionID string) error {
	return m.leaveFn(ctx, currentUserID, sessionID)
}
func (m *mockSessionService) TransferGroupOwnership(ctx context.Context, currentUserID, sessionID, newOwnerID string) error {
	return m.transferOwnerFn(ctx, currentUserID, sessionID, newOwnerID)
}
func (m *mockSessionService) DissolveGroup(ctx context.Context, currentUserID, sessionID string) error {
	return m.dissolveFn(ctx, currentUserID, sessionID)
}
func (m *mockSessionService) UpdateGroupInfo(ctx context.Context, currentUserID, sessionID string, name, avatarURL, announcement *string) error {
	return m.updateGroupInfoFn(ctx, currentUserID, sessionID, name, avatarURL, announcement)
}
func (m *mockSessionService) UpdateMemberSettings(ctx context.Context, currentUserID, sessionID string, pinned, archived, muted *bool) error {
	return m.updateMemberSettingsFn(ctx, currentUserID, sessionID, pinned, archived, muted)
}
func (m *mockSessionService) DeleteForMe(ctx context.Context, currentUserID, sessionID string) error {
	return m.deleteForMeFn(ctx, currentUserID, sessionID)
}
func (m *mockSessionService) SearchSessions(ctx context.Context, userID, q string) ([]service.SessionListItem, error) {
	return m.searchFn(ctx, userID, q)
}

func ptr[T any](v T) *T { return &v }

// ── CreatePrivate ───────────────────────────────────────────────────

func TestSessionHandler_CreatePrivate_Success(t *testing.T) {
	svc := &mockSessionService{
		createPrivateFn: func(ctx context.Context, currentUserID, targetUserID string) (*service.CreateSessionResponse, error) {
			return &service.CreateSessionResponse{SessionID: "s1", Type: "private", Created: true}, nil
		},
	}
	h := handler.NewSessionHandler(svc)

	c, w := newGinCtx("POST", "/client/sessions/private", map[string]string{"target_user_id": "u2"}, "user_id", "u1")
	h.CreatePrivate(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp handler.Response
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp.Code != "OK" {
		t.Fatalf("expected OK, got %s", resp.Code)
	}
}

func TestSessionHandler_CreatePrivate_BadRequest(t *testing.T) {
	svc := &mockSessionService{}
	h := handler.NewSessionHandler(svc)

	c, w := newGinCtx("POST", "/client/sessions/private", map[string]string{}, "user_id", "u1")
	h.CreatePrivate(c)

	if w.Code != 400 {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

// ── CreateGroup ─────────────────────────────────────────────────────

func TestSessionHandler_CreateGroup_Success(t *testing.T) {
	svc := &mockSessionService{
		createGroupFn: func(ctx context.Context, ownerUserID, name string, memberIDs []string) (*service.CreateSessionResponse, error) {
			return &service.CreateSessionResponse{SessionID: "g1", Type: "group", Created: true}, nil
		},
	}
	h := handler.NewSessionHandler(svc)

	c, w := newGinCtx("POST", "/client/sessions/group", map[string]any{
		"name":       "Test Group",
		"member_ids": []string{"u2", "u3"},
	}, "user_id", "u1")
	h.CreateGroup(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestSessionHandler_CreateGroup_BadRequest(t *testing.T) {
	svc := &mockSessionService{}
	h := handler.NewSessionHandler(svc)

	c, w := newGinCtx("POST", "/client/sessions/group", map[string]any{}, "user_id", "u1")
	h.CreateGroup(c)

	if w.Code != 400 {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

// ── List ────────────────────────────────────────────────────────────

func TestSessionHandler_List_Success(t *testing.T) {
	svc := &mockSessionService{
		listFn: func(ctx context.Context, userID string) ([]service.SessionListItem, error) {
			return []service.SessionListItem{
				{SessionID: "s1", Type: "private"},
			}, nil
		},
	}
	h := handler.NewSessionHandler(svc)

	c, w := newGinCtx("GET", "/client/sessions", nil, "user_id", "u1")
	h.List(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

// ── AddMembers ──────────────────────────────────────────────────────

func TestSessionHandler_AddMembers_Success(t *testing.T) {
	svc := &mockSessionService{
		addMembersFn: func(ctx context.Context, currentUserID, sessionID string, memberIDs []string) error { return nil },
	}
	h := handler.NewSessionHandler(svc)

	c, w := newGinCtx("POST", "/client/sessions/s1/members", map[string]any{
		"member_ids": []string{"u3"},
	}, "user_id", "u1")
	c.Params = gin.Params{{Key: "id", Value: "s1"}}
	h.AddMembers(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestSessionHandler_AddMembers_BadRequest(t *testing.T) {
	svc := &mockSessionService{}
	h := handler.NewSessionHandler(svc)

	c, w := newGinCtx("POST", "/client/sessions/s1/members", map[string]any{}, "user_id", "u1")
	c.Params = gin.Params{{Key: "id", Value: "s1"}}
	h.AddMembers(c)

	if w.Code != 400 {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

// ── RemoveMember ────────────────────────────────────────────────────

func TestSessionHandler_RemoveMember_Success(t *testing.T) {
	svc := &mockSessionService{
		removeMemberFn: func(ctx context.Context, currentUserID, sessionID, targetUserID string) error { return nil },
	}
	h := handler.NewSessionHandler(svc)

	c, w := newGinCtx("DELETE", "/client/sessions/s1/members/u2", nil, "user_id", "u1")
	c.Params = gin.Params{{Key: "id", Value: "s1"}, {Key: "user_id", Value: "u2"}}
	h.RemoveMember(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

// ── Leave ───────────────────────────────────────────────────────────

func TestSessionHandler_Leave_Success(t *testing.T) {
	svc := &mockSessionService{
		leaveFn: func(ctx context.Context, currentUserID, sessionID string) error { return nil },
	}
	h := handler.NewSessionHandler(svc)

	c, w := newGinCtx("POST", "/client/sessions/s1/leave", nil, "user_id", "u1")
	c.Params = gin.Params{{Key: "id", Value: "s1"}}
	h.Leave(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

// ── TransferOwner ───────────────────────────────────────────────────

func TestSessionHandler_TransferOwner_Success(t *testing.T) {
	svc := &mockSessionService{
		transferOwnerFn: func(ctx context.Context, currentUserID, sessionID, newOwnerID string) error { return nil },
	}
	h := handler.NewSessionHandler(svc)

	c, w := newGinCtx("POST", "/client/sessions/s1/transfer-owner", map[string]string{
		"new_owner_id": "u2",
	}, "user_id", "u1")
	c.Params = gin.Params{{Key: "id", Value: "s1"}}
	h.TransferOwner(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestSessionHandler_TransferOwner_BadRequest(t *testing.T) {
	svc := &mockSessionService{}
	h := handler.NewSessionHandler(svc)

	c, w := newGinCtx("POST", "/client/sessions/s1/transfer-owner", map[string]string{}, "user_id", "u1")
	c.Params = gin.Params{{Key: "id", Value: "s1"}}
	h.TransferOwner(c)

	if w.Code != 400 {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

// ── Dissolve ────────────────────────────────────────────────────────

func TestSessionHandler_Dissolve_Success(t *testing.T) {
	svc := &mockSessionService{
		dissolveFn: func(ctx context.Context, currentUserID, sessionID string) error { return nil },
	}
	h := handler.NewSessionHandler(svc)

	c, w := newGinCtx("POST", "/client/sessions/s1/dissolve", nil, "user_id", "u1")
	c.Params = gin.Params{{Key: "id", Value: "s1"}}
	h.Dissolve(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

// ── UpdateGroupInfo ─────────────────────────────────────────────────

func TestSessionHandler_UpdateGroupInfo_Success(t *testing.T) {
	svc := &mockSessionService{
		updateGroupInfoFn: func(ctx context.Context, currentUserID, sessionID string, name, avatarURL, announcement *string) error {
			return nil
		},
	}
	h := handler.NewSessionHandler(svc)

	c, w := newGinCtx("PUT", "/client/sessions/s1/info", map[string]string{
		"name": "New Name",
	}, "user_id", "u1")
	c.Params = gin.Params{{Key: "id", Value: "s1"}}
	h.UpdateGroupInfo(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestSessionHandler_UpdateGroupInfo_BadRequest(t *testing.T) {
	svc := &mockSessionService{}
	h := handler.NewSessionHandler(svc)

	c, w := newGinCtx("PUT", "/client/sessions/s1/info", "not-json", "user_id", "u1")
	c.Params = gin.Params{{Key: "id", Value: "s1"}}
	h.UpdateGroupInfo(c)

	if w.Code != 400 {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

// ── UpdateMemberSettings ────────────────────────────────────────────

func TestSessionHandler_UpdateMemberSettings_Success(t *testing.T) {
	svc := &mockSessionService{
		updateMemberSettingsFn: func(ctx context.Context, currentUserID, sessionID string, pinned, archived, muted *bool) error {
			return nil
		},
	}
	h := handler.NewSessionHandler(svc)

	c, w := newGinCtx("PUT", "/client/sessions/s1/settings", map[string]bool{
		"pinned": true,
		"muted":  false,
	}, "user_id", "u1")
	c.Params = gin.Params{{Key: "id", Value: "s1"}}
	h.UpdateMemberSettings(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestSessionHandler_UpdateMemberSettings_BadRequest(t *testing.T) {
	svc := &mockSessionService{}
	h := handler.NewSessionHandler(svc)

	c, w := newGinCtx("PUT", "/client/sessions/s1/settings", "bad", "user_id", "u1")
	c.Params = gin.Params{{Key: "id", Value: "s1"}}
	h.UpdateMemberSettings(c)

	if w.Code != 400 {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

// ── DeleteForMe ─────────────────────────────────────────────────────

func TestSessionHandler_DeleteForMe_Success(t *testing.T) {
	svc := &mockSessionService{
		deleteForMeFn: func(ctx context.Context, currentUserID, sessionID string) error { return nil },
	}
	h := handler.NewSessionHandler(svc)

	c, w := newGinCtx("DELETE", "/client/sessions/s1", nil, "user_id", "u1")
	c.Params = gin.Params{{Key: "id", Value: "s1"}}
	h.DeleteForMe(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

// ── SearchSessions ──────────────────────────────────────────────────

func TestSessionHandler_SearchSessions_Success(t *testing.T) {
	svc := &mockSessionService{
		searchFn: func(ctx context.Context, userID, q string) ([]service.SessionListItem, error) {
			return []service.SessionListItem{
				{SessionID: "s1", Type: "group", Name: "Test"},
			}, nil
		},
	}
	h := handler.NewSessionHandler(svc)

	c, w := newGinCtx("GET", "/client/sessions/search?q=test", nil, "user_id", "u1")
	c.Request.URL.RawQuery = "q=test"
	h.SearchSessions(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestSessionHandler_SearchSessions_EmptyQuery(t *testing.T) {
	svc := &mockSessionService{}
	h := handler.NewSessionHandler(svc)

	c, w := newGinCtx("GET", "/client/sessions/search", nil, "user_id", "u1")
	h.SearchSessions(c)

	if w.Code != 400 {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}
