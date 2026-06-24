package tests

import (
	"encoding/json"
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

	// Generate a token that is already expired (negative TTL).
	expiredToken, err := jwtutil.GenerateAccessToken(
		u.ID,
		"web",
		testDeviceID(u.Username, "web"),
		testJWT.Secret,
		-1*time.Second, // already expired
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

	expiredToken, err := jwtutil.GenerateAccessToken(
		u.ID,
		"desktop",
		testDeviceID(u.Username, "desktop"),
		testJWT.Secret,
		-1*time.Second,
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

// TestAuthWrongDeviceToken verifies that a request with a mismatched device
// context (e.g. token issued for device A but requesting from device B) is
// handled correctly. The JWT middleware validates the token but does not
// cross-check device binding at the HTTP level; this test verifies that
// both tokens for the same user are independently valid.
func TestAuthWrongDeviceToken(t *testing.T) {
	CleanDB(t, db)

	// Register a user and get tokens for two different devices.
	u := register(t, "twrongdev", "pass1234", "WrongDevice")

	// Login on desktop to get a desktop-scoped token.
	desktopResp := parse(post("/client/auth/login", map[string]interface{}{
		"username":    u.Username,
		"password":    u.Password,
		"device_type": "desktop",
		"device_id":   "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
	}))
	mustOK(t, desktopResp, "desktop login")

	desktopToken := extract(desktopResp.Data, "access_token")

	// Login on web to get a web-scoped token.
	webResp := parse(post("/client/auth/login", map[string]interface{}{
		"username":    u.Username,
		"password":    u.Password,
		"device_type": "web",
		"device_id":   "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
	}))
	mustOK(t, webResp, "web login")

	webToken := extract(webResp.Data, "access_token")

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
		t.Fatal("expected different tokens for different device logins")
	}
}

// TestAuthConcurrentLogin verifies that multiple concurrent login attempts
// for the same user on different desktop devices all succeed.
func TestAuthConcurrentLogin(t *testing.T) {
	CleanDB(t, db)

	u := register(t, "tconcurrent", "pass1234", "ConcurrentUser")

	const numConcurrent = 10
	type result struct {
		deviceID string
		token    string
		err      string
	}
	results := make(chan result, numConcurrent)

	var wg sync.WaitGroup
	for i := 0; i < numConcurrent; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			deviceID := testDeviceID(u.Username+"_conc", "desktop")
			// Make deviceID unique by appending the index
			deviceID = deviceID[:len(deviceID)-1] + string(rune('0'+idx%10))

			resp := parse(post("/client/auth/login", map[string]interface{}{
				"username":    u.Username,
				"password":    u.Password,
				"device_type": "desktop",
				"device_id":   deviceID,
			}))
			r := result{deviceID: deviceID}
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
			t.Errorf("concurrent login failed for device %s: %s", r.deviceID, r.err)
			continue
		}
		if r.token == "" {
			failures++
			t.Errorf("concurrent login empty token for device %s", r.deviceID)
			continue
		}
		if tokens[r.token] {
			t.Errorf("duplicate token issued: %s", r.token)
		}
		tokens[r.token] = true
	}

	if failures > 0 {
		t.Fatalf("%d/%d concurrent logins failed", failures, numConcurrent)
	}
	if len(tokens) != numConcurrent {
		t.Errorf("expected %d unique tokens, got %d", numConcurrent, len(tokens))
	}
}

// TestAuthRefreshAfterLogout verifies that a refresh token is rejected
// after the user logs out.
func TestAuthRefreshAfterLogout(t *testing.T) {
	CleanDB(t, db)

	// Create a login-capable user.
	createLoginUser(t, "tlogoutrefresh", "pass1234", "LogoutRefresh")

	resp := parse(post("/client/auth/login", map[string]interface{}{
		"username":    "tlogoutrefresh",
		"password":    "pass1234",
		"device_type": "desktop",
		"device_id":   "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
	}))
	mustOK(t, resp, "login")

	accessToken := extract(resp.Data, "access_token")
	refreshToken := extract(resp.Data, "refresh_token")

	// Verify tokens work.
	mustOK(t, parse(get("/client/auth/me", accessToken)), "me before logout")

	// Logout.
	logoutResp := parse(postAuth("/client/auth/logout", accessToken, nil))
	mustOK(t, logoutResp, "logout")

	// Verify access token is still valid (JWT is stateless).
	// Actually, the JWT access token is stateless — it's still valid until expiry.
	// But the refresh should be rejected.
	refreshResp := parse(post("/client/auth/refresh", map[string]string{
		"refresh_token": refreshToken,
	}))
	if refreshResp.GetCode() == errcode.OK.Code {
		t.Fatal("expected refresh after logout to be rejected")
	}
}

// TestAuthConcurrentLoginSameDevice verifies that logging in on the same
// device twice succeeds (re-login on same device).
func TestAuthConcurrentLoginSameDevice(t *testing.T) {
	CleanDB(t, db)

	createLoginUser(t, "trelogin", "pass1234", "ReLogin")
	deviceID := "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"

	// First login.
	first := parse(post("/client/auth/login", map[string]interface{}{
		"username":    "trelogin",
		"password":    "pass1234",
		"device_type": "desktop",
		"device_id":   deviceID,
	}))
	mustOK(t, first, "first login")
	firstAccess := extract(first.Data, "access_token")
	firstRefresh := extract(first.Data, "refresh_token")

	// Second login on same device.
	second := parse(post("/client/auth/login", map[string]interface{}{
		"username":    "trelogin",
		"password":    "pass1234",
		"device_type": "desktop",
		"device_id":   deviceID,
	}))
	mustOK(t, second, "second login on same device")
	secondAccess := extract(second.Data, "access_token")
	secondRefresh := extract(second.Data, "refresh_token")

	// Both access tokens should work.
	mustOK(t, parse(get("/client/auth/me", firstAccess)), "first access token")
	mustOK(t, parse(get("/client/auth/me", secondAccess)), "second access token")

	// Tokens should be distinct.
	if firstAccess == secondAccess {
		t.Error("expected distinct access tokens for re-login")
	}
	if firstRefresh == secondRefresh {
		t.Error("expected distinct refresh tokens for re-login")
	}
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

// TestAuthLoginResponseShape verifies the login response contains all expected fields.
func TestAuthLoginResponseShape(t *testing.T) {
	CleanDB(t, db)

	createLoginUser(t, "tshape", "pass1234", "ShapeUser")

	resp := post("/client/auth/login", map[string]interface{}{
		"username":    "tshape",
		"password":    "pass1234",
		"device_type": "web",
		"device_id":   "ffffffff-ffff-4fff-8fff-ffffffffffff",
	})
	r := parse(resp)
	mustOK(t, r, "login")

	// Decode data into a map to check all fields.
	var data map[string]interface{}
	if err := json.Unmarshal(r.Data, &data); err != nil {
		t.Fatalf("unmarshal login response data: %v", err)
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

	// Verify the access token is valid.
	mustOK(t, parse(get("/client/auth/me", accessToken)), "me with login token")
}
