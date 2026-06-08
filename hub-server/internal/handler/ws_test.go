package handler_test

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/handler"
	"github.com/agenthub/hub-server/internal/jwtutil"
	"github.com/agenthub/hub-server/internal/middleware"
	hubws "github.com/agenthub/hub-server/internal/ws"
	"github.com/coder/websocket"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

const testWSSecret = "test-ws-secret-32-characters-long"

func TestWebSocketAuthAcceptsHubLocalSessionToken(t *testing.T) {
	token, err := jwtutil.GenerateAccessToken("user-ws-1", "desktop", testDeviceID, testWSSecret, time.Hour)
	if err != nil {
		t.Fatalf("generate access token: %v", err)
	}

	manager := hubws.NewManager()
	wsURL := newWebSocketTestServer(t, manager)
	conn := dialWebSocket(t, wsURL)
	defer conn.Close(websocket.StatusNormalClosure, "")

	writeAuthFrame(t, conn, token)
	frame := readFrame(t, conn)
	if frame.Type != hubws.TypeAuthOK {
		t.Fatalf("frame type = %q, want %q", frame.Type, hubws.TypeAuthOK)
	}
	if got := manager.FindByUserDevice("user-ws-1", "desktop"); got == nil {
		t.Fatal("expected Hub-local session token to register desktop WebSocket route")
	}
}

func TestWebSocketAuthRejectsTokenDanceBearerToken(t *testing.T) {
	token := makeTokenDanceWebSocketToken(t)
	manager := hubws.NewManager()
	wsURL := newWebSocketTestServer(t, manager)
	conn := dialWebSocket(t, wsURL)
	defer conn.Close(websocket.StatusNormalClosure, "")

	writeAuthFrame(t, conn, token)
	frame := readFrame(t, conn)
	if frame.Type != hubws.TypeAuthFail {
		t.Fatalf("frame type = %q, want %q", frame.Type, hubws.TypeAuthFail)
	}
	if got := manager.FindByUserDevice("tokendance-user-ws", "desktop"); got != nil {
		t.Fatal("TokenDance bearer must not register as a Hub desktop WebSocket session")
	}
}

func TestWebSocketRouteRejectsTokenDanceBearerBeforeUpgrade(t *testing.T) {
	token, issuer, audience, jwks := makeTokenDanceWebSocketTokenWithJWKS(t)
	jwksServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(jwks))
	}))
	t.Cleanup(jwksServer.Close)
	jwtutil.ResetJWKSCache()
	jwtutil.SetJWKSURI(jwksServer.URL)
	t.Cleanup(jwtutil.ResetJWKSCache)

	manager := hubws.NewManager()
	wsURL := newMiddlewareWebSocketTestServer(t, manager, &config.Config{
		JWT: config.JWTConfig{Secret: testWSSecret},
		TokenDanceID: config.TokenDanceIDConfig{
			IssuerURL: issuer,
			ClientID:  audience,
		},
	})

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	conn, resp, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{
		HTTPHeader: http.Header{"Authorization": []string{"Bearer " + token}},
	})
	if conn != nil {
		conn.Close(websocket.StatusNormalClosure, "")
	}
	if err == nil {
		t.Fatal("expected TokenDance bearer route handshake to fail before WebSocket upgrade")
	}
	if resp == nil {
		t.Fatalf("expected HTTP response for rejected upgrade, got err=%v", err)
	}
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusUnauthorized)
	}
	if got := manager.FindByUserDevice("tokendance-user-ws", "tokendance_bearer"); got != nil {
		t.Fatal("TokenDance bearer must not register through the WebSocket route")
	}
}

