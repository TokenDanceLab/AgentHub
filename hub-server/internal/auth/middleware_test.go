package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const testSecret = "test-secret-key-for-unit-tests"

// createToken signs a JWT with the given user claims and duration.
func createToken(secret string, user User, dur time.Duration) string {
	now := time.Now()
	claims := jwt.MapClaims{
		"sub":  user.ID,
		"name": user.Name,
		"iat":  now.Unix(),
		"exp":  now.Add(dur).Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	s, _ := token.SignedString([]byte(secret))
	return s
}

// createExpiredToken signs a JWT that is already expired.
func createExpiredToken(secret string, user User) string {
	now := time.Now()
	claims := jwt.MapClaims{
		"sub":  user.ID,
		"name": user.Name,
		"iat":  now.Add(-2 * time.Hour).Unix(),
		"exp":  now.Add(-1 * time.Hour).Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	s, _ := token.SignedString([]byte(secret))
	return s
}

func TestNoAuthHeader(t *testing.T) {
	m := NewMiddleware(testSecret)
	handler := m.Authenticate(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/v1/users/me", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}

	var body map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode body: %v", err)
	}
	if body["error"] != "unauthorized" {
		t.Fatalf("expected error 'unauthorized', got %q", body["error"])
	}
	if body["message"] == "" {
		t.Fatal("expected non-empty message")
	}
}

func TestInvalidToken(t *testing.T) {
	m := NewMiddleware(testSecret)
	handler := m.Authenticate(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/v1/users/me", nil)
	req.Header.Set("Authorization", "Bearer not.a.valid.token")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}

func TestExpiredToken(t *testing.T) {
	m := NewMiddleware(testSecret)
	handler := m.Authenticate(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	expired := createExpiredToken(testSecret, User{ID: "user-1", Name: "Alice"})

	req := httptest.NewRequest(http.MethodGet, "/v1/users/me", nil)
	req.Header.Set("Authorization", "Bearer "+expired)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}

	var body map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode body: %v", err)
	}
	if body["message"] == "" {
		t.Fatal("expected non-empty message")
	}
}

func TestValidTokenPassesThrough(t *testing.T) {
	m := NewMiddleware(testSecret)
	called := false
	handler := m.Authenticate(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}))

	validToken := createToken(testSecret, User{ID: "user-1", Name: "Alice"}, time.Hour)

	req := httptest.NewRequest(http.MethodGet, "/v1/users/me", nil)
	req.Header.Set("Authorization", "Bearer "+validToken)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	if !called {
		t.Fatal("expected handler to be called")
	}
}

func TestHealthCheckSkipsAuth(t *testing.T) {
	m := NewMiddleware(testSecret, "/v1/health")
	called := false
	handler := m.Authenticate(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}))

	// No Authorization header — should still pass.
	req := httptest.NewRequest(http.MethodGet, "/v1/health", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	if !called {
		t.Fatal("expected handler to be called (health should skip auth)")
	}
}

func TestClaimsInjectedIntoContext(t *testing.T) {
	m := NewMiddleware(testSecret)
	var capturedUser *User
	handler := m.Authenticate(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u, ok := UserFromContext(r.Context())
		if ok {
			capturedUser = u
		}
		w.WriteHeader(http.StatusOK)
	}))

	validToken := createToken(testSecret, User{ID: "user-42", Name: "Bob"}, time.Hour)

	req := httptest.NewRequest(http.MethodGet, "/v1/users/me", nil)
	req.Header.Set("Authorization", "Bearer "+validToken)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	if capturedUser == nil {
		t.Fatal("expected user in context, got nil")
	}
	if capturedUser.ID != "user-42" {
		t.Fatalf("expected user ID 'user-42', got %q", capturedUser.ID)
	}
	if capturedUser.Name != "Bob" {
		t.Fatalf("expected user name 'Bob', got %q", capturedUser.Name)
	}
}

func TestSkipPathPrefixWildcard(t *testing.T) {
	m := NewMiddleware(testSecret, "/v1/public/*")
	called := false
	handler := m.Authenticate(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}))

	// Sub-path should skip auth.
	req := httptest.NewRequest(http.MethodGet, "/v1/public/docs", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	if !called {
		t.Fatal("expected handler to be called (public prefix should skip auth)")
	}
}

func TestMissingSubClaim(t *testing.T) {
	m := NewMiddleware(testSecret)
	handler := m.Authenticate(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	now := time.Now()
	claims := jwt.MapClaims{
		"name": "NoSub",
		"iat":  now.Unix(),
		"exp":  now.Add(time.Hour).Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	s, _ := token.SignedString([]byte(testSecret))

	req := httptest.NewRequest(http.MethodGet, "/v1/users/me", nil)
	req.Header.Set("Authorization", "Bearer "+s)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for missing sub, got %d", rec.Code)
	}
}

func TestWrongSigningMethod(t *testing.T) {
	m := NewMiddleware(testSecret)
	handler := m.Authenticate(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	// Sign with a different secret.
	m2 := NewMiddleware("wrong-secret")
	wrongToken := createToken("wrong-secret", User{ID: "u1", Name: "X"}, time.Hour)
	_ = m2 // suppress unused warning

	req := httptest.NewRequest(http.MethodGet, "/v1/users/me", nil)
	req.Header.Set("Authorization", "Bearer "+wrongToken)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for wrong secret, got %d", rec.Code)
	}
}

func TestUserFromContextNil(t *testing.T) {
	// No user set — should return false.
	ctx := context.Background() // from the standard library, but we import it via the package
	user, ok := UserFromContext(ctx)
	if ok {
		t.Fatal("expected false when no user in context")
	}
	if user != nil {
		t.Fatal("expected nil user when no user in context")
	}
}
