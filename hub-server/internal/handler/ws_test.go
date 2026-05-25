package handler_test

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/agenthub/hub-server/internal/handler"
	"github.com/agenthub/hub-server/internal/jwtutil"
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

func newWebSocketTestServer(t *testing.T, manager *hubws.Manager) string {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	h := handler.NewWebSocketHandler(manager, testWSSecret)
	r.GET("/client/ws", h.ServeWS)
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
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate RSA key: %v", err)
	}
	now := time.Now()
	claims := jwt.RegisteredClaims{
		Issuer:    "https://id.example",
		Subject:   "tokendance-user-ws",
		Audience:  jwt.ClaimStrings{"agenthub-client"},
		ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)),
		IssuedAt:  jwt.NewNumericDate(now),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	signed, err := token.SignedString(priv)
	if err != nil {
		t.Fatalf("sign TokenDance token: %v", err)
	}
	return signed
}
