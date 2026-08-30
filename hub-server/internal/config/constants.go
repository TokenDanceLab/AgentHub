package config

import "time"

// ── Pagination ────────────────────────────────────────────────────────────────

// DefaultPaginationLimit is the default page size for list endpoints when no
// limit query parameter is specified.
const DefaultPaginationLimit = 50

// MaxMessagePageLimit is the maximum allowed page size for message list queries
// (GetMessagesBySession) and notification list queries (ListNotifications).
const MaxMessagePageLimit = 100

// MaxIncrementalMessageLimit is the maximum allowed page size for incremental
// message sync queries (GetMessagesIncrement). It is deliberately higher than
// MaxMessagePageLimit because sync clients often fetch larger batches.
const MaxIncrementalMessageLimit = 500

// MaxPageLimit is the maximum allowed page size (pageSize / limit) for list
// endpoints across all Hub handlers. Handlers MUST clamp user-supplied values
// to this ceiling to prevent unbounded query resource usage.
const MaxPageLimit = 500

// ── HTTP server timeouts ─────────────────────────────────────────────────────

// DefaultReadHeaderTimeout is applied to both the main HTTP server and the
// admin server to limit how long the server will spend reading request headers.
const DefaultReadHeaderTimeout = 5 * time.Second

// DefaultServerWriteTimeout is the WriteTimeout applied to both the main and
// admin HTTP servers.
const DefaultServerWriteTimeout = 60 * time.Second

// DefaultShutdownTimeout is the context deadline used during graceful shutdown
// of the HTTP server.
const DefaultShutdownTimeout = 5 * time.Second

// DefaultServerReadTimeout is the ReadTimeout applied to both the main and
// admin HTTP servers.
const DefaultServerReadTimeout = 30 * time.Second

// DefaultServerIdleTimeout is the IdleTimeout applied to the main HTTP server.
const DefaultServerIdleTimeout = 120 * time.Second

// DefaultMaxUploadSize is the fallback max upload size when not configured.
const DefaultMaxUploadSize int64 = 50 << 20 // 50 MB

// DefaultAllowedUploadMimeTypes is the fallback upload MIME allowlist. It does
// not include application/octet-stream; binary catch-all uploads must be
// explicitly configured.
var DefaultAllowedUploadMimeTypes = []string{
	"text/plain",
	"text/markdown",
	"text/csv",
	"application/json",
	"application/pdf",
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/webp",
}

// DefaultMaxHeaderBytes caps incoming HTTP request headers.
const DefaultMaxHeaderBytes = 1 << 20

// DefaultRequestBodyLimit caps ordinary API request bodies.
const DefaultRequestBodyLimit int64 = 10 << 20

// DefaultRequestTimeout is the normal API request deadline.
const DefaultRequestTimeout = 15 * time.Second

// UploadRequestTimeout is the longer deadline used by attachment uploads.
const UploadRequestTimeout = 30 * time.Second

// ── Cache TTLs ────────────────────────────────────────────────────────────────

// SessionMemberCacheTTL is the TTL for the cached session member list used when
// resolving WebSocket push targets.
const SessionMemberCacheTTL = 5 * time.Minute

// PendingAgentControlQueueMaxLen bounds the per-user/device offline control
// list so approval/control redelivery cannot grow Redis without limit while a
// desktop stays offline.
const PendingAgentControlQueueMaxLen = 256

// PendingAgentControlQueueTTL expires stale offline control queues when a
// desktop does not reconnect within the task lifetime window.
const PendingAgentControlQueueTTL = 24 * time.Hour

// ── Agent task ────────────────────────────────────────────────────────────────

// PendingTaskTTL is the time-to-live for a queued pending agent task. Expired
// tasks are scanned by the background scheduler and published as timeout events.
const PendingTaskTTL = 24 * time.Hour

// RunningTaskHeartbeatTTL is the expiration extension applied to running tasks
// each time the Hub receives a stream callback. If no callback arrives within
// this window, the background scheduler will mark the task as timed out.
// #132: ensures long-running agent tasks are eventually expired on inactivity.
const RunningTaskHeartbeatTTL = 10 * time.Minute

// MaxRunEventsPerTask bounds typed runtime event persistence for a single Hub
// task so an abnormal Edge callback loop cannot grow agent_run_events forever.
const MaxRunEventsPerTask int64 = 4096

// PendingTaskScanInterval controls how often expired pending tasks are scanned.
const PendingTaskScanInterval = time.Minute

// ── Rate limits ──────────────────────────────────────────────────────────────

// GlobalRateLimitPerMinute is the per-IP global request cap.
const GlobalRateLimitPerMinute int64 = 100

// GlobalRateLimitRetryAfterSeconds is the Retry-After header value used when the
// coarse global fixed-window limiter rejects a request.
const GlobalRateLimitRetryAfterSeconds = 60

