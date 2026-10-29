package oidc

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/url"
	"time"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/jwtutil"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/redis/go-redis/v9"
)

type BrowserSessionResponse struct {
	User      model.User `json:"user"`
	ExpiresAt time.Time  `json:"expires_at"`
	CSRFToken string     `json:"csrf_token"`
}

type browserFlow struct {
	CookieHash string `json:"cookie_hash"`
	Verifier   string `json:"verifier"`
	DeviceID   string `json:"device_id"`
}

// BeginBrowserLogin retains PKCE only on the server. The flow cookie binds
// the authorization response to the browser that initiated it.
func (s *Service) BeginBrowserLogin(ctx context.Context, cfg config.BrowserSessionConfig, deviceID string) (*AuthorizationResult, string, error) {
	verifier, err := randomURLToken(32)
	if err != nil {
		return nil, "", err
	}
	cookie, err := randomURLToken(32)
	if err != nil {
		return nil, "", err
	}
	challenge := sha256.Sum256([]byte(verifier))
	auth, err := s.GenerateAuthorizationURL(ctx, base64.RawURLEncoding.EncodeToString(challenge[:]), "S256", "web", deviceID, cfg.RedirectURI)
	if err != nil {
		return nil, "", err
	}
	flow, _ := json.Marshal(browserFlow{CookieHash: jwtutil.HashRefreshToken(cookie), Verifier: verifier, DeviceID: deviceID})
	if err := s.cache.GetRDB().Set(ctx, "oidc:browser:"+auth.State, flow, oidcStateTTL).Err(); err != nil {
		return nil, "", errcode.AuthUnavailable
	}
	return auth, cookie, nil
}

func (s *Service) CompleteBrowserLogin(ctx context.Context, cfg config.BrowserSessionConfig, code, state, issuer, cookie string) (*BrowserSessionResponse, string, error) {
	if state == "" || cookie == "" || len(state) > 128 || len(cookie) > 128 {
		return nil, "", errcode.OIDCInvalidState
	}
	raw, err := s.cache.GetRDB().GetDel(ctx, "oidc:browser:"+state).Bytes()
	if errors.Is(err, redis.Nil) {
		return nil, "", errcode.OIDCInvalidState
	}
	if err != nil {
		return nil, "", errcode.AuthUnavailable
	}
	var flow browserFlow
	if json.Unmarshal(raw, &flow) != nil || flow.Verifier == "" || subtle.ConstantTimeCompare([]byte(flow.CookieHash), []byte(jwtutil.HashRefreshToken(cookie))) != 1 {
		return nil, "", errcode.OIDCInvalidState
	}
	token, err := randomURLToken(32)
	if err != nil {
		return nil, "", err
	}
	csrf, err := randomURLToken(32)
	if err != nil {
		return nil, "", err
	}
	now := time.Now().UTC()
	session := &model.BrowserSession{TokenHash: jwtutil.HashRefreshToken(token), CSRFToken: csrf, CreatedAt: now, ExpiresAt: now.Add(cfg.TTL)}
	result, err := s.handleCallback(ctx, code, state, flow.Verifier, issuer, "web", flow.DeviceID, cfg.RedirectURI, session)
	if err != nil {
		return nil, "", err
	}
	return &BrowserSessionResponse{User: result.User, ExpiresAt: session.ExpiresAt, CSRFToken: csrf}, token, nil
}

// BeginAccountLogout uses the confidential client's cookie-based end-session
// path; no Account ID/access token is retained or forwarded to the browser.
func (s *Service) BeginAccountLogout(ctx context.Context, cfg config.BrowserSessionConfig) (string, string, error) {
	meta, _, err := s.providerMetadata(ctx)
	if err != nil {
		return "", "", errcode.AuthUnavailable
	}
	endpoint, err := url.Parse(meta.EndSessionEndpoint)
	issuer, _ := url.Parse(s.cfg.IssuerURL)
	if err != nil || endpoint.Host == "" || endpoint.Scheme != issuer.Scheme || endpoint.Host != issuer.Host || endpoint.User != nil || endpoint.Fragment != "" {
		return "", "", errcode.AuthUnavailable
	}
	state, err := randomURLToken(32)
	if err != nil {
		return "", "", err
	}
	cookie, err := randomURLToken(32)
	if err != nil {
		return "", "", err
	}
	if err := s.cache.GetRDB().Set(ctx, "oidc:logout:"+state, jwtutil.HashRefreshToken(cookie), oidcStateTTL).Err(); err != nil {
		return "", "", errcode.AuthUnavailable
	}
	query := endpoint.Query()
	query.Set("client_id", s.cfg.ClientID)
	query.Set("post_logout_redirect_uri", cfg.PostLogoutRedirectURI)
	query.Set("state", state)
	endpoint.RawQuery = query.Encode()
	return endpoint.String(), cookie, nil
}

func (s *Service) CompleteAccountLogout(ctx context.Context, state, cookie string) error {
	if state == "" || cookie == "" || len(state) > 128 || len(cookie) > 128 {
		return errcode.OIDCInvalidState
	}
	hash, err := s.cache.GetRDB().GetDel(ctx, "oidc:logout:"+state).Result()
	if errors.Is(err, redis.Nil) {
		return errcode.OIDCInvalidState
	}
	if err != nil {
		return errcode.AuthUnavailable
	}
	if subtle.ConstantTimeCompare([]byte(hash), []byte(jwtutil.HashRefreshToken(cookie))) != 1 {
		return errcode.OIDCInvalidState
	}
	return nil
}

func (s *Service) ApplyBackchannelLogout(ctx context.Context, raw string) (string, int64, error) {
	_, verifier, err := s.providerMetadata(ctx)
	if err != nil {
		return "", 0, errcode.AuthUnavailable
	}
	claims, hash, err := verifier.ParseLogoutToken(ctx, raw, s.cfg.IssuerURL, s.cfg.ClientID)
	if errors.Is(err, jwtutil.ErrAccountKeysUnavailable) {
		return "", 0, errcode.AuthUnavailable
	}
	if err != nil {
		return "", 0, errcode.ErrBadRequest
	}
	identity, generation, err := repository.ApplyAccountLogout(s.db.WithContext(ctx), claims.Issuer, claims.Subject, claims.ID, hash, claims.IssuedAt.Unix(), claims.ExpiresAt.Time.Add(5*time.Minute))
	if errors.Is(err, repository.ErrLogoutJTIReuse) {
		return "", 0, errcode.ErrBadRequest
	}
	if err != nil {
		return "", 0, errcode.AuthUnavailable
	}
	return identity, generation, nil
}
