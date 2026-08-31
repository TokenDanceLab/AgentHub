//nolint:gosec // 测试 fixture：凭据模式字符串用于构造测试用例，非真实凭据
package jwtutil

import (
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func TestGenerateAccessToken_RoundTrip(t *testing.T) {
	secret := "test-secret"
	token, err := GenerateAccessToken("user-1", "desktop", "dev-1", secret, 15*time.Minute)
	if err != nil {
		t.Fatalf("GenerateAccessToken failed: %v", err)
	}
	if token == "" {
		t.Fatal("expected non-empty token")
	}

	claims, err := ParseToken(token, secret)
	if err != nil {
		t.Fatalf("ParseToken failed: %v", err)
	}
	if claims.UserID != "user-1" {
		t.Errorf("expected user_id=user-1, got %s", claims.UserID)
	}
	if claims.DeviceType != "desktop" {
		t.Errorf("expected device_type=desktop, got %s", claims.DeviceType)
	}
	if claims.DeviceID != "dev-1" {
		t.Errorf("expected device_id=dev-1, got %s", claims.DeviceID)
	}
	if claims.ExpiresAt == nil {
		t.Fatal("expected ExpiresAt to be set")
	}
	if claims.IssuedAt == nil {
		t.Fatal("expected IssuedAt to be set")
	}
	if claims.ID == "" {
		t.Fatal("expected access token jti (RegisteredClaims.ID) to be set")
	}
}

func TestGenerateAccessToken_MintsUniqueJTI(t *testing.T) {
	secret := "test-secret"
	t1, err := GenerateAccessToken("user-1", "desktop", "dev-1", secret, 15*time.Minute)
	if err != nil {
		t.Fatalf("GenerateAccessToken failed: %v", err)
	}
	t2, err := GenerateAccessToken("user-1", "desktop", "dev-1", secret, 15*time.Minute)
	if err != nil {
		t.Fatalf("GenerateAccessToken failed: %v", err)
	}
	c1, err := ParseToken(t1, secret)
	if err != nil {
		t.Fatalf("ParseToken t1: %v", err)
	}
	c2, err := ParseToken(t2, secret)
	if err != nil {
		t.Fatalf("ParseToken t2: %v", err)
	}
	if c1.ID == "" || c2.ID == "" {
		t.Fatal("expected non-empty jti on both tokens")
	}
	if c1.ID == c2.ID {
		t.Fatal("expected unique jti per access token mint")
	}
}

func TestParseToken_Expired(t *testing.T) {
	secret := "test-secret"
	// -31s stays beyond the 30s leeway (#2135 F1): still rejected.
	token, err := GenerateAccessToken("user-1", "desktop", "dev-1", secret, -31*time.Second)
	if err != nil {
		t.Fatalf("GenerateAccessToken failed: %v", err)
	}

	_, err = ParseToken(token, secret)
	if err == nil {
		t.Fatal("expected error for expired token")
	}
}

func TestParseToken_WithinLeewayAccepted(t *testing.T) {
	secret := "test-secret"
	// -10s expires slightly in the past but within the 30s clock-skew leeway:
	// aligned with capability/edge validation (#2135 F1).
	token, err := GenerateAccessToken("user-1", "desktop", "dev-1", secret, -10*time.Second)
	if err != nil {
		t.Fatalf("GenerateAccessToken failed: %v", err)
	}

	claims, err := ParseToken(token, secret)
	if err != nil {
		t.Fatalf("ParseToken within leeway failed: %v", err)
	}
	if claims == nil || claims.UserID != "user-1" {
		t.Fatalf("claims = %+v, want user-1", claims)
	}
}

func TestParseToken_WrongSecret(t *testing.T) {
	secret := "test-secret"
	token, err := GenerateAccessToken("user-1", "desktop", "dev-1", secret, 15*time.Minute)
	if err != nil {
		t.Fatalf("GenerateAccessToken failed: %v", err)
	}

	_, err = ParseToken(token, "wrong-secret")
	if err == nil {
		t.Fatal("expected error for wrong secret")
	}
}

func TestParseToken_Malformed(t *testing.T) {
	cases := []string{
		"",
		"not.a.jwt",
		"header.$$$.sig",
		"just-one-part",
	}

	for _, tc := range cases {
		_, err := ParseToken(tc, "secret")
		if err == nil {
			t.Errorf("expected error for malformed token %q", tc)
		}
	}
}

func TestParseToken_InvalidSignature(t *testing.T) {
	secret := "test-secret"
	token, err := GenerateAccessToken("user-1", "desktop", "dev-1", secret, 15*time.Minute)
	if err != nil {
		t.Fatalf("GenerateAccessToken failed: %v", err)
	}

	// Tamper with the payload: change last char of the middle part
	parts := []byte(token)
	if len(parts) > 20 {
		parts[len(parts)-5] ^= 0xff
	}

	_, err = ParseToken(string(parts), secret)
	if err == nil {
		t.Fatal("expected error for tampered token")
	}
}

func TestGenerateRefreshToken_ProducesValue(t *testing.T) {
	tok, err := GenerateRefreshToken()
	if err != nil {
		t.Fatalf("GenerateRefreshToken failed: %v", err)
	}
	if tok == "" {
		t.Fatal("expected non-empty refresh token")
	}
	if len(tok) < 32 {
		t.Errorf("expected refresh token >= 32 chars, got %d", len(tok))
	}
}

func TestGenerateRefreshToken_Unique(t *testing.T) {
	tokens := make(map[string]bool)
	for i := 0; i < 10; i++ {
		tok, err := GenerateRefreshToken()
		if err != nil {
			t.Fatalf("GenerateRefreshToken failed: %v", err)
		}
		if tokens[tok] {
			t.Fatal("expected unique tokens, got duplicate")
		}
		tokens[tok] = true
	}
}

func TestHashRefreshToken_Deterministic(t *testing.T) {
	tok := "my-refresh-token"
	h1 := HashRefreshToken(tok)
	h2 := HashRefreshToken(tok)
	if h1 != h2 {
		t.Fatal("expected deterministic hash")
	}
	if h1 == "" {
		t.Fatal("expected non-empty hash")
	}
}

func TestHashRefreshToken_DifferentInputs(t *testing.T) {
	h1 := HashRefreshToken("token-a")
	h2 := HashRefreshToken("token-b")
	if h1 == h2 {
		t.Fatal("expected different hashes for different inputs")
	}
}

func TestGenerateAccessToken_IncludesRegisteredClaims(t *testing.T) {
	secret := "test-secret"
	token, err := GenerateAccessToken("user-1", "desktop", "dev-1", secret, 15*time.Minute)
	if err != nil {
		t.Fatalf("GenerateAccessToken failed: %v", err)
	}

	claims, err := ParseToken(token, secret)
	if err != nil {
		t.Fatalf("ParseToken failed: %v", err)
	}

	if claims.ExpiresAt.Before(time.Now()) {
		t.Error("expected ExpiresAt to be in the future")
	}
	if claims.IssuedAt.After(time.Now()) {
		t.Error("expected IssuedAt to be in the past or present")
	}
}

func TestGenerateEdgeToken_IncludesEdgeScopedClaims(t *testing.T) {
	secret := "hub-secret-at-least-32-bytes-long!!"
	tokenString, err := GenerateEdgeToken("user-1", "edge-device-1", secret, 15*time.Minute)
	if err != nil {
		t.Fatalf("GenerateEdgeToken failed: %v", err)
	}
	if tokenString == "" {
		t.Fatal("expected non-empty token")
	}

	var claims struct {
		UserID     string `json:"user_id"`
		DeviceID   string `json:"device_id"`
		DeviceType string `json:"device_type"`
		Purpose    string `json:"purpose"`
		jwt.RegisteredClaims
	}
	token, err := jwt.ParseWithClaims(tokenString, &claims, func(t *jwt.Token) (interface{}, error) {
		return []byte(secret), nil
	}, jwt.WithValidMethods([]string{"HS256"}))
	if err != nil {
		t.Fatalf("parse edge token: %v", err)
	}
	if !token.Valid {
		t.Fatal("edge token is invalid")
	}
	if claims.Issuer != "agenthub-hub" {
		t.Fatalf("issuer = %q, want agenthub-hub", claims.Issuer)
	}
	if !claimStringsContain(claims.Audience, "agenthub-edge") {
		t.Fatalf("audience = %v, want agenthub-edge", claims.Audience)
	}
	if claims.Subject != "user-1" || claims.UserID != "user-1" {
		t.Fatalf("subject/user_id = %q/%q, want user-1", claims.Subject, claims.UserID)
	}
	if claims.DeviceID != "edge-device-1" {
		t.Fatalf("device_id = %q, want edge-device-1", claims.DeviceID)
	}
	if claims.DeviceType != "edge" {
		t.Fatalf("device_type = %q, want edge", claims.DeviceType)
	}
	if claims.Purpose != "edge-api" {
		t.Fatalf("purpose = %q, want edge-api", claims.Purpose)
	}
}

func claimStringsContain(values jwt.ClaimStrings, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}

func TestParseToken_RejectsEdgeToken(t *testing.T) {
	secret := "hub-secret-at-least-32-bytes-long!!"
	token, err := GenerateEdgeToken("user-1", "edge-device-1", secret, 15*time.Minute)
	if err != nil {
		t.Fatalf("GenerateEdgeToken: %v", err)
	}
	if _, err := ParseToken(token, secret); err == nil {
		t.Fatal("ParseToken must reject edge-scoped tokens (aud=agenthub-edge, purpose=edge-api)")
	}
}

func TestParseToken_RejectsCapabilityToken(t *testing.T) {
	secret := []byte("hub-local-secret-minimum-32-chars!!")
	token, err := IssueCapabilityToken(secret, "user-1", "edge-1", "proj_local", "run-start", time.Minute)
	if err != nil {
		t.Fatalf("IssueCapabilityToken: %v", err)
	}
	if _, err := ParseToken(token, string(secret)); err == nil {
		t.Fatal("ParseToken must reject capability tokens (aud=agenthub-edge, purpose=run-start)")
	}
}

func TestParseToken_RejectsPurposeOnlyToken(t *testing.T) {
	secret := "test-secret-for-purpose-only-token!!"
	now := time.Now()
	claims := Claims{
		UserID:     "user-1",
		DeviceType: "desktop",
		DeviceID:   "dev-1",
		Purpose:    "run-start",
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "agenthub-hub",
			Audience:  jwt.ClaimStrings{"agenthub-api"},
			Subject:   "user-1",
			ExpiresAt: jwt.NewNumericDate(now.Add(15 * time.Minute)),
			IssuedAt:  jwt.NewNumericDate(now),
		},
	}
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(secret))
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	if _, err := ParseToken(token, secret); err == nil {
		t.Fatal("ParseToken must reject non-empty purpose even with product audience")
	}
}

