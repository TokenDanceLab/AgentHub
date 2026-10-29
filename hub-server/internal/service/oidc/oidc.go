package oidc

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
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

const (
	oidcStateTTL        = 10 * time.Minute
	providerMetadataTTL = 5 * time.Minute
	accountOIDCScopes   = "openid profile"
)

// Service implements the TokenDance Account confidential OIDC BFF flow. It
// discovers only public Account endpoints, exchanges the authorization code
// server-side, verifies the ID token and UserInfo subject, then issues a
// Hub-local session. Account access/ID tokens never become Hub API tokens.
type Service struct {
	db         *gorm.DB
	cfg        config.AccountOIDCConfig
	jwtCfg     config.JWTConfig
	cache      *cache.Client
	httpClient *http.Client

	metadataMu      sync.RWMutex
	metadata        *providerMetadata
	metadataFetched time.Time
	verifier        *jwtutil.AccountOIDCVerifier
}

var validDeviceTypes = []string{"desktop", "web", "cli", "mobile"}

type AuthorizationResult struct {
	State            string `json:"state"`
	AuthorizationURL string `json:"authorization_url"`
	Issuer           string `json:"issuer"`
}

type CallbackResult struct {
	AccessToken  string     `json:"access_token"`
	RefreshToken string     `json:"refresh_token"`
	ExpiresIn    int64      `json:"expires_in"`
	User         model.User `json:"user"`
}

type stateEntry struct {
	CodeChallenge       string `json:"code_challenge"`
	CodeChallengeMethod string `json:"code_challenge_method"`
	DeviceType          string `json:"device_type"`
	DeviceID            string `json:"device_id"`
	RedirectURI         string `json:"redirect_uri"`
	Nonce               string `json:"nonce"`
	CreatedAt           int64  `json:"created_at"`
}

type providerMetadata struct {
	Issuer                string   `json:"issuer"`
	AuthorizationEndpoint string   `json:"authorization_endpoint"`
	TokenEndpoint         string   `json:"token_endpoint"`
	UserInfoEndpoint      string   `json:"userinfo_endpoint"`
	JWKSURI               string   `json:"jwks_uri"`
	EndSessionEndpoint    string   `json:"end_session_endpoint"`
	ResponseTypes         []string `json:"response_types_supported"`
	ResponseModes         []string `json:"response_modes_supported"`
	GrantTypes            []string `json:"grant_types_supported"`
	IDTokenAlgorithms     []string `json:"id_token_signing_alg_values_supported"`
	TokenAuthMethods      []string `json:"token_endpoint_auth_methods_supported"`
	PKCEMethods           []string `json:"code_challenge_methods_supported"`
	Scopes                []string `json:"scopes_supported"`
	RFC9207IssuerResponse bool     `json:"authorization_response_iss_parameter_supported"`
}

func NewService(db *gorm.DB, cfg config.AccountOIDCConfig, jwtCfg config.JWTConfig, cache *cache.Client) *Service {
	return &Service{
		db:         db,
		cfg:        cfg,
		jwtCfg:     jwtCfg,
		cache:      cache,
		httpClient: outboundhttp.NewClient(cfg.HTTPTimeout),
	}
}

func (s *Service) ExpectedIssuer() string {
	return s.cfg.IssuerURL
}

