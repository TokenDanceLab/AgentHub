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

// ── Cache TTLs ────────────────────────────────────────────────────────────────

// SessionMemberCacheTTL is the TTL for the cached session member list used when
// resolving WebSocket push targets.
const SessionMemberCacheTTL = 5 * time.Minute

// ── Agent task ────────────────────────────────────────────────────────────────

// PendingTaskTTL is the time-to-live for a queued pending agent task. Expired
// tasks are scanned by the background scheduler and published as timeout events.
const PendingTaskTTL = 24 * time.Hour

// ── WebSocket ─────────────────────────────────────────────────────────────────

// WSSendBufferSize is the capacity of each WebSocket connection's outgoing
// message channel.
const WSSendBufferSize = 64

// ── Auth validation ───────────────────────────────────────────────────────────

// MinPasswordLength is the minimum password length accepted by Register and
// ChangePassword.
const MinPasswordLength = 8

// MaxPasswordLength is the maximum password length accepted by Register and
// ChangePassword.
const MaxPasswordLength = 64