func TestParseToken_AcceptsLegacyEmptyAudience(t *testing.T) {
	secret := "test-secret-legacy-empty-aud!!!!!!!"
	now := time.Now()
	claims := Claims{
		UserID:     "user-1",
		DeviceType: "desktop",
		DeviceID:   "dev-1",
		RegisteredClaims: jwt.RegisteredClaims{
			// No Issuer / Audience: pre-R08 product session shape.
			Subject:   "user-1",
			ExpiresAt: jwt.NewNumericDate(now.Add(15 * time.Minute)),
			IssuedAt:  jwt.NewNumericDate(now),
		},
	}
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(secret))
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	got, err := ParseToken(token, secret)
	if err != nil {
		t.Fatalf("legacy empty-aud product token must still parse: %v", err)
	}
	if got.UserID != "user-1" || got.DeviceType != "desktop" {
		t.Fatalf("unexpected claims: %+v", got)
	}
}

func TestParseToken_RejectsUnknownAudience(t *testing.T) {
	secret := "test-secret-unknown-audience!!!!!!!"
	now := time.Now()
	claims := Claims{
		UserID:     "user-1",
		DeviceType: "desktop",
		DeviceID:   "dev-1",
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "agenthub-hub",
			Audience:  jwt.ClaimStrings{"other-service"},
			Subject:   "user-1",
			ExpiresAt: jwt.NewNumericDate(now.Add(15 * time.Minute)),
			IssuedAt:  jwt.NewNumericDate(now),
		},
	}
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(secret))
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	if _, err := ParseToken(token, secret); err == nil {
		t.Fatal("ParseToken must reject unknown audience")
	}
}