// GenerateAuthorizationURL creates a one-time state and nonce, stores both with
// the PKCE/device/redirect transaction, and returns the discovered Account
// authorization endpoint.
func (s *Service) GenerateAuthorizationURL(
	ctx context.Context,
	codeChallenge, codeChallengeMethod, deviceType, deviceID, redirectURI string,
) (*AuthorizationResult, error) {
	if codeChallengeMethod == "" {
		codeChallengeMethod = "S256"
	}
	if strings.TrimSpace(codeChallengeMethod) != "S256" {
		return nil, errcode.ErrBadRequest.WithMessage("code_challenge_method must be S256")
	}
	if !validPKCEValue(codeChallenge, 43) {
		return nil, errcode.ErrBadRequest.WithMessage("code_challenge must be a base64url-encoded S256 challenge")
	}
	deviceType, deviceID, err := normalizeOIDCDevice(deviceType, deviceID)
	if err != nil {
		return nil, err
	}
	redirectURI, err = normalizeOIDCRedirectURI(redirectURI, s.cfg.RedirectURI, s.cfg.AllowedRedirectURIs)
	if err != nil {
		return nil, err
	}
	meta, _, err := s.providerMetadata(ctx)
	if err != nil {
		return nil, fmt.Errorf("load Account OIDC metadata: %w", err)
	}

	state, err := randomURLToken(32)
	if err != nil {
		return nil, fmt.Errorf("generate state: %w", err)
	}
	nonce, err := randomURLToken(32)
	if err != nil {
		return nil, fmt.Errorf("generate nonce: %w", err)
	}
	entry := stateEntry{
		CodeChallenge:       codeChallenge,
		CodeChallengeMethod: "S256",
		DeviceType:          deviceType,
		DeviceID:            deviceID,
		RedirectURI:         redirectURI,
		Nonce:               nonce,
		CreatedAt:           time.Now().UTC().Unix(),
	}
	entryJSON, err := json.Marshal(entry)
	if err != nil {
		return nil, fmt.Errorf("marshal state entry: %w", err)
	}
	if err := s.cache.GetRDB().Set(ctx, oidcStateKey(state), entryJSON, oidcStateTTL).Err(); err != nil {
		return nil, fmt.Errorf("store state in redis: %w", err)
	}

	authURL, err := url.Parse(meta.AuthorizationEndpoint)
	if err != nil {
		return nil, fmt.Errorf("parse Account authorization endpoint")
	}
	q := authURL.Query()
	q.Set("response_type", "code")
	q.Set("client_id", s.cfg.ClientID)
	q.Set("redirect_uri", redirectURI)
	q.Set("scope", accountOIDCScopes)
	q.Set("state", state)
	q.Set("nonce", nonce)
	q.Set("code_challenge", codeChallenge)
	q.Set("code_challenge_method", "S256")
	q.Set("prompt", "consent")
	authURL.RawQuery = q.Encode()
	slog.Debug("account_oidc.authorize.created",
		"issuer", s.cfg.IssuerURL,
		"provider_host", authURL.Host,
		"device_type", deviceType,
	)
	return &AuthorizationResult{
		State:            state,
		AuthorizationURL: authURL.String(),
		Issuer:           s.cfg.IssuerURL,
	}, nil
}

// HandleCallback consumes the exact state transaction and requires the RFC
// 9207 issuer parameter to match the configured Account issuer before exchange.
func (s *Service) HandleCallback(
	ctx context.Context,
	code, state, codeVerifier, issuerParam, deviceType, deviceID, redirectURI string,
) (*CallbackResult, error) {
	return s.handleCallback(ctx, code, state, codeVerifier, issuerParam, deviceType, deviceID, redirectURI, nil)
}

