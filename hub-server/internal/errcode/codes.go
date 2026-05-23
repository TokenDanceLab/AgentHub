package errcode

import "net/http"

type Error struct {
	Code       string `json:"code"`
	Message    string `json:"message"`
	HTTPStatus int    `json:"-"`
}

func (e *Error) Error() string {
	return e.Code + ": " + e.Message
}

func New(code, message string, httpStatus int) *Error {
	return &Error{Code: code, Message: message, HTTPStatus: httpStatus}
}

var (
	OK          = &Error{Code: "OK", Message: "", HTTPStatus: http.StatusOK}
	ErrInternal = &Error{Code: "INTERNAL_ERROR", Message: "internal server error", HTTPStatus: http.StatusInternalServerError}
	ErrBadRequest = &Error{Code: "BAD_REQUEST", Message: "invalid request", HTTPStatus: http.StatusBadRequest}

	AuthInvalidToken       = &Error{Code: "AUTH_INVALID_TOKEN", Message: "token is invalid or expired", HTTPStatus: http.StatusUnauthorized}
	AuthInvalidCredentials = &Error{Code: "AUTH_INVALID_CREDENTIALS", Message: "invalid username or password", HTTPStatus: http.StatusUnauthorized}
	AuthTokenExpired       = &Error{Code: "AUTH_TOKEN_EXPIRED", Message: "token has expired", HTTPStatus: http.StatusUnauthorized}
	AuthDeviceMismatch     = &Error{Code: "AUTH_DEVICE_MISMATCH", Message: "device type not allowed for this endpoint", HTTPStatus: http.StatusForbidden}
	AuthRefreshInvalid     = &Error{Code: "AUTH_REFRESH_INVALID", Message: "refresh token is invalid or revoked", HTTPStatus: http.StatusUnauthorized}

	MsgNotFound          = &Error{Code: "MSG_NOT_FOUND", Message: "message not found", HTTPStatus: http.StatusNotFound}
	MsgRecallTimeout     = &Error{Code: "MSG_RECALL_TIMEOUT", Message: "recall window has expired", HTTPStatus: http.StatusBadRequest}
	MsgPinLimitExceeded  = &Error{Code: "MSG_PIN_LIMIT_EXCEEDED", Message: "pin limit exceeded for this session", HTTPStatus: http.StatusBadRequest}
	MsgBlockedByReceiver = &Error{Code: "MSG_BLOCKED_BY_RECEIVER", Message: "you have been blocked by the receiver", HTTPStatus: http.StatusForbidden}

	SessionNotFound  = &Error{Code: "SESSION_NOT_FOUND", Message: "session not found", HTTPStatus: http.StatusNotFound}
	SessionDissolved = &Error{Code: "SESSION_DISSOLVED", Message: "session has been dissolved", HTTPStatus: http.StatusGone}
	SessionNotMember = &Error{Code: "SESSION_NOT_MEMBER", Message: "you are not a member of this session", HTTPStatus: http.StatusForbidden}

	AgentNotFound      = &Error{Code: "AGENT_NOT_FOUND", Message: "agent not found", HTTPStatus: http.StatusNotFound}
	AgentOffline       = &Error{Code: "AGENT_OFFLINE", Message: "agent runner is offline", HTTPStatus: http.StatusServiceUnavailable}
	AgentTaskNotFound  = &Error{Code: "AGENT_TASK_NOT_FOUND", Message: "agent task not found", HTTPStatus: http.StatusNotFound}
	AgentTaskCancelled = &Error{Code: "AGENT_TASK_CANCELLED", Message: "task has been cancelled", HTTPStatus: http.StatusGone}
	AgentTaskTimeout   = &Error{Code: "AGENT_TASK_TIMEOUT", Message: "task has timed out", HTTPStatus: http.StatusGone}

	GroupNotOwner         = &Error{Code: "GROUP_NOT_OWNER", Message: "only group owner can perform this action", HTTPStatus: http.StatusForbidden}
	GroupOwnerCannotLeave = &Error{Code: "GROUP_OWNER_CANNOT_LEAVE", Message: "group owner cannot leave, transfer or dissolve first", HTTPStatus: http.StatusBadRequest}
	GroupAlreadyMember    = &Error{Code: "GROUP_ALREADY_MEMBER", Message: "user is already a member", HTTPStatus: http.StatusConflict}

	UserNotFound      = &Error{Code: "USER_NOT_FOUND", Message: "user not found", HTTPStatus: http.StatusNotFound}
	UserUsernameTaken = &Error{Code: "USER_USERNAME_TAKEN", Message: "username is already taken", HTTPStatus: http.StatusConflict}
	UserInvalidParam  = &Error{Code: "USER_INVALID_PARAM", Message: "invalid user parameters", HTTPStatus: http.StatusBadRequest}

	FriendAlready         = &Error{Code: "FRIEND_ALREADY", Message: "already friends", HTTPStatus: http.StatusConflict}
	FriendBlocked         = &Error{Code: "FRIEND_BLOCKED", Message: "blocked by user", HTTPStatus: http.StatusForbidden}
	FriendRequestNotFound = &Error{Code: "FRIEND_REQUEST_NOT_FOUND", Message: "friend request not found", HTTPStatus: http.StatusNotFound}

	AttachNotFound    = &Error{Code: "ATTACH_NOT_FOUND", Message: "attachment not found", HTTPStatus: http.StatusNotFound}
	AttachTooLarge    = &Error{Code: "ATTACH_TOO_LARGE", Message: "file exceeds maximum size", HTTPStatus: http.StatusRequestEntityTooLarge}
	AttachHashMismatch = &Error{Code: "ATTACH_HASH_MISMATCH", Message: "file hash does not match", HTTPStatus: http.StatusBadRequest}

	NotifNotFound = &Error{Code: "NOTIF_NOT_FOUND", Message: "notification not found", HTTPStatus: http.StatusNotFound}

	WsAuthTimeout = &Error{Code: "WS_AUTH_TIMEOUT", Message: "ws authentication timeout", HTTPStatus: http.StatusUnauthorized}
	WsAuthFailed  = &Error{Code: "WS_AUTH_FAILED", Message: "ws authentication failed", HTTPStatus: http.StatusUnauthorized}
)
