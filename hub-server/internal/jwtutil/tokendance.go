package jwtutil

import (
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// TokenDanceClaims holds OIDC standard claims from a TokenDance ID-issued JWT.
type TokenDanceClaims struct {
	Email         string `json:"email"`
	EmailVerified bool   `json:"email_verified"`
	Name          string `json:"name"`
	Picture       string `json:"picture"`
	jwt.RegisteredClaims
}

// jwksCache caches the JWKS response from TokenDance ID.
type jwksCache struct {
	mu      sync.RWMutex
	keys    map[string]*rsa.PublicKey
	fetched time.Time
	jwksURI string
	ttl     time.Duration
}

var defaultJWKSCache = &jwksCache{ttl: 1 * time.Hour}

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

// SetJWKSURI configures the JWKS endpoint URL for TokenDance ID.
func SetJWKSURI(uri string) {
	defaultJWKSCache.jwksURI = uri
}

// fetchJWKS fetches the JWKS from TokenDance ID and caches the parsed RSA public keys.
func (c *jwksCache) fetchJWKS() error {
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

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(c.jwksURI)
	if err != nil {
		return fmt.Errorf("jwks fetch failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("jwks fetch returned %d", resp.StatusCode)
	}

	var jwks jwksResponse
	if err := json.NewDecoder(resp.Body).Decode(&jwks); err != nil {
		return fmt.Errorf("jwks parse failed: %w", err)
	}

	keys := make(map[string]*rsa.PublicKey, len(jwks.Keys))
	for _, k := range jwks.Keys {
		if k.KTY != "RSA" {
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
		return fmt.Errorf("no valid RSA keys found in JWKS")
	}

	c.keys = keys
	c.fetched = time.Now()
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

// ParseTokenDanceJWT validates a TokenDance ID-issued RS256 JWT.
// It fetches the JWKS from the configured endpoint, finds the matching key by kid,
// and verifies signature, issuer, audience, and standard time claims.
func ParseTokenDanceJWT(tokenString, expectedIssuer, expectedAudience string) (*TokenDanceClaims, error) {
	if expectedIssuer == "" {
		return nil, fmt.Errorf("expected issuer is required")
	}
	if expectedAudience == "" {
		return nil, fmt.Errorf("expected audience is required")
	}
	if err := defaultJWKSCache.fetchJWKS(); err != nil {
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

	defaultJWKSCache.mu.RLock()
	pubKey, ok := defaultJWKSCache.keys[kid]
	defaultJWKSCache.mu.RUnlock()

	if !ok {
		// Key not found — refresh cache and retry.
		defaultJWKSCache.fetched = time.Time{}
		if err := defaultJWKSCache.fetchJWKS(); err != nil {
			return nil, fmt.Errorf("jwks refresh failed: %w", err)
		}
		defaultJWKSCache.mu.RLock()
		pubKey, ok = defaultJWKSCache.keys[kid]
		defaultJWKSCache.mu.RUnlock()
		if !ok {
			return nil, fmt.Errorf("key %q not found in JWKS", kid)
		}
	}

	// Second pass: full verification with the correct key.
	claims := &TokenDanceClaims{}
	token, err := jwt.ParseWithClaims(
		tokenString,
		claims,
		func(t *jwt.Token) (interface{}, error) {
			if _, ok := t.Method.(*jwt.SigningMethodRSA); !ok {
				return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
			}
			return pubKey, nil
		},
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
