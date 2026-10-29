package cache

import (
	"context"
	"log/slog"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
)

// AllocateSeq atomically increments and returns the next seq for a session.
func (c *Client) AllocateSeq(ctx context.Context, sessionID string) (int64, error) {
	key := "session:seq:" + sessionID
	val, err := c.rdb.Incr(ctx, key).Result()
	if err != nil {
		return 0, err
	}
	// Always set TTL to prevent permanent key leak: when a session's seq key
	// expires after 30 days, the next AllocateSeq recreates it via Incr with
	// no TTL, and subsequent InitSeqIfAbsent becomes a no-op (SetNX fails
	// because key already exists). The Expire call closes this leak path.
	_ = c.rdb.Expire(ctx, key, 30*24*time.Hour).Err()
	return val, nil
}

// InitSeqIfAbsent initializes the seq key if it doesn't exist.
func (c *Client) InitSeqIfAbsent(ctx context.Context, sessionID string, seq int64) error {
	return c.rdb.SetNX(ctx, "session:seq:"+sessionID, seq, 30*24*time.Hour).Err()
}

// SetSeq force-sets the seq key to seq (recovery path after Redis data loss:
// restart / FLUSH / key expiry). Mirrors the DB seq mirror so allocation
// continues without repeating values (#1533).
func (c *Client) SetSeq(ctx context.Context, sessionID string, seq int64) error {
	return c.rdb.Set(ctx, "session:seq:"+sessionID, seq, 30*24*time.Hour).Err()
}

// PeekSeq returns the current seq value for a session (diagnostics only).
func (c *Client) PeekSeq(ctx context.Context, sessionID string) (int64, error) {
	s, err := c.rdb.Get(ctx, "session:seq:"+sessionID).Result()
	if err != nil {
		return 0, err
	}
	return strconv.ParseInt(s, 10, 64)
}

// BlacklistRefreshToken stores a refresh token hash in the Redis blacklist
// with the specified TTL. This allows fast revocation checks without hitting
// the database.
func (c *Client) BlacklistRefreshToken(ctx context.Context, tokenHash string, ttl time.Duration) error {
	return c.rdb.Set(ctx, "rt_blacklist:"+tokenHash, "1", ttl).Err()
}

// IsRefreshTokenBlacklisted checks whether a key (token hash, or compound
// userID:deviceID[:deviceType] key) exists in the Redis refresh token
// blacklist. Returns true if the key is present, false otherwise.
// Redis errors are propagated to the caller (#2053, symmetric with the
// access contract, #2040): Service.RefreshToken is the policy
// decision point and picks fail-open vs fail-closed via
// AGENTHUB_AUTH_FAIL_CLOSED (service/auth enforceRefreshBlacklist).
// Swallowing errors here made that fail-closed branch unreachable in the
// production wiring.
func (c *Client) IsRefreshTokenBlacklisted(ctx context.Context, key string) (bool, error) {
	n, err := c.rdb.Exists(ctx, "rt_blacklist:"+key).Result()
	if err != nil {
		slog.Warn("redis IsRefreshTokenBlacklisted failed",
			"key", key, "error", err)
		return false, err
	}
	return n > 0, nil
}

// BlacklistAccessToken stores an access-token jti in the Redis blacklist until
// the remaining access TTL elapses. Used on logout so stolen access JWTs are
// rejected immediately rather than remaining valid for AccessExpire (#888).
func (c *Client) BlacklistAccessToken(ctx context.Context, jti string, ttl time.Duration) error {
	if jti == "" || ttl <= 0 {
		return nil
	}
	return c.rdb.Set(ctx, "at_blacklist:"+jti, "1", ttl).Err()
}

// IsAccessTokenBlacklisted reports whether an access-token jti is blacklisted.
// Redis errors are propagated to the caller (contract, #2040): the
// auth middleware is the policy decision point and picks fail-open vs
// fail-closed via AGENTHUB_AUTH_FAIL_CLOSED (middleware/auth.go
// acceptAccessClaims). Swallowing errors here made that fail-closed branch
// unreachable in the production wiring.
func (c *Client) IsAccessTokenBlacklisted(ctx context.Context, jti string) (bool, error) {
	if jti == "" {
		return false, nil
	}
	n, err := c.rdb.Exists(ctx, "at_blacklist:"+jti).Result()
	if err != nil {
		slog.Warn("redis IsAccessTokenBlacklisted failed",
			"jti", jti, "error", err)
		return false, err
	}
	return n > 0, nil
}

// rateLimitScript atomically INCRs the fixed-window counter and sets its TTL
// only when the window starts (or repairs a legacy key without expiry).
// Refreshing the TTL on every call would let steady traffic, including health
// probes, accumulate forever and permanently rate-limit an otherwise quiet IP.
// A non-atomic INCR+EXPIRE pair would
// leave a TTL-less key behind if the process crashed between the two commands,
// permanently rate-limiting that caller until an external key cleanup.
var rateLimitScript = redis.NewScript(`
local count = redis.call('INCR', KEYS[1])
if count == 1 or redis.call('TTL', KEYS[1]) < 0 then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return count
`)

// CheckRateLimit counts requests in a fixed 60-second window starting at the
// first request. Counting and expiry assignment are atomic; subsequent requests
// (including rejected ones) cannot extend the window or prevent recovery.
func (c *Client) CheckRateLimit(ctx context.Context, key string, limit int64) (count int64, exceeded bool, err error) {
	count, err = rateLimitScript.Run(ctx, c.rdb, []string{"ratelimit:" + key}, 60).Int64()
	if err != nil {
		return 0, false, err
	}
	exceeded = count > limit
	return
}
