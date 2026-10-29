package jwtutil

import (
	"context"
	"crypto/rsa"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/agenthub/hub-server/internal/outboundhttp"
	"github.com/agenthub/pkg/outboundmetrics"
)

var ErrIDTokenSubjectMissing = errors.New("id token subject is missing")

var ErrAccountKeysUnavailable = errors.New("Account signing keys unavailable")

// AccountOIDCClaims contains the minimal ID-token claims Hub consumes. Profile
// attributes are deliberately read from UserInfo, not treated as ID-token
// guarantees.
type AccountOIDCClaims struct {
	Nonce string `json:"nonce,omitempty"`
	Azp   string `json:"azp,omitempty"`
	jwt.RegisteredClaims
}

// VerifierConfig controls the Account JWKS verifier. Zero fields use safe
// defaults.
type VerifierConfig struct {
	HTTPClient      *http.Client
	CacheTTL        time.Duration
	MaxBodyBytes    int64
	OutboundMetrics *outboundmetrics.Recorder
}

func (c VerifierConfig) withDefaults() VerifierConfig {
	if c.HTTPClient == nil {
		c.HTTPClient = outboundhttp.NewClient(0)
	}
	if c.CacheTTL <= 0 {
		c.CacheTTL = 5 * time.Minute
	}
	if c.MaxBodyBytes <= 0 {
		c.MaxBodyBytes = 64 * 1024
	}
	return c
}

type accountJWKSCache struct {
	mu       sync.RWMutex
	jwksURI  string
	ttl      time.Duration
	client   *http.Client
	maxBody  int64
	fetched  time.Time
	keys     map[string]*rsa.PublicKey
	outbound *outboundmetrics.Recorder
}

// AccountOIDCVerifier validates Account-issued RS256 ID tokens against a
// bounded, cached JWKS endpoint. The verifier is instance-owned; tests and
// multiple Apps never share mutable keys.
type AccountOIDCVerifier struct {
	cache *accountJWKSCache
}

// NewAccountOIDCVerifier builds a verifier for the discovered Account JWKS.
func NewAccountOIDCVerifier(jwksURI string, cfg VerifierConfig) *AccountOIDCVerifier {
	cfg = cfg.withDefaults()
	return &AccountOIDCVerifier{cache: &accountJWKSCache{
		jwksURI:  jwksURI,
		ttl:      cfg.CacheTTL,
		client:   cfg.HTTPClient,
		maxBody:  cfg.MaxBodyBytes,
		outbound: cfg.OutboundMetrics,
	}}
}

type accountJWKSResponse struct {
	Keys []accountJWK `json:"keys"`
}

type accountJWK struct {
	KTY string `json:"kty"`
	Use string `json:"use"`
	Alg string `json:"alg"`
	Kid string `json:"kid"`
	N   string `json:"n"`
	E   string `json:"e"`
}

func (c *accountJWKSCache) fetchJWKS(ctx context.Context) error {
	c.mu.RLock()
	if c.freshLocked() {
		c.mu.RUnlock()
		return nil
	}
	c.mu.RUnlock()

	c.mu.Lock()
	defer c.mu.Unlock()
	if c.freshLocked() {
		return nil
	}
	body, err := c.downloadJWKS(ctx)
	if err != nil {
		return err
	}
	keys, err := c.parseJWKSBody(body)
	if err != nil {
		return err
	}
	c.keys = keys
	c.fetched = time.Now()
	c.outbound.Record(outboundmetrics.ProviderAccountOIDC, outboundmetrics.PurposeJWKSFetch, outboundmetrics.CategorySuccess, outboundmetrics.StatusOK)
	return nil
}

func (c *accountJWKSCache) freshLocked() bool {
	return !c.fetched.IsZero() && time.Since(c.fetched) < c.ttl && len(c.keys) > 0
}

