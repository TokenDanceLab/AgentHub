package service

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"slices"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
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

// validDeviceTypes enumerates the allowed device_type values for Hub login.
var validDeviceTypes = []string{"desktop", "web", "cli"}

type AuthService struct {
	db          *gorm.DB
	jwtCfg      config.JWTConfig
	cacheClient authCache
}

func NewAuthService(db *gorm.DB, jwtCfg config.JWTConfig, cacheClient *cache.Client) *AuthService {
	return &AuthService{db: db, jwtCfg: jwtCfg, cacheClient: resolveAuthCache(cacheClient)}
}

type LoginResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int64  `json:"expires_in"`
}

func (s *AuthService) Register(ctx context.Context, username, password, nickname string) (*model.User, error) {
	if len(username) < 4 || len(username) > 32 {
		return nil, errcode.UserInvalidParam
	}
	if len(password) < config.MinPasswordLength || len(password) > config.MaxPasswordLength {
		return nil, errcode.UserInvalidParam
	}
	if len(nickname) < 1 || len(nickname) > config.MaxPasswordLength {
		return nil, errcode.UserInvalidParam
	}

	_, err := repository.GetUserByUsername(s.db, username)
	if err == nil {
		return nil, errcode.UserUsernameTaken
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), 10)
	if err != nil {
		return nil, err
	}

	user := &model.User{
		Username:     username,
		PasswordHash: string(hash),
		Nickname:     nickname,
	}
	if err := repository.CreateUser(s.db, user); err != nil {
		return nil, err
	}
	return user, nil
}

func (s *AuthService) Login(ctx context.Context, username, password, deviceType, deviceID string) (*LoginResponse, error) {
	// Validate device_type against the allowed enum (#161).
	if !slices.Contains(validDeviceTypes, deviceType) {
		return nil, &errcode.Error{
			Code:       errcode.ErrBadRequest.Code,
			Message:    fmt.Sprintf("device_type must be one of desktop, web, cli (got %q)", deviceType),
			HTTPStatus: errcode.ErrBadRequest.HTTPStatus,
		}
	}

	user, err := repository.GetUserByUsername(s.db, username)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errcode.AuthInvalidCredentials
		}
		return nil, err
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)); err != nil {
		return nil, errcode.AuthInvalidCredentials
	}

	if err := repository.UpsertDevice(s.db, &model.Device{
		ID: deviceID, UserID: user.ID, DeviceType: deviceType, Capabilities: "[]",
	}); err != nil {
		if errors.Is(err, repository.ErrDeviceOwnershipMismatch) {
			return nil, errcode.ErrBadRequest
		}
		return nil, err
	}

	accessToken, err := jwtutil.GenerateAccessToken(user.ID, deviceType, deviceID,
		s.jwtCfg.Secret, s.jwtCfg.AccessTTL)
	if err != nil {
		return nil, err
	}

	rawRefresh, err := jwtutil.GenerateRefreshToken()
	if err != nil {
		return nil, err
	}

	tokenHash := jwtutil.HashRefreshToken(rawRefresh)
	rt := &model.RefreshToken{
		UserID: user.ID, DeviceType: deviceType, DeviceID: deviceID,
		TokenHash: tokenHash,
		ExpiresAt: time.Now().Add(s.jwtCfg.RefreshTTL),
	}
	if err := repository.UpsertRefreshToken(s.db, rt); err != nil {
		return nil, err
	}

	return &LoginResponse{
		AccessToken:  accessToken,
		RefreshToken: rawRefresh,
		ExpiresIn:    int64(s.jwtCfg.AccessTTL.Seconds()),
	}, nil
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

func (s *AuthService) ChangePassword(ctx context.Context, userID, oldPassword, newPassword string) error {
	if len(newPassword) < config.MinPasswordLength || len(newPassword) > config.MaxPasswordLength {
		return errcode.UserInvalidParam
	}

	user, err := repository.GetUserByID(s.db, userID)
	if err != nil {
		return err
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(oldPassword)); err != nil {
		return errcode.AuthInvalidCredentials
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(newPassword), 10)
	if err != nil {
		return err
	}

	if err := repository.UpdatePasswordAndRevokeTokens(s.db, userID, string(hash)); err != nil {
		return err
	}

	resolveAuthCache(s.cacheClient).Invalidate(ctx, "user:profile:"+userID)
	return nil
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
