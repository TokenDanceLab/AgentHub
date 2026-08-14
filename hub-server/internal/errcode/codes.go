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
	OK                = &Error{Code: "ok", Message: "", HTTPStatus: http.StatusOK}
	ErrInternal       = sharederr.ErrInternal
	ErrBadRequest     = sharederr.ErrBadRequest
	ErrTimeout        = sharederr.ErrTimeout
	ErrNotImplemented = sharederr.ErrNotImplemented
)

// --- Hub domain-specific codes ---

var (
	AuthInvalidToken       = New("auth_invalid_token", "token is invalid or expired", http.StatusUnauthorized)
	AuthInvalidCredentials = New("auth_invalid_credentials", "invalid username or password", http.StatusUnauthorized)
	AuthTokenExpired       = New("auth_token_expired", "token has expired", http.StatusUnauthorized)
	AuthDeviceMismatch     = New("auth_device_mismatch", "device type not allowed for this endpoint", http.StatusForbidden)
	AuthRefreshInvalid     = New("auth_refresh_invalid", "refresh token is invalid or revoked", http.StatusUnauthorized)

	MsgNotFound          = New("msg_not_found", "message not found", http.StatusNotFound)
	MsgRecallTimeout     = New("msg_recall_timeout", "recall window has expired", http.StatusBadRequest)
	MsgEditTimeout       = New("msg_edit_timeout", "edit window has expired", http.StatusBadRequest)
	MsgNotEditable       = New("msg_not_editable", "message cannot be edited", http.StatusBadRequest)
	MsgPinLimitExceeded  = New("msg_pin_limit_exceeded", "pin limit exceeded for this session", http.StatusBadRequest)
	MsgBlockedByReceiver = New("msg_blocked_by_receiver", "you have been blocked by the receiver", http.StatusForbidden)

	SessionNotFound  = New("session_not_found", "session not found", http.StatusNotFound)
	SessionDissolved = New("session_dissolved", "session has been dissolved", http.StatusGone)
	SessionNotMember = New("session_not_member", "you are not a member of this session", http.StatusForbidden)

	AgentNotFound      = New("agent_not_found", "agent not found", http.StatusNotFound)
	AgentOffline       = New("agent_offline", "agent runner is offline", http.StatusServiceUnavailable)
	AgentTaskNotFound  = New("agent_task_not_found", "agent task not found", http.StatusNotFound)
	AgentTaskCancelled = New("agent_task_cancelled", "task has been cancelled", http.StatusGone)
	AgentTaskTimeout   = New("agent_task_timeout", "task has timed out", http.StatusGone)
	// TurnInProgress signals that the agent instance already has a non-terminal
	// task (queued/dispatched/running). The frontend treats this 409 as
	// recoverable: keep the draft / optimistic message, do not show a hard
	// error toast. Granularity is per agent_instance, not per session (#1430).
	TurnInProgress    = New("turn_in_progress", "agent instance already has an active task", http.StatusConflict)
	TargetNotFound    = New("target_not_found", "execution target not found", http.StatusNotFound)
	TargetNotRoutable = New("target_not_routable", "execution target is not routable", http.StatusConflict)

	GroupNotOwner         = New("group_not_owner", "only group owner can perform this action", http.StatusForbidden)
	GroupOwnerCannotLeave = New("group_owner_cannot_leave", "group owner cannot leave, transfer or dissolve first", http.StatusBadRequest)
	GroupAlreadyMember    = New("group_already_member", "user is already a member", http.StatusConflict)

	TeamMemberAlready = New("team_member_already", "agent profile is already a member of this team", http.StatusConflict)
	TeamHasRuns       = New("team_has_runs", "team has run history and cannot be deleted", http.StatusConflict)

	UserNotFound      = New("user_not_found", "user not found", http.StatusNotFound)
	UserUsernameTaken = New("user_username_taken", "username is already taken", http.StatusConflict)
	UserInvalidParam  = New("user_invalid_param", "invalid user parameters", http.StatusBadRequest)

	FriendAlready         = New("friend_already", "already friends", http.StatusConflict)
	FriendBlocked         = New("friend_blocked", "blocked by user", http.StatusForbidden)
	FriendRequestNotFound = New("friend_request_not_found", "friend request not found", http.StatusNotFound)
	FriendRemarkNoRow     = New("friend_remark_no_row", "remark update affected no rows, friendship may not exist", http.StatusNotFound)
	FriendNotFriend       = New("friend_not_friend", "you are not friends with this user", http.StatusForbidden)

	AttachNotFound       = New("attach_not_found", "attachment not found", http.StatusNotFound)
	AttachTooLarge       = New("attach_too_large", "file exceeds maximum size", http.StatusRequestEntityTooLarge)
	AttachHashMismatch   = New("attach_hash_mismatch", "file hash does not match", http.StatusBadRequest)
	AttachTypeNotAllowed = New("attach_type_not_allowed", "file type is not allowed", http.StatusUnsupportedMediaType)

	NotifNotFound = New("notif_not_found", "notification not found", http.StatusNotFound)

	WsAuthTimeout = New("ws_auth_timeout", "ws authentication timeout", http.StatusUnauthorized)
	WsAuthFailed  = New("ws_auth_failed", "ws authentication failed", http.StatusUnauthorized)

	OIDCInvalidState       = New("oidc_invalid_state", "state is invalid or expired", http.StatusBadRequest)
	OIDCCodeExchangeFailed = New("oidc_code_exchange_failed", "failed to exchange authorization code", http.StatusBadRequest)
	OIDCIDTokenInvalid     = New("oidc_id_token_invalid", "id token validation failed", http.StatusBadRequest)
	OIDCSubNotFound        = New("oidc_sub_not_found", "no sub claim in id token", http.StatusBadRequest)

	DocNotFound       = New("doc_not_found", "document not found", http.StatusNotFound)
	DocAlreadyDeleted = New("doc_already_deleted", "document already deleted", http.StatusBadRequest)

	ErrUnauthorized = sharederr.ErrUnauthorized
	ErrForbidden    = sharederr.ErrForbidden
)