func (s *Service) handleCallback(ctx context.Context, code, state, codeVerifier, issuerParam, deviceType, deviceID, redirectURI string, browser *model.BrowserSession) (*CallbackResult, error) {
	deviceType, deviceID, err := normalizeOIDCDevice(deviceType, deviceID)
	if err != nil {
		return nil, err
	}
	if !jwtutil.IssuerEqual(issuerParam, s.cfg.IssuerURL) {
		return nil, errcode.OIDCIssuerInvalid
	}
	entry, err := s.consumeCallbackState(ctx, state, codeVerifier, deviceType, deviceID, redirectURI)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(code) == "" {
		return nil, errcode.OIDCCodeExchangeFailed
	}

	meta, verifier, err := s.providerMetadata(ctx)
	if err != nil {
		return nil, fmt.Errorf("load Account OIDC metadata: %w", err)
	}
	tokenResponse, err := s.exchangeCode(ctx, meta.TokenEndpoint, code, codeVerifier, entry.RedirectURI)
	if err != nil {
		return nil, errcode.OIDCCodeExchangeFailed
	}
	if tokenResponse.IDToken == "" || tokenResponse.AccessToken == "" {
		return nil, errcode.OIDCIDTokenInvalid
	}
	claims, err := s.parseCallbackIDToken(ctx, verifier, tokenResponse.IDToken, entry.Nonce, browser != nil)
	if err != nil {
		return nil, err
	}
	profile, err := s.fetchUserInfo(ctx, meta.UserInfoEndpoint, tokenResponse.AccessToken, claims.Subject)
	if err != nil {
		return nil, errcode.OIDCUserInfoInvalid
	}

	var rawRefresh string
	if browser == nil {
		rawRefresh, err = jwtutil.GenerateRefreshToken()
		if err != nil {
			return nil, fmt.Errorf("generate refresh token: %w", err)
		}
	}
	bound, err := repository.CreateBoundAccountSession(s.db.WithContext(ctx), repository.BoundAccountSessionInput{AccountSessionInput: repository.AccountSessionInput{
		OIDCClientID:     s.cfg.ClientID,
		Issuer:           s.cfg.IssuerURL,
		Subject:          claims.Subject,
		Name:             profile.Name,
		Picture:          profile.Picture,
		DeviceType:       deviceType,
		DeviceID:         deviceID,
		RefreshTokenHash: jwtutil.HashRefreshToken(rawRefresh),
		RefreshExpiresAt: time.Now().Add(s.jwtCfg.RefreshTTL),
	}, ProofIssuedAt: claims.IssuedAt.Unix(), Browser: browser})
	if err != nil {
		if errors.Is(err, repository.ErrSessionRevoked) {
			return nil, errcode.AuthInvalidToken
		}
		if errors.Is(err, repository.ErrOIDCIdentityRetired) {
			return nil, errcode.OIDCIdentityRetired
		}
		return nil, fmt.Errorf("create Account Hub session: %w", err)
	}
	user := bound.User
	if browser != nil {
		return &CallbackResult{User: *user}, nil
	}

	accessToken, err := jwtutil.GenerateIdentityAccessToken(
		user.ID,
		deviceType,
		deviceID,
		bound.IdentityID,
		bound.Generation,
		s.jwtCfg.Secret,
		s.jwtCfg.AccessTTL,
		s.cfg.ClientID,
	)
	if err != nil {
		if revokeErr := repository.RevokeRefreshTokensByUserDevice(s.db, user.ID, deviceID); revokeErr != nil {
			slog.Warn("account_oidc.session.cleanup_failed",
				"request_id", reqlog.GetRequestID(ctx),
				"user_id", user.ID,
				"error", revokeErr,
			)
		}
		return nil, fmt.Errorf("generate access token: %w", err)
	}
	slog.Info("account_oidc.login.succeeded",
		"request_id", reqlog.GetRequestID(ctx),
		"user_id", user.ID,
		"device_type", deviceType,
		"subject_ref", opaqueRef(claims.Subject),
	)
	return &CallbackResult{
		AccessToken:  accessToken,
		RefreshToken: rawRefresh,
		ExpiresIn:    int64(s.jwtCfg.AccessTTL.Seconds()),
		User:         *user,
	}, nil
}

// parseCallbackIDToken owns Account proof validation and its public error
// classification for the native and browser callback contracts.
func (s *Service) parseCallbackIDToken(ctx context.Context, verifier *jwtutil.AccountOIDCVerifier, raw, nonce string, browser bool) (*jwtutil.AccountOIDCClaims, error) {
	claims, err := verifier.ParseIDToken(ctx, raw, s.cfg.IssuerURL, s.cfg.ClientID, nonce)
	if err != nil {
		if browser && errors.Is(err, jwtutil.ErrAccountKeysUnavailable) {
			return nil, errcode.AuthUnavailable
		}
		if errors.Is(err, jwtutil.ErrIDTokenSubjectMissing) {
			return nil, errcode.OIDCSubNotFound
		}
		slog.Warn("account_oidc.id_token.rejected",
			"request_id", reqlog.GetRequestID(ctx),
			"reason", "validation_failed",
		)
		return nil, errcode.OIDCIDTokenInvalid
	}
	if claims.Subject == "" {
		return nil, errcode.OIDCSubNotFound
	}
	return claims, nil
}

