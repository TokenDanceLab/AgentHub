package jwtutil

import (
	"context"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/agenthub/pkg/outboundmetrics"

	"github.com/agenthub/hub-server/internal/outboundhttp"
)

// TokenDanceClaims holds OIDC standard claims from a TokenDance ID-issued JWT.
type TokenDanceClaims struct {
	Email         string `json:"email"`
	EmailVerified bool   `json:"email_verified"`
	Name          string `json:"name"`
	Picture       string `json:"picture"`
	jwt.RegisteredClaims
}

// VerifierConfig is the explicit URI/transport/cache policy for a
// TokenDanceVerifier (#1564). Zero fields fall back to the defaults below;
// the HTTP client, body cap and refresh TTL are all injected — never read
// from package globals.
type VerifierConfig struct {
	// HTTPClient is the outbound client used for JWKS fetches. Built by the
	// composition root (outboundhttp.NewClient); nil falls back to the
	// default policy client.
	HTTPClient *http.Client
	// CacheTTL is how long a fetched JWKS is trusted before refresh
	// (default 1h).
	CacheTTL time.Duration
	// MaxBodyBytes is the fail-closed cap on the JWKS response body
	// (default 64 KiB).
	MaxBodyBytes int64
	// OutboundMetrics is the unified outbound metrics recorder (#1595);
	// nil is a no-op.
	OutboundMetrics *outboundmetrics.Recorder
}

func (c VerifierConfig) withDefaults() VerifierConfig {
	if c.HTTPClient == nil {
		c.HTTPClient = outboundhttp.NewClient(0)
	}
	if c.CacheTTL <= 0 {
		c.CacheTTL = time.Hour
	}
	if c.MaxBodyBytes <= 0 {
		c.MaxBodyBytes = 64 * 1024
	}
	return c
}

// jwksCache caches the JWKS response from TokenDance ID.
type jwksCache struct {
	mu       sync.RWMutex
	keys     map[string]*rsa.PublicKey
	fetched  time.Time
	jwksURI  string
	ttl      time.Duration
	client   *http.Client
	maxBody  int64
	outbound *outboundmetrics.Recorder
}

// TokenDanceVerifier validates TokenDance ID-issued RS256 JWTs against a
// JWKS endpoint. Instance-based (#1551): the URI, HTTP client, cache, and
// refresh policy are owned by the verifier, constructed once in the
// composition root — never a process-global mutable default.
type TokenDanceVerifier struct {
	cache *jwksCache
}

// NewTokenDanceVerifier builds a verifier for the given JWKS endpoint with an
// explicit transport/cache policy (#1564). Pass VerifierConfig{} for the
// defaults.
func NewTokenDanceVerifier(jwksURI string, cfg VerifierConfig) *TokenDanceVerifier {
	cfg = cfg.withDefaults()
	return &TokenDanceVerifier{cache: &jwksCache{
		jwksURI:  jwksURI,
		ttl:      cfg.CacheTTL,
		client:   cfg.HTTPClient,
		maxBody:  cfg.MaxBodyBytes,
		outbound: cfg.OutboundMetrics,
	}}
}

// jwksResponse is the JSON structure returned by an OIDC JWKS endpoint.
type jwksResponse struct {
	Keys []jwkKey `json:"keys"`
}

type jwkKey struct {
	KTY string `json:"kty"`
	Use string `json:"use"`
	Alg string `json:"alg"`
	Kid string `json:"kid"`
	N   string `json:"n"`
	E   string `json:"e"`
}

