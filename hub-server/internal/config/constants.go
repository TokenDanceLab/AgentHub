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

// ── Agent task ────────────────────────────────────────────────────────────────

// PendingTaskTTL is the time-to-live for a queued pending agent task. Expired
// tasks are scanned by the background scheduler and published as timeout events.
const PendingTaskTTL = 24 * time.Hour

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
const AuthLoginRateLimit = 5

// AuthRateLimitWindow is the sliding window for login/register limits.
const AuthRateLimitWindow = time.Minute

// RateLimitExpiryBuffer keeps Redis rate-limit keys alive slightly beyond their
// sliding window so clients can compute Retry-After reliably.
const RateLimitExpiryBuffer = 10 * time.Second

// ── Messaging ────────────────────────────────────────────────────────────────

// MessageRecallWindow is the non-owner recall window for messages.
const MessageRecallWindow = 5 * time.Minute

// MaxPinsPerSession caps how many messages can be pinned in one session.
const MaxPinsPerSession int64 = 50

// ForwardMessageConcurrency limits concurrent writes during message forwarding.
const ForwardMessageConcurrency = 8

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

// ── Event bus ────────────────────────────────────────────────────────────────

// EventBusPoolSize is the worker pool size for asynchronous event handlers.
const EventBusPoolSize = 1024

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
