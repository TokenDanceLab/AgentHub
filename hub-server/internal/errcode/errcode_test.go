package errcode

import (
	"net/http"
	"testing"
)

func TestErrorMethod(t *testing.T) {
	e := New("TEST_CODE", "test message", http.StatusBadRequest)
	if e.Error() != "TEST_CODE: test message" {
		t.Fatalf("Error() = %q, want %q", e.Error(), "TEST_CODE: test message")
	}
}

func TestNewError(t *testing.T) {
	e := New("CUSTOM", "custom message", http.StatusTeapot)
	if e.Code != "CUSTOM" {
		t.Errorf("Code = %q", e.Code)
	}
	if e.Message != "custom message" {
		t.Errorf("Message = %q", e.Message)
	}
	if e.HTTPStatus != http.StatusTeapot {
		t.Errorf("HTTPStatus = %d", e.HTTPStatus)
	}
}

func TestAllErrorsHaveNonEmptyCode(t *testing.T) {
	all := []*Error{
		OK, ErrInternal, ErrBadRequest, ErrTimeout,
		AuthInvalidToken, AuthTokenExpired, AuthDeviceMismatch, AuthRefreshInvalid,
		MsgNotFound, MsgRecallTimeout, MsgPinLimitExceeded, MsgBlockedByReceiver,
		SessionNotFound, SessionDissolved, SessionNotMember,
		AgentNotFound, AgentTaskNotFound, AgentTaskCancelled, AgentTaskTimeout, TurnInProgress, TargetNotFound, TargetNotRoutable,
		GroupNotOwner, GroupOwnerCannotLeave, GroupAlreadyMember,
		UserNotFound, UserUsernameTaken, UserInvalidParam,
		FriendAlready, FriendBlocked, FriendRequestNotFound, FriendRemarkNoRow, FriendNotFriend,
		AttachNotFound, AttachTooLarge, AttachHashMismatch, AttachTypeNotAllowed,
		NotifNotFound,

		OIDCInvalidState, OIDCCodeExchangeFailed, OIDCIDTokenInvalid, OIDCSubNotFound,
		DeviceLimitExceeded,
		ErrNotImplemented,
	}
	for _, e := range all {
		if e.Code == "" {
			t.Errorf("error with message %q has empty Code", e.Message)
		}
	}
}

func TestErrorIs(t *testing.T) {
	e := New("TEST", "msg", 400)
	if !e.Is(e) {
		t.Error("same error should match itself")
	}
	if e.Is(New("OTHER", "msg", 400)) {
		t.Error("different code should not match")
	}
	if ErrInternal.Is(ErrBadRequest) {
		t.Error("different sentinel errors should not match")
	}
}

func TestWithMessage(t *testing.T) {
	e := ErrBadRequest.WithMessage("custom")
	if e.Code != ErrBadRequest.Code {
		t.Errorf("Code = %q, want %q", e.Code, ErrBadRequest.Code)
	}
	if e.Message != "custom" {
		t.Errorf("Message = %q, want custom", e.Message)
	}
	if e.HTTPStatus != ErrBadRequest.HTTPStatus {
		t.Errorf("HTTPStatus = %d, want %d", e.HTTPStatus, ErrBadRequest.HTTPStatus)
	}
	if ErrBadRequest.Message != "invalid request" {
		t.Error("original error message was mutated")
	}
}
