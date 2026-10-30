package device

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func fixtureCredential(t *testing.T) Credential {
	t.Helper()
	return Credential{HubURL: "https://hub.example", DeviceID: "device-1", TargetID: "target-1", Secret: "fixture-device-secret", ExpiresAt: time.Now().Add(time.Hour), RuntimeID: "openai-sdk", WorkspaceRoot: t.TempDir()}
}

func reply(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"code": "ok", "data": data})
}

func TestEnrollmentExchangeAndPrivatePersistence(t *testing.T) {
	credential := fixtureCredential(t)
	var exchanges atomic.Int32
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Empty(t, r.Header.Get("Authorization"))
		switch r.URL.Path {
		case "/edge/enrollments/start":
			var req StartRequest
			require.NoError(t, json.NewDecoder(r.Body).Decode(&req))
			require.Equal(t, credential.WorkspaceRoot, req.WorkspaceRoot)
			reply(w, 200, Enrollment{ID: "enrollment-1", UserCode: "ABCD-EFGH", PollSecret: "fixture-poll-secret", ExpiresAt: time.Now().Add(time.Minute)})
		case "/edge/enrollments/exchange":
			var req map[string]string
			require.NoError(t, json.NewDecoder(r.Body).Decode(&req))
			require.Equal(t, "fixture-poll-secret", req["poll_secret"])
			switch exchanges.Add(1) {
			case 1:
				reply(w, 202, map[string]string{"status": "pending"})
			case 2:
				reply(w, 200, credential)
			default:
				reply(w, 409, map[string]string{"error": "already consumed"})
			}
		default:
			t.Errorf("unexpected path %s", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer server.Close()
	client, err := NewClient(server.URL, "", server.Client())
	require.NoError(t, err)
	enrollment, err := client.Start(context.Background(), StartRequest{DeviceID: credential.DeviceID, Name: "Test Edge", RuntimeID: credential.RuntimeID, WorkspaceRoot: credential.WorkspaceRoot})
	require.NoError(t, err)
	_, pending, err := client.Exchange(context.Background(), enrollment)
	require.NoError(t, err)
	require.True(t, pending)
	got, pending, err := client.Exchange(context.Background(), enrollment)
	require.NoError(t, err)
	require.False(t, pending)
	assertPrivateCredentialStorage(t, got, credential.WorkspaceRoot)
	_, _, err = client.Exchange(context.Background(), enrollment)
	require.Error(t, err)
	require.NotContains(t, err.Error(), credential.Secret)
}

func TestClientRefusesHTTPRedirectAndSecretErrors(t *testing.T) {
	for _, origin := range []string{"http://127.0.0.1:1234", "https://user:password@hub.example", "https://hub.example?secret=x", "https://hub.example/path"} { // Synthetic URI credentials rejected by this test; # leak-guard-allow:LG-F4C6A155
		_, err := NewClient(origin, "secret", http.DefaultClient)
		require.Error(t, err)
	}
	var reached atomic.Bool
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/leak" {
			reached.Store(true)
		}
		w.Header().Set("Location", "/leak?credential=fixture-secret")
		w.WriteHeader(302)
		_, _ = w.Write([]byte("fixture-secret"))
	}))
	defer server.Close()
	client, err := NewClient(server.URL, "fixture-secret", server.Client())
	require.NoError(t, err)
	err = client.Heartbeat(context.Background())
	require.Error(t, err)
	require.False(t, reached.Load())
	require.NotContains(t, err.Error(), "fixture-secret")
}

func TestClientStopsOnRevocationAndContext(t *testing.T) {
	for _, status := range []int{401, 403} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(status)
				_, _ = w.Write([]byte("private raw body"))
			}))
			defer server.Close()
			client, err := NewClient(server.URL, "fixture", server.Client())
			require.NoError(t, err)
			require.ErrorIs(t, client.Heartbeat(context.Background()), ErrUnauthorized)
		})
	}
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { <-r.Context().Done() }))
	defer server.Close()
	client, err := NewClient(server.URL, "fixture", server.Client())
	require.NoError(t, err)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err = client.Poll(ctx)
	require.True(t, errors.Is(err, context.Canceled))
}

func TestWorkspaceAndCredentialRejectScopeChanges(t *testing.T) {
	c := fixtureCredential(t)
	path := filepath.Join(t.TempDir(), "credential.json")
	if ValidatePlatform() == nil {
		require.NoError(t, SaveCredential(path, c))
		_, err := LoadCredential(path, []string{t.TempDir()})
		require.Error(t, err)
	} else {
		require.ErrorIs(t, SaveCredential(path, c), ErrUnsupportedPlatform)
		_, err := Workspace(c.WorkspaceRoot, []string{t.TempDir()})
		require.Error(t, err)
	}
	link := filepath.Join(t.TempDir(), "workspace-link")
	if err := os.Symlink(c.WorkspaceRoot, link); err == nil {
		_, err = Workspace(link, []string{filepath.Dir(link)})
		require.Error(t, err)
	}
	c.ExpiresAt = time.Now().Add(-time.Minute)
	require.ErrorIs(t, c.Validate(), ErrUnauthorized)
	for _, id := range []string{"../secret", "a/b", strings.Repeat("a", 129)} {
		require.False(t, validIdentifier(id))
	}
}
