//go:build integration

package integration

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/jwtutil"
)

// TestAuthExpiredToken verifies that an expired access token is rejected
// when accessing a protected endpoint.
func TestAuthExpiredToken(t *testing.T) {
	CleanDB(t, db)

	u := register(t, "texpired_user", "pass1234", "ExpiredUser")

	// Generate a token that is already expired BEYOND the 30s clock-skew
	// leeway (jwt.go WithLeeway, #2135 F1; jwt_test.go pins the contract:
	// -31s rejected, within-leeway accepted). A -1s TTL used to sit inside
	// the leeway, so the test exercised acceptance, not rejection.
	expiredToken, err := jwtutil.GenerateAccessToken(
		u.ID,
		"web",
		testDeviceID(u.Username, "web"),
		testJWT.Secret,
		-2*time.Minute, // expired beyond leeway
	)
	if err != nil {
		t.Fatalf("generate expired token: %v", err)
	}

	// Attempt to access /me with the expired token.
	resp := get("/client/auth/me", expiredToken)
	r := parse(resp)

	if r.GetCode() == errcode.OK.Code {
		t.Fatal("expected expired token to be rejected, got OK")
	}

	// Verify the valid token still works (sanity check).
	respOK := get("/client/auth/me", u.Token)
	rOK := parse(respOK)
	if rOK.GetCode() != errcode.OK.Code {
		t.Fatalf("valid token should work: got %s", rOK.GetCode())
	}
}

// TestAuthExpiredAccessTokenOnProtectedEndpoint verifies that an expired
// access token is rejected across multiple protected endpoints (not just /me).
func TestAuthExpiredAccessTokenOnProtectedEndpoint(t *testing.T) {
	CleanDB(t, db)

	u := register(t, "texpired2", "pass1234", "Expired2")

	// -2min: beyond the 30s clock-skew leeway (see TestAuthExpiredToken).
	expiredToken, err := jwtutil.GenerateAccessToken(
		u.ID,
		"desktop",
		testDeviceID(u.Username, "desktop"),
		testJWT.Secret,
		-2*time.Minute,
	)
	if err != nil {
		t.Fatalf("generate expired token: %v", err)
	}

	// Try multiple protected endpoints with the expired token.
	endpoints := []struct {
		method string
		path   string
		body   interface{}
	}{
		{"GET", "/client/contacts", nil},
		{"GET", "/client/sessions", nil},
		{"POST", "/client/sessions/private", map[string]string{"target_user_id": "any"}},
	}

	for _, ep := range endpoints {
		var resp *http.Response
		switch ep.method {
		case "GET":
			resp = get(ep.path, expiredToken)
		case "POST":
			resp = postAuth(ep.path, expiredToken, ep.body)
		}
		r := parse(resp)
		if r.GetCode() == errcode.OK.Code {
			t.Errorf("%s %s: expected rejection for expired token, got OK", ep.method, ep.path)
		}
	}
}

// TestAuthWrongDeviceToken verifies that tokens scoped to different devices
// of the same user are independently valid: the JWT middleware validates the
// token but does not cross-check device binding at the HTTP level. Password
// login used to mint the two device-scoped tokens; they are now minted
// directly like register() does (#1367).
func TestAuthWrongDeviceToken(t *testing.T) {
	CleanDB(t, db)

	// register() mints a web-scoped token; mint a desktop-scoped one for a
	// different device alongside it.
	u := register(t, "twrongdev", "pass1234", "WrongDevice")
	webToken := u.Token

	desktopToken, err := jwtutil.GenerateAccessToken(u.ID, "desktop",
		"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", testJWT.Secret, testJWT.AccessTTL)
	if err != nil {
		t.Fatalf("generate desktop token: %v", err)
	}

	// Both tokens should work independently for /me.
	for _, tc := range []struct {
		name  string
		token string
	}{
		{"desktop token", desktopToken},
		{"web token", webToken},
	} {
		resp := get("/client/auth/me", tc.token)
		r := parse(resp)
		if r.GetCode() != errcode.OK.Code {
			t.Errorf("%s: expected OK, got %s: %s", tc.name, r.GetCode(), r.GetMsg())
		}
	}

	// Verify tokens are distinct (different devices, different tokens).
	if desktopToken == webToken {
		t.Fatal("expected different tokens for different devices")
	}
}

