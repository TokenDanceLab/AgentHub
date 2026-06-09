package errcode

import (
	"net/http"

	sharederr "github.com/agenthub/pkg/errcode"
)

// Error re-exports the shared error type so all existing code using
// *errcode.Error continues to compile without changes.
type Error = sharederr.Error

// New re-exports the shared constructor for domain-specific codes.
func New(code, message string, httpStatus int) *Error {
	return sharederr.New(code, message, httpStatus)
}

// --- Common codes (re-exported) ---

var (
	OK                = &Error{Code: "OK", Message: "", HTTPStatus: http.StatusOK}
	ErrInternal       = sharederr.ErrInternal
	ErrBadRequest     = sharederr.ErrBadRequest
	ErrTimeout        = sharederr.ErrTimeout
	ErrNotImplemented = sharederr.ErrNotImplemented
)

// --- Hub domain-specific codes ---

var (
	AuthInvalidToken       = New("AUTH_INVALID_TOKEN", "token is invalid or expired", http.StatusUnauthorized)
	AuthInvalidCredentials = New("AUTH_INVALID_CREDENTIALS", "invalid username or password", http.StatusUnauthorized)
	AuthTokenExpired       = New("AUTH_TOKEN_EXPIRED", "token has expired", http.StatusUnauthorized)
	AuthDeviceMismatch     = New("AUTH_DEVICE_MISMATCH", "device type not allowed for this endpoint", http.StatusForbidden)
	AuthRefreshInvalid     = New("AUTH_REFRESH_INVALID", "refresh token is invalid or revoked", http.StatusUnauthorized)

	MsgNotFound          = New("MSG_NOT_FOUND", "message not found", http.StatusNotFound)
	MsgRecallTimeout     = New("MSG_RECALL_TIMEOUT", "recall window has expired", http.StatusBadRequest)
	MsgEditTimeout       = New("MSG_EDIT_TIMEOUT", "edit window has expired", http.StatusBadRequest)
	MsgNotEditable       = New("MSG_NOT_EDITABLE", "message cannot be edited", http.StatusBadRequest)
	MsgPinLimitExceeded  = New("MSG_PIN_LIMIT_EXCEEDED", "pin limit exceeded for this session", http.StatusBadRequest)
	MsgBlockedByReceiver = New("MSG_BLOCKED_BY_RECEIVER", "you have been blocked by the receiver", http.StatusForbidden)

	SessionNotFound  = New("SESSION_NOT_FOUND", "session not found", http.StatusNotFound)
	SessionDissolved = New("SESSION_DISSOLVED", "session has been dissolved", http.StatusGone)
	SessionNotMember = New("SESSION_NOT_MEMBER", "you are not a member of this session", http.StatusForbidden)

	AgentNotFound      = New("AGENT_NOT_FOUND", "agent not found", http.StatusNotFound)
	AgentOffline       = New("AGENT_OFFLINE", "agent runner is offline", http.StatusServiceUnavailable)
	AgentTaskNotFound  = New("AGENT_TASK_NOT_FOUND", "agent task not found", http.StatusNotFound)
	AgentTaskCancelled = New("AGENT_TASK_CANCELLED", "task has been cancelled", http.StatusGone)
	AgentTaskTimeout   = New("AGENT_TASK_TIMEOUT", "task has timed out", http.StatusGone)
	TargetNotFound     = New("TARGET_NOT_FOUND", "execution target not found", http.StatusNotFound)
	TargetNotRoutable  = New("TARGET_NOT_ROUTABLE", "execution target is not routable", http.StatusConflict)

	GroupNotOwner         = New("GROUP_NOT_OWNER", "only group owner can perform this action", http.StatusForbidden)
	GroupOwnerCannotLeave = New("GROUP_OWNER_CANNOT_LEAVE", "group owner cannot leave, transfer or dissolve first", http.StatusBadRequest)
	GroupAlreadyMember    = New("GROUP_ALREADY_MEMBER", "user is already a member", http.StatusConflict)

	UserNotFound      = New("USER_NOT_FOUND", "user not found", http.StatusNotFound)
	UserUsernameTaken = New("USER_USERNAME_TAKEN", "username is already taken", http.StatusConflict)
	UserInvalidParam  = New("USER_INVALID_PARAM", "invalid user parameters", http.StatusBadRequest)

	FriendAlready         = New("FRIEND_ALREADY", "already friends", http.StatusConflict)
	FriendBlocked         = New("FRIEND_BLOCKED", "blocked by user", http.StatusForbidden)
	FriendRequestNotFound = New("FRIEND_REQUEST_NOT_FOUND", "friend request not found", http.StatusNotFound)
	FriendRemarkNoRow     = New("FRIEND_REMARK_NO_ROW", "remark update affected no rows, friendship may not exist", http.StatusNotFound)
	FriendNotFriend       = New("FRIEND_NOT_FRIEND", "you are not friends with this user", http.StatusForbidden)

	AttachNotFound       = New("ATTACH_NOT_FOUND", "attachment not found", http.StatusNotFound)
	AttachTooLarge       = New("ATTACH_TOO_LARGE", "file exceeds maximum size", http.StatusRequestEntityTooLarge)
	AttachHashMismatch   = New("ATTACH_HASH_MISMATCH", "file hash does not match", http.StatusBadRequest)
	AttachTypeNotAllowed = New("ATTACH_TYPE_NOT_ALLOWED", "file type is not allowed", http.StatusUnsupportedMediaType)

	NotifNotFound = New("NOTIF_NOT_FOUND", "notification not found", http.StatusNotFound)

	WsAuthTimeout = New("WS_AUTH_TIMEOUT", "ws authentication timeout", http.StatusUnauthorized)
	WsAuthFailed  = New("WS_AUTH_FAILED", "ws authentication failed", http.StatusUnauthorized)

	OIDCInvalidState       = New("OIDC_INVALID_STATE", "state is invalid or expired", http.StatusBadRequest)
	OIDCCodeExchangeFailed = New("OIDC_CODE_EXCHANGE_FAILED", "failed to exchange authorization code", http.StatusBadRequest)
	OIDCIDTokenInvalid     = New("OIDC_ID_TOKEN_INVALID", "id token validation failed", http.StatusBadRequest)
	OIDCSubNotFound        = New("OIDC_SUB_NOT_FOUND", "no sub claim in id token", http.StatusBadRequest)
)
