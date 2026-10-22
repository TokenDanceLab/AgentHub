// Package oidcfixture provides a self-contained TokenDance Account-shaped OIDC
// provider for tests: RSA keys, discovery, JWKS, authorization-code exchange,
// UserInfo and strict exact redirect behavior. It intentionally implements the
// public Account contract, not Account internals.
package oidcfixture

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// Claims covers the minimal ID-token contract. Profile fields remain optional
// for older focused fixtures; Account production returns profile via UserInfo.
type Claims struct {
	Nonce         string `json:"nonce,omitempty"`
	Azp           string `json:"azp,omitempty"`
	Email         string `json:"email,omitempty"`
	EmailVerified bool   `json:"email_verified,omitempty"`
	Name          string `json:"name,omitempty"`
	Picture       string `json:"picture,omitempty"`
	jwt.RegisteredClaims
}

// ComputeKID derives the deterministic key ID used by the fixture.
func ComputeKID(pub *rsa.PublicKey) string {
	hash := sha256.Sum256(pub.N.Bytes())
	return base64.RawURLEncoding.EncodeToString(hash[:16])
}

// JWKS renders a public RS256 key set.
func JWKS(pub *rsa.PublicKey, kid string) string {
	n := base64.RawURLEncoding.EncodeToString(pub.N.Bytes())
	e := base64.RawURLEncoding.EncodeToString(big.NewInt(int64(pub.E)).Bytes())
	return fmt.Sprintf(
		`{"keys":[{"kty":"RSA","use":"sig","alg":"RS256","kid":"%s","n":"%s","e":"%s"}]}`,
		kid, n, e,
	)
}

// Key is a generated RSA key with its KID and JWKS.
type Key struct {
	Private *rsa.PrivateKey
	Kid     string
	JWKS    string
}

func NewKey(t testing.TB) *Key {
	t.Helper()
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("oidcfixture: generate key: %v", err)
	}
	kid := ComputeKID(&priv.PublicKey)
	return &Key{Private: priv, Kid: kid, JWKS: JWKS(&priv.PublicKey, kid)}
}

// SignToken signs a generic RS256 token without nonce. Prefer Provider.RegisterCode
// for authorization-code tests that need nonce and UserInfo continuity.
func SignToken(t testing.TB, priv *rsa.PrivateKey, kid, issuer, audience, subject, email, name string) string {
	t.Helper()
	now := time.Now()
	claims := Claims{
		Email:         email,
		EmailVerified: true,
		Name:          name,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    issuer,
			Subject:   subject,
			Audience:  jwt.ClaimStrings{audience},
			ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)),
			IssuedAt:  jwt.NewNumericDate(now),
		},
	}
	return signClaims(t, priv, kid, &claims)
}

func (k *Key) SignIDToken(t testing.TB, issuer, audience, subject, email, name string) string {
	return SignToken(t, k.Private, k.Kid, issuer, audience, subject, email, name)
}

type accountRecord struct {
	Subject         string
	UserInfoSubject string
	Name            string
	Picture         string
	Nonce           string
	IDTokenIssuer   string
	IDTokenAudience string
	IDTokenAzp      string
}

// CodeOptions controls one authorization-code result. Empty provider claims
// use Account-contract defaults; tests set overrides to exercise negative
// validation without replacing the fixture server.
type CodeOptions struct {
	Subject         string
	UserInfoSubject string
	Name            string
	Picture         string
	Nonce           string
	IDTokenIssuer   string
	IDTokenAudience string
	IDTokenAzp      string
}

// Provider is a running Account-shaped OIDC fixture.
type Provider struct {
	Server *httptest.Server
	Key    *Key

	mu           sync.Mutex
	codes        map[string]accountRecord
	accessTokens map[string]accountRecord
	clientID     string
	clientSecret string
}

// ConfigureClient makes the token endpoint enforce confidential-client Basic
// authentication. Other fixture users may leave it unconfigured.
func (p *Provider) ConfigureClient(clientID, clientSecret string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.clientID = clientID
	p.clientSecret = clientSecret
}

// NewServer starts a fixture exposing discovery and public OIDC endpoints.
func NewServer(t testing.TB) *Provider {
	t.Helper()
	key := NewKey(t)
	provider := &Provider{
		Key:          key,
		codes:        make(map[string]accountRecord),
		accessTokens: make(map[string]accountRecord),
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /.well-known/openid-configuration", provider.discovery)
	mux.HandleFunc("GET /.well-known/oauth-authorization-server", provider.discovery)
	mux.HandleFunc("GET /oauth/jwks", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(key.JWKS))
	})
	mux.HandleFunc("GET /oauth/authorize", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write([]byte("<html><body>Mock TokenDance Account — Authorize</body></html>"))
	})
	mux.HandleFunc("POST /oauth/token", provider.token)
	mux.HandleFunc("GET /oauth/userinfo", provider.userinfo)
	mux.HandleFunc("POST /oauth/userinfo", provider.userinfo)
	mux.HandleFunc("GET /oauth/end-session", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})

	provider.Server = httptest.NewServer(mux)
	t.Cleanup(provider.Server.Close)
	return provider
}

// RegisterCode associates the nonce generated by the Hub's authorize request
// with the authorization code used by the callback under test.
func (p *Provider) RegisterCode(code, nonce, subject, name, picture string) {
	p.RegisterCodeOptions(code, CodeOptions{
		Nonce:   nonce,
		Subject: subject,
		Name:    name,
		Picture: picture,
	})
}