func (s *Service) consumeCallbackState(
	ctx context.Context,
	state, codeVerifier, deviceType, deviceID, redirectURI string,
) (*stateEntry, error) {
	if state == "" {
		return nil, errcode.OIDCInvalidState
	}
	entryJSON, err := s.cache.GetRDB().GetDel(ctx, oidcStateKey(state)).Result()
	if errors.Is(err, redis.Nil) {
		return nil, errcode.OIDCInvalidState
	}
	if err != nil {
		return nil, errcode.AuthUnavailable
	}
	var entry stateEntry
	if err := json.Unmarshal([]byte(entryJSON), &entry); err != nil {
		return nil, errcode.OIDCInvalidState
	}
	if entry.CreatedAt <= 0 || time.Since(time.Unix(entry.CreatedAt, 0)) > oidcStateTTL {
		return nil, errcode.OIDCInvalidState
	}
	if entry.Nonce == "" || entry.DeviceType != deviceType || entry.DeviceID != deviceID {
		return nil, errcode.OIDCInvalidState
	}
	if redirectURI == "" {
		redirectURI = entry.RedirectURI
	}
	if redirectURI != entry.RedirectURI || entry.CodeChallengeMethod != "S256" {
		return nil, errcode.OIDCInvalidState
	}
	if !validPKCEValue(codeVerifier, 0) || len(codeVerifier) < 43 || len(codeVerifier) > 128 {
		return nil, errcode.OIDCInvalidState
	}
	digest := sha256.Sum256([]byte(codeVerifier))
	computed := base64.RawURLEncoding.EncodeToString(digest[:])
	if computed != entry.CodeChallenge {
		return nil, errcode.OIDCInvalidState
	}
	return &entry, nil
}

type tokenEndpointResponse struct {
	AccessToken string `json:"access_token"`
	TokenType   string `json:"token_type"`
	ExpiresIn   int    `json:"expires_in"`
	IDToken     string `json:"id_token"`
	Scope       string `json:"scope"`
}

func (s *Service) exchangeCode(
	ctx context.Context,
	tokenEndpoint, code, codeVerifier, redirectURI string,
) (*tokenEndpointResponse, error) {
	form := url.Values{}
	form.Set("grant_type", "authorization_code")
	form.Set("code", code)
	form.Set("redirect_uri", redirectURI)
	form.Set("code_verifier", codeVerifier)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, tokenEndpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, fmt.Errorf("build token request")
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.SetBasicAuth(s.cfg.ClientID, s.cfg.ClientSecret)
	reqlog.SetRequestIDHeader(ctx, req.Header)

	started := time.Now()
	resp, err := s.httpClient.Do(req)
	if err != nil {
		metrics.OutboundMetrics.Record(outboundmetrics.ProviderAccountOIDC, outboundmetrics.PurposeTokenExchange, outboundmetrics.CategoryFailure, outboundmetrics.StatusNetworkError)
		slog.Warn("account_oidc.token_exchange.unreachable", "request_id", reqlog.GetRequestID(ctx), "error_category", "network_error")
		return nil, fmt.Errorf("token endpoint request failed")
	}
	defer resp.Body.Close()
	body, err := outboundhttp.ReadLimited(resp.Body, s.cfg.MaxResponseBodyBytes)
	if err != nil {
		metrics.OutboundMetrics.Record(outboundmetrics.ProviderAccountOIDC, outboundmetrics.PurposeTokenExchange, outboundmetrics.CategoryFailure, outboundmetrics.StatusBodyTooLarge)
		return nil, fmt.Errorf("token endpoint response too large")
	}
	if resp.StatusCode != http.StatusOK {
		category := oidcProviderErrorCategory(body)
		metrics.OutboundMetrics.Record(outboundmetrics.ProviderAccountOIDC, outboundmetrics.PurposeTokenExchange, outboundmetrics.CategoryFailure, outboundmetrics.StatusNonSuccess)
		slog.Warn("account_oidc.token_exchange.rejected",
			"request_id", reqlog.GetRequestID(ctx),
			"status", resp.StatusCode,
			"error_category", category,
		)
		return nil, fmt.Errorf("provider code exchange failed")
	}
	var out tokenEndpointResponse
	if err := json.Unmarshal(body, &out); err != nil {
		metrics.OutboundMetrics.Record(outboundmetrics.ProviderAccountOIDC, outboundmetrics.PurposeTokenExchange, outboundmetrics.CategoryFailure, outboundmetrics.StatusDecodeFail)
		return nil, fmt.Errorf("parse token response failed")
	}
	if !strings.EqualFold(out.TokenType, "Bearer") || out.AccessToken == "" || out.IDToken == "" {
		metrics.OutboundMetrics.Record(outboundmetrics.ProviderAccountOIDC, outboundmetrics.PurposeTokenExchange, outboundmetrics.CategoryFailure, outboundmetrics.StatusDecodeFail)
		return nil, fmt.Errorf("token response missing required fields")
	}
	metrics.OutboundMetrics.Record(outboundmetrics.ProviderAccountOIDC, outboundmetrics.PurposeTokenExchange, outboundmetrics.CategorySuccess, outboundmetrics.StatusOK)
	metrics.OutboundMetrics.Observe(outboundmetrics.ProviderAccountOIDC, outboundmetrics.PurposeTokenExchange, outboundmetrics.CategorySuccess, outboundmetrics.StatusOK, time.Since(started))
	return &out, nil
}