func (c *accountJWKSCache) downloadJWKS(ctx context.Context) ([]byte, error) {
	if c.jwksURI == "" {
		return nil, fmt.Errorf("jwks_uri not configured")
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.jwksURI, nil)
	if err != nil {
		return nil, fmt.Errorf("jwks request build failed: %w", err)
	}
	resp, err := c.client.Do(req)
	if err != nil {
		c.outbound.Record(outboundmetrics.ProviderAccountOIDC, outboundmetrics.PurposeJWKSFetch, outboundmetrics.CategoryFailure, outboundmetrics.StatusNetworkError)
		return nil, fmt.Errorf("jwks fetch failed")
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		c.outbound.Record(outboundmetrics.ProviderAccountOIDC, outboundmetrics.PurposeJWKSFetch, outboundmetrics.CategoryFailure, outboundmetrics.StatusNonSuccess)
		return nil, fmt.Errorf("jwks fetch returned %d", resp.StatusCode)
	}
	body, err := outboundhttp.ReadLimited(resp.Body, c.maxBody)
	if err != nil {
		c.outbound.Record(outboundmetrics.ProviderAccountOIDC, outboundmetrics.PurposeJWKSFetch, outboundmetrics.CategoryFailure, outboundmetrics.StatusBodyTooLarge)
		return nil, fmt.Errorf("jwks fetch body limit: %w", err)
	}
	return body, nil
}

func (c *accountJWKSCache) parseJWKSBody(body []byte) (map[string]*rsa.PublicKey, error) {
	var jwks accountJWKSResponse
	if err := json.Unmarshal(body, &jwks); err != nil {
		c.outbound.Record(outboundmetrics.ProviderAccountOIDC, outboundmetrics.PurposeJWKSFetch, outboundmetrics.CategoryFailure, outboundmetrics.StatusDecodeFail)
		return nil, fmt.Errorf("jwks parse failed")
	}
	keys := make(map[string]*rsa.PublicKey, len(jwks.Keys))
	for _, k := range jwks.Keys {
		if k.KTY != "RSA" || k.Alg != "RS256" || k.Kid == "" ||
			(k.Use != "" && k.Use != "sig") {
			continue
		}
		pubKey, err := parseAccountJWK(&k)
		if err != nil {
			continue
		}
		if _, exists := keys[k.Kid]; exists {
			c.outbound.Record(outboundmetrics.ProviderAccountOIDC, outboundmetrics.PurposeJWKSFetch, outboundmetrics.CategoryFailure, "duplicate_kid")
			return nil, fmt.Errorf("duplicate kid in JWKS")
		}
		keys[k.Kid] = pubKey
	}
	if len(keys) == 0 {
		c.outbound.Record(outboundmetrics.ProviderAccountOIDC, outboundmetrics.PurposeJWKSFetch, outboundmetrics.CategoryFailure, outboundmetrics.StatusDecodeFail)
		return nil, fmt.Errorf("no valid RSA keys found in JWKS")
	}
	return keys, nil
}

func (c *accountJWKSCache) invalidate() {
	c.mu.Lock()
	c.fetched = time.Time{}
	c.mu.Unlock()
}

func parseAccountJWK(k *accountJWK) (*rsa.PublicKey, error) {
	nBytes, err := base64.RawURLEncoding.DecodeString(k.N)
	if err != nil {
		return nil, fmt.Errorf("decode modulus")
	}
	eBytes, err := base64.RawURLEncoding.DecodeString(k.E)
	if err != nil {
		return nil, fmt.Errorf("decode exponent")
	}
	n := new(big.Int).SetBytes(nBytes)
	e := new(big.Int).SetBytes(eBytes)
	if n.Sign() <= 0 || n.BitLen() < 2048 || !e.IsInt64() || e.Int64() < 3 || e.Int64() > 1<<31-1 {
		return nil, fmt.Errorf("invalid RSA key")
	}
	return &rsa.PublicKey{N: n, E: int(e.Int64())}, nil
}

// ParseIDToken validates the signature, fixed RS256 algorithm, issuer,
// audience, azp, expiry, issued-at, nonce and required subject.
func (v *AccountOIDCVerifier) ParseIDToken(
	ctx context.Context,
	tokenString string,
	expectedIssuer string,
	expectedAudience string,
	expectedNonce string,
) (*AccountOIDCClaims, error) {
	if err := validateExpectedTokenClaims(expectedIssuer, expectedAudience, expectedNonce); err != nil {
		return nil, err
	}
	pubKey, err := v.signingKey(ctx, tokenString)
	if err != nil {
		return nil, err
	}
	claims, err := verifyAccountIDToken(tokenString, pubKey, expectedIssuer, expectedAudience)
	if err != nil {
		return nil, err
	}
	if err := validateAccountClaims(claims, expectedAudience, expectedNonce); err != nil {
		return nil, err
	}
	return claims, nil
}

