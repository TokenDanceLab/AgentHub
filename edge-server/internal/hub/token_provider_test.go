package hub

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/agenthub/pkg/testkit"
)

// makeTestJWT builds an unsigned JWT-shaped string with the given exp so the
// scheduler can extract it (signature is irrelevant to jwtExpirySeconds).
func makeTestJWT(exp int64) string {
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`))
	payload, _ := json.Marshal(map[string]int64{"exp": exp})
	return header + "." + base64.RawURLEncoding.EncodeToString(payload) + ".sig"
}

func TestJWTExpirySeconds(t *testing.T) {
	exp, ok := jwtExpirySeconds(makeTestJWT(1787000000))
	if !ok || exp != 1787000000 {
		t.Fatalf("jwtExpirySeconds = (%d, %v), want (1787000000, true)", exp, ok)
	}

	if _, ok := jwtExpirySeconds("not-a-jwt"); ok {
		t.Fatal("jwtExpirySeconds accepted a non-JWT string")
	}
	if _, ok := jwtExpirySeconds(""); ok {
		t.Fatal("jwtExpirySeconds accepted an empty string")
	}
	if _, ok := jwtExpirySeconds("a.b"); ok {
		t.Fatal("jwtExpirySeconds accepted a payload without exp")
	}
}

func TestTokenProviderAccessTokenAndSetTokens(t *testing.T) {
	p := NewTokenProvider("http://hub", "initial-access", "initial-refresh", http.DefaultClient)
	if got := p.AccessToken(); got != "initial-access" {
		t.Fatalf("AccessToken = %q, want initial-access", got)
	}
	p.SetTokens("rotated-access", "rotated-refresh")
	if got := p.AccessToken(); got != "rotated-access" {
		t.Fatalf("AccessToken after SetTokens = %q, want rotated-access", got)
	}
}

func TestTokenProviderNextRefreshDelay(t *testing.T) {
	// exp = now+3m, lead = 2m => refresh in ~1m (#2135 F3).
	soon := time.Now().Add(3 * time.Minute).Unix()
	p := NewTokenProvider("http://hub", makeTestJWT(soon), "rt", http.DefaultClient)
	delay := p.nextRefreshDelay()
	if delay < time.Minute-tokenRefreshLead || delay > time.Minute+5*time.Second {
		t.Fatalf("nextRefreshDelay = %v, want ~1m (exp-3m minus 2m lead)", delay)
	}

	expired := time.Now().Add(-time.Minute).Unix()
	p2 := NewTokenProvider("http://hub", makeTestJWT(expired), "rt", http.DefaultClient)
	if d := p2.nextRefreshDelay(); d != 0 {
		t.Fatalf("nextRefreshDelay for expired token = %v, want 0 (immediate)", d)
	}

	p3 := NewTokenProvider("http://hub", "garbage", "rt", http.DefaultClient)
	if d := p3.nextRefreshDelay(); d != 5*time.Minute {
		t.Fatalf("nextRefreshDelay for unparsable token = %v, want 5m fallback", d)
	}
}

// TestTokenProviderAutoRefreshRotatesBeforeExpiry drives the full loop against
// a mock Hub refresh endpoint and proves the token rotates without manual
// intervention.
func TestTokenProviderAutoRefreshRotatesBeforeExpiry(t *testing.T) {
	var refreshCalls atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != refreshEndpoint {
			http.NotFound(w, r)
			return
		}
		var req struct {
			RefreshToken string `json:"refresh_token"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "bad json", http.StatusBadRequest)
			return
		}
		if req.RefreshToken != "initial-refresh" && req.RefreshToken != "rotated-refresh" {
			http.Error(w, "unknown refresh token", http.StatusUnauthorized)
			return
		}
		refreshCalls.Add(1)
		// Each refresh mints a token valid for another 70 seconds.
		nextExp := time.Now().Add(70 * time.Second).Unix()
		_ = json.NewEncoder(w).Encode(map[string]any{
			"code": "ok",
			"data": map[string]string{
				"access_token":  makeTestJWT(nextExp),
				"refresh_token": "rotated-refresh",
			},
		})
	}))
	defer server.Close()

	p := NewTokenProvider(server.URL, makeTestJWT(time.Now().Add(2*time.Second).Unix()), "initial-refresh", server.Client())
	original := p.AccessToken()
	p.StartAutoRefresh()
	defer p.Stop()

	// Wait on the client-side rotation itself: the server-side request counter
	// increments before the client processes the 200 response and swaps the
	// live token in SetTokens, so polling the counter leaves the same race
	// window that flaked FLK-001 (fixed in #2017).
	testkit.Eventually(t, 10*time.Second, func() bool {
		return p.AccessToken() != original
	}, "rotated token live before expiry", func() string {
		return fmt.Sprintf("refreshCalls=%d rotated=%v", refreshCalls.Load(), p.AccessToken() != original)
	})

	// The rotated token is the live one; LastError stays clean.
	if p.AccessToken() == "" {
		t.Fatal("AccessToken empty after rotation")
	}
	if err := p.LastError(); err != "" {
		t.Fatalf("LastError = %q, want empty", err)
	}
	// The rotated token must differ from the pre-rotation one (the mock mints
	// a new exp on every refresh).
	if p.AccessToken() == original {
		t.Fatal("AccessToken still the pre-rotation token")
	}
}