type userInfoResponse struct {
	Sub     string `json:"sub"`
	Name    string `json:"name"`
	Picture string `json:"picture"`
	Locale  string `json:"locale"`
}

func (s *Service) fetchUserInfo(ctx context.Context, endpoint, accessToken, expectedSubject string) (*userInfoResponse, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("build userinfo request")
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/json")
	reqlog.SetRequestIDHeader(ctx, req.Header)
	started := time.Now()
	resp, err := s.httpClient.Do(req)
	if err != nil {
		metrics.OutboundMetrics.Record(outboundmetrics.ProviderAccountOIDC, outboundmetrics.PurposeUserInfo, outboundmetrics.CategoryFailure, outboundmetrics.StatusNetworkError)
		return nil, fmt.Errorf("userinfo request failed")
	}
	defer resp.Body.Close()
	body, err := outboundhttp.ReadLimited(resp.Body, s.cfg.MaxResponseBodyBytes)
	if err != nil {
		metrics.OutboundMetrics.Record(outboundmetrics.ProviderAccountOIDC, outboundmetrics.PurposeUserInfo, outboundmetrics.CategoryFailure, outboundmetrics.StatusBodyTooLarge)
		return nil, fmt.Errorf("userinfo response too large")
	}
	if resp.StatusCode != http.StatusOK {
		metrics.OutboundMetrics.Record(outboundmetrics.ProviderAccountOIDC, outboundmetrics.PurposeUserInfo, outboundmetrics.CategoryFailure, outboundmetrics.StatusNonSuccess)
		return nil, fmt.Errorf("userinfo rejected")
	}
	var out userInfoResponse
	if err := json.Unmarshal(body, &out); err != nil {
		metrics.OutboundMetrics.Record(outboundmetrics.ProviderAccountOIDC, outboundmetrics.PurposeUserInfo, outboundmetrics.CategoryFailure, outboundmetrics.StatusDecodeFail)
		return nil, fmt.Errorf("parse userinfo failed")
	}
	if out.Sub == "" || out.Sub != expectedSubject {
		metrics.OutboundMetrics.Record(outboundmetrics.ProviderAccountOIDC, outboundmetrics.PurposeUserInfo, outboundmetrics.CategoryFailure, "subject_mismatch")
		return nil, fmt.Errorf("userinfo subject mismatch")
	}
	metrics.OutboundMetrics.Record(outboundmetrics.ProviderAccountOIDC, outboundmetrics.PurposeUserInfo, outboundmetrics.CategorySuccess, outboundmetrics.StatusOK)
	metrics.OutboundMetrics.Observe(outboundmetrics.ProviderAccountOIDC, outboundmetrics.PurposeUserInfo, outboundmetrics.CategorySuccess, outboundmetrics.StatusOK, time.Since(started))
	return &out, nil
}

func (s *Service) providerMetadata(ctx context.Context) (*providerMetadata, *jwtutil.AccountOIDCVerifier, error) {
	if meta, verifier, ok := s.cachedProviderMetadata(); ok {
		return meta, verifier, nil
	}

	s.metadataMu.Lock()
	defer s.metadataMu.Unlock()
	if s.providerMetadataFreshLocked() {
		return s.metadata, s.verifier, nil
	}
	started := time.Now()
	meta, err := s.fetchProviderMetadata(ctx)
	if err != nil {
		return nil, nil, err
	}
	if err := s.validateProviderMetadata(meta); err != nil {
		return nil, nil, err
	}
	verifier := jwtutil.NewAccountOIDCVerifier(meta.JWKSURI, jwtutil.VerifierConfig{
		HTTPClient:      s.httpClient,
		MaxBodyBytes:    s.cfg.MaxResponseBodyBytes,
		OutboundMetrics: metrics.OutboundMetrics,
	})
	s.metadata = meta
	s.metadataFetched = time.Now()
	s.verifier = verifier
	metrics.OutboundMetrics.Record(outboundmetrics.ProviderAccountOIDC, outboundmetrics.PurposeDiscovery, outboundmetrics.CategorySuccess, outboundmetrics.StatusOK)
	metrics.OutboundMetrics.Observe(outboundmetrics.ProviderAccountOIDC, outboundmetrics.PurposeDiscovery, outboundmetrics.CategorySuccess, outboundmetrics.StatusOK, time.Since(started))
	return s.metadata, s.verifier, nil
}

