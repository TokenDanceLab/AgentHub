package oidc

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
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
	"github.com/agenthub/hub-server/internal/metrics"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/outboundhttp"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/pkg/outboundmetrics"
	"github.com/agenthub/pkg/reqlog"
)

// Service handles TokenDance ID OIDC Authorization Code + PKCE login flow.
type Service struct {
	db     *gorm.DB
	cfg    config.TokenDanceIDConfig
	jwtCfg config.JWTConfig
	cache  *cache.Client
	// httpClient is the purpose-built TokenDance ID token-exchange client
	// (#1564). Built once in NewService from the injected config with the
	// default outbound policy: bounded timeout, redirects refused (the form
	// body carries client_secret, so it must never be replayed to another
	// origin), default TLS verification.
	httpClient *http.Client
	// tdVerifier validates TokenDance ID-issued RS256 ID tokens against the
	// configured JWKS endpoint. Instance-owned (#1551/#1564): URI, client,
	// cache and refresh policy injected; nil when TokenDance ID is not
	// configured (ID-token validation is skipped upstream).
	tdVerifier *jwtutil.TokenDanceVerifier
}

var validDeviceTypes = []string{"desktop", "web", "cli"}

const oidcStateTTL = 10 * time.Minute

// NewService creates a new OIDC Service.
func NewService(db *gorm.DB, cfg config.TokenDanceIDConfig, jwtCfg config.JWTConfig, cache *cache.Client) *Service {
	jwksURI := cfg.JWKSURI
	if jwksURI == "" && cfg.IssuerURL != "" {
		jwksURI = strings.TrimRight(cfg.IssuerURL, "/") + "/oidc/jwks"
	}
	var tdVerifier *jwtutil.TokenDanceVerifier
	if jwksURI != "" {
		tdVerifier = jwtutil.NewTokenDanceVerifier(jwksURI, jwtutil.VerifierConfig{
			HTTPClient:      outboundhttp.NewClient(cfg.HTTPTimeout),
			MaxBodyBytes:    cfg.MaxResponseBodyBytes,
			OutboundMetrics: metrics.OutboundMetrics,
		})
	}
	return &Service{
		db:         db,
		cfg:        cfg,
		jwtCfg:     jwtCfg,
		cache:      cache,
		httpClient: outboundhttp.NewClient(cfg.HTTPTimeout),
		tdVerifier: tdVerifier,
	}
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
func (s *Service) GenerateAuthorizationURL(ctx context.Context, codeChallenge, codeChallengeMethod, deviceType, deviceID, redirectURI string) (*AuthorizationResult, error) {
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

	// Store PKCE data in Redis with a short TTL.
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
	if err := s.cache.GetRDB().Set(ctx, stateKey, string(entryJSON), oidcStateTTL).Err(); err != nil {
		return nil, fmt.Errorf("store state in redis: %w", err)
	}
	slog.Debug("oidc.state.stored", "state", state[:8]+"...", "ttl", oidcStateTTL.String())

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
	q.Set("prompt", "consent")
	authURL.RawQuery = q.Encode()
	slog.Debug("oidc.authorize.url", "authorization_url_prefix", authURL.Scheme+"://"+authURL.Host+authURL.Path)

	return &AuthorizationResult{
		State:            state,
		AuthorizationURL: authURL.String(),
	}, nil
}

// HandleCallback validates the OIDC callback, exchanges the authorization code,
// validates the ID token, maps the TokenDance sub to a Hub user, and issues Hub tokens.
func (s *Service) HandleCallback(ctx context.Context, code, state, codeVerifier, deviceType, deviceID, redirectURI string) (*CallbackResult, error) {
	var err error
	deviceType, deviceID, err = normalizeOIDCDevice(deviceType, deviceID)
	if err != nil {
		return nil, err
	}

	// 1. Atomically consume state from Redis (GetDel = GET + DEL in one command).
	//    This prevents replay attacks that could exploit the race window between
	//    separate Get/Delete operations.
	entry, err := s.consumeCallbackState(ctx, state, codeVerifier, deviceType, deviceID, redirectURI)
	if err != nil {
		return nil, err
	}

	// 2. Exchange authorization code for tokens at TokenDance ID and validate
	//    the ID token (signature, issuer, audience, expiry).
	claims, err := s.exchangeAndValidateIDToken(ctx, code, codeVerifier, entry)
	if err != nil {
		return nil, err
	}

	// 3. Find or create Hub user by TokenDance sub, with profile from ID token
	slog.Debug("oidc.user.find_or_create", "sub", claims.Subject, "picture_len", len(claims.Picture))
	user, err := repository.FindOrCreateByTokenDanceSub(s.db, claims.Subject, claims.Name, claims.Picture)
	if err != nil {
		return nil, fmt.Errorf("find or create user by sub: %w", err)
	}
	slog.Debug("oidc.user.mapped", "sub", claims.Subject, "user_id", user.ID)

	// 4. Register/update device
	if err := repository.UpsertDevice(s.db, &model.Device{
		ID: deviceID, UserID: user.ID, DeviceType: deviceType, Capabilities: "[]",
	}); err != nil {
		return nil, fmt.Errorf("upsert device: %w", err)
	}

	// 5. Issue Hub access token
	accessToken, err := jwtutil.GenerateAccessToken(user.ID, deviceType, deviceID,
		s.jwtCfg.Secret, s.jwtCfg.AccessTTL)
	if err != nil {
		return nil, fmt.Errorf("generate access token: %w", err)
	}

	// 6. Issue Hub refresh token
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

	// 7. State was already consumed atomically via GetDel — no explicit Del needed.

	return &CallbackResult{
		AccessToken:  accessToken,
		RefreshToken: rawRefresh,
		ExpiresIn:    int64(s.jwtCfg.AccessTTL.Seconds()),
		User:         *user,
	}, nil
}

// consumeCallbackState atomically consumes the stored authorize state from
// Redis and verifies device, redirect URI and PKCE code_verifier. Every
// violation fails closed with OIDCInvalidState, matching the original
// check order so error precedence is preserved.
func (s *Service) consumeCallbackState(ctx context.Context, state, codeVerifier, deviceType, deviceID, redirectURI string) (*stateEntry, error) {
	stateKey := "oidc:state:" + state
	entryJSON, err := s.cache.GetRDB().GetDel(ctx, stateKey).Result()
	if err != nil {
		return nil, errcode.OIDCInvalidState
	}
	slog.Debug("oidc.state.consumed", "state", state[:8]+"...")

	var entry stateEntry
	if err := json.Unmarshal([]byte(entryJSON), &entry); err != nil {
		return nil, errcode.OIDCInvalidState
	}
	if entry.CreatedAt <= 0 || time.Since(time.Unix(entry.CreatedAt, 0)) > oidcStateTTL {
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

	// Local PKCE verification (defense in depth): confirm the caller's
	// code_verifier hashes to the code_challenge stored during authorize.
	// TokenDance ID also checks this server-side, but a local check rejects a
	// mismatched verifier before the network round-trip and makes the trust
	// boundary explicit at the Hub. Only S256 is supported (enforced at
	// authorize time); a missing/empty verifier is a client bug and fails closed.
	if codeVerifier == "" {
		return nil, errcode.OIDCInvalidState
	}
	if entry.CodeChallengeMethod != "S256" {
		return nil, errcode.OIDCInvalidState
	}
	verifierDigest := sha256.Sum256([]byte(codeVerifier))
	computedChallenge := base64.RawURLEncoding.EncodeToString(verifierDigest[:])
	if !slices.Equal([]byte(computedChallenge), []byte(entry.CodeChallenge)) {
		return nil, errcode.OIDCInvalidState
	}
	return &entry, nil
}

// exchangeAndValidateIDToken exchanges the authorization code for tokens and
// validates the ID token (signature, issuer, audience, expiry).
func (s *Service) exchangeAndValidateIDToken(ctx context.Context, code, codeVerifier string, entry *stateEntry) (*jwtutil.TokenDanceClaims, error) {
	slog.Debug("oidc.token.exchange.start", "redirect_uri", entry.RedirectURI, "code_len", len(code), "verifier_len", len(codeVerifier))
	tokenResponse, err := s.exchangeCode(ctx, code, codeVerifier, entry.RedirectURI)
	if err != nil {
		return nil, errcode.OIDCCodeExchangeFailed
	}
	slog.Debug("oidc.token.exchange.ok", "has_id_token", tokenResponse.IDToken != "")
	if tokenResponse.IDToken == "" {
		return nil, errcode.OIDCIDTokenInvalid
	}

	if s.tdVerifier == nil {
		return nil, errcode.OIDCIDTokenInvalid
	}
	claims, err := s.tdVerifier.ParseJWT(tokenResponse.IDToken, s.cfg.IssuerURL, s.cfg.ClientID)
	if err != nil {
		return nil, errcode.OIDCIDTokenInvalid
	}
	slog.Debug("oidc.jwt.validated", "sub", claims.Subject)
	if claims.Subject == "" {
		return nil, errcode.OIDCSubNotFound
	}
	return claims, nil
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
func (s *Service) exchangeCode(ctx context.Context, code, codeVerifier, redirectURI string) (*tokenEndpointResponse, error) {
	form := url.Values{}
	form.Set("grant_type", "authorization_code")
	form.Set("code", code)
	form.Set("redirect_uri", redirectURI)
	form.Set("client_id", s.cfg.ClientID)
	form.Set("client_secret", s.cfg.ClientSecret)
	form.Set("code_verifier", codeVerifier)

	tokenURL := s.cfg.TokenURL
	if tokenURL == "" {
		tokenURL = strings.TrimRight(s.cfg.IssuerURL, "/") + "/oidc/token"
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, tokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, fmt.Errorf("build token request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	// Correlation contract (#1595): propagate the caller's request id so the
	// provider side can join its logs to the originating Hub request.
	reqlog.SetRequestIDHeader(ctx, req.Header)

	started := time.Now()
	resp, err := s.httpClient.Do(req)
	if err != nil {
		slog.Error("oidc provider code exchange unreachable",
			"provider", oidcProviderHost(tokenURL),
			"request_id", reqlog.GetRequestID(ctx),
			"error_category", "network_error",
			"error", err,
		)
		metrics.OutboundMetrics.Record(outboundmetrics.ProviderTokenDanceID, outboundmetrics.PurposeTokenExchange, outboundmetrics.CategoryFailure, "network_error")
		return nil, fmt.Errorf("token endpoint request: %w", err)
	}
	defer resp.Body.Close()

	body, err := outboundhttp.ReadLimited(resp.Body, s.cfg.MaxResponseBodyBytes)
	if err != nil {
		// Fail-closed: a provider response beyond the cap is refused and the
		// body content never surfaces in logs (#1564).
		slog.Error("oidc provider code exchange response too large",
			"provider", oidcProviderHost(tokenURL),
			"request_id", reqlog.GetRequestID(ctx),
			"error_category", "body_too_large",
			"limit", s.cfg.MaxResponseBodyBytes,
		)
		metrics.OutboundMetrics.Record(outboundmetrics.ProviderTokenDanceID, outboundmetrics.PurposeTokenExchange, outboundmetrics.CategoryFailure, "body_too_large")
		return nil, fmt.Errorf("token endpoint response too large")
	}

	if resp.StatusCode != http.StatusOK {
		category := oidcProviderErrorCategory(body)
		slog.Error("oidc provider code exchange failed",
			"status", resp.StatusCode,
			"provider", oidcProviderHost(tokenURL),
			"request_id", reqlog.GetRequestID(ctx),
			"error_category", category,
			"body_len", len(body),
			"body_sha256", oidcBodySHA256(body),
		)
		metrics.OutboundMetrics.Record(outboundmetrics.ProviderTokenDanceID, outboundmetrics.PurposeTokenExchange, outboundmetrics.CategoryFailure, "non_success")
		return nil, fmt.Errorf("provider code exchange failed: status=%d category=%s", resp.StatusCode, category)
	}

	var tokenResp tokenEndpointResponse
	if err := json.Unmarshal(body, &tokenResp); err != nil {
		metrics.OutboundMetrics.Record(outboundmetrics.ProviderTokenDanceID, outboundmetrics.PurposeTokenExchange, outboundmetrics.CategoryFailure, "decode_fail")
		return nil, fmt.Errorf("parse token response: %w", err)
	}
	metrics.OutboundMetrics.Record(outboundmetrics.ProviderTokenDanceID, outboundmetrics.PurposeTokenExchange, outboundmetrics.CategorySuccess, outboundmetrics.StatusOK)
	metrics.OutboundMetrics.Observe(outboundmetrics.ProviderTokenDanceID, outboundmetrics.PurposeTokenExchange, outboundmetrics.CategorySuccess, outboundmetrics.StatusOK, time.Since(started))
	return &tokenResp, nil
}

func oidcProviderHost(rawURL string) string {
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Host == "" {
		return "unknown"
	}
	return parsed.Host
}

func oidcBodySHA256(body []byte) string {
	sum := sha256.Sum256(body)
	return fmt.Sprintf("%x", sum[:])
}

func oidcProviderErrorCategory(body []byte) string {
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		return "provider_error"
	}
	raw, ok := payload["error"].(string)
	if !ok {
		return "provider_error"
	}
	return sanitizeOIDCErrorCategory(raw)
}

func sanitizeOIDCErrorCategory(value string) string {
	value = strings.TrimSpace(value)
	if value == "" || len(value) > 64 {
		return "provider_error"
	}
	lower := strings.ToLower(value)
	for _, forbidden := range []string{
		"access_token",
		"refresh_token",
		"id_token",
		"client_secret",
		"code_verifier",
		"authorization code",
	} {
		if strings.Contains(lower, forbidden) {
			return "provider_error"
		}
	}
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_' || r == '-' || r == '.' {
			continue
		}
		return "provider_error"
	}
	return value
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