// RegisterCodeOptions registers one code with explicit claim overrides.
func (p *Provider) RegisterCodeOptions(code string, opts CodeOptions) {
	if opts.UserInfoSubject == "" {
		opts.UserInfoSubject = opts.Subject
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	p.codes[code] = accountRecord{
		Subject:         opts.Subject,
		UserInfoSubject: opts.UserInfoSubject,
		Name:            opts.Name,
		Picture:         opts.Picture,
		Nonce:           opts.Nonce,
		IDTokenIssuer:   opts.IDTokenIssuer,
		IDTokenAudience: opts.IDTokenAudience,
		IDTokenAzp:      opts.IDTokenAzp,
	}
}

func (p *Provider) discovery(w http.ResponseWriter, r *http.Request) {
	base := p.Server.URL
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=300")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"issuer":                                         base,
		"authorization_endpoint":                         base + "/oauth/authorize",
		"token_endpoint":                                 base + "/oauth/token",
		"userinfo_endpoint":                              base + "/oauth/userinfo",
		"jwks_uri":                                       base + "/oauth/jwks",
		"end_session_endpoint":                           base + "/oauth/end-session",
		"response_types_supported":                       []string{"code"},
		"response_modes_supported":                       []string{"query"},
		"grant_types_supported":                          []string{"authorization_code"},
		"id_token_signing_alg_values_supported":          []string{"RS256"},
		"token_endpoint_auth_methods_supported":          []string{"none", "client_secret_basic"},
		"code_challenge_methods_supported":               []string{"S256"},
		"scopes_supported":                               []string{"openid", "profile"},
		"authorization_response_iss_parameter_supported": true,
	})
}

func (p *Provider) token(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		writeOAuthError(w, http.StatusBadRequest, "invalid_request")
		return
	}
	if r.FormValue("grant_type") != "authorization_code" {
		writeOAuthError(w, http.StatusBadRequest, "unsupported_grant_type")
		return
	}
	clientID, clientSecret, ok := r.BasicAuth()
	if !ok || clientID == "" {
		writeOAuthError(w, http.StatusUnauthorized, "invalid_client")
		return
	}
	p.mu.Lock()
	expectedClientID, expectedClientSecret := p.clientID, p.clientSecret
	p.mu.Unlock()
	if expectedClientID != "" && (clientID != expectedClientID || clientSecret != expectedClientSecret) {
		writeOAuthError(w, http.StatusUnauthorized, "invalid_client")
		return
	}
	if r.FormValue("client_secret") != "" {
		writeOAuthError(w, http.StatusBadRequest, "invalid_request")
		return
	}
	code := r.FormValue("code")
	redirectURI := r.FormValue("redirect_uri")
	if code == "" || redirectURI == "" {
		writeOAuthError(w, http.StatusBadRequest, "invalid_request")
		return
	}

	p.mu.Lock()
	record, found := p.codes[code]
	if found {
		delete(p.codes, code)
	}
	p.mu.Unlock()
	if !found {
		writeOAuthError(w, http.StatusBadRequest, "invalid_grant")
		return
	}

	issuer := record.IDTokenIssuer
	if issuer == "" {
		issuer = p.Server.URL
	}
	audience := record.IDTokenAudience
	if audience == "" {
		audience = clientID
	}
	azp := record.IDTokenAzp
	if azp == "" {
		azp = clientID
	}
	now := time.Now()
	claims := Claims{
		Nonce: record.Nonce,
		Azp:   azp,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    issuer,
			Subject:   record.Subject,
			Audience:  jwt.ClaimStrings{audience},
			ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)),
			IssuedAt:  jwt.NewNumericDate(now),
		},
	}
	idToken := signClaimsRaw(p.Key.Private, p.Key.Kid, &claims)
	accessToken := "mock-access-token-" + code
	p.mu.Lock()
	p.accessTokens[accessToken] = record
	p.mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"access_token": accessToken,
		"token_type":   "Bearer",
		"expires_in":   900,
		"id_token":     idToken,
		"scope":        "openid profile",
	})
}

func (p *Provider) userinfo(w http.ResponseWriter, r *http.Request) {
	auth := r.Header.Get("Authorization")
	raw := ""
	if len(auth) > len("Bearer ") && auth[:len("Bearer ")] == "Bearer " {
		raw = auth[len("Bearer "):]
	}
	p.mu.Lock()
	record, ok := p.accessTokens[raw]
	p.mu.Unlock()
	if !ok {
		w.Header().Set("WWW-Authenticate", `Bearer error="invalid_token"`)
		writeOAuthError(w, http.StatusUnauthorized, "invalid_token")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	payload := map[string]any{"sub": record.UserInfoSubject}
	if record.Name != "" {
		payload["name"] = record.Name
	}
	if record.Picture != "" {
		payload["picture"] = record.Picture
	}
	_ = json.NewEncoder(w).Encode(payload)
}

func signClaims(t testing.TB, priv *rsa.PrivateKey, kid string, claims *Claims) string {
	t.Helper()
	raw, err := signClaimsRawChecked(priv, kid, claims)
	if err != nil {
		t.Fatalf("oidcfixture: sign id token: %v", err)
	}
	return raw
}

func signClaimsRaw(priv *rsa.PrivateKey, kid string, claims *Claims) string {
	raw, _ := signClaimsRawChecked(priv, kid, claims)
	return raw
}

func signClaimsRawChecked(priv *rsa.PrivateKey, kid string, claims *Claims) (string, error) {
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	token.Header["kid"] = kid
	return token.SignedString(priv)
}

func writeOAuthError(w http.ResponseWriter, status int, code string) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": code})
}