// ── KeyManager / Key Rotation tests ──────────────────────────────────────────

func TestKeyRotation(t *testing.T) {
	// Create a KeyManager with two keys.
	secrets := map[string]string{
		"key-v1": "secret-for-key-v1-minimum-32-chars",
		"key-v2": "secret-for-key-v2-minimum-32-chars",
	}
	km, err := NewKeyManager(secrets, "key-v1")
	if err != nil {
		t.Fatalf("NewKeyManager failed: %v", err)
	}
	if km.ActiveKeyID() != "key-v1" {
		t.Fatalf("active key = %q, want key-v1", km.ActiveKeyID())
	}
	if km.KeyCount() != 2 {
		t.Fatalf("key count = %d, want 2", km.KeyCount())
	}

	// Sign a token with the active key (key-v1).
	token1, err := km.SignAccessToken("user-1", "desktop", "dev-1", 15*time.Minute)
	if err != nil {
		t.Fatalf("SignAccessToken failed: %v", err)
	}
	if token1 == "" {
		t.Fatal("expected non-empty token")
	}

	// Parse the token — should succeed with key-v1.
	claims1, err := km.ParseToken(token1)
	if err != nil {
		t.Fatalf("ParseToken failed: %v", err)
	}
	if claims1.UserID != "user-1" {
		t.Errorf("user_id = %q, want user-1", claims1.UserID)
	}

	// Rotate to key-v2.
	if err := km.SetActiveKey("key-v2"); err != nil {
		t.Fatalf("SetActiveKey key-v2 failed: %v", err)
	}
	if km.ActiveKeyID() != "key-v2" {
		t.Fatalf("active key after rotation = %q, want key-v2", km.ActiveKeyID())
	}

	// Old token (signed with key-v1) should still parse.
	claimsOld, err := km.ParseToken(token1)
	if err != nil {
		t.Fatalf("ParseToken for old token after rotation failed: %v", err)
	}
	if claimsOld.UserID != "user-1" {
		t.Errorf("old token user_id = %q, want user-1", claimsOld.UserID)
	}

	// Sign a new token with the new active key (key-v2).
	token2, err := km.SignAccessToken("user-2", "web", "dev-2", 15*time.Minute)
	if err != nil {
		t.Fatalf("SignAccessToken with new key failed: %v", err)
	}
	if token1 == token2 {
		t.Fatal("tokens signed with different keys should differ")
	}

	claims2, err := km.ParseToken(token2)
	if err != nil {
		t.Fatalf("ParseToken for new-key token failed: %v", err)
	}
	if claims2.UserID != "user-2" {
		t.Errorf("new token user_id = %q, want user-2", claims2.UserID)
	}
}

