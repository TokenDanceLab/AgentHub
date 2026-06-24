package jwtutil

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type Claims struct {
	UserID     string `json:"user_id"`
	DeviceType string `json:"device_type"`
	DeviceID   string `json:"device_id"`
	Purpose    string `json:"purpose,omitempty"`
	jwt.RegisteredClaims
}

func GenerateAccessToken(userID, deviceType, deviceID, secret string, ttl time.Duration) (string, error) {
	now := time.Now()
	claims := Claims{
		UserID:     userID,
		DeviceType: deviceType,
		DeviceID:   deviceID,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "agenthub-hub",
			Audience:  jwt.ClaimStrings{"agenthub-api"},
			Subject:   userID,
			ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
			IssuedAt:  jwt.NewNumericDate(now),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

func GenerateEdgeToken(userID, deviceID, secret string, ttl time.Duration) (string, error) {
	now := time.Now()
	claims := Claims{
		UserID:     userID,
		DeviceType: "edge",
		DeviceID:   deviceID,
		Purpose:    "edge-api",
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "agenthub-hub",
			Audience:  jwt.ClaimStrings{"agenthub-edge"},
			Subject:   userID,
			ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
			IssuedAt:  jwt.NewNumericDate(now),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

func ParseToken(tokenString, secret string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(t *jwt.Token) (interface{}, error) {
		return []byte(secret), nil
	},
		jwt.WithValidMethods([]string{"HS256"}),
	)
	if err != nil {
		return nil, err
	}
	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, jwt.ErrSignatureInvalid
	}
	// Lenient iss/aud validation: only check when claims are present, so
	// tokens issued before R08 (without iss/aud) are not rejected.
	if claims.Issuer != "" && claims.Issuer != "agenthub-hub" {
		return nil, fmt.Errorf("jwt issuer mismatch: got %q, want agenthub-hub", claims.Issuer)
	}
	if len(claims.Audience) > 0 {
		found := false
		for _, a := range claims.Audience {
			if a == "agenthub-api" || a == "agenthub-edge" {
				found = true
				break
			}
		}
		if !found {
			return nil, fmt.Errorf("jwt audience does not contain agenthub-api or agenthub-edge")
		}
	}
	return claims, nil
}

func GenerateRefreshToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func HashRefreshToken(token string) string {
	h := sha256.Sum256([]byte(token))
	return hex.EncodeToString(h[:])
}

// ── KeyManager (multi-key JWT with kid header) ─────────────────────────────────

// KeyManager manages HMAC-SHA256 JWT signing keys with support for key rotation.
// Each key is identified by a unique key ID (kid) that is embedded in the JWT
// header so that the correct verification key can be selected during parsing.
type KeyManager struct {
	mu          sync.RWMutex
	keys        map[string][]byte // kid → HMAC secret
	activeKeyID string
}

// NewKeyManager creates a KeyManager from a map of key_id→secret pairs.
// activeKeyID specifies which key signs new tokens. If empty, the first key
// in the map (iteration order is non-deterministic) is used.
func NewKeyManager(secrets map[string]string, activeKeyID string) (*KeyManager, error) {
	if len(secrets) == 0 {
		return nil, fmt.Errorf("at least one key is required")
	}
	keys := make(map[string][]byte, len(secrets))
	for kid, secret := range secrets {
		if kid == "" {
			return nil, fmt.Errorf("empty key ID is not allowed")
		}
		if secret == "" {
			return nil, fmt.Errorf("secret for key %q must not be empty", kid)
		}
		keys[kid] = []byte(secret)
	}
	if activeKeyID == "" {
		for kid := range keys {
			activeKeyID = kid
			break
		}
	}
	if _, ok := keys[activeKeyID]; !ok {
		return nil, fmt.Errorf("active key %q not found in secrets map", activeKeyID)
	}
	return &KeyManager{
		keys:        keys,
		activeKeyID: activeKeyID,
	}, nil
}

// ActiveKeyID returns the key ID used for signing new tokens.
func (km *KeyManager) ActiveKeyID() string {
	km.mu.RLock()
	defer km.mu.RUnlock()
	return km.activeKeyID
}

// KeyIDs returns a copy of all known key IDs.
func (km *KeyManager) KeyIDs() []string {
	km.mu.RLock()
	defer km.mu.RUnlock()
	ids := make([]string, 0, len(km.keys))
	for kid := range km.keys {
		ids = append(ids, kid)
	}
	return ids
}

// HasKey reports whether a key with the given kid is registered.
func (km *KeyManager) HasKey(kid string) bool {
	km.mu.RLock()
	defer km.mu.RUnlock()
	_, ok := km.keys[kid]
	return ok
}

// AddKey registers a new key. If the kid already exists it is overwritten.
// The key is NOT automatically made active — call SetActiveKey separately.
func (km *KeyManager) AddKey(kid, secret string) error {
	if kid == "" {
		return fmt.Errorf("empty key ID is not allowed")
	}
	if secret == "" {
		return fmt.Errorf("secret must not be empty")
	}
	km.mu.Lock()
	defer km.mu.Unlock()
	km.keys[kid] = []byte(secret)
	return nil
}

// RemoveKey deletes a key by ID. The active key cannot be removed.
func (km *KeyManager) RemoveKey(kid string) error {
	km.mu.Lock()
	defer km.mu.Unlock()
	if kid == km.activeKeyID {
		return fmt.Errorf("cannot remove active key %q; set a different active key first", kid)
	}
	if _, ok := km.keys[kid]; !ok {
		return fmt.Errorf("key %q not found", kid)
	}
	delete(km.keys, kid)
	return nil
}

// SetActiveKey changes the signing key. The kid must already be registered.
func (km *KeyManager) SetActiveKey(kid string) error {
	km.mu.Lock()
	defer km.mu.Unlock()
	if _, ok := km.keys[kid]; !ok {
		return fmt.Errorf("key %q not found in key set", kid)
	}
	km.activeKeyID = kid
	return nil
}

// SignAccessToken builds and signs an access token with the active key.
func (km *KeyManager) SignAccessToken(userID, deviceType, deviceID string, ttl time.Duration) (string, error) {
	now := time.Now()
	claims := &Claims{
		UserID:     userID,
		DeviceType: deviceType,
		DeviceID:   deviceID,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "agenthub-hub",
			Audience:  jwt.ClaimStrings{"agenthub-api"},
			Subject:   userID,
			ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
			IssuedAt:  jwt.NewNumericDate(now),
		},
	}
	return km.signClaims(claims)
}

// SignEdgeToken builds and signs an edge-scoped token with the active key.
func (km *KeyManager) SignEdgeToken(userID, deviceID string, ttl time.Duration) (string, error) {
	now := time.Now()
	claims := &Claims{
		UserID:     userID,
		DeviceType: "edge",
		DeviceID:   deviceID,
		Purpose:    "edge-api",
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "agenthub-hub",
			Audience:  jwt.ClaimStrings{"agenthub-edge"},
			Subject:   userID,
			ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
			IssuedAt:  jwt.NewNumericDate(now),
		},
	}
	return km.signClaims(claims)
}

