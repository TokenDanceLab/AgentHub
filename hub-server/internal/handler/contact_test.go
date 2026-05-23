package handler_test

import (
	"context"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/handler"
	"github.com/agenthub/hub-server/internal/service"
)

type mockContactService struct {
	searchUserFn        func(ctx context.Context, currentUserID, targetID string) (*service.SearchResult, error)
	sendFriendRequestFn func(ctx context.Context, userID, friendID, message string) error
	listFriendRequestsFn func(ctx context.Context, userID string) ([]service.RequestInfo, error)
	acceptFriendRequestFn func(ctx context.Context, userID, requestID string) error
	rejectFriendRequestFn func(ctx context.Context, userID, requestID string) error
	listContactsFn       func(ctx context.Context, userID string) ([]service.ContactInfo, error)
	removeContactFn      func(ctx context.Context, currentUserID, friendUserID string) error
	blockContactFn       func(ctx context.Context, currentUserID, targetUserID string) error
	unblockContactFn     func(ctx context.Context, currentUserID, targetUserID string) error
	updateRemarkFn       func(ctx context.Context, currentUserID, friendUserID, remark string) error
}

func (m *mockContactService) SearchUser(ctx context.Context, currentUserID, targetID string) (*service.SearchResult, error) {
	return m.searchUserFn(ctx, currentUserID, targetID)
}
func (m *mockContactService) SendFriendRequest(ctx context.Context, userID, friendID, message string) error {
	return m.sendFriendRequestFn(ctx, userID, friendID, message)
}
func (m *mockContactService) ListFriendRequests(ctx context.Context, userID string) ([]service.RequestInfo, error) {
	return m.listFriendRequestsFn(ctx, userID)
}
func (m *mockContactService) AcceptFriendRequest(ctx context.Context, userID, requestID string) error {
	return m.acceptFriendRequestFn(ctx, userID, requestID)
}
func (m *mockContactService) RejectFriendRequest(ctx context.Context, userID, requestID string) error {
	return m.rejectFriendRequestFn(ctx, userID, requestID)
}
func (m *mockContactService) ListContacts(ctx context.Context, userID string) ([]service.ContactInfo, error) {
	return m.listContactsFn(ctx, userID)
}
func (m *mockContactService) RemoveContact(ctx context.Context, currentUserID, friendUserID string) error {
	return m.removeContactFn(ctx, currentUserID, friendUserID)
}
func (m *mockContactService) BlockContact(ctx context.Context, currentUserID, targetUserID string) error {
	return m.blockContactFn(ctx, currentUserID, targetUserID)
}
func (m *mockContactService) UnblockContact(ctx context.Context, currentUserID, targetUserID string) error {
	return m.unblockContactFn(ctx, currentUserID, targetUserID)
}
func (m *mockContactService) UpdateRemark(ctx context.Context, currentUserID, friendUserID, remark string) error {
	return m.updateRemarkFn(ctx, currentUserID, friendUserID, remark)
}

// ── SearchUser ──────────────────────────────────────────────────────

