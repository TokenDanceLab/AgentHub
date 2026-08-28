package cache

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ==================== Refresh-token blacklist ====================

// TestBlacklistRefreshToken_ThenCheck_Hit proves the happy path: blacklisting a
// refresh-token hash makes IsRefreshTokenBlacklisted report true for that key.
func TestBlacklistRefreshToken_ThenCheck_Hit(t *testing.T) {
	c, _ := testClient(t)
	ctx := context.Background()

	const blacklistKey = "rt-hash-hit-1"
	require.NoError(t, c.BlacklistRefreshToken(ctx, blacklistKey, 5*time.Minute))

	hit, err := c.IsRefreshTokenBlacklisted(ctx, blacklistKey)
	require.NoError(t, err)
	assert.True(t, hit, "blacklisted refresh token must be reported as blacklisted")
}

// TestIsRefreshTokenBlacklisted_Miss proves a never-blacklisted key reports
// false without error.
func TestIsRefreshTokenBlacklisted_Miss(t *testing.T) {
	c, _ := testClient(t)
	ctx := context.Background()

	hit, err := c.IsRefreshTokenBlacklisted(ctx, "rt-hash-never")
	require.NoError(t, err)
	assert.False(t, hit, "a never-blacklisted key must not be reported as blacklisted")
}

// TestBlacklistRefreshToken_RevokeIsIdempotent proves re-revoking the same
// token hash does not error and the key stays blacklisted (semantic: a
// second logout of an already-revoked token is a no-op, not a failure).
func TestBlacklistRefreshToken_RevokeIsIdempotent(t *testing.T) {
	c, _ := testClient(t)
	ctx := context.Background()

	const blacklistKey = "rt-hash-idempotent"
	// First revocation.
	require.NoError(t, c.BlacklistRefreshToken(ctx, blacklistKey, 5*time.Minute))
	// Second revocation of the same hash must succeed (idempotent).
	require.NoError(t, c.BlacklistRefreshToken(ctx, blacklistKey, 5*time.Minute))

	hit, err := c.IsRefreshTokenBlacklisted(ctx, blacklistKey)
	require.NoError(t, err)
	assert.True(t, hit, "key must remain blacklisted after a repeat revoke")
}

// TestBlacklistRefreshToken_RevokeExtendsTTL proves a repeat revoke refreshes
// the TTL (a re-logout should not shorten the existing blacklist window).
// We assert the visible key remains present after the original TTL would have
// expired because the second revoke reset it.
func TestBlacklistRefreshToken_RevokeExtendsTTL(t *testing.T) {
	c, mr := testClient(t)
	ctx := context.Background()

	const blacklistKey = "rt-hash-extend"
	// Initial revoke with a 2s TTL.
	require.NoError(t, c.BlacklistRefreshToken(ctx, blacklistKey, 2*time.Second))
	// Fast-forward 1s, then revoke again — the second call must reset the TTL.
	mr.FastForward(1 * time.Second)
	require.NoError(t, c.BlacklistRefreshToken(ctx, blacklistKey, 5*time.Second))
	// Fast-forward 3s: original 2s TTL would have expired at t=2s, but the
	// second revoke (at t=1s) reset it to 5s, so at t=4s the key must survive.
	mr.FastForward(3 * time.Second)
	hit, err := c.IsRefreshTokenBlacklisted(ctx, blacklistKey)
	require.NoError(t, err)
	assert.True(t, hit, "repeat revoke must extend the blacklist TTL past the original expiry")
}

// TestBlacklistRefreshToken_Expires proves the blacklist entry disappears after
// its TTL elapses (a revoked token is not blacklisted forever).
func TestBlacklistRefreshToken_Expires(t *testing.T) {
	c, mr := testClient(t)
	ctx := context.Background()

	const blacklistKey = "rt-hash-expire"
	require.NoError(t, c.BlacklistRefreshToken(ctx, blacklistKey, 1*time.Second))

	// Present immediately.
	hit, err := c.IsRefreshTokenBlacklisted(ctx, blacklistKey)
	require.NoError(t, err)
	assert.True(t, hit)

	// Fast-forward past the TTL.
	mr.FastForward(1100 * time.Millisecond)
	hit, err = c.IsRefreshTokenBlacklisted(ctx, blacklistKey)
	require.NoError(t, err)
	assert.False(t, hit, "blacklist entry must expire after its TTL")
}