// TestAuthConcurrentRefresh verifies that concurrent refresh attempts for the
// same user on different desktop devices all succeed with unique tokens.
// Pre-OIDC this exercised concurrent password logins; POST /client/auth/refresh
// is the surviving token-issuance endpoint (#1367, #1369).
func TestAuthConcurrentRefresh(t *testing.T) {
	CleanDB(t, db)

	u := register(t, "tconcurrent", "pass1234", "ConcurrentUser")

	const numConcurrent = 10
	refreshTokens := make([]string, numConcurrent)
	for i := 0; i < numConcurrent; i++ {
		deviceID := fmt.Sprintf("cccccccc-cccc-4ccc-8ccc-%012d", i)
		refreshTokens[i] = seedRefreshToken(t, u.ID, "desktop", deviceID)
	}

	type result struct {
		idx   int
		token string
		err   string
	}
	results := make(chan result, numConcurrent)

	var wg sync.WaitGroup
	for i := 0; i < numConcurrent; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			resp := parse(post("/client/auth/refresh", map[string]string{
				"refresh_token": refreshTokens[idx],
			}))
			r := result{idx: idx}
			if resp.GetCode() != errcode.OK.Code {
				r.err = resp.GetMsg()
			} else {
				r.token = extract(resp.Data, "access_token")
			}
			results <- r
		}(i)
	}
	wg.Wait()
	close(results)

	// Collect and verify.
	tokens := make(map[string]bool)
	failures := 0
	for r := range results {
		if r.err != "" {
			failures++
			t.Errorf("concurrent refresh failed for device %d: %s", r.idx, r.err)
			continue
		}
		if r.token == "" {
			failures++
			t.Errorf("concurrent refresh returned empty token for device %d", r.idx)
			continue
		}
		if tokens[r.token] {
			t.Errorf("duplicate token issued: %s", r.token)
		}
		tokens[r.token] = true
	}

	if failures > 0 {
		t.Fatalf("%d/%d concurrent refreshes failed", failures, numConcurrent)
	}
	if len(tokens) != numConcurrent {
		t.Errorf("expected %d unique tokens, got %d", numConcurrent, len(tokens))
	}
}

// TestAuthRefreshAfterLogout verifies that a refresh token is rejected
// after the user logs out. The session pair (access + refresh token) is
// seeded directly for the same user/device the way the OIDC callback
// would establish it (#1367).
func TestAuthRefreshAfterLogout(t *testing.T) {
	CleanDB(t, db)

	u := register(t, "tlogoutrefresh", "pass1234", "LogoutRefresh")
	deviceID := "dddddddd-dddd-4ddd-8ddd-dddddddddddd"

	accessToken, err := jwtutil.GenerateAccessToken(u.ID, "desktop", deviceID,
		testJWT.Secret, testJWT.AccessTTL)
	if err != nil {
		t.Fatalf("generate desktop token: %v", err)
	}
	refreshToken := seedRefreshToken(t, u.ID, "desktop", deviceID)

	// Verify the access token works.
	mustOK(t, parse(get("/client/auth/me", accessToken)), "me before logout")

	// Logout revokes refresh tokens for the user/device carried by the JWT.
	mustOK(t, parse(postAuth("/client/auth/logout", accessToken, nil)), "logout")

	// The refresh token must now be rejected.
	mustCode(t, parse(post("/client/auth/refresh", map[string]string{
		"refresh_token": refreshToken,
	})), errcode.AuthRefreshInvalid.Code, "refresh after logout")
}

