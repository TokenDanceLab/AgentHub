package service

import (
	"context"
	"errors"
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

type AuthService struct {
	db *gorm.DB
}

func NewAuthService(db *gorm.DB) *AuthService {
	return &AuthService{db: db}
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
	if len(password) < 8 || len(password) > 64 {
		return nil, errcode.UserInvalidParam
	}
	if len(nickname) < 1 || len(nickname) > 64 {
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
		return nil, err
	}

	accessToken, err := jwtutil.GenerateAccessToken(user.ID, deviceType, deviceID,
		config.Cfg.JWT.Secret, config.Cfg.JWT.AccessTTL)
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
		ExpiresAt: time.Now().Add(config.Cfg.JWT.RefreshTTL),
	}
	if err := repository.UpsertRefreshToken(s.db, rt); err != nil {
		return nil, err
	}

	return &LoginResponse{
		AccessToken:  accessToken,
		RefreshToken: rawRefresh,
		ExpiresIn:    int64(config.Cfg.JWT.AccessTTL.Seconds()),
	}, nil
}

func (s *AuthService) RefreshToken(ctx context.Context, rawRefreshToken string) (*LoginResponse, error) {
	tokenHash := jwtutil.HashRefreshToken(rawRefreshToken)
	rt, err := repository.FindRefreshTokenByHash(s.db, tokenHash)
	if err != nil {
		return nil, errcode.AuthRefreshInvalid
	}
	if rt.Revoked || time.Now().After(rt.ExpiresAt) {
		return nil, errcode.AuthRefreshInvalid
	}

	accessToken, err := jwtutil.GenerateAccessToken(rt.UserID, rt.DeviceType, rt.DeviceID,
		config.Cfg.JWT.Secret, config.Cfg.JWT.AccessTTL)
	if err != nil {
		return nil, err
	}

	return &LoginResponse{
		AccessToken:  accessToken,
		RefreshToken: rawRefreshToken,
		ExpiresIn:    int64(config.Cfg.JWT.AccessTTL.Seconds()),
	}, nil
}

func (s *AuthService) Logout(ctx context.Context, userID, deviceID string) error {
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
		user.Nickname = nickname
	}
	if avatarURL != "" {
		user.AvatarURL = avatarURL
	}
	if err := repository.UpdateUser(s.db, user); err != nil {
		return nil, err
	}
	cache.Invalidate(ctx, "user:profile:"+userID)
	return user, nil
}

func (s *AuthService) ChangePassword(ctx context.Context, userID, oldPassword, newPassword string) error {
	if len(newPassword) < 8 || len(newPassword) > 64 {
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

	if err := repository.UpdatePassword(s.db, userID, string(hash)); err != nil {
		return err
	}

	cache.Invalidate(ctx, "user:profile:"+userID)
	return repository.RevokeAllUserTokens(s.db, userID)
}
