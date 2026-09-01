package auth

import (
	"context"
	"errors"
	"log/slog"
	"net/url"
	"strings"
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/cache"
	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/jwtutil"
	"github.com/agenthub/hub-server/internal/metrics"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
)

// authCache is the subset of *cache.Client methods used by Service.
type authCache interface {
	Invalidate(ctx context.Context, keys ...string) error
	BlacklistRefreshToken(ctx context.Context, tokenHash string, ttl time.Duration) error
	IsRefreshTokenBlacklisted(ctx context.Context, key string) (bool, error)
	BlacklistAccessToken(ctx context.Context, jti string, ttl time.Duration) error
	IsAccessTokenBlacklisted(ctx context.Context, jti string) (bool, error)
}

// LoginResponse is returned to clients after successful authentication.
type LoginResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int64  `json:"expires_in"`
}

type Service struct {
	db          *gorm.DB
	jwtCfg      config.JWTConfig
	cacheClient authCache
}

func NewService(db *gorm.DB, jwtCfg config.JWTConfig, cacheClient *cache.Client) *Service {
	return &Service{db: db, jwtCfg: jwtCfg, cacheClient: resolveAuthCache(cacheClient)}
}

// RefreshToken validates a refresh token, issues a new access token,
// and rotates the refresh token (#134: old one is revoked, new one is issued).
func (s *Service) RefreshToken(ctx context.Context, rawRefreshToken string) (*LoginResponse, error) {
	tokenHash := jwtutil.HashRefreshToken(rawRefreshToken)
	rt, err := repository.FindRefreshTokenByHash(s.db, tokenHash)
	if err != nil {
		return nil, errcode.AuthRefreshInvalid
	}
	if rt.Revoked {
		// Reuse of a revoked refresh-token row — e.g. a stolen token presented
		// after logout. #2154 F2 step ①: signal-only slice. The response code
		// stays AuthRefreshInvalid and NO cascade revocation happens here
		// (cascade is a separate decision item). The raw token and its hash
		// are never logged; only non-secret dimensions are (#134 logging rule).
		slog.Warn("refresh token reuse: revoked token presented",
			"user_id", rt.UserID, "device_type", rt.DeviceType)
		if metrics.RefreshTokenReuseTotal != nil {
			metrics.RefreshTokenReuseTotal.Inc()
		}
		return nil, errcode.AuthRefreshInvalid
	}
	if time.Now().After(rt.ExpiresAt) {
		return nil, errcode.AuthRefreshInvalid
	}

	// Check Redis blacklist: the token hash itself (set during rotation),
	// the per-user-device key (set during logout without device_type), and
	// the per-user-device-type key (set during logout with device_type).
	// Any hit means the token was revoked through Redis before the DB
	// commit completed, closing the race window. Redis errors apply the
	// fail-open/fail-closed policy (see enforceRefreshBlacklist, #2053).
	if err := s.enforceRefreshBlacklist(ctx, tokenHash); err != nil {
		return nil, err
	}
	deviceKey := rt.UserID + ":" + rt.DeviceID
	if err := s.enforceRefreshBlacklist(ctx, deviceKey); err != nil {
		return nil, err
	}
	if rt.DeviceType != "" {
		deviceTypeKey := rt.UserID + ":" + rt.DeviceID + ":" + rt.DeviceType
		if err := s.enforceRefreshBlacklist(ctx, deviceTypeKey); err != nil {
			return nil, err
		}
	}

	// Rotate step 1 — atomic claim: flip THIS row to revoked with a
	// conditional UPDATE. Concurrent presentations of the same token race
	// here; only the winner proceeds, losers are rejected as reuse and feed
	// the F2 signal (#2154: pre-fix the check-then-write gap let every racer
	// obtain a fresh token pair — double-spend, proven under real PG).
	claimed, err := repository.ClaimRefreshTokenForRotation(s.db, tokenHash)
	if err != nil {
		return nil, err
	}
	if !claimed {
		slog.Warn("refresh token reuse: concurrent rotation lost the claim",
			"user_id", rt.UserID, "device_type", rt.DeviceType)
		if metrics.RefreshTokenReuseTotal != nil {
			metrics.RefreshTokenReuseTotal.Inc()
		}
		return nil, errcode.AuthRefreshInvalid
	}

	// Rotate step 2 — revoke any remaining tokens on the device.
	if err := repository.RevokeRefreshTokensByUserDevice(s.db, rt.UserID, rt.DeviceID); err != nil {
		return nil, err
	}

	// Blacklist the old token hash in Redis for the remaining TTL (#134).
	remainingTTL := time.Until(rt.ExpiresAt)
	if remainingTTL > 0 {
		if err := resolveAuthCache(s.cacheClient).BlacklistRefreshToken(ctx, tokenHash, remainingTTL); err != nil {
			slog.Warn("refresh token: failed to blacklist in Redis, fallback to DB-only", "error", err)
		}
	}

	// Issue a new access token.
	accessToken, err := jwtutil.GenerateAccessToken(rt.UserID, rt.DeviceType, rt.DeviceID,
		s.jwtCfg.Secret, s.jwtCfg.AccessTTL)
	if err != nil {
		return nil, err
	}

	// Issue a new refresh token.
	rawRefresh, err := jwtutil.GenerateRefreshToken()
	if err != nil {
		return nil, err
	}

	newTokenHash := jwtutil.HashRefreshToken(rawRefresh)
	newRT := &model.RefreshToken{
		UserID:     rt.UserID,
		DeviceType: rt.DeviceType,
		DeviceID:   rt.DeviceID,
		TokenHash:  newTokenHash,
		ExpiresAt:  time.Now().Add(s.jwtCfg.RefreshTTL),
	}
	if err := repository.UpsertRefreshToken(s.db, newRT); err != nil {
		return nil, err
	}

	return &LoginResponse{
		AccessToken:  accessToken,
		RefreshToken: rawRefresh,
		ExpiresIn:    int64(s.jwtCfg.AccessTTL.Seconds()),
	}, nil
}

