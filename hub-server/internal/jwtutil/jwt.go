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

	sharedjwt "github.com/agenthub/pkg/jwtutil"
)

// Claims is the Hub-issued HS256 session token payload. Alias of the shared
// pkg/jwtutil.HubSessionClaims single source (#1675 P1) — edge verifies the
// same struct via its own alias, so the wire contract cannot drift.
type Claims = sharedjwt.HubSessionClaims

// newJTI returns a cryptographically random JWT ID (jti) for access-token
// revocation. Opaque base64url; uniqueness is the only requirement.
func newJTI() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func GenerateAccessToken(userID, deviceType, deviceID, secret string, ttl time.Duration) (string, error) {
	now := time.Now()
	jti, err := newJTI()
	if err != nil {
		return "", fmt.Errorf("mint access jti: %w", err)
	}
	claims := Claims{
		UserID:     userID,
		DeviceType: deviceType,
		DeviceID:   deviceID,
		RegisteredClaims: jwt.RegisteredClaims{
			ID:        jti,
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

// Product JWT audiences / edge token class markers.
// Product session tokens use agenthub-api (or legacy empty aud).
// Edge identity and capability grants use agenthub-edge and must never
// authenticate Hub product APIs (/client, /web, WS, /cloud).
const (
	AudienceAPI  = "agenthub-api"
	AudienceEdge = "agenthub-edge"
	PurposeEdge  = "edge-api"
	PurposeRun   = "run-start"
)

// ParseToken parses a Hub-issued product session JWT (HS256).
//
// Product acceptance rules (#853 / token-type confusion fix):
//   - Signature + HS256 only
//   - Issuer lenient when empty (pre-R08), else must be agenthub-hub
//   - Audience: empty (legacy) or must contain agenthub-api; agenthub-edge rejected
//   - Purpose: must be empty; edge-api / run-start / any non-empty purpose rejected
//   - device_type "edge" rejected (defense in depth)
//
// Edge identity (GenerateEdgeToken) and capability (IssueCapabilityToken) tokens
// share the same secret plane but are Edge-only; this parser rejects them.
func ParseToken(tokenString, secret string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(t *jwt.Token) (interface{}, error) {
		return []byte(secret), nil
	},
		jwt.WithValidMethods([]string{"HS256"}),
		// 30s clock-skew leeway, aligned with capability tokens
		// (tokendance.go) and edge-side validation (#2135 F1). Without it,
		// product session JWTs reject earlier than capability tokens under
		// NTP skew between Hub and clients.
		jwt.WithLeeway(30*time.Second),
	)
	if err != nil {
		return nil, err
	}
	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, jwt.ErrSignatureInvalid
	}
	if err := validateProductClaims(claims); err != nil {
		return nil, err
	}
	return claims, nil
}

// validateProductClaims enforces product-session token class after signature
// verification. Shared by ParseToken and KeyManager.ParseToken.
func validateProductClaims(claims *Claims) error {
	// Lenient iss: only check when present so pre-R08 tokens still work.
	if claims.Issuer != "" && claims.Issuer != "agenthub-hub" {
		return fmt.Errorf("jwt issuer mismatch: got %q, want agenthub-hub", claims.Issuer)
	}

	// Audience: reject edge audience; require product audience when present.
	if len(claims.Audience) > 0 {
		hasAPI := false
		for _, a := range claims.Audience {
			if a == AudienceEdge {
				return fmt.Errorf("jwt audience %q is not valid for product sessions", AudienceEdge)
			}
			if a == AudienceAPI {
				hasAPI = true
			}
		}
		if !hasAPI {
			return fmt.Errorf("jwt audience does not contain %s", AudienceAPI)
		}
	}

	// Purpose: product sessions have no purpose; edge/capability tokens do.
	if claims.Purpose != "" {
		return fmt.Errorf("jwt purpose %q is not valid for product sessions", claims.Purpose)
	}

	// Defense in depth: edge device_type never authenticates product APIs.
	if claims.DeviceType == "edge" {
		return fmt.Errorf("jwt device_type %q is not valid for product sessions", claims.DeviceType)
	}

	return nil
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
	jti, err := newJTI()
	if err != nil {
		return "", fmt.Errorf("mint access jti: %w", err)
	}
	claims := &Claims{
		UserID:     userID,
		DeviceType: deviceType,
		DeviceID:   deviceID,
		RegisteredClaims: jwt.RegisteredClaims{
			ID:        jti,
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

// ParseToken parses and validates a product-session JWT using the key identified
// by the kid header. It rejects tokens without a kid header and applies the
// same product token-class gate as ParseToken (no edge/capability acceptance).
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
		jwt.WithLeeway(30*time.Second), // #2135 F1: align with single-key parser,
		jwt.WithValidMethods([]string{"HS256"}),
	)
	if err != nil {
		return nil, err
	}
	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, jwt.ErrSignatureInvalid
	}
	if err := validateProductClaims(claims); err != nil {
		return nil, err
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