func (s *Service) cachedProviderMetadata() (*providerMetadata, *jwtutil.AccountOIDCVerifier, bool) {
	s.metadataMu.RLock()
	defer s.metadataMu.RUnlock()
	if !s.providerMetadataFreshLocked() {
		return nil, nil, false
	}
	return s.metadata, s.verifier, true
}

func (s *Service) providerMetadataFreshLocked() bool {
	return s.metadata != nil && time.Since(s.metadataFetched) < providerMetadataTTL && s.verifier != nil
}

func (s *Service) fetchProviderMetadata(ctx context.Context) (*providerMetadata, error) {
	discoveryURL := strings.TrimRight(s.cfg.IssuerURL, "/") + "/.well-known/openid-configuration"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, discoveryURL, nil)
	if err != nil {
		return nil, fmt.Errorf("build discovery request")
	}
	req.Header.Set("Accept", "application/json")
	resp, err := s.httpClient.Do(req)
	if err != nil {
		metrics.OutboundMetrics.Record(outboundmetrics.ProviderAccountOIDC, outboundmetrics.PurposeDiscovery, outboundmetrics.CategoryFailure, outboundmetrics.StatusNetworkError)
		return nil, fmt.Errorf("discovery request failed")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		metrics.OutboundMetrics.Record(outboundmetrics.ProviderAccountOIDC, outboundmetrics.PurposeDiscovery, outboundmetrics.CategoryFailure, outboundmetrics.StatusNonSuccess)
		return nil, fmt.Errorf("discovery returned %d", resp.StatusCode)
	}
	body, err := outboundhttp.ReadLimited(resp.Body, s.cfg.MaxResponseBodyBytes)
	if err != nil {
		metrics.OutboundMetrics.Record(outboundmetrics.ProviderAccountOIDC, outboundmetrics.PurposeDiscovery, outboundmetrics.CategoryFailure, outboundmetrics.StatusBodyTooLarge)
		return nil, fmt.Errorf("discovery body limit")
	}
	var meta providerMetadata
	if err := json.Unmarshal(body, &meta); err != nil {
		metrics.OutboundMetrics.Record(outboundmetrics.ProviderAccountOIDC, outboundmetrics.PurposeDiscovery, outboundmetrics.CategoryFailure, outboundmetrics.StatusDecodeFail)
		return nil, fmt.Errorf("discovery parse failed")
	}
	return &meta, nil
}

func (s *Service) validateProviderMetadata(meta *providerMetadata) error {
	if meta.Issuer != s.cfg.IssuerURL {
		metrics.OutboundMetrics.Record(outboundmetrics.ProviderAccountOIDC, outboundmetrics.PurposeDiscovery, outboundmetrics.CategoryFailure, "issuer_mismatch")
		return fmt.Errorf("discovery issuer mismatch")
	}
	for _, endpoint := range []string{meta.AuthorizationEndpoint, meta.TokenEndpoint, meta.UserInfoEndpoint, meta.JWKSURI} {
		if !sameIssuerOrigin(endpoint, s.cfg.IssuerURL) {
			metrics.OutboundMetrics.Record(outboundmetrics.ProviderAccountOIDC, outboundmetrics.PurposeDiscovery, outboundmetrics.CategoryFailure, "endpoint_policy")
			return fmt.Errorf("discovery endpoint violates issuer-origin policy")
		}
	}
	if !slices.Contains(meta.ResponseTypes, "code") ||
		!slices.Contains(meta.ResponseModes, "query") ||
		!slices.Contains(meta.GrantTypes, "authorization_code") ||
		!slices.Contains(meta.PKCEMethods, "S256") ||
		!slices.Contains(meta.IDTokenAlgorithms, "RS256") ||
		!slices.Contains(meta.TokenAuthMethods, "client_secret_basic") {
		metrics.OutboundMetrics.Record(outboundmetrics.ProviderAccountOIDC, outboundmetrics.PurposeDiscovery, outboundmetrics.CategoryFailure, "capability_mismatch")
		return fmt.Errorf("discovery capability mismatch")
	}
	if !meta.RFC9207IssuerResponse {
		metrics.OutboundMetrics.Record(outboundmetrics.ProviderAccountOIDC, outboundmetrics.PurposeDiscovery, outboundmetrics.CategoryFailure, "rfc9207_missing")
		return fmt.Errorf("discovery does not advertise RFC 9207 issuer response support")
	}
	return nil
}