func TestKeyRotation_RemoveOldKey(t *testing.T) {
	secrets := map[string]string{
		"key-v1": "secret-for-key-v1-minimum-32-chars",
		"key-v2": "secret-for-key-v2-minimum-32-chars",
	}
	km, err := NewKeyManager(secrets, "key-v1")
	if err != nil {
		t.Fatalf("NewKeyManager failed: %v", err)
	}

	// Cannot remove the active key.
	if err := km.RemoveKey("key-v1"); err == nil {
		t.Fatal("expected error removing active key")
	}

	// Rotate, then remove the old key.
	if err := km.SetActiveKey("key-v2"); err != nil {
		t.Fatalf("SetActiveKey failed: %v", err)
	}
	if err := km.RemoveKey("key-v1"); err != nil {
		t.Fatalf("RemoveKey key-v1 failed: %v", err)
	}
	if km.HasKey("key-v1") {
		t.Fatal("key-v1 should be removed")
	}
	if km.KeyCount() != 1 {
		t.Fatalf("key count after removal = %d, want 1", km.KeyCount())
	}

	// Cannot remove the only remaining key (it is active).
	if err := km.RemoveKey("key-v2"); err == nil {
		t.Fatal("expected error removing the only key")
	}
}

func TestKeyRotation_AddKeyDuringRuntime(t *testing.T) {
	secrets := map[string]string{
		"key-v1": "secret-for-key-v1-minimum-32-chars",
	}
	km, err := NewKeyManager(secrets, "key-v1")
	if err != nil {
		t.Fatalf("NewKeyManager failed: %v", err)
	}

	// Add a new key at runtime.
	if err := km.AddKey("key-v3", "secret-for-key-v3-minimum-32-chars"); err != nil {
		t.Fatalf("AddKey failed: %v", err)
	}
	if !km.HasKey("key-v3") {
		t.Fatal("key-v3 should exist after AddKey")
	}
	if km.KeyCount() != 2 {
		t.Fatalf("key count after add = %d, want 2", km.KeyCount())
	}

	// Rotate to the new key.
	if err := km.SetActiveKey("key-v3"); err != nil {
		t.Fatalf("SetActiveKey key-v3 failed: %v", err)
	}

	token, err := km.SignAccessToken("user-3", "mobile", "dev-3", 15*time.Minute)
	if err != nil {
		t.Fatalf("SignAccessToken with runtime-added key failed: %v", err)
	}
	claims, err := km.ParseToken(token)
	if err != nil {
		t.Fatalf("ParseToken with runtime-added key failed: %v", err)
	}
	if claims.UserID != "user-3" {
		t.Errorf("user_id = %q, want user-3", claims.UserID)
	}
}

