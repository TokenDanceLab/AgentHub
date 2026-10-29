package auth

import (
	"context"
	"errors"
	"log/slog"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"gorm.io/gorm"

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
	accountClientID        string
	browserSessionsEnabled bool
	db                     *gorm.DB
	jwtCfg                 config.JWTConfig
	cacheClient            authCache
}

var (
	errRefreshClaimLost        = errors.New("refresh rotation claim was lost")
	errRefreshIdentityInactive = errors.New("refresh identity is no longer active")
)

func NewService(db *gorm.DB, jwtCfg config.JWTConfig, cacheClient authCache) *Service {
	return &Service{db: db, jwtCfg: jwtCfg, cacheClient: cacheClient}
}

// SetBrowserSessionsEnabled is configured before serving requests. Existing
// browser bearer refresh chains must not bypass the cookie-session cutover.
func (s *Service) SetBrowserSessionsEnabled(enabled bool) { s.browserSessionsEnabled = enabled }

// SetAccountClientID pins sessions to the current relying-party registration.
// A replacement client requires fresh Account consent, so old-client refresh
// must not silently extend sessions outside the replacement's logout grant set.
func (s *Service) SetAccountClientID(clientID string) { s.accountClientID = clientID }

// RefreshToken validates a refresh token, issues a new access token,
// and rotates the refresh token (#134: old one is revoked, new one is issued).
func (s *Service) RefreshToken(ctx context.Context, rawRefreshToken string) (*LoginResponse, error) {
	tokenHash := jwtutil.HashRefreshToken(rawRefreshToken)
	rt, err := repository.FindRefreshTokenForRotation(s.db, tokenHash)
	if err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}
		return nil, errcode.AuthRefreshInvalid
	}
	if err := s.validateRefreshPresentation(ctx, rt, tokenHash); err != nil {
		return nil, err
	}
	if s.accountClientID != "" && rt.OIDCClientID != s.accountClientID {
		return nil, errcode.AuthRefreshInvalid
	}
	if s.browserSessionsEnabled && rt.DeviceType == "web" {
		return nil, errcode.AuthRefreshInvalid
	}
	rawRefresh, err := jwtutil.GenerateRefreshToken()
	if err != nil {
		return nil, err
	}
	accessToken, err := s.rotateRefreshToken(rt, tokenHash, rawRefresh)
	if err != nil {
		if isRefreshRotationRejection(err) {
			if errors.Is(err, errRefreshClaimLost) {
				s.recordRefreshReuse("rotation rejected", rt)
			}
			return nil, errcode.AuthRefreshInvalid
		}
		return nil, err
	}
	s.blacklistRotatedToken(ctx, tokenHash, rt.ExpiresAt)
	return &LoginResponse{
		AccessToken:  accessToken,
		RefreshToken: rawRefresh,
		ExpiresIn:    int64(s.jwtCfg.AccessTTL.Seconds()),
	}, nil
}