func TestWebSocketRouteAcceptsHubLocalQueryTokenBeforeUpgrade(t *testing.T) {
	token, err := jwtutil.GenerateAccessToken("user-ws-query", "web", "device-ws-query", testWSSecret, time.Hour)
	if err != nil {
		t.Fatalf("generate access token: %v", err)
	}

	manager := hubws.NewManager()
	wsURL := newMiddlewareWebSocketTestServer(t, manager, &config.Config{
		JWT: config.JWTConfig{Secret: testWSSecret},
	})
	conn := dialWebSocket(t, wsURL+"?access_token="+url.QueryEscape(token))
	defer conn.Close(websocket.StatusNormalClosure, "")

	frame := readFrame(t, conn)
	if frame.Type != hubws.TypeAuthOK {
		t.Fatalf("frame type = %q, want %q", frame.Type, hubws.TypeAuthOK)
	}
	if got := manager.FindByUserDevice("user-ws-query", "web"); got == nil {
		t.Fatal("expected Hub-local query token to register WebSocket session")
	}
}

func TestWebSocketTypingAllowsSessionMemberCallback(t *testing.T) {
	token, err := jwtutil.GenerateAccessToken("user-ws-typing", "desktop", "device-ws-typing", testWSSecret, time.Hour)
	if err != nil {
		t.Fatalf("generate access token: %v", err)
	}

	manager := hubws.NewManager()
	manager.ResolveMembers = func(sessionID string) []string {
		if sessionID == "sess-typing" {
			return []string{"user-ws-typing", "peer-ws-typing"}
		}
		return nil
	}
	called := make(chan map[string]string, 1)
	wsURL := newWebSocketTestServerWithHandler(t, manager, func(h *handler.WebSocketHandler) {
		h.SetOnTyping(func(userID, sessionID string) {
			called <- map[string]string{"user_id": userID, "session_id": sessionID}
		})
	})
	conn := dialWebSocket(t, wsURL)
	defer conn.Close(websocket.StatusNormalClosure, "")

	writeAuthFrame(t, conn, token)
	if frame := readFrame(t, conn); frame.Type != hubws.TypeAuthOK {
		t.Fatalf("frame type = %q, want %q", frame.Type, hubws.TypeAuthOK)
	}
	writeTypingFrame(t, conn, "sess-typing")

	select {
	case got := <-called:
		if got["user_id"] != "user-ws-typing" || got["session_id"] != "sess-typing" {
			t.Fatalf("typing callback = %#v", got)
		}
	case <-time.After(time.Second):
		t.Fatal("expected typing callback for active session member")
	}
}

func TestWebSocketTypingRejectsNonMemberBeforeCallback(t *testing.T) {
	token, err := jwtutil.GenerateAccessToken("user-ws-outsider", "desktop", "device-ws-outsider", testWSSecret, time.Hour)
	if err != nil {
		t.Fatalf("generate access token: %v", err)
	}

	manager := hubws.NewManager()
	manager.ResolveMembers = func(sessionID string) []string {
		if sessionID == "sess-typing" {
			return []string{"peer-ws-typing"}
		}
		return nil
	}
	called := make(chan struct{}, 1)
	wsURL := newWebSocketTestServerWithHandler(t, manager, func(h *handler.WebSocketHandler) {
		h.SetOnTyping(func(userID, sessionID string) {
			called <- struct{}{}
		})
	})
	conn := dialWebSocket(t, wsURL)
	defer conn.Close(websocket.StatusNormalClosure, "")

	writeAuthFrame(t, conn, token)
	if frame := readFrame(t, conn); frame.Type != hubws.TypeAuthOK {
		t.Fatalf("frame type = %q, want %q", frame.Type, hubws.TypeAuthOK)
	}
	writeTypingFrame(t, conn, "sess-typing")

	select {
	case <-called:
		t.Fatal("typing callback must not run for non-member session")
	case <-time.After(200 * time.Millisecond):
	}
}

func newWebSocketTestServer(t *testing.T, manager *hubws.Manager) string {
	return newWebSocketTestServerWithHandler(t, manager, nil)
}

