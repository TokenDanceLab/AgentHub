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

func TestOK(t *testing.T) {
	if OK.Code != "OK" {
		t.Fatalf("OK.Code = %q, want OK", OK.Code)
	}
	if OK.HTTPStatus != http.StatusOK {
		t.Fatalf("OK.HTTPStatus = %d, want 200", OK.HTTPStatus)
	}
}

func TestErrInternal(t *testing.T) {
	if ErrInternal.HTTPStatus != http.StatusInternalServerError {
		t.Fatalf("ErrInternal.HTTPStatus = %d, want 500", ErrInternal.HTTPStatus)
	}
}

func TestAuthErrors(t *testing.T) {
	tests := []struct {
		name   string
		err    *Error
		code   string
		status int
	}{
		{"AuthInvalidToken", AuthInvalidToken, "AUTH_INVALID_TOKEN", http.StatusUnauthorized},
		{"AuthInvalidCredentials", AuthInvalidCredentials, "AUTH_INVALID_CREDENTIALS", http.StatusUnauthorized},
		{"AuthTokenExpired", AuthTokenExpired, "AUTH_TOKEN_EXPIRED", http.StatusUnauthorized},
		{"AuthDeviceMismatch", AuthDeviceMismatch, "AUTH_DEVICE_MISMATCH", http.StatusForbidden},
		{"AuthRefreshInvalid", AuthRefreshInvalid, "AUTH_REFRESH_INVALID", http.StatusUnauthorized},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.err.Code != tt.code {
				t.Errorf("Code = %q, want %q", tt.err.Code, tt.code)
			}
			if tt.err.HTTPStatus != tt.status {
				t.Errorf("HTTPStatus = %d, want %d", tt.err.HTTPStatus, tt.status)
			}
		})
	}
}

func TestMessageErrors(t *testing.T) {
	tests := []struct {
		name   string
		err    *Error
		code   string
		status int
	}{
		{"MsgNotFound", MsgNotFound, "MSG_NOT_FOUND", http.StatusNotFound},
		{"MsgRecallTimeout", MsgRecallTimeout, "MSG_RECALL_TIMEOUT", http.StatusBadRequest},
		{"MsgPinLimitExceeded", MsgPinLimitExceeded, "MSG_PIN_LIMIT_EXCEEDED", http.StatusBadRequest},
		{"MsgBlockedByReceiver", MsgBlockedByReceiver, "MSG_BLOCKED_BY_RECEIVER", http.StatusForbidden},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.err.Code != tt.code {
				t.Errorf("Code = %q, want %q", tt.err.Code, tt.code)
			}
			if tt.err.HTTPStatus != tt.status {
				t.Errorf("HTTPStatus = %d, want %d", tt.err.HTTPStatus, tt.status)
			}
		})
	}
}

func TestSessionErrors(t *testing.T) {
	if SessionNotFound.HTTPStatus != http.StatusNotFound {
		t.Errorf("SessionNotFound.HTTPStatus = %d", SessionNotFound.HTTPStatus)
	}
	if SessionDissolved.HTTPStatus != http.StatusGone {
		t.Errorf("SessionDissolved.HTTPStatus = %d", SessionDissolved.HTTPStatus)
	}
	if SessionNotMember.HTTPStatus != http.StatusForbidden {
		t.Errorf("SessionNotMember.HTTPStatus = %d", SessionNotMember.HTTPStatus)
	}
}

func TestAgentErrors(t *testing.T) {
	if AgentNotFound.HTTPStatus != http.StatusNotFound {
		t.Errorf("AgentNotFound.HTTPStatus = %d", AgentNotFound.HTTPStatus)
	}
	if AgentOffline.HTTPStatus != http.StatusServiceUnavailable {
		t.Errorf("AgentOffline.HTTPStatus = %d", AgentOffline.HTTPStatus)
	}
	if AgentTaskNotFound.HTTPStatus != http.StatusNotFound {
		t.Errorf("AgentTaskNotFound.HTTPStatus = %d", AgentTaskNotFound.HTTPStatus)
	}
}