func (s *Service) validateRefreshPresentation(
	ctx context.Context,
	rt *model.RefreshToken,
	tokenHash string,
) error {
	if rt.Revoked {
		// Reuse of a revoked refresh-token row — e.g. a stolen token presented
		// after logout. The response stays AuthRefreshInvalid and does not
		// cascade-revoke other sessions. The raw token and its hash are never
		// logged; only non-secret dimensions are (#134).
		s.recordRefreshReuse("revoked token presented", rt)
		return errcode.AuthRefreshInvalid
	}
	if time.Now().After(rt.ExpiresAt) {
		return errcode.AuthRefreshInvalid
	}
	if rt.UserIdentityID == nil || *rt.UserIdentityID == "" {
		return errcode.AuthRefreshInvalid
	}

	// Check Redis blacklist: the token hash itself (set during rotation),
	// the per-user-device key (set during logout without device_type), and
	// the per-user-device-type key (set during logout with device_type).
	// Any hit means the token was revoked through Redis before the DB
	// commit completed, closing the race window. Redis errors apply the
	// fail-open/fail-closed policy (see enforceRefreshBlacklist, #2053).
	keys := []string{tokenHash, rt.UserID + ":" + rt.DeviceID}
	if rt.DeviceType != "" {
		keys = append(keys, rt.UserID+":"+rt.DeviceID+":"+rt.DeviceType)
	}
	for _, key := range keys {
		if err := s.enforceRefreshBlacklist(ctx, key); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) recordRefreshReuse(reason string, rt *model.RefreshToken) {
	slog.Warn("refresh token reuse: "+reason,
		"user_id", rt.UserID, "device_type", rt.DeviceType)
	if metrics.RefreshTokenReuseTotal != nil {
		metrics.RefreshTokenReuseTotal.Inc()
	}
}

func (s *Service) rotateRefreshToken(rt *model.RefreshToken, tokenHash, rawRefresh string) (string, error) {
	// Claim, device-wide revoke, and replacement upsert commit together. The
	// exact identity row is locked active until commit, closing the race where
	// retirement could land between authorization and new-token insertion.
	var accessToken string
	err := s.db.Transaction(func(tx *gorm.DB) error {
		identity, err := repository.LockRefreshIdentity(tx, *rt.UserIdentityID)
		if err != nil {
			return err
		}
		if identity == nil {
			return errRefreshIdentityInactive
		}
		epoch, err := repository.LockSubjectEpoch(tx, identity.Issuer, identity.Subject)
		if err != nil {
			return err
		}
		accessToken, err = jwtutil.GenerateIdentityAccessToken(rt.UserID, rt.DeviceType, rt.DeviceID, identity.ID, epoch.Generation, s.jwtCfg.Secret, s.jwtCfg.AccessTTL, rt.OIDCClientID)
		if err != nil {
			return err
		}
		claimed, err := repository.ClaimRefreshTokenForRotation(tx, tokenHash)
		if err != nil {
			return err
		}
		if !claimed {
			return errRefreshClaimLost
		}
		if err := repository.RevokeRefreshTokensByUserDevice(tx, rt.UserID, rt.DeviceID); err != nil {
			return err
		}
		newRT := &model.RefreshToken{
			UserID:         rt.UserID,
			DeviceType:     rt.DeviceType,
			DeviceID:       rt.DeviceID,
			UserIdentityID: rt.UserIdentityID,
			OIDCClientID:   rt.OIDCClientID,
			TokenHash:      jwtutil.HashRefreshToken(rawRefresh),
			ExpiresAt:      time.Now().Add(s.jwtCfg.RefreshTTL),
		}
		return repository.UpsertRefreshToken(tx, newRT)
	})
	return accessToken, err
}

func isRefreshRotationRejection(err error) bool {
	return errors.Is(err, errRefreshClaimLost) ||
		errors.Is(err, errRefreshIdentityInactive) ||
		errors.Is(err, gorm.ErrRecordNotFound)
}

func (s *Service) blacklistRotatedToken(ctx context.Context, tokenHash string, expiresAt time.Time) {
	// The DB transaction is the source of truth. Redis only closes the window
	// where another process may still have the old row cached.
	remainingTTL := time.Until(expiresAt)
	if remainingTTL <= 0 {
		return
	}
	if err := s.cacheClient.BlacklistRefreshToken(ctx, tokenHash, remainingTTL); err != nil {
		slog.Warn("refresh token: failed to blacklist in Redis, fallback to DB-only", "error", err)
	}
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
	blacklisted, err := s.cacheClient.IsRefreshTokenBlacklisted(ctx, key)
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
// If deviceType is non-empty, the Redis blacklist is scoped by device_type;
// callers must pass the authenticated token's claim-derived device_type so
// the written key matches the one the refresh path checks.
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
	if err := s.cacheClient.BlacklistRefreshToken(ctx, blacklistKey, s.jwtCfg.RefreshTTL); err != nil {
		slog.Warn("logout: failed to blacklist in Redis, fallback to DB-only revocation", "key", blacklistKey, "error", err)
	}

	// Blacklist the current access token jti for the remaining access TTL (#888).
	// Without this, a stolen access JWT remains valid until natural expiry.
	if accessJTI != "" {
		if err := s.cacheClient.BlacklistAccessToken(ctx, accessJTI, s.jwtCfg.AccessTTL); err != nil {
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
		if count := utf8.RuneCountInString(nickname); count < 1 || count > 64 {
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
	if utf8.RuneCountInString(raw) > 512 {
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