// TestIsRefreshTokenBlacklisted_DistinctKeysAreIndependent proves blacklisting
// one key does not blacklist another (no prefix collision / wildcard leak).
func TestIsRefreshTokenBlacklisted_DistinctKeysAreIndependent(t *testing.T) {
	c, _ := testClient(t)
	ctx := context.Background()

	require.NoError(t, c.BlacklistRefreshToken(ctx, "rt-hash-A", 5*time.Minute))

	hitA, err := c.IsRefreshTokenBlacklisted(ctx, "rt-hash-A")
	require.NoError(t, err)
	assert.True(t, hitA, "blacklisted key A must hit")

	// A distinct key — including a prefix of A — must NOT hit (no substring match).
	hitPrefix, err := c.IsRefreshTokenBlacklisted(ctx, "rt-hash")
	require.NoError(t, err)
	assert.False(t, hitPrefix, "a prefix of the blacklisted key must not hit")

	hitB, err := c.IsRefreshTokenBlacklisted(ctx, "rt-hash-B")
	require.NoError(t, err)
	assert.False(t, hitB, "a sibling key must not hit")
}

// TestBlacklistRefreshToken_CompoundKey proves the compound userID:device key
// form (used by device-scoped revocation) round-trips through the blacklist
// without special handling — it is just a string key.
func TestBlacklistRefreshToken_CompoundKey(t *testing.T) {
	c, _ := testClient(t)
	ctx := context.Background()

	const compoundKey = "user-42:web:chrome"
	require.NoError(t, c.BlacklistRefreshToken(ctx, compoundKey, 5*time.Minute))

	hit, err := c.IsRefreshTokenBlacklisted(ctx, compoundKey)
	require.NoError(t, err)
	assert.True(t, hit)

	// The bare userID must not match the compound key.
	hitUser, err := c.IsRefreshTokenBlacklisted(ctx, "user-42")
	require.NoError(t, err)
	assert.False(t, hitUser, "bare userID must not match a compound device key")
}

// ==================== Access-token blacklist ====================

// TestBlacklistAccessToken_ThenCheck_Hit proves blacklisting an access-token
// jti makes IsAccessTokenBlacklisted report true.
func TestBlacklistAccessToken_ThenCheck_Hit(t *testing.T) {
	c, _ := testClient(t)
	ctx := context.Background()

	const jti = "at-jti-hit-1"
	require.NoError(t, c.BlacklistAccessToken(ctx, jti, 5*time.Minute))

	hit, err := c.IsAccessTokenBlacklisted(ctx, jti)
	require.NoError(t, err)
	assert.True(t, hit, "blacklisted access-token jti must be reported as blacklisted")
}

// TestIsAccessTokenBlacklisted_Miss proves a never-blacklisted jti reports
// false without error.
func TestIsAccessTokenBlacklisted_Miss(t *testing.T) {
	c, _ := testClient(t)
	ctx := context.Background()

	hit, err := c.IsAccessTokenBlacklisted(ctx, "at-jti-never")
	require.NoError(t, err)
	assert.False(t, hit, "a never-blacklisted jti must not be reported as blacklisted")
}

// TestIsAccessTokenBlacklisted_RedisDownPropagatesError proves the AH-SR-052
// contract (#2040): a Redis outage is not swallowed here. The error is
// returned to the caller so the auth middleware can apply the configured
// fail-open/fail-closed policy (AGENTHUB_AUTH_FAIL_CLOSED). Swallowing the
// error made the middleware fail-closed branch unreachable in production.
func TestIsAccessTokenBlacklisted_RedisDownPropagatesError(t *testing.T) {
	c, mr := testClient(t)
	ctx := context.Background()

	const jti = "at-jti-redis-down"
	require.NoError(t, c.BlacklistAccessToken(ctx, jti, 5*time.Minute))
	mr.Close() // simulate a Redis outage

	hit, err := c.IsAccessTokenBlacklisted(ctx, jti)
	require.Error(t, err, "Redis errors must be propagated to the caller; fail-open/fail-closed is the middleware's policy decision")
	assert.False(t, hit, "on Redis errors the jti must not be reported as blacklisted")
}

// TestBlacklistAccessToken_RevokeIsIdempotent proves re-revoking the same jti
// is a no-op success and the key stays blacklisted.
func TestBlacklistAccessToken_RevokeIsIdempotent(t *testing.T) {
	c, _ := testClient(t)
	ctx := context.Background()

	const jti = "at-jti-idempotent"
	require.NoError(t, c.BlacklistAccessToken(ctx, jti, 5*time.Minute))
	require.NoError(t, c.BlacklistAccessToken(ctx, jti, 5*time.Minute))

	hit, err := c.IsAccessTokenBlacklisted(ctx, jti)
	require.NoError(t, err)
	assert.True(t, hit, "jti must remain blacklisted after a repeat revoke")
}

// TestBlacklistAccessToken_Expires proves the access blacklist entry disappears
// after its TTL (a logged-out access token is not blacklisted forever — once
// the underlying JWT would have expired anyway, the entry is redundant).
func TestBlacklistAccessToken_Expires(t *testing.T) {
	c, mr := testClient(t)
	ctx := context.Background()

	const jti = "at-jti-expire"
	require.NoError(t, c.BlacklistAccessToken(ctx, jti, 1*time.Second))

	hit, err := c.IsAccessTokenBlacklisted(ctx, jti)
	require.NoError(t, err)
	assert.True(t, hit)

	mr.FastForward(1100 * time.Millisecond)
	hit, err = c.IsAccessTokenBlacklisted(ctx, jti)
	require.NoError(t, err)
	assert.False(t, hit, "access blacklist entry must expire after its TTL")
}

