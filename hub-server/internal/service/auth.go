package service

import (
	"context"
	"errors"
	"net/url"
	"strings"
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/cache"
	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/jwtutil"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
)

// authCache is the subset of *cache.Client methods used by AuthService.
type authCache interface {
	Invalidate(ctx context.Context, keys ...string) error
	BlacklistRefreshToken(ctx context.Context, tokenHash string, ttl time.Duration) error
}

// LoginResponse is returned to clients after successful authentication.
type LoginResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int64  `json:"expires_in"`
}

type AuthService struct {
	db          *gorm.DB
	jwtCfg      config.JWTConfig
	cacheClient authCache
}

func NewAuthService(db *gorm.DB, jwtCfg config.JWTConfig, cacheClient *cache.Client) *AuthService {
	return &AuthService{db: db, jwtCfg: jwtCfg, cacheClient: resolveAuthCache(cacheClient)}
}

// RefreshToken validates a refresh token, issues a new access token,
// and rotates the refresh token (#134: old one is revoked, new one is issued).
func (s *AuthService) RefreshToken(ctx context.Context, rawRefreshToken string) (*LoginResponse, error) {
	tokenHash := jwtutil.HashRefreshToken(rawRefreshToken)
	rt, err := repository.FindRefreshTokenByHash(s.db, tokenHash)
	if err != nil {
		return nil, errcode.AuthRefreshInvalid
	}
	if rt.Revoked || time.Now().After(rt.ExpiresAt) {
		return nil, errcode.AuthRefreshInvalid
	}

	// Rotate: revoke the old refresh token.
	if err := repository.RevokeRefreshTokensByUserDevice(s.db, rt.UserID, rt.DeviceID); err != nil {
		return nil, err
	}

	// Blacklist the old token hash in Redis for the remaining TTL (#134).
	remainingTTL := time.Until(rt.ExpiresAt)
	if remainingTTL > 0 {
		_ = resolveAuthCache(s.cacheClient).BlacklistRefreshToken(ctx, tokenHash, remainingTTL)
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

// Logout revokes all refresh tokens for the given user and device,
// both in the database and in the Redis blacklist (#66).
// If deviceType is non-empty, the Redis blacklist is scoped by device_type (#149).
func (s *AuthService) Logout(ctx context.Context, userID, deviceID, deviceType string) error {
	// Write to Redis blacklist so token validation can check without hitting DB (#66).
	// BlacklistRefreshToken prepends "rt_blacklist:" internally, so we only pass the
	// logical key suffix here.
	blacklistKey := userID + ":" + deviceID
	if deviceType != "" {
		blacklistKey = userID + ":" + deviceID + ":" + deviceType
	}
	_ = resolveAuthCache(s.cacheClient).BlacklistRefreshToken(ctx, blacklistKey, s.jwtCfg.RefreshTTL)

	// Also revoke in the database (source of truth).
	return repository.RevokeRefreshTokensByUserDevice(s.db, userID, deviceID)
}

func (s *AuthService) GetMe(ctx context.Context, userID string) (*model.User, error) {
	user, err := repository.GetUserByID(s.db, userID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errcode.UserNotFound
		}
		return nil, err
	}
	return user, nil
}

func (s *AuthService) UpdateProfile(ctx context.Context, userID, nickname, avatarURL string) (*model.User, error) {
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
	resolveAuthCache(s.cacheClient).Invalidate(ctx, "user:profile:"+userID)
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