// signClaims signs claims with the active key and embeds the kid in the JWT header.
func (km *KeyManager) signClaims(claims *Claims) (string, error) {
	km.mu.RLock()
	kid := km.activeKeyID
	secret := km.keys[kid]
	km.mu.RUnlock()

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	token.Header["kid"] = kid
	return token.SignedString(secret)
}

// ParseToken parses and validates a JWT string using the key identified by the
// kid header. It rejects tokens without a kid header.
func (km *KeyManager) ParseToken(tokenString string) (*Claims, error) {
	// First pass: extract kid without verification.
	parser := jwt.NewParser()
	unverified, _, err := parser.ParseUnverified(tokenString, &Claims{})
	if err != nil {
		return nil, fmt.Errorf("token parse failed: %w", err)
	}

	kid, ok := unverified.Header["kid"].(string)
	if !ok || kid == "" {
		return nil, fmt.Errorf("token missing kid header")
	}

	km.mu.RLock()
	secret, ok := km.keys[kid]
	km.mu.RUnlock()
	if !ok {
		return nil, fmt.Errorf("unknown key id %q", kid)
	}

	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return secret, nil
	},
		jwt.WithValidMethods([]string{"HS256"}),
	)
	if err != nil {
		return nil, err
	}
	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, jwt.ErrSignatureInvalid
	}

	// Lenient iss/aud validation: only check when claims are present.
	if claims.Issuer != "" && claims.Issuer != "agenthub-hub" {
		return nil, fmt.Errorf("jwt issuer mismatch: got %q, want agenthub-hub", claims.Issuer)
	}
	if len(claims.Audience) > 0 {
		found := false
		for _, a := range claims.Audience {
			if a == "agenthub-api" || a == "agenthub-edge" {
				found = true
				break
			}
		}
		if !found {
			return nil, fmt.Errorf("jwt audience does not contain agenthub-api or agenthub-edge")
		}
	}
	return claims, nil
}

// ── JWKS ───────────────────────────────────────────────────────────────────────

// SymmetricJWKS is the JSON Web Key Set payload for HMAC symmetric keys.
type SymmetricJWKS struct {
	Keys []SymmetricJWK `json:"keys"`
}

// SymmetricJWK is a single symmetric JWK entry (kty: "oct").
type SymmetricJWK struct {
	KTY string `json:"kty"`
	Use string `json:"use,omitempty"`
	Alg string `json:"alg"`
	Kid string `json:"kid"`
	K   string `json:"k"` // base64url-encoded symmetric key (no padding)
}

// JWKS returns the JWKS representation of all registered keys.
// WARNING: For HS256, the JWKS exposes the raw symmetric key material
// (base64url-encoded). This endpoint MUST be restricted to internal/admin
// access only and never exposed on the public Internet.
func (km *KeyManager) JWKS() *SymmetricJWKS {
	km.mu.RLock()
	defer km.mu.RUnlock()

	keys := make([]SymmetricJWK, 0, len(km.keys))
	for kid, secret := range km.keys {
		keys = append(keys, SymmetricJWK{
			KTY: "oct",
			Use: "sig",
			Alg: "HS256",
			Kid: kid,
			K:   base64.RawURLEncoding.EncodeToString(secret),
		})
	}
	return &SymmetricJWKS{Keys: keys}
}

// GetSecret returns the active key's raw secret for backward compatibility
// with code that still uses a single secret string.
func (km *KeyManager) GetSecret() string {
	km.mu.RLock()
	defer km.mu.RUnlock()
	return string(km.keys[km.activeKeyID])
}

// KeyCount returns the number of registered keys.
func (km *KeyManager) KeyCount() int {
	km.mu.RLock()
	defer km.mu.RUnlock()
	return len(km.keys)
}
