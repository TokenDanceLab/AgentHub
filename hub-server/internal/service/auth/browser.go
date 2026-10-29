package auth

import (
	"context"
	"errors"
	"time"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/jwtutil"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"gorm.io/gorm"
)

func (s *Service) BrowserSession(ctx context.Context, cookie string) (*model.BrowserSession, error) {
	if cookie == "" || len(cookie) > 128 {
		return nil, errcode.AuthInvalidToken
	}
	return s.BrowserSessionByHash(ctx, jwtutil.HashRefreshToken(cookie))
}

func (s *Service) BrowserSessionByHash(ctx context.Context, hash string) (*model.BrowserSession, error) {
	session, err := repository.FindBrowserSession(s.db.WithContext(ctx), hash, time.Now())
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, errcode.AuthInvalidToken
	}
	if err != nil {
		return nil, errcode.AuthUnavailable
	}
	if s.accountClientID != "" && session.OIDCClientID != s.accountClientID {
		return nil, errcode.AuthInvalidToken
	}
	return session, nil
}

func (s *Service) RevokeBrowserSession(ctx context.Context, hash string) error {
	if err := repository.RevokeBrowserSession(s.db.WithContext(ctx), hash, time.Now().UTC()); err != nil {
		return errcode.AuthUnavailable
	}
	return nil
}

// CheckAccessSession is also used during a live native WebSocket. Revocation
// uses the persisted epoch and never depends on Redis pub/sub delivery.
func (s *Service) CheckAccessSession(ctx context.Context, claims *jwtutil.Claims) error {
	if s.accountClientID != "" && claims.OIDCClientID != s.accountClientID {
		return errcode.AuthInvalidToken
	}
	if claims.ExpiresAt == nil || !claims.ExpiresAt.After(time.Now()) {
		return errcode.AuthInvalidToken
	}
	valid, err := repository.CheckIdentityGeneration(s.db.WithContext(ctx), claims.IdentityID, claims.UserID, claims.AuthGeneration)
	if err != nil {
		return errcode.AuthUnavailable
	}
	if !valid {
		return errcode.AuthInvalidToken
	}
	if s.cacheClient != nil && claims.ID != "" {
		revoked, err := s.cacheClient.IsAccessTokenBlacklisted(ctx, claims.ID)
		if err != nil {
			return errcode.AuthUnavailable
		}
		if revoked {
			return errcode.AuthInvalidToken
		}
	}
	return nil
}