// AuthRegisterRateLimit is the per-IP registration cap in AuthRateLimitWindow.
const AuthRegisterRateLimit = 3

// AuthLoginRateLimit is the per-IP login cap in AuthRateLimitWindow.
const AuthLoginRateLimit = 20

// AuthRateLimitWindow is the sliding window for login/register limits.
const AuthRateLimitWindow = time.Minute

// RateLimitExpiryBuffer keeps Redis rate-limit keys alive slightly beyond their
// sliding window so clients can compute Retry-After reliably.
const RateLimitExpiryBuffer = 10 * time.Second

// RateLimitFailOpenDefault controls the default behavior when Redis is unavailable
// during rate limiting. When true (default), non-auth API requests are allowed
// through with a warning log. Auth paths always fail-closed regardless of this
// setting. Controlled by the AGENTHUB_RATE_LIMIT_FAIL_OPEN environment variable.
const RateLimitFailOpenDefault = true

// AuthFailClosedDefault controls the default behavior when the access-token
// jti blacklist checker (Redis-backed) returns an error. When false (default),
// the auth middleware fails open (allows the request through) to preserve the
// historical behavior and avoid locking users out during a Redis outage. When
// true (set via AGENTHUB_AUTH_FAIL_CLOSED=true), the middleware fails closed
// and rejects the request so a Redis outage cannot let a revoked access JWT
// (post-logout) back into the product APIs.
const AuthFailClosedDefault = false

// ── Messaging ────────────────────────────────────────────────────────────────

// MessageRecallWindow is the non-owner recall window for messages.
const MessageRecallWindow = 5 * time.Minute

// MessageEditWindow is the time window during which a sender may edit their
// own message. Set to 0 to allow editing without a time limit.
const MessageEditWindow = 15 * time.Minute

// MaxPinsPerSession caps how many messages can be pinned in one session.
const MaxPinsPerSession int64 = 50

// ForwardMessageConcurrency limits concurrent writes during message forwarding.
const ForwardMessageConcurrency = 8

// MaxForwardTargets limits the number of target sessions for message forwarding.
const MaxForwardTargets = 50

// ── WebSocket ─────────────────────────────────────────────────────────────────

// WSSendBufferSize is the capacity of each WebSocket connection's outgoing
// message channel.
const WSSendBufferSize = 256

// WSHeartbeatInterval controls server-side WebSocket ping cadence.
const WSHeartbeatInterval = 30 * time.Second

// WSPingTimeout is the deadline for a single WebSocket ping.
const WSPingTimeout = 5 * time.Second

// WSMaxMissedPongs is the number of consecutive missed pongs before a
// connection is closed.
const WSMaxMissedPongs = 2

// WSIPRateLimitPerMinute is the maximum number of new WebSocket connections
// allowed per client IP within one minute.
const WSIPRateLimitPerMinute = 30

// WSMessageRateLimit is the maximum number of messages per second allowed per
// WebSocket connection (token bucket refill rate).
const WSMessageRateLimit = 10

// WSMessageBurst is the token bucket burst size for per-connection message
// rate limiting.
const WSMessageBurst = 20

// WSMaxConnsPerUser is the maximum number of concurrent WebSocket connections
// allowed per user. When this limit is reached, new connection attempts are
// rejected with a warning log.
const WSMaxConnsPerUser = 10

// ── Event bus ────────────────────────────────────────────────────────────────

// EventBusPoolSize is the worker pool size for asynchronous event handlers.
const EventBusPoolSize = 1024

// EventBusHandlerTimeout bounds each async event handler invocation (#1548).
// Handlers receive a context with the caller's values but not its
// cancellation, plus this deadline.
const EventBusHandlerTimeout = 30 * time.Second

// ── Metrics ──────────────────────────────────────────────────────────────────

// MetricsCollectionInterval controls periodic in-process metric sampling.
const MetricsCollectionInterval = 15 * time.Second

// ── Auth validation ───────────────────────────────────────────────────────────

// MinPasswordLength is the minimum password length accepted by Register and
// ChangePassword.
const MinPasswordLength = 8

// MaxPasswordLength is the maximum password length accepted by Register and
// ChangePassword.
const MaxPasswordLength = 64

// MaxGroupNameLength is the maximum group session display name length.
const MaxGroupNameLength = 64

// MaxTeamNameLength is the maximum agent team name length.
const MaxTeamNameLength = 100

// ── Orphan task recovery ─────────────────────────────────────────────────────

// OrphanTaskGracePeriod is the minimum age a queued task must reach before the
// orphan sweeper considers it eligible for recovery. Tasks younger than this
// window are still in the normal dispatch pipeline and must not be reclaimed.
const OrphanTaskGracePeriod = 120 * time.Second

// OrphanTaskScanInterval controls how often the orphan task sweeper runs.
const OrphanTaskScanInterval = 30 * time.Second