// fetchJWKS fetches the JWKS from TokenDance ID and caches the parsed RSA public keys.
func (c *jwksCache) fetchJWKS(ctx context.Context) error {
	c.mu.RLock()
	if time.Since(c.fetched) < c.ttl && len(c.keys) > 0 {
		c.mu.RUnlock()
		return nil
	}
	c.mu.RUnlock()

	c.mu.Lock()
	defer c.mu.Unlock()

	if time.Since(c.fetched) < c.ttl && len(c.keys) > 0 {
		return nil
	}

	if c.jwksURI == "" {
		return fmt.Errorf("jwks_uri not configured")
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.jwksURI, nil)
	if err != nil {
		return fmt.Errorf("jwks request build failed: %w", err)
	}
	resp, err := c.client.Do(req)
	if err != nil {
		c.outbound.Record(outboundmetrics.ProviderTokenDanceID, outboundmetrics.PurposeJWKSFetch, outboundmetrics.CategoryFailure, "network_error")
		return fmt.Errorf("jwks fetch failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		c.outbound.Record(outboundmetrics.ProviderTokenDanceID, outboundmetrics.PurposeJWKSFetch, outboundmetrics.CategoryFailure, "non_success")
		return fmt.Errorf("jwks fetch returned %d", resp.StatusCode)
	}

	// Fail-closed body cap: an oversized JWKS document is a protocol
	// anomaly and is refused, never streamed into memory unbounded.
	body, err := outboundhttp.ReadLimited(resp.Body, c.maxBody)
	if err != nil {
		c.outbound.Record(outboundmetrics.ProviderTokenDanceID, outboundmetrics.PurposeJWKSFetch, outboundmetrics.CategoryFailure, "body_too_large")
		return fmt.Errorf("jwks fetch body limit: %w", err)
	}

	var jwks jwksResponse
	if err := json.Unmarshal(body, &jwks); err != nil {
		c.outbound.Record(outboundmetrics.ProviderTokenDanceID, outboundmetrics.PurposeJWKSFetch, outboundmetrics.CategoryFailure, "decode_fail")
		return fmt.Errorf("jwks parse failed: %w", err)
	}

	keys := make(map[string]*rsa.PublicKey, len(jwks.Keys))
	for _, k := range jwks.Keys {
		// Pin alg to RS256: a JWKS entry advertising RS384/RS512 (or no alg)
		// is refused even though the key is RSA, so an attacker who persuades
		// the issuer to publish a stronger-alg key cannot slip a token signed
		// with a different RSA padding/hash past this verifier.
		if k.KTY != "RSA" || k.Alg != "RS256" {
			continue
		}
		pubKey, err := parseJWKKey(&k)
		if err != nil {
			continue
		}
		if k.Kid != "" {
			keys[k.Kid] = pubKey
		}
	}

	if len(keys) == 0 {
		c.outbound.Record(outboundmetrics.ProviderTokenDanceID, outboundmetrics.PurposeJWKSFetch, outboundmetrics.CategoryFailure, "decode_fail")
		return fmt.Errorf("no valid RSA keys found in JWKS")
	}

	c.keys = keys
	c.fetched = time.Now()
	c.outbound.Record(outboundmetrics.ProviderTokenDanceID, outboundmetrics.PurposeJWKSFetch, outboundmetrics.CategorySuccess, outboundmetrics.StatusOK)
	return nil
}

// parseJWKKey converts a JWK key to an RSA public key by decoding the base64url
// modulus (n) and exponent (e) fields.
func parseJWKKey(k *jwkKey) (*rsa.PublicKey, error) {
	nBytes, err := base64.RawURLEncoding.DecodeString(k.N)
	if err != nil {
		return nil, fmt.Errorf("failed to decode JWK modulus: %w", err)
	}
	eBytes, err := base64.RawURLEncoding.DecodeString(k.E)
	if err != nil {
		return nil, fmt.Errorf("failed to decode JWK exponent: %w", err)
	}

	n := new(big.Int).SetBytes(nBytes)
	e := new(big.Int).SetBytes(eBytes)

	return &rsa.PublicKey{N: n, E: int(e.Int64())}, nil
}

// ParseJWT validates a TokenDance ID-issued RS256 JWT.
// It fetches the JWKS from the configured endpoint, finds the matching key by kid,
// and verifies signature, issuer, audience, and standard time claims.
func (v *TokenDanceVerifier) ParseJWT(ctx context.Context, tokenString, expectedIssuer, expectedAudience string) (*TokenDanceClaims, error) {
	if expectedIssuer == "" {
		return nil, fmt.Errorf("expected issuer is required")
	}
	if expectedAudience == "" {
		return nil, fmt.Errorf("expected audience is required")
	}
	if err := v.cache.fetchJWKS(ctx); err != nil {
		return nil, err
	}

	// First pass: parse without verification to extract the kid header.
	unverified, _, err := jwt.NewParser().ParseUnverified(tokenString, &TokenDanceClaims{})
	if err != nil {
		return nil, fmt.Errorf("token parse failed: %w", err)
	}

	kid, ok := unverified.Header["kid"].(string)
	if !ok || kid == "" {
		return nil, fmt.Errorf("token missing kid header")
	}

	v.cache.mu.RLock()
	pubKey, ok := v.cache.keys[kid]
	v.cache.mu.RUnlock()

	if !ok {
		// Key not found — refresh cache and retry.
		v.cache.fetched = time.Time{}
		if err := v.cache.fetchJWKS(ctx); err != nil {
			return nil, fmt.Errorf("jwks refresh failed: %w", err)
		}
		v.cache.mu.RLock()
		pubKey, ok = v.cache.keys[kid]
		v.cache.mu.RUnlock()
		if !ok {
			return nil, fmt.Errorf("key %q not found in JWKS", kid)
		}
	}

	// Second pass: full verification with the correct key. Pin the signing
	// method to RS256 explicitly (WithValidMethods + keyfunc alg check) so a
	// token signed with RS384/RS512 — even if it shared the kid — is rejected
	// before signature verification, and the JWKS alg-pin above is reinforced
	// at parse time. (golang-jwt v5 models RS256/RS384/RS512 as the same
	// *SigningMethodRSA type, so a type assertion cannot distinguish them;
	// the alg header string is the authoritative discriminator.)
	claims := &TokenDanceClaims{}
	token, err := jwt.ParseWithClaims(
		tokenString,
		claims,
		func(t *jwt.Token) (interface{}, error) {
			if _, ok := t.Method.(*jwt.SigningMethodRSA); !ok {
				return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
			}
			if t.Header["alg"] != "RS256" {
				return nil, fmt.Errorf("unexpected signing algorithm: %v", t.Header["alg"])
			}
			return pubKey, nil
		},
		jwt.WithValidMethods([]string{"RS256"}),
		jwt.WithIssuer(expectedIssuer),
		jwt.WithAudience(expectedAudience),
		jwt.WithLeeway(30*time.Second),
	)
	if err != nil {
		return nil, fmt.Errorf("token verification failed: %w", err)
	}
	if !token.Valid {
		return nil, fmt.Errorf("token is invalid")
	}

	return claims, nil
}