func TestKeyRotation_JWKS(t *testing.T) {
	secrets := map[string]string{
		"key-v1": "secret-for-key-v1-minimum-32-chars",
		"key-v2": "secret-for-key-v2-minimum-32-chars",
	}
	km, err := NewKeyManager(secrets, "key-v1")
	if err != nil {
		t.Fatalf("NewKeyManager failed: %v", err)
	}

	jwks := km.JWKS()
	if jwks == nil {
		t.Fatal("JWKS returned nil")
	}
	if len(jwks.Keys) != 2 {
		t.Fatalf("JWKS keys count = %d, want 2", len(jwks.Keys))
	}

	seen := make(map[string]bool)
	for _, k := range jwks.Keys {
		if k.KTY != "oct" {
			t.Errorf("key %q kty = %q, want oct", k.Kid, k.KTY)
		}
		if k.Alg != "HS256" {
			t.Errorf("key %q alg = %q, want HS256", k.Kid, k.Alg)
		}
		if k.Kid == "" {
			t.Error("JWK missing kid")
		}
		if k.K == "" {
			t.Errorf("key %q missing k (base64url secret)", k.Kid)
		}
		seen[k.Kid] = true
	}
	if !seen["key-v1"] || !seen["key-v2"] {
		t.Fatal("JWKS missing expected key IDs")
	}
}

func TestKeyRotation_TokenMissingKid(t *testing.T) {
	// Token generated without KeyManager (old-style, no kid header).
	secret := "old-style-secret-padded-to-minimum-32-chars!!"
	token, err := GenerateAccessToken("user-1", "desktop", "dev-1", secret, 15*time.Minute)
	if err != nil {
		t.Fatalf("GenerateAccessToken failed: %v", err)
	}

	secrets := map[string]string{
		"default": secret,
	}
	km, err := NewKeyManager(secrets, "default")
	if err != nil {
		t.Fatalf("NewKeyManager failed: %v", err)
	}

	_, err = km.ParseToken(token)
	if err == nil {
		t.Fatal("expected error for token without kid header")
	}
}

func TestKeyRotation_TokenUnknownKid(t *testing.T) {
	secrets := map[string]string{
		"key-v1": "secret-for-key-v1-minimum-32-chars",
	}
	km, err := NewKeyManager(secrets, "key-v1")
	if err != nil {
		t.Fatalf("NewKeyManager failed: %v", err)
	}

	// Sign with a different KeyManager having different keys.
	otherKM, _ := NewKeyManager(map[string]string{
		"other-key": "other-secret-for-other-key-32-chars!",
	}, "other-key")
	token, _ := otherKM.SignAccessToken("user-1", "desktop", "dev-1", 15*time.Minute)

	_, err = km.ParseToken(token)
	if err == nil {
		t.Fatal("expected error for token with unknown kid")
	}
}

