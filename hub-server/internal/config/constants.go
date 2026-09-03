package config

import "time"

// ── Pagination ────────────────────────────────────────────────────────────────

// DefaultPaginationLimit is the default page size for list endpoints when no
// limit query parameter is specified.
const DefaultPaginationLimit = 50

// MaxMessagePageLimit is the ceiling of the payload-size-sensitive lists:
// message list queries (repository.GetMessagesBySession — which also backs the
// project-thread-message list), notification list queries
// (repository.ListNotifications), and message search (handler/message.go
// parseMessageSearchPage, whose repository query applies no ceiling of its own).
// Handler and query layer clamp to the same value, so what the handler forwards
// is what the query executes.
//
// These endpoints are not described by the shared PageSize parameter:
// api/openapi.yaml declares maximum: 100 for the `limit` of
// GET /web/projects/{id}/threads/{threadId}/messages and declares no maximum at
// all for GET /client/notifications, while the two message-search routes do
// reference PageSize (maximum: 200) and are deliberately held at 100 to keep
// the search payload bounded — see parseMessageSearchPage.
const MaxMessagePageLimit = 100

// MaxIncrementalMessageLimit is the maximum allowed page size for incremental
// message sync queries (GetMessagesIncrement). It is deliberately higher than
// MaxMessagePageLimit because sync clients often fetch larger batches.
const MaxIncrementalMessageLimit = 500

// MaxListPageSize is the maximum page size for the generic cursor-paged list
// endpoints: projects/workspaces, skills, agent profiles, execution targets,
// provider bindings, MCP servers, market profiles, session search and audit
// events. It is the value api/openapi.yaml declares for the shared PageSize
// parameter (maximum: 200), so it is the bound those endpoints must actually
// enforce; it was previously a bare `200` literal repeated in ten places.
//
// Enforcement lives wherever the client-supplied value becomes a LIMIT, and
// since #2243 that is the handler — the layer the contract is written against —
// for projects/workspaces, skills, agent profiles, execution targets, provider
// bindings, MCP servers, market profiles and session search, each clamping with
// ClampPageSize(.., MaxListPageSize, ..). The repository queries beneath them
// clamp to the same value as defence in depth, with two asymmetries worth
// knowing: repository.SearchSessions applies no ceiling of its own, so its
// handler is the only enforcement point, and GET /web/audit-events has no
// handler-side clamp, so repository.ListAuditEvents is its enforcement point.
//
// Before #2243 every one of those handlers clamped to MaxPageLimit (500)
// instead, so pageSize=300 reached a query that silently returned 200 rows with
// HTTP 200 and no signal that the page had been shortened.
const MaxListPageSize = 200

// MaxPageLimit is the ceiling of the endpoints whose own contract declares
// maximum: 500 and whose query layer enforces nothing lower:
//
//   - GET /web/agent-tasks/{id}/events (`limit`) — repository/agent.go
//     ListAgentRunEventsByTaskIDFiltered applies no ceiling to an explicit
//     limit; it only substitutes maxAgentEventsPerQuery (2000) when limit is 0.
//     The handler is therefore the enforcement point, and openapi declares
//     maximum: 500 for this parameter.
//   - GET /web/agent-teams/{id}/runs/{run_id}/events (`pageSize`) —
//     repository/agent_team_events.go ListTeamEventsByRunPage caps at
//     maxTeamEventsPerRun (10000), and openapi declares maximum: 500.
//
// It is also the bound two repository-side lists enforce where no client page
// size reaches the query: the document family (repository/document.go, whose
// openapi `limit` declares no maximum) and the custom-agents list
// (repository/agent.go ListCustomAgentsByOwner). repository/pagination_limits_test.go
// pins both.
//
// It is NOT a Hub-wide handler ceiling — that is what this comment claimed until
// #2243, and the claim was false for every generic list endpoint, which clamp to
// MaxListPageSize (200), and for the message/notification/thread-message
// endpoints, which clamp to MaxMessagePageLimit (100).
const MaxPageLimit = 500

// MaxPaginationOffset caps client-controlled OFFSET values on list endpoints.
// An unbounded offset forces PG to scan-and-discard arbitrarily many rows per
// request (single-request DoS amplifier, #2154 Gauss P2-1); 10000 pages far
// beyond any real UI depth (limit<=500 => 5M rows reachable) while keeping
// legitimate pagination intact. Keyset cursors remain the long-term shape.
const MaxPaginationOffset = 10000

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

// DefaultDBMaxOpenConns / DefaultDBMaxIdleConns size the PG pool for the
// concurrent roles the hub actually runs (edge-callback transactions, seq
// allocation, audit advisory-lock writes, sweepers, outbox tickers, metrics,
// interactive API). The historical 2/1 starved every consumer whenever one
// slow transaction held a connection (#2154 Gauss P1-1). Both are tunable
// per instance via AGENTHUB_DB_MAX_OPEN_CONNS / AGENTHUB_DB_MAX_IDLE_CONNS
// (viper AutomaticEnv).
const (
	DefaultDBMaxOpenConns = 20
	DefaultDBMaxIdleConns = 10
)

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

// ── Device quotas ────────────────────────────────────────────────────────────

// DefaultMaxCloudEdgeDevicesPerUser caps how many cloud_edge device rows a
// single user may own. Route-level rate limiting (#2185) bounds request
// frequency; this quota bounds stored device rows, since callers choose their
// own device_id UUIDs and could otherwise register unbounded cloud_edge
// devices. Re-registering an already-owned device_id (upsert refresh) is not
// blocked by the cap. Override with AGENTHUB_MAX_CLOUD_EDGE_DEVICES; a value
// <= 0 disables the cap.
const DefaultMaxCloudEdgeDevicesPerUser = 50

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

// ── JWT key rotation ─────────────────────────────────────────────────────────

// DefaultJWTRotationInterval is the default period between automatic JWT
// signing-key rotations. Conservative 24h to minimize disruption while still
// limiting exposure window of a compromised key. Operators may override via
// AGENTHUB_JWT_ROTATION_INTERVAL env var.
const DefaultJWTRotationInterval = 24 * time.Hour

// DefaultJWTRotationGracePeriod is how long a superseded signing key remains
// registered for verification after rotation. Must exceed the maximum access
// token TTL so in-flight tokens survive the transition. Defaults to 30m
// (access_ttl 15m + 15m buffer). Operators may override via
// AGENTHUB_JWT_ROTATION_GRACE_PERIOD env var.
const DefaultJWTRotationGracePeriod = 30 * time.Minute

// JWTRotationEnabledEnvVar is the environment variable that enables the
// automatic JWT key rotation scheduler. Accepts "true"/"1"/"yes" (case-
// insensitive). Default is disabled (safe opt-in).
const JWTRotationEnabledEnvVar = "AGENTHUB_JWT_ROTATION_ENABLED"

// JWTRotationIntervalEnvVar overrides DefaultJWTRotationInterval.
const JWTRotationIntervalEnvVar = "AGENTHUB_JWT_ROTATION_INTERVAL"

// JWTRotationGracePeriodEnvVar overrides DefaultJWTRotationGracePeriod.
const JWTRotationGracePeriodEnvVar = "AGENTHUB_JWT_ROTATION_GRACE_PERIOD"