// TestBlacklistAccessToken_EmptyJTINoOps proves the empty-jti guard: passing
// an empty jti is a no-op (returns nil) and does not create a key, so an
// access token without a jti is simply not blacklistable (and not blacklisted).
func TestBlacklistAccessToken_EmptyJTINoOps(t *testing.T) {
	c, _ := testClient(t)
	ctx := context.Background()

	require.NoError(t, c.BlacklistAccessToken(ctx, "", 5*time.Minute),
		"empty jti must be a no-op, not an error")

	hit, err := c.IsAccessTokenBlacklisted(ctx, "")
	require.NoError(t, err)
	assert.False(t, hit, "empty jti must not be reported as blacklisted")
}

// TestBlacklistAccessToken_ZeroTTLNoOps proves the non-positive TTL guard: a
// zero/negative TTL is a no-op so a caller cannot accidentally create a
// permanent (TTL-less) blacklist entry.
func TestBlacklistAccessToken_ZeroTTLNoOps(t *testing.T) {
	c, _ := testClient(t)
	ctx := context.Background()

	const jti = "at-jti-zero-ttl"
	require.NoError(t, c.BlacklistAccessToken(ctx, jti, 0))
	require.NoError(t, c.BlacklistAccessToken(ctx, jti, -1*time.Second))

	hit, err := c.IsAccessTokenBlacklisted(ctx, jti)
	require.NoError(t, err)
	assert.False(t, hit, "non-positive TTL must not create a blacklist entry")
}

// TestIsAccessTokenBlacklisted_DistinctJTIsAreIndependent proves blacklisting
// one jti does not blacklist another (no prefix collision).
func TestIsAccessTokenBlacklisted_DistinctJTIsAreIndependent(t *testing.T) {
	c, _ := testClient(t)
	ctx := context.Background()

	require.NoError(t, c.BlacklistAccessToken(ctx, "at-jti-1", 5*time.Minute))

	hit1, err := c.IsAccessTokenBlacklisted(ctx, "at-jti-1")
	require.NoError(t, err)
	assert.True(t, hit1)

	hit2, err := c.IsAccessTokenBlacklisted(ctx, "at-jti-2")
	require.NoError(t, err)
	assert.False(t, hit2, "a sibling jti must not hit")

	// A prefix of the blacklisted jti must not hit (no substring match).
	hitPrefix, err := c.IsAccessTokenBlacklisted(ctx, "at-jti")
	require.NoError(t, err)
	assert.False(t, hitPrefix, "a prefix of the blacklisted jti must not hit")
}

// ==================== Cross-key isolation ====================

// TestBlacklist_RefreshAndAccessKeysDoNotCollide proves the refresh and access
// blacklists use distinct key namespaces (rt_blacklist:* vs at_blacklist:*),
// so blacklisting a refresh token hash does not affect access-token checks and
// vice versa — even when the raw string is identical.
func TestBlacklist_RefreshAndAccessKeysDoNotCollide(t *testing.T) {
	c, _ := testClient(t)
	ctx := context.Background()

	const same = "shared-token-id"
	require.NoError(t, c.BlacklistRefreshToken(ctx, same, 5*time.Minute))
	require.NoError(t, c.BlacklistAccessToken(ctx, same, 5*time.Minute))

	// Refresh blacklist must report hit (and not be polluted by the access entry).
	rtHit, err := c.IsRefreshTokenBlacklisted(ctx, same)
	require.NoError(t, err)
	assert.True(t, rtHit, "refresh blacklist must hit for the shared id")

	// Access blacklist must report hit (and not be polluted by the refresh entry).
	atHit, err := c.IsAccessTokenBlacklisted(ctx, same)
	require.NoError(t, err)
	assert.True(t, atHit, "access blacklist must hit for the shared id")

	// A refresh-only id must not hit the access blacklist, and vice versa.
	require.NoError(t, c.BlacklistRefreshToken(ctx, "rt-only", 5*time.Minute))
	atMiss, err := c.IsAccessTokenBlacklisted(ctx, "rt-only")
	require.NoError(t, err)
	assert.False(t, atMiss, "a refresh-only id must not hit the access blacklist")

	require.NoError(t, c.BlacklistAccessToken(ctx, "at-only", 5*time.Minute))
	rtMiss, err := c.IsRefreshTokenBlacklisted(ctx, "at-only")
	require.NoError(t, err)
	assert.False(t, rtMiss, "an access-only id must not hit the refresh blacklist")
}