func TestKeyRotation_NewKeyManagerErrors(t *testing.T) {
	// Empty secrets.
	_, err := NewKeyManager(map[string]string{}, "")
	if err == nil {
		t.Fatal("expected error for empty secrets")
	}

	// Empty kid.
	_, err = NewKeyManager(map[string]string{"": "secret"}, "")
	if err == nil {
		t.Fatal("expected error for empty kid")
	}

	// Empty secret.
	_, err = NewKeyManager(map[string]string{"kid": ""}, "")
	if err == nil {
		t.Fatal("expected error for empty secret")
	}

	// Active key not in secrets.
	_, err = NewKeyManager(map[string]string{"key1": "secret-for-key1-minimum-32-chars!!!"}, "key2")
	if err == nil {
		t.Fatal("expected error for unknown active key")
	}
}

func TestKeyRotation_SignEdgeToken(t *testing.T) {
	secrets := map[string]string{
		"edge-key": "edge-key-secret!!-padded-to-32-chars",
	}
	km, _ := NewKeyManager(secrets, "edge-key")

	token, err := km.SignEdgeToken("user-1", "edge-dev-1", 15*time.Minute)
	if err != nil {
		t.Fatalf("SignEdgeToken failed: %v", err)
	}

	// Parse with a fresh parser to check claims (not through KeyManager).
	parser := jwt.NewParser()
	unverified, _, err := parser.ParseUnverified(token, &Claims{})
	if err != nil {
		t.Fatalf("ParseUnverified failed: %v", err)
	}

	kid, ok := unverified.Header["kid"].(string)
	if !ok || kid != "edge-key" {
		t.Fatalf("kid = %q, want edge-key", kid)
	}

	// Product ParseToken must reject edge-scoped tokens (#853).
	if _, err := km.ParseToken(token); err == nil {
		t.Fatal("KeyManager.ParseToken must reject edge-scoped tokens on product path")
	}

	// Claims shape is still edge-scoped when inspected without product gate.
	rawClaims, ok := unverified.Claims.(*Claims)
	if !ok {
		t.Fatal("expected Claims type")
	}
	if rawClaims.Purpose != "edge-api" {
		t.Errorf("purpose = %q, want edge-api", rawClaims.Purpose)
	}
	if rawClaims.DeviceType != "edge" {
		t.Errorf("device_type = %q, want edge", rawClaims.DeviceType)
	}
}

func TestKeyRotation_ConcurrentAccess(t *testing.T) {
	secrets := map[string]string{
		"k1": "secret-for-k1-padded-to-minimum-32-chars!",
		"k2": "secret-for-k2-padded-to-minimum-32-chars!",
	}
	km, _ := NewKeyManager(secrets, "k1")

	done := make(chan bool, 10)
	for i := 0; i < 5; i++ {
		go func() {
			for j := 0; j < 50; j++ {
				token, _ := km.SignAccessToken("user", "desktop", "dev", 15*time.Minute)
				km.ParseToken(token) //nolint:errcheck
				km.ActiveKeyID()
				km.KeyIDs()
				km.JWKS()
			}
			done <- true
		}()
	}
	// Rotate while signing/parsing.
	go func() {
		for j := 0; j < 50; j++ {
			if j%2 == 0 {
				km.SetActiveKey("k1") //nolint:errcheck
			} else {
				km.SetActiveKey("k2") //nolint:errcheck
			}
		}
		done <- true
	}()
	for i := 0; i < 6; i++ {
		<-done
	}
}

func TestKeyRotation_GetSecret(t *testing.T) {
	secrets := map[string]string{
		"key-a": "secret-a-padded-to-minimum-32-chars!",
		"key-b": "secret-b-padded-to-minimum-32-chars!",
	}
	km, _ := NewKeyManager(secrets, "key-a")

	if s := km.GetSecret(); s != "secret-a-padded-to-minimum-32-chars!" {
		t.Errorf("GetSecret = %q, want key-a secret", s)
	}
	km.SetActiveKey("key-b") //nolint:errcheck
	if s := km.GetSecret(); s != "secret-b-padded-to-minimum-32-chars!" {
		t.Errorf("GetSecret after rotation = %q, want key-b secret", s)
	}
}