// TestTokenProviderRefreshFailureRetries proves a failed rotation records the
// error and the loop keeps retrying (the token stays as-is meanwhile).
func TestTokenProviderRefreshFailureRetries(t *testing.T) {
	var refreshCalls atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		refreshCalls.Add(1)
		http.Error(w, "boom", http.StatusInternalServerError)
	}))
	defer server.Close()

	p := NewTokenProvider(server.URL, makeTestJWT(time.Now().Add(2*time.Second).Unix()), "rt", server.Client())
	p.StartAutoRefresh()
	defer p.Stop()

	// Wait on the client-side signal that is actually asserted: LastError is
	// written only after the client processes the 500 response, while the
	// server-side request counter increments earlier and left a race window
	// that flaked on slow Windows CI scheduling (FLK-001).
	testkit.Eventually(t, 5*time.Second, func() bool {
		return p.LastError() != ""
	}, "rotation failure recorded in LastError", func() string {
		return fmt.Sprintf("refreshCalls=%d lastError=%q", refreshCalls.Load(), p.LastError())
	})
	if err := p.LastError(); !strings.Contains(err, "refresh status 500") {
		t.Fatalf("LastError = %q, want refresh status 500", err)
	}
	// The failed rotation must not clobber the current access token.
	if p.AccessToken() == "" {
		t.Fatal("AccessToken lost after failed refresh")
	}
}

// TestCallbackClientUsesLiveTokenSource proves the live token source wins over
// the static token at send time (#1410 wiring contract).
func TestCallbackClientUsesLiveTokenSource(t *testing.T) {
	var seenAuth atomic.Value
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seenAuth.Store(r.Header.Get("Authorization"))
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"code":"ok"}`))
	}))
	defer server.Close()

	client := NewCallbackClient(server.URL, "static-token", server.Client(), CallbackConfig{})
	client.SetTokenSource(func() string { return "live-token" })

	_ = client.TaskAck(t.Context(), "task-1", "run-1")

	auth, _ := seenAuth.Load().(string)
	if auth != "Bearer live-token" {
		t.Fatalf("Authorization = %q, want Bearer live-token", auth)
	}

	// A source returning empty falls back to the static token.
	client.SetTokenSource(func() string { return "" })
	_ = client.TaskAck(t.Context(), "task-1", "run-1")
	auth, _ = seenAuth.Load().(string)
	if auth != "Bearer static-token" {
		t.Fatalf("Authorization after empty source = %q, want Bearer static-token", auth)
	}
}

func TestTokenProviderStopIdempotent(t *testing.T) {
	p := NewTokenProvider("http://hub", "a", "r", http.DefaultClient)
	p.Stop()
	p.Stop() // second call must not panic
}

// TestTokenProviderLogRefreshFailureCountAndReset locks in the post-fix
// contract of the failure voice: failures are recorded in LastError, the
// consecutive-failure streak counts up (driving the Warn cadence), and a
// fresh token pair (SetTokens) clears both the error and the streak so the
// next outage's first failure warns again.
func TestTokenProviderLogRefreshFailureCountAndReset(t *testing.T) {
	p := NewTokenProvider("http://hub", "a", "r", http.DefaultClient)

	p.logRefreshFailure("refresh status 500")
	if got := p.LastError(); got != "refresh status 500" {
		t.Fatalf("LastError = %q, want refresh status 500", got)
	}
	if n := p.refreshFails.Load(); n != 1 {
		t.Fatalf("refreshFails = %d, want 1", n)
	}

	for i := 0; i < tokenRefreshLogEvery; i++ {
		p.logRefreshFailure("refresh status 500")
	}
	if n := p.refreshFails.Load(); n != int64(tokenRefreshLogEvery)+1 {
		t.Fatalf("refreshFails = %d, want %d", n, tokenRefreshLogEvery+1)
	}

	p.SetTokens("new-access", "new-refresh")
	if got := p.LastError(); got != "" {
		t.Fatalf("LastError after SetTokens = %q, want empty", got)
	}
	if n := p.refreshFails.Load(); n != 0 {
		t.Fatalf("refreshFails after SetTokens = %d, want 0", n)
	}
}
