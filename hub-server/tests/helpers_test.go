package tests

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"github.com/agenthub/hub-server/internal/model"
)

// CreateTestUser registers a new user, logs in, and returns the user model with auth token.
// In case of error it calls t.Fatal.
func CreateTestUser(t *testing.T, client *http.Client, baseURL string) (*model.User, string) {
	t.Helper()

	username := fmt.Sprintf("testuser_%s", t.Name())
	password := "pass1234"
	nickname := "TestUser"

	// Register
	u := register(t, username, password, nickname)

	// Fetch full user profile from /me
	resp := get("/client/auth/me", u.Token)
	r := parse(resp)
	mustOK(t, r, "me")

	var user model.User
	if err := json.Unmarshal(r.Data, &user); err != nil {
		t.Fatalf("failed to unmarshal user: %v", err)
	}

	return &user, u.Token
}

// CreateTestSession creates a private session between two users and returns the session.
// The creator is the user identified by token.
func CreateTestSession(t *testing.T, client *http.Client, baseURL string, token string, targetUserID string) *model.Session {
	t.Helper()

	resp := postAuth("/client/sessions/private", token, map[string]string{
		"target_user_id": targetUserID,
	})
	r := parse(resp)
	mustOK(t, r, "create private session")

	sid := extract(r.Data, "session_id")

	// Fetch session details to get full model
	sessResp := get("/client/sessions/"+sid, token)
	sr := parse(sessResp)
	// session detail may return list or single — handle both
	var session model.Session
	if err := json.Unmarshal(sr.Data, &session); err != nil {
		// If it's an array, try unmarshalling as slice and take first
		var sessions []model.Session
		if err2 := json.Unmarshal(sr.Data, &sessions); err2 == nil && len(sessions) > 0 {
			session = sessions[0]
		} else {
			t.Fatalf("failed to unmarshal session: %v", err)
		}
	}

	return &session
}

// AssertHTTPStatus checks that the response has the expected HTTP status code.
func AssertHTTPStatus(t *testing.T, resp *http.Response, expected int) {
	t.Helper()
	if resp.StatusCode != expected {
		t.Errorf("expected HTTP %d, got %d %s", expected, resp.StatusCode, resp.Status)
	}
}