func TestContactHandler_SearchUser_Success(t *testing.T) {
	svc := &mockContactService{
		searchUserFn: func(ctx context.Context, currentUserID, targetID string) (*service.SearchResult, error) {
			return &service.SearchResult{UserID: "u2", Username: "friend", Nickname: "Friend", Relationship: "stranger"}, nil
		},
	}
	h := handler.NewContactHandler(svc)

	c, w := newGinCtx("GET", "/client/contacts/search?id=u2", nil, "user_id", "u1")
	c.Request.URL.RawQuery = "id=u2"
	h.SearchUser(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestContactHandler_SearchUser_EmptyID(t *testing.T) {
	svc := &mockContactService{}
	h := handler.NewContactHandler(svc)

	c, w := newGinCtx("GET", "/client/contacts/search", nil, "user_id", "u1")
	h.SearchUser(c)

	if w.Code != 400 {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestContactHandler_SearchUser_NotFound(t *testing.T) {
	svc := &mockContactService{
		searchUserFn: func(ctx context.Context, currentUserID, targetID string) (*service.SearchResult, error) {
			return nil, errcode.UserNotFound
		},
	}
	h := handler.NewContactHandler(svc)

	c, w := newGinCtx("GET", "/client/contacts/search?id=nonexistent", nil, "user_id", "u1")
	c.Request.URL.RawQuery = "id=nonexistent"
	h.SearchUser(c)

	if w.Code != 404 {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

// ── SendFriendRequest ───────────────────────────────────────────────

func TestContactHandler_SendFriendRequest_Success(t *testing.T) {
	svc := &mockContactService{
		sendFriendRequestFn: func(ctx context.Context, userID, friendID, message string) error { return nil },
	}
	h := handler.NewContactHandler(svc)

	c, w := newGinCtx("POST", "/client/contacts/friend-requests", map[string]string{
		"friend_id": "u2",
		"message":   "Hello!",
	}, "user_id", "u1")
	h.SendFriendRequest(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestContactHandler_SendFriendRequest_BadRequest(t *testing.T) {
	svc := &mockContactService{}
	h := handler.NewContactHandler(svc)

	c, w := newGinCtx("POST", "/client/contacts/friend-requests", map[string]string{}, "user_id", "u1")
	h.SendFriendRequest(c)

	if w.Code != 400 {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestContactHandler_SendFriendRequest_AlreadyFriend(t *testing.T) {
	svc := &mockContactService{
		sendFriendRequestFn: func(ctx context.Context, userID, friendID, message string) error {
			return errcode.FriendAlready
		},
	}
	h := handler.NewContactHandler(svc)

	c, w := newGinCtx("POST", "/client/contacts/friend-requests", map[string]string{
		"friend_id": "u2",
	}, "user_id", "u1")
	h.SendFriendRequest(c)

	if w.Code != 409 {
		t.Fatalf("expected 409, got %d", w.Code)
	}
}

// ── ListFriendRequests ──────────────────────────────────────────────

func TestContactHandler_ListFriendRequests_Success(t *testing.T) {
	svc := &mockContactService{
		listFriendRequestsFn: func(ctx context.Context, userID string) ([]service.RequestInfo, error) {
			return []service.RequestInfo{
				{RequestID: "r1", UserID: "u2", Username: "friend", Nickname: "Friend", Message: "Hi", CreatedAt: "2026-01-01T00:00:00Z"},
			}, nil
		},
	}
	h := handler.NewContactHandler(svc)

	c, w := newGinCtx("GET", "/client/contacts/friend-requests", nil, "user_id", "u1")
	h.ListFriendRequests(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

// ── AcceptFriendRequest ─────────────────────────────────────────────

func TestContactHandler_AcceptFriendRequest_Success(t *testing.T) {
	svc := &mockContactService{
		acceptFriendRequestFn: func(ctx context.Context, userID, requestID string) error { return nil },
	}
	h := handler.NewContactHandler(svc)

	c, w := newGinCtx("POST", "/client/contacts/friend-requests/r1/accept", nil, "user_id", "u1")
	gin.SetMode(gin.TestMode)
	c.Params = gin.Params{{Key: "id", Value: "r1"}}
	h.AcceptFriendRequest(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestContactHandler_AcceptFriendRequest_NotFound(t *testing.T) {
	svc := &mockContactService{
		acceptFriendRequestFn: func(ctx context.Context, userID, requestID string) error {
			return errcode.FriendRequestNotFound
		},
	}
	h := handler.NewContactHandler(svc)

	c, w := newGinCtx("POST", "/client/contacts/friend-requests/r1/accept", nil, "user_id", "u1")
	c.Params = gin.Params{{Key: "id", Value: "bad"}}
	h.AcceptFriendRequest(c)

	if w.Code != 404 {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

// ── RejectFriendRequest ─────────────────────────────────────────────

func TestContactHandler_RejectFriendRequest_Success(t *testing.T) {
	svc := &mockContactService{
		rejectFriendRequestFn: func(ctx context.Context, userID, requestID string) error { return nil },
	}
	h := handler.NewContactHandler(svc)

	c, w := newGinCtx("POST", "/client/contacts/friend-requests/r1/reject", nil, "user_id", "u1")
	c.Params = gin.Params{{Key: "id", Value: "r1"}}
	h.RejectFriendRequest(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

// ── ListContacts ────────────────────────────────────────────────────

func TestContactHandler_ListContacts_Success(t *testing.T) {
	svc := &mockContactService{
		listContactsFn: func(ctx context.Context, userID string) ([]service.ContactInfo, error) {
			return []service.ContactInfo{
				{UserID: "u2", Username: "friend", Nickname: "Friend", Online: true, Type: "user"},
			}, nil
		},
	}
	h := handler.NewContactHandler(svc)

	c, w := newGinCtx("GET", "/client/contacts", nil, "user_id", "u1")
	h.ListContacts(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

// ── RemoveContact ───────────────────────────────────────────────────

func TestContactHandler_RemoveContact_Success(t *testing.T) {
	svc := &mockContactService{
		removeContactFn: func(ctx context.Context, currentUserID, friendUserID string) error { return nil },
	}
	h := handler.NewContactHandler(svc)

	c, w := newGinCtx("DELETE", "/client/contacts/u2", nil, "user_id", "u1")
	c.Params = gin.Params{{Key: "user_id", Value: "u2"}}
	h.RemoveContact(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

// ── BlockContact ────────────────────────────────────────────────────

func TestContactHandler_BlockContact_Success(t *testing.T) {
	svc := &mockContactService{
		blockContactFn: func(ctx context.Context, currentUserID, targetUserID string) error { return nil },
	}
	h := handler.NewContactHandler(svc)

	c, w := newGinCtx("POST", "/client/contacts/u2/block", nil, "user_id", "u1")
	c.Params = gin.Params{{Key: "user_id", Value: "u2"}}
	h.BlockContact(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

// ── UnblockContact ──────────────────────────────────────────────────

func TestContactHandler_UnblockContact_Success(t *testing.T) {
	svc := &mockContactService{
		unblockContactFn: func(ctx context.Context, currentUserID, targetUserID string) error { return nil },
	}
	h := handler.NewContactHandler(svc)

	c, w := newGinCtx("POST", "/client/contacts/u2/unblock", nil, "user_id", "u1")
	c.Params = gin.Params{{Key: "user_id", Value: "u2"}}
	h.UnblockContact(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

// ── UpdateRemark ────────────────────────────────────────────────────

func TestContactHandler_UpdateRemark_Success(t *testing.T) {
	svc := &mockContactService{
		updateRemarkFn: func(ctx context.Context, currentUserID, friendUserID, remark string) error { return nil },
	}
	h := handler.NewContactHandler(svc)

	c, w := newGinCtx("PUT", "/client/contacts/u2/remark", map[string]string{
		"remark": "Best friend",
	}, "user_id", "u1")
	c.Params = gin.Params{{Key: "user_id", Value: "u2"}}
	h.UpdateRemark(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestContactHandler_UpdateRemark_BadRequest(t *testing.T) {
	svc := &mockContactService{}
	h := handler.NewContactHandler(svc)

	c, w := newGinCtx("PUT", "/client/contacts/u2/remark", map[string]string{}, "user_id", "u1")
	c.Params = gin.Params{{Key: "user_id", Value: "u2"}}
	h.UpdateRemark(c)

	if w.Code != 400 {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}