// TestAuthRefreshRotationSameDevice verifies that refreshing on the same
// device rotates the pair: a new distinct access/refresh pair is issued each
// time, the rotated refresh token keeps working, and consumed refresh tokens
// are rejected (#134). Pre-OIDC this was covered as "re-login on the same
// device"; refresh is the surviving re-issuance path (#1367, #1369).
func TestAuthRefreshRotationSameDevice(t *testing.T) {
	CleanDB(t, db)

	u := register(t, "trelogin", "pass1234", "ReLogin")
	deviceID := "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
	seeded := seedRefreshToken(t, u.ID, "desktop", deviceID)

	// First refresh: consumes the seeded token, issues a new pair.
	first := parse(post("/client/auth/refresh", map[string]string{"refresh_token": seeded}))
	mustOK(t, first, "first refresh")
	firstAccess := extract(first.Data, "access_token")
	firstRefresh := extract(first.Data, "refresh_token")
	if firstRefresh == seeded {
		t.Fatal("expected rotation to issue a new refresh token")
	}

	// Second refresh with the rotated token succeeds and differs again.
	second := parse(post("/client/auth/refresh", map[string]string{"refresh_token": firstRefresh}))
	mustOK(t, second, "second refresh with rotated token")
	secondAccess := extract(second.Data, "access_token")
	secondRefresh := extract(second.Data, "refresh_token")

	if firstAccess == secondAccess {
		t.Error("expected distinct access tokens for consecutive refreshes")
	}
	if firstRefresh == secondRefresh {
		t.Error("expected distinct refresh tokens for consecutive refreshes")
	}

	// Both access tokens remain valid (stateless JWTs).
	mustOK(t, parse(get("/client/auth/me", firstAccess)), "first access token")
	mustOK(t, parse(get("/client/auth/me", secondAccess)), "second access token")

	// The consumed refresh tokens are rejected: rotation revoked them.
	mustCode(t, parse(post("/client/auth/refresh", map[string]string{"refresh_token": seeded})),
		errcode.AuthRefreshInvalid.Code, "seeded token after rotation")
	mustCode(t, parse(post("/client/auth/refresh", map[string]string{"refresh_token": firstRefresh})),
		errcode.AuthRefreshInvalid.Code, "first rotated token after second rotation")
}

// TestAuthRefreshRejectsUnknownToken verifies that a refresh token that was
// never issued is rejected.
func TestAuthRefreshRejectsUnknownToken(t *testing.T) {
	CleanDB(t, db)

	mustCode(t, parse(post("/client/auth/refresh", map[string]string{
		"refresh_token": "never-issued-refresh-token",
	})), errcode.AuthRefreshInvalid.Code, "unknown refresh token")
}

// TestAuthMalformedToken verifies that a malformed (non-JWT) token is rejected.
func TestAuthMalformedToken(t *testing.T) {
	CleanDB(t, db)

	malformedTokens := []string{
		"not-a-jwt",
		"",
		"Bearer ",
		"eyJhbGciOiJIUzI1NiJ9.INVALID",
	}

	for _, tok := range malformedTokens {
		var resp *http.Response
		if tok == "" {
			resp = get("/client/auth/me", "")
		} else {
			resp = get("/client/auth/me", tok)
		}
		r := parse(resp)
		if r.GetCode() == errcode.OK.Code {
			t.Errorf("malformed token %q should be rejected", tok)
		}
	}
}

// TestAuthRefreshResponseShape verifies the refresh response contains all
// expected fields — the same LoginResponse shape the OIDC callback returns.
func TestAuthRefreshResponseShape(t *testing.T) {
	CleanDB(t, db)

	u := register(t, "tshape", "pass1234", "ShapeUser")
	seeded := seedRefreshToken(t, u.ID, "web", "ffffffff-ffff-4fff-8fff-ffffffffffff")

	r := parse(post("/client/auth/refresh", map[string]string{"refresh_token": seeded}))
	mustOK(t, r, "refresh")

	// Decode data into a map to check all fields.
	var data map[string]interface{}
	if err := json.Unmarshal(r.Data, &data); err != nil {
		t.Fatalf("unmarshal refresh response data: %v", err)
	}

	accessToken, ok := data["access_token"].(string)
	if !ok || accessToken == "" {
		t.Error("missing or empty access_token")
	}
	refreshToken, ok := data["refresh_token"].(string)
	if !ok || refreshToken == "" {
		t.Error("missing or empty refresh_token")
	}
	expiresIn, ok := data["expires_in"].(float64)
	if !ok || expiresIn <= 0 {
		t.Errorf("missing or invalid expires_in: %v", data["expires_in"])
	}

	// Verify the freshly issued access token is valid.
	mustOK(t, parse(get("/client/auth/me", accessToken)), "me with refreshed token")
}