func TestGroupErrors(t *testing.T) {
	if GroupNotOwner.HTTPStatus != http.StatusForbidden {
		t.Errorf("GroupNotOwner.HTTPStatus = %d", GroupNotOwner.HTTPStatus)
	}
	if GroupOwnerCannotLeave.HTTPStatus != http.StatusBadRequest {
		t.Errorf("GroupOwnerCannotLeave.HTTPStatus = %d", GroupOwnerCannotLeave.HTTPStatus)
	}
}

func TestUserErrors(t *testing.T) {
	if UserNotFound.HTTPStatus != http.StatusNotFound {
		t.Errorf("UserNotFound.HTTPStatus = %d", UserNotFound.HTTPStatus)
	}
	if UserUsernameTaken.HTTPStatus != http.StatusConflict {
		t.Errorf("UserUsernameTaken.HTTPStatus = %d", UserUsernameTaken.HTTPStatus)
	}
	if UserInvalidParam.HTTPStatus != http.StatusBadRequest {
		t.Errorf("UserInvalidParam.HTTPStatus = %d", UserInvalidParam.HTTPStatus)
	}
}

func TestFriendErrors(t *testing.T) {
	if FriendAlready.HTTPStatus != http.StatusConflict {
		t.Errorf("FriendAlready.HTTPStatus = %d", FriendAlready.HTTPStatus)
	}
	if FriendBlocked.HTTPStatus != http.StatusForbidden {
		t.Errorf("FriendBlocked.HTTPStatus = %d", FriendBlocked.HTTPStatus)
	}
}

func TestAttachmentErrors(t *testing.T) {
	if AttachNotFound.HTTPStatus != http.StatusNotFound {
		t.Errorf("AttachNotFound.HTTPStatus = %d", AttachNotFound.HTTPStatus)
	}
	if AttachTooLarge.HTTPStatus != http.StatusRequestEntityTooLarge {
		t.Errorf("AttachTooLarge.HTTPStatus = %d", AttachTooLarge.HTTPStatus)
	}
	if AttachHashMismatch.HTTPStatus != http.StatusBadRequest {
		t.Errorf("AttachHashMismatch.HTTPStatus = %d", AttachHashMismatch.HTTPStatus)
	}
}

func TestWSErrors(t *testing.T) {
	if WsAuthTimeout.HTTPStatus != http.StatusUnauthorized {
		t.Errorf("WsAuthTimeout.HTTPStatus = %d", WsAuthTimeout.HTTPStatus)
	}
	if WsAuthFailed.HTTPStatus != http.StatusUnauthorized {
		t.Errorf("WsAuthFailed.HTTPStatus = %d", WsAuthFailed.HTTPStatus)
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
		OK, ErrInternal, ErrBadRequest,
		AuthInvalidToken, AuthInvalidCredentials, AuthTokenExpired, AuthDeviceMismatch, AuthRefreshInvalid,
		MsgNotFound, MsgRecallTimeout, MsgPinLimitExceeded, MsgBlockedByReceiver,
		SessionNotFound, SessionDissolved, SessionNotMember,
		AgentNotFound, AgentOffline, AgentTaskNotFound, AgentTaskCancelled, AgentTaskTimeout,
		GroupNotOwner, GroupOwnerCannotLeave, GroupAlreadyMember,
		UserNotFound, UserUsernameTaken, UserInvalidParam,
		FriendAlready, FriendBlocked, FriendRequestNotFound,
		AttachNotFound, AttachTooLarge, AttachHashMismatch,
		NotifNotFound,
		WsAuthTimeout, WsAuthFailed,
	}
	for _, e := range all {
		if e.Code == "" {
			t.Errorf("error with message %q has empty Code", e.Message)
		}
	}
}