func validateExpectedTokenClaims(expectedIssuer, expectedAudience, expectedNonce string) error {
	if expectedIssuer == "" {
		return fmt.Errorf("expected issuer is required")
	}
	if expectedAudience == "" {
		return fmt.Errorf("expected audience is required")
	}
	if expectedNonce == "" {
		return fmt.Errorf("expected nonce is required")
	}
	return nil
}

func (v *AccountOIDCVerifier) signingKey(ctx context.Context, tokenString string) (*rsa.PublicKey, error) {
	if err := v.cache.fetchJWKS(ctx); err != nil {
		return nil, ErrAccountKeysUnavailable
	}

	unverified, _, err := jwt.NewParser().ParseUnverified(tokenString, &AccountOIDCClaims{})
	if err != nil {
		return nil, fmt.Errorf("token parse failed")
	}
	kid, _ := unverified.Header["kid"].(string)
	if kid == "" {
		return nil, fmt.Errorf("token missing kid header")
	}

	pubKey, ok := v.cache.key(kid)
	if !ok {
		v.cache.invalidate()
		if err := v.cache.fetchJWKS(ctx); err != nil {
			return nil, ErrAccountKeysUnavailable
		}
		pubKey, ok = v.cache.key(kid)
		if !ok {
			return nil, fmt.Errorf("key not found in JWKS")
		}
	}
	return pubKey, nil
}

func verifyAccountIDToken(
	tokenString string,
	pubKey *rsa.PublicKey,
	expectedIssuer string,
	expectedAudience string,
) (*AccountOIDCClaims, error) {
	claims := &AccountOIDCClaims{}
	token, err := jwt.ParseWithClaims(
		tokenString,
		claims,
		func(t *jwt.Token) (interface{}, error) {
			if _, ok := t.Method.(*jwt.SigningMethodRSA); !ok {
				return nil, fmt.Errorf("unexpected signing method")
			}
			if t.Header["alg"] != "RS256" {
				return nil, fmt.Errorf("unexpected signing algorithm")
			}
			return pubKey, nil
		},
		jwt.WithValidMethods([]string{"RS256"}),
		jwt.WithIssuer(expectedIssuer),
		jwt.WithAudience(expectedAudience),
		jwt.WithExpirationRequired(),
		jwt.WithLeeway(30*time.Second),
	)
	if err != nil || !token.Valid {
		return nil, fmt.Errorf("token verification failed")
	}
	return claims, nil
}

func validateAccountClaims(claims *AccountOIDCClaims, expectedAudience, expectedNonce string) error {
	if claims.Subject == "" {
		return ErrIDTokenSubjectMissing
	}
	if claims.IssuedAt == nil {
		return fmt.Errorf("token iat is required")
	}
	now := time.Now()
	if claims.IssuedAt.After(now.Add(5 * time.Minute)) {
		return fmt.Errorf("token iat is in the future")
	}
	if now.Sub(claims.IssuedAt.Time) > time.Hour {
		return fmt.Errorf("token iat is too old")
	}
	if subtle.ConstantTimeCompare([]byte(claims.Nonce), []byte(expectedNonce)) != 1 {
		return fmt.Errorf("token nonce mismatch")
	}
	if len(claims.Audience) > 1 && claims.Azp != expectedAudience {
		return fmt.Errorf("token azp mismatch")
	}
	if claims.Azp != "" && claims.Azp != expectedAudience {
		return fmt.Errorf("token azp mismatch")
	}
	return nil
}

func (c *accountJWKSCache) key(kid string) (*rsa.PublicKey, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	key, ok := c.keys[kid]
	return key, ok
}

// IssuerEqual applies exact issuer comparison after trimming only transport
// whitespace.
func IssuerEqual(got, want string) bool {
	return strings.TrimSpace(got) == strings.TrimSpace(want)
}
