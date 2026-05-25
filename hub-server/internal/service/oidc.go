package service

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
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

// OIDCService handles TokenDance ID OIDC Authorization Code + PKCE login flow.
type OIDCService struct {
	db     *gorm.DB
	cfg    config.TokenDanceIDConfig
	jwtCfg config.JWTConfig
	cache  *cache.Client
}

// NewOIDCService creates a new OIDCService.
func NewOIDCService(db *gorm.DB, cfg config.TokenDanceIDConfig, jwtCfg config.JWTConfig, cache *cache.Client) *OIDCService {
	return &OIDCService{db: db, cfg: cfg, jwtCfg: jwtCfg, cache: cache}
}

// AuthorizationResult is returned from GenerateAuthorizationURL.
type AuthorizationResult struct {
	State            string `json:"state"`
	AuthorizationURL string `json:"authorization_url"`
}

// CallbackResult is returned from HandleCallback on successful login.
type CallbackResult struct {
	AccessToken  string     `json:"access_token"`
	RefreshToken string     `json:"refresh_token"`
	ExpiresIn    int64      `json:"expires_in"`
	User         model.User `json:"user"`
}

// stateEntry holds the PKCE data temporarily stored in Redis during the OIDC flow.
type stateEntry struct {
	CodeChallenge       string `json:"code_challenge"`
	CodeChallengeMethod string `json:"code_challenge_method"`
	DeviceType          string `json:"device_type"`
	DeviceID            string `json:"device_id"`
	CreatedAt           int64  `json:"created_at"`
}

// GenerateAuthorizationURL creates a random state, stores PKCE parameters in Redis,
// and returns the full TokenDance ID authorization URL.
func (s *OIDCService) GenerateAuthorizationURL(ctx context.Context, codeChallenge, codeChallengeMethod, deviceType, deviceID string) (*AuthorizationResult, error) {
	if codeChallenge == "" {
		return nil, errcode.ErrBadRequest
	}
	if codeChallengeMethod == "" {
		codeChallengeMethod = "S256"
	}
	if deviceType == "" || deviceID == "" {
		return nil, errcode.ErrBadRequest
	}

	// Generate cryptographically random state (32 bytes -> base64url)
	stateBytes := make([]byte, 32)
	if _, err := rand.Read(stateBytes); err != nil {
		return nil, fmt.Errorf("generate state: %w", err)
	}
	state := base64.RawURLEncoding.EncodeToString(stateBytes)

	// Store PKCE data in Redis with 10-minute TTL
	entry := stateEntry{
		CodeChallenge:       codeChallenge,
		CodeChallengeMethod: codeChallengeMethod,
		DeviceType:          deviceType,
		DeviceID:            deviceID,
		CreatedAt:           time.Now().Unix(),
	}
	entryJSON, err := json.Marshal(entry)
	if err != nil {
		return nil, fmt.Errorf("marshal state entry: %w", err)
	}
	stateKey := "oidc:state:" + state
	if err := s.cache.GetRDB().Set(ctx, stateKey, string(entryJSON), 10*time.Minute).Err(); err != nil {
		return nil, fmt.Errorf("store state in redis: %w", err)
	}

	// Build the TokenDance ID authorization URL
	authURL, err := url.Parse(s.cfg.IssuerURL + "/oidc/authorize")
	if err != nil {
		return nil, fmt.Errorf("parse issuer url: %w", err)
	}
	q := authURL.Query()
	q.Set("response_type", "code")
	q.Set("client_id", s.cfg.ClientID)
	q.Set("redirect_uri", s.cfg.RedirectURI)
	q.Set("scope", "openid profile")
	q.Set("state", state)
	q.Set("code_challenge", codeChallenge)
	q.Set("code_challenge_method", codeChallengeMethod)
	authURL.RawQuery = q.Encode()

	return &AuthorizationResult{
		State:            state,
		AuthorizationURL: authURL.String(),
	}, nil
}

