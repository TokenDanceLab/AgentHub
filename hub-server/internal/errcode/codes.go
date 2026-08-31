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

// --- HTTP status design principles (状态码设计原则) ---
// 401 Unauthorized: 凭证本身无效或过期（auth_invalid_token/auth_token_expired）。
// 400 Bad Request: 客户端请求参数/状态错误，与凭证有效性无关（oidc_invalid_state/msg_recall_timeout/msg_edit_timeout）。
// 410 Gone: 资源生命周期终结，已不可恢复（agent_task_timeout/agent_task_cancelled/session_dissolved）。
// 403 Forbidden: 凭证有效但无权限（auth_device_mismatch/msg_blocked_by_receiver/session_not_member）。
// 502 Bad Gateway: 上游响应内容不合法（oidc_sub_not_found：IdP 返回的 id_token 缺 sub claim）。
// 503 Service Unavailable: 服务/依赖未就绪（agent_offline）。
// 新码归属到上面的对应类别；不在任何 HTTP 请求中产生的码不注册于此。

// --- Hub domain-specific codes ---

var (
	AuthInvalidToken = New("auth_invalid_token", "token is invalid or expired", http.StatusUnauthorized)
	// AuthTokenExpired 当前无 Go 生产路径产生，但客户端错误上报契约仍映射该码
	// （app/shared/src/errorReporting.ts），保留以保证契约可追溯。
	AuthTokenExpired   = New("auth_token_expired", "token has expired", http.StatusUnauthorized)
	AuthDeviceMismatch = New("auth_device_mismatch", "device type not allowed for this endpoint", http.StatusForbidden)
	AuthRefreshInvalid = New("auth_refresh_invalid", "refresh token is invalid or revoked", http.StatusUnauthorized)

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

	// OIDC 错误码与前端 SSOT 同步（#2123 P1-2）：本节每增删一个 oidc_* code，
	// 必须同步 app/shared/src/api/auth/types.ts 的 OidcBackendErrorCodes；
	// CI `scripts/verify/verify-oidc-code-ssot.py` 校验两侧集合一致。
	OIDCInvalidState       = New("oidc_invalid_state", "state is invalid or expired", http.StatusBadRequest)
	OIDCCodeExchangeFailed = New("oidc_code_exchange_failed", "failed to exchange authorization code", http.StatusBadRequest)
	OIDCIDTokenInvalid     = New("oidc_id_token_invalid", "id token validation failed", http.StatusBadRequest)
	OIDCSubNotFound        = New("oidc_sub_not_found", "no sub claim in id token", http.StatusBadGateway)

	DocNotFound       = New("doc_not_found", "document not found", http.StatusNotFound)
	DocAlreadyDeleted = New("doc_already_deleted", "document already deleted", http.StatusBadRequest)

	ErrUnauthorized = sharederr.ErrUnauthorized
	ErrForbidden    = sharederr.ErrForbidden
)