// enforceRefreshBlacklist checks one refresh-blacklist key and rejects the
// refresh with AuthRefreshInvalid when the key is blacklisted.
//
// Redis errors follow the same policy as the access path (#2053, mirrors
// middleware/auth.go acceptAccessClaims, #2049): the default policy is
// fail-open (treat the key as not blacklisted) to avoid locking users out
// during a Redis outage — the DB revoked flag remains the source of truth
// and the blacklist only closes the pre-commit race window. Operators
// hardening production set AGENTHUB_AUTH_FAIL_CLOSED=true so a Redis outage
// cannot let a revoked (logged-out or rotated) refresh token rotate again:
// the refresh is rejected with AuthRefreshInvalid because revocation status
// could not be verified.
func (s *Service) enforceRefreshBlacklist(ctx context.Context, key string) error {
	blacklisted, err := resolveAuthCache(s.cacheClient).IsRefreshTokenBlacklisted(ctx, key)
	if err != nil {
		if metrics.RefreshBlacklistCheckErrors != nil {
			metrics.RefreshBlacklistCheckErrors.Inc()
		}
		if config.AuthFailClosed() {
			slog.Warn("refresh blacklist check error, fail-closed",
				"key", key, "error", err)
			return errcode.AuthRefreshInvalid
		}
		slog.Warn("refresh blacklist check error, fail-open",
			"key", key, "error", err)
		return nil
	}
	if blacklisted {
		return errcode.AuthRefreshInvalid
	}
	return nil
}

// Logout revokes all refresh tokens for the given user and device,
// both in the database and in the Redis blacklist (#66).
// If deviceType is non-empty, the Redis blacklist is scoped by device_type (#149).
// When accessJTI is non-empty, the access token jti is also blacklisted until
// AccessTTL elapses so middleware rejects the token immediately (#888).
func (s *Service) Logout(ctx context.Context, userID, deviceID, deviceType, accessJTI string) error {
	// Write to Redis blacklist so token validation can check without hitting DB (#66).
	// BlacklistRefreshToken prepends "rt_blacklist:" internally, so we only pass the
	// logical key suffix here.
	blacklistKey := userID + ":" + deviceID
	if deviceType != "" {
		blacklistKey = userID + ":" + deviceID + ":" + deviceType
	}
	if err := resolveAuthCache(s.cacheClient).BlacklistRefreshToken(ctx, blacklistKey, s.jwtCfg.RefreshTTL); err != nil {
		slog.Warn("logout: failed to blacklist in Redis, fallback to DB-only revocation", "key", blacklistKey, "error", err)
	}

	// Blacklist the current access token jti for the remaining access TTL (#888).
	// Without this, a stolen access JWT remains valid until natural expiry.
	if accessJTI != "" {
		if err := resolveAuthCache(s.cacheClient).BlacklistAccessToken(ctx, accessJTI, s.jwtCfg.AccessTTL); err != nil {
			slog.Warn("logout: failed to blacklist access jti in Redis", "jti", accessJTI, "error", err)
		}
	}

	// Also revoke in the database (source of truth).
	// Idempotent: skip when userID or deviceID is empty so that callers
	// without a stored refresh token (e.g. manually-issued JWT) still get 200.
	if userID == "" || deviceID == "" {
		return nil
	}
	return repository.RevokeRefreshTokensByUserDevice(s.db, userID, deviceID)
}

func (s *Service) GetMe(ctx context.Context, userID string) (*model.User, error) {
	user, err := repository.GetUserByID(s.db, userID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errcode.UserNotFound
		}
		return nil, err
	}
	return user, nil
}

func (s *Service) UpdateProfile(ctx context.Context, userID, nickname, avatarURL string) (*model.User, error) {
	user, err := repository.GetUserByID(s.db, userID)
	if err != nil {
		return nil, err
	}
	if nickname != "" {
		nickname = strings.TrimSpace(nickname)
		if len(nickname) < 1 || len(nickname) > 50 {
			return nil, errcode.UserInvalidParam
		}
		user.Nickname = nickname
	}
	if avatarURL != "" {
		avatarURL = strings.TrimSpace(avatarURL)
		if err := validateAvatarURL(avatarURL); err != nil {
			return nil, errcode.UserInvalidParam
		}
		user.AvatarURL = avatarURL
	}
	if err := repository.UpdateUser(s.db, user); err != nil {
		return nil, err
	}
	return user, nil
}

// validateAvatarURL checks that the given URL is well-formed and uses an
// allowed scheme (http or https).
func validateAvatarURL(raw string) error {
	if len(raw) > 2048 {
		return errors.New("avatar URL too long")
	}
	u, err := url.Parse(raw)
	if err != nil {
		return err
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return errors.New("avatar URL scheme must be http or https")
	}
	if u.Host == "" {
		return errors.New("avatar URL has no host")
	}
	return nil
}