// HandleCallback validates the OIDC callback, exchanges the authorization code,
// validates the ID token, maps the TokenDance sub to a Hub user, and issues Hub tokens.
func (s *OIDCService) HandleCallback(ctx context.Context, code, state, codeVerifier, deviceType, deviceID string) (*CallbackResult, error) {
	// 1. Atomically consume state from Redis (GetDel = GET + DEL in one command).
	//    This prevents replay attacks that could exploit the race window between
	//    separate Get/Delete operations.
	stateKey := "oidc:state:" + state
	entryJSON, err := s.cache.GetRDB().GetDel(ctx, stateKey).Result()
	if err != nil {
		return nil, errcode.OIDCInvalidState
	}

	var entry stateEntry
	if err := json.Unmarshal([]byte(entryJSON), &entry); err != nil {
		return nil, errcode.OIDCInvalidState
	}

	// Verify device info matches what was stored during authorization
	if entry.DeviceType != deviceType || entry.DeviceID != deviceID {
		return nil, errcode.OIDCInvalidState
	}

	// 2. Exchange authorization code for tokens at TokenDance ID
	tokenResponse, err := s.exchangeCode(ctx, code, codeVerifier)
	if err != nil {
		return nil, errcode.OIDCCodeExchangeFailed
	}
	if tokenResponse.IDToken == "" {
		return nil, errcode.OIDCIDTokenInvalid
	}

	// 3. Validate ID token (signature, issuer, audience, expiry)
	claims, err := jwtutil.ParseTokenDanceJWT(tokenResponse.IDToken, s.cfg.IssuerURL, s.cfg.ClientID)
	if err != nil {
		return nil, errcode.OIDCIDTokenInvalid
	}
	if claims.Subject == "" {
		return nil, errcode.OIDCSubNotFound
	}

	// 4. Find or create Hub user by TokenDance sub
	user, err := repository.FindOrCreateByTokenDanceSub(s.db, claims.Subject)
	if err != nil {
		return nil, fmt.Errorf("find or create user by sub: %w", err)
	}

	// 5. Register/update device
	if err := repository.UpsertDevice(s.db, &model.Device{
		ID: deviceID, UserID: user.ID, DeviceType: deviceType, Capabilities: "[]",
	}); err != nil {
		return nil, fmt.Errorf("upsert device: %w", err)
	}

	// 6. Issue Hub access token
	accessToken, err := jwtutil.GenerateAccessToken(user.ID, deviceType, deviceID,
		s.jwtCfg.Secret, s.jwtCfg.AccessTTL)
	if err != nil {
		return nil, fmt.Errorf("generate access token: %w", err)
	}

	// 7. Issue Hub refresh token
	rawRefresh, err := jwtutil.GenerateRefreshToken()
	if err != nil {
		return nil, fmt.Errorf("generate refresh token: %w", err)
	}
	tokenHash := jwtutil.HashRefreshToken(rawRefresh)
	rt := &model.RefreshToken{
		UserID: user.ID, DeviceType: deviceType, DeviceID: deviceID,
		TokenHash: tokenHash,
		ExpiresAt: time.Now().Add(s.jwtCfg.RefreshTTL),
	}
	if err := repository.UpsertRefreshToken(s.db, rt); err != nil {
		return nil, fmt.Errorf("upsert refresh token: %w", err)
	}

	// 8. State was already consumed atomically via GetDel — no explicit Del needed.

	return &CallbackResult{
		AccessToken:  accessToken,
		RefreshToken: rawRefresh,
		ExpiresIn:    int64(s.jwtCfg.AccessTTL.Seconds()),
		User:         *user,
	}, nil
}

// tokenEndpointResponse is the JSON response from TokenDance ID's /oidc/token endpoint.
type tokenEndpointResponse struct {
	AccessToken  string `json:"access_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int    `json:"expires_in"`
	IDToken      string `json:"id_token"`
	RefreshToken string `json:"refresh_token,omitempty"`
}

// exchangeCode POSTs the authorization code to TokenDance ID's token endpoint.
func (s *OIDCService) exchangeCode(ctx context.Context, code, codeVerifier string) (*tokenEndpointResponse, error) {
	form := url.Values{}
	form.Set("grant_type", "authorization_code")
	form.Set("code", code)
	form.Set("redirect_uri", s.cfg.RedirectURI)
	form.Set("client_id", s.cfg.ClientID)
	form.Set("client_secret", s.cfg.ClientSecret)
	form.Set("code_verifier", codeVerifier)

	tokenURL := s.cfg.IssuerURL + "/oidc/token"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, tokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, fmt.Errorf("build token request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("token endpoint request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read token response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("token endpoint returned %d: %s", resp.StatusCode, string(body))
	}

	var tokenResp tokenEndpointResponse
	if err := json.Unmarshal(body, &tokenResp); err != nil {
		return nil, fmt.Errorf("parse token response: %w", err)
	}
	return &tokenResp, nil
}