func normalizeOIDCDevice(deviceType, deviceID string) (string, string, error) {
	deviceType = strings.TrimSpace(deviceType)
	if !slices.Contains(validDeviceTypes, deviceType) {
		return "", "", errcode.ErrBadRequest.WithMessage("device_type must be one of desktop, web, cli, mobile")
	}
	parsed, err := uuid.Parse(strings.TrimSpace(deviceID))
	if err != nil {
		return "", "", errcode.ErrBadRequest.WithMessage("device_id must be a UUID")
	}
	return deviceType, parsed.String(), nil
}

func normalizeOIDCRedirectURI(requested, fallback string, allowed []string) (string, error) {
	redirectURI := strings.TrimSpace(requested)
	if redirectURI == "" {
		redirectURI = strings.TrimSpace(fallback)
	}
	parsed, err := url.Parse(redirectURI)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" || parsed.User != nil || parsed.Fragment != "" {
		return "", errcode.ErrBadRequest.WithMessage("redirect_uri must be an absolute URL without credentials or fragment")
	}
	if !isHTTPSOrLoopbackHTTP(parsed.Scheme, parsed.Hostname()) {
		return "", errcode.ErrBadRequest.WithMessage("redirect_uri must use https outside loopback")
	}
	normalized := parsed.String()
	for _, raw := range append([]string{fallback}, allowed...) {
		allowedURL, err := url.Parse(strings.TrimSpace(raw))
		if err != nil || allowedURL.Scheme == "" || allowedURL.Host == "" {
			continue
		}
		if allowedURL.String() == normalized {
			return normalized, nil
		}
	}
	return "", errcode.ErrBadRequest.WithMessage("redirect_uri is not allowed for the Account client")
}

func validPKCEValue(value string, exactLength int) bool {
	if exactLength > 0 && len(value) != exactLength {
		return false
	}
	if value == "" {
		return false
	}
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			continue
		}
		return false
	}
	return true
}

func randomURLToken(size int) (string, error) {
	buf := make([]byte, size)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

func sameIssuerOrigin(endpoint, issuer string) bool {
	e, err := url.Parse(strings.TrimSpace(endpoint))
	if err != nil || e.Scheme == "" || e.Host == "" || e.User != nil || e.Fragment != "" {
		return false
	}
	if !isHTTPSOrLoopbackHTTP(e.Scheme, e.Hostname()) {
		return false
	}
	i, err := url.Parse(strings.TrimSpace(issuer))
	if err != nil {
		return false
	}
	return strings.EqualFold(e.Scheme, i.Scheme) && strings.EqualFold(e.Host, i.Host)
}

func isLoopbackHost(host string) bool {
	return host == "localhost" || host == "127.0.0.1" || host == "::1"
}

func isHTTPSOrLoopbackHTTP(scheme, host string) bool {
	return scheme == "https" || (scheme == "http" && isLoopbackHost(host))
}

func oidcStateKey(state string) string {
	return "account_oidc:state:" + state
}

func opaqueRef(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:6])
}

func oidcProviderErrorCategory(body []byte) string {
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		return "provider_error"
	}
	raw, ok := payload["error"].(string)
	if !ok || raw == "" || len(raw) > 64 {
		return "provider_error"
	}
	for _, r := range raw {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_' || r == '-' || r == '.' {
			continue
		}
		return "provider_error"
	}
	return raw
}