func newWebSocketTestServerWithHandler(t *testing.T, manager *hubws.Manager, configure func(*handler.WebSocketHandler)) string {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	h := handler.NewWebSocketHandler(manager, testWSSecret)
	if configure != nil {
		configure(h)
	}
	r.GET("/client/ws", h.ServeWS)
	server := httptest.NewServer(r)
	t.Cleanup(server.Close)
	return "ws" + strings.TrimPrefix(server.URL, "http") + "/client/ws"
}

func newMiddlewareWebSocketTestServer(t *testing.T, manager *hubws.Manager, cfg *config.Config) string {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	h := handler.NewWebSocketHandler(manager, testWSSecret)
	r.GET("/client/ws", middleware.WSAuthMiddleware(cfg), h.ServeWS)
	server := httptest.NewServer(r)
	t.Cleanup(server.Close)
	return "ws" + strings.TrimPrefix(server.URL, "http") + "/client/ws"
}

func dialWebSocket(t *testing.T, url string) *websocket.Conn {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, url, nil)
	if err != nil {
		t.Fatalf("dial websocket: %v", err)
	}
	return conn
}

func writeAuthFrame(t *testing.T, conn *websocket.Conn, token string) {
	t.Helper()
	frame := hubws.NewFrame(hubws.TypeAuth, map[string]string{"access_token": token})
	data, err := frame.Marshal()
	if err != nil {
		t.Fatalf("marshal auth frame: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := conn.Write(ctx, websocket.MessageText, data); err != nil {
		t.Fatalf("write auth frame: %v", err)
	}
}

func writeTypingFrame(t *testing.T, conn *websocket.Conn, sessionID string) {
	t.Helper()
	frame := hubws.NewFrame(hubws.TypeTyping, map[string]string{"session_id": sessionID})
	data, err := frame.Marshal()
	if err != nil {
		t.Fatalf("marshal typing frame: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := conn.Write(ctx, websocket.MessageText, data); err != nil {
		t.Fatalf("write typing frame: %v", err)
	}
}

func readFrame(t *testing.T, conn *websocket.Conn) *hubws.Frame {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_, data, err := conn.Read(ctx)
	if err != nil {
		t.Fatalf("read frame: %v", err)
	}
	frame, err := hubws.ParseFrame(data)
	if err != nil {
		t.Fatalf("parse frame: %v", err)
	}
	return frame
}

func makeTokenDanceWebSocketToken(t *testing.T) string {
	t.Helper()
	token, _, _, _ := makeTokenDanceWebSocketTokenWithJWKS(t)
	return token
}

func makeTokenDanceWebSocketTokenWithJWKS(t *testing.T) (token, issuer, audience, jwks string) {
	t.Helper()
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate RSA key: %v", err)
	}
	kid := tokenDanceWebSocketKID(&priv.PublicKey)
	n := base64.RawURLEncoding.EncodeToString(priv.PublicKey.N.Bytes())
	e := base64.RawURLEncoding.EncodeToString(big.NewInt(int64(priv.PublicKey.E)).Bytes())
	jwks = `{"keys":[{"kty":"RSA","use":"sig","alg":"RS256","kid":"` + kid + `","n":"` + n + `","e":"` + e + `"}]}`

	now := time.Now()
	issuer = "https://id.example"
	audience = "agenthub-client"
	claims := jwt.RegisteredClaims{
		Issuer:    issuer,
		Subject:   "tokendance-user-ws",
		Audience:  jwt.ClaimStrings{audience},
		ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)),
		IssuedAt:  jwt.NewNumericDate(now),
	}
	jwtToken := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	jwtToken.Header["kid"] = kid
	signed, err := jwtToken.SignedString(priv)
	if err != nil {
		t.Fatalf("sign TokenDance token: %v", err)
	}
	return signed, issuer, audience, jwks
}

func tokenDanceWebSocketKID(pub *rsa.PublicKey) string {
	hash := sha256.Sum256(pub.N.Bytes())
	return base64.RawURLEncoding.EncodeToString(hash[:16])
}
