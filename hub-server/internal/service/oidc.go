package service

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
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

var validDeviceTypes = []string{"desktop", "web", "cli"}

// NewOIDCService creates a new OIDCService.
func NewOIDCService(db *gorm.DB, cfg config.TokenDanceIDConfig, jwtCfg config.JWTConfig, cache *cache.Client) *OIDCService {
	if cfg.JWKSURI != "" {
		jwtutil.SetJWKSURI(cfg.JWKSURI)
	} else if cfg.IssuerURL != "" {
		jwtutil.SetJWKSURI(strings.TrimRight(cfg.IssuerURL, "/") + "/oidc/jwks")
	}
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
	RedirectURI         string `json:"redirect_uri"`
	CreatedAt           int64  `json:"created_at"`
}

// GenerateAuthorizationURL creates a random state, stores PKCE parameters in Redis,
// and returns the full TokenDance ID authorization URL.
func (s *OIDCService) GenerateAuthorizationURL(ctx context.Context, codeChallenge, codeChallengeMethod, deviceType, deviceID, redirectURI string) (*AuthorizationResult, error) {
	if codeChallenge == "" {
		return nil, errcode.ErrBadRequest
	}
	if codeChallengeMethod == "" {
		codeChallengeMethod = "S256"
	}
	codeChallengeMethod = strings.TrimSpace(codeChallengeMethod)
	if codeChallengeMethod != "S256" {
		return nil, errcode.ErrBadRequest.WithMessage("code_challenge_method must be S256")
	}
	var err error
	deviceType, deviceID, err = normalizeOIDCDevice(deviceType, deviceID)
	if err != nil {
		return nil, err
	}
	redirectURI, err = normalizeOIDCRedirectURI(redirectURI, s.cfg.RedirectURI, s.cfg.AllowedRedirectURIs, deviceType)
	if err != nil {
		return nil, err
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
		RedirectURI:         redirectURI,
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
	authURL, err := url.Parse(strings.TrimRight(s.cfg.IssuerURL, "/") + "/oidc/authorize")
	if err != nil {
		return nil, fmt.Errorf("parse issuer url: %w", err)
	}
	q := authURL.Query()
	q.Set("response_type", "code")
	q.Set("client_id", s.cfg.ClientID)
	q.Set("redirect_uri", redirectURI)
	q.Set("scope", "openid profile email")
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
func (s *OIDCService) HandleCallback(ctx context.Context, code, state, codeVerifier, deviceType, deviceID, redirectURI string) (*CallbackResult, error) {
	var err error
	deviceType, deviceID, err = normalizeOIDCDevice(deviceType, deviceID)
	if err != nil {
		return nil, err
	}

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
	if redirectURI == "" {
		redirectURI = entry.RedirectURI
	}
	if redirectURI != entry.RedirectURI {
		return nil, errcode.OIDCInvalidState
	}

	// 2. Exchange authorization code for tokens at TokenDance ID
	tokenResponse, err := s.exchangeCode(ctx, code, codeVerifier, entry.RedirectURI)
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
func (s *OIDCService) exchangeCode(ctx context.Context, code, codeVerifier, redirectURI string) (*tokenEndpointResponse, error) {
	form := url.Values{}
	form.Set("grant_type", "authorization_code")
	form.Set("code", code)
	form.Set("redirect_uri", redirectURI)
	form.Set("client_id", s.cfg.ClientID)
	form.Set("client_secret", s.cfg.ClientSecret)
	form.Set("code_verifier", codeVerifier)

	tokenURL := strings.TrimRight(s.cfg.IssuerURL, "/") + "/oidc/token"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, tokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, fmt.Errorf("build token request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		slog.Error("oidc token endpoint unreachable", "error", err, "token_url", tokenURL)
		return nil, fmt.Errorf("token endpoint request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read token response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		slog.Error("oidc token endpoint returned non-200",
			"status", resp.StatusCode,
			"response_body", string(body),
			"redirect_uri_sent", redirectURI,
		)
		return nil, fmt.Errorf("token endpoint returned %d: %s", resp.StatusCode, string(body))
	}

	var tokenResp tokenEndpointResponse
	if err := json.Unmarshal(body, &tokenResp); err != nil {
		return nil, fmt.Errorf("parse token response: %w", err)
	}
	return &tokenResp, nil
}

func normalizeOIDCDevice(deviceType, deviceID string) (string, string, error) {
	deviceType = strings.TrimSpace(deviceType)
	if !slices.Contains(validDeviceTypes, deviceType) {
		return "", "", errcode.ErrBadRequest.WithMessage("device_type must be one of desktop, web, cli")
	}
	parsed, err := uuid.Parse(strings.TrimSpace(deviceID))
	if err != nil {
		return "", "", errcode.ErrBadRequest.WithMessage("device_id must be a UUID")
	}
	return deviceType, parsed.String(), nil
}

func normalizeOIDCRedirectURI(requested, fallback string, allowed []string, deviceType string) (string, error) {
	redirectURI := strings.TrimSpace(requested)
	if redirectURI == "" {
		redirectURI = strings.TrimSpace(fallback)
	}
	parsed, err := url.Parse(redirectURI)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" || parsed.Fragment != "" {
		return "", errcode.ErrBadRequest.WithMessage("redirect_uri must be an absolute http(s) URL without fragment")
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", errcode.ErrBadRequest.WithMessage("redirect_uri must use http or https")
	}
	normalized := parsed.String()
	if !oidcRedirectAllowed(normalized, fallback, allowed, deviceType) {
		return "", errcode.ErrBadRequest.WithMessage("redirect_uri is not allowed for this TokenDance ID client")
	}
	return normalized, nil
}

func oidcRedirectAllowed(requested, fallback string, allowed []string, deviceType string) bool {
	for _, registered := range oidcAllowedRedirectCandidates(fallback, allowed) {
		registered = strings.TrimSpace(registered)
		if registered == "" {
			continue
		}
		if registered == requested {
			return true
		}
		if (deviceType == "desktop" || deviceType == "cli") && oidcLoopbackRedirectMatch(registered, requested) {
			return true
		}
	}
	return false
}

func oidcAllowedRedirectCandidates(fallback string, allowed []string) []string {
	candidates := make([]string, 0, len(allowed)+1)
	if fallback = strings.TrimSpace(fallback); fallback != "" {
		candidates = append(candidates, fallback)
	}
	return append(candidates, allowed...)
}

func oidcLoopbackRedirectMatch(registered, requested string) bool {
	regURL, err := url.Parse(registered)
	if err != nil {
		return false
	}
	reqURL, err := url.Parse(requested)
	if err != nil {
		return false
	}
	if regURL.Scheme != "http" || reqURL.Scheme != "http" {
		return false
	}
	if regURL.User != nil || reqURL.User != nil {
		return false
	}
	if regURL.Fragment != "" || reqURL.Fragment != "" {
		return false
	}
	if regURL.Port() != "" || reqURL.Port() == "" {
		return false
	}
	port, err := strconv.Atoi(reqURL.Port())
	if err != nil || port < 1 || port > 65535 {
		return false
	}
	if regURL.EscapedPath() != reqURL.EscapedPath() || regURL.RawQuery != reqURL.RawQuery {
		return false
	}
	regIP := net.ParseIP(regURL.Hostname())
	reqIP := net.ParseIP(reqURL.Hostname())
	if regIP == nil || reqIP == nil || !regIP.IsLoopback() || !reqIP.IsLoopback() {
		return false
	}
	return regIP.Equal(reqIP)
}
