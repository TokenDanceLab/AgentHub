//nolint:gosec // 测试 fixture：凭据模式字符串用于构造测试用例，非真实凭据
package handler_test

import (
	"context"
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
	"github.com/agenthub/pkg/testkit/oidcfixture"
	"github.com/coder/websocket"
	"github.com/gin-gonic/gin"
)

// #nosec G101 -- 测试专用固定 JWT secret（非真实凭据）
const testWSSecret = "test-ws-secret-32-characters-long"

func TestWebSocketHandlerRejectsMissingAuthenticatedContextBeforeUpgrade(t *testing.T) {
	manager := hubws.NewManager()
	wsURL := newWebSocketTestServer(t, manager)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	conn, resp, err := websocket.Dial(ctx, wsURL, nil)
	if conn != nil {
		conn.Close(websocket.StatusNormalClosure, "")
	}
	if err == nil {
		t.Fatal("expected handler without authenticated middleware context to reject upgrade")
	}
	if resp == nil || resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("response = %#v, want HTTP %d", resp, http.StatusUnauthorized)
	}
	if manager.Count() != 0 {
		t.Fatalf("manager count = %d, want no unauthenticated connection", manager.Count())
	}
}

func TestWebSocketRouteRejectsTokenDanceBearerBeforeUpgrade(t *testing.T) {
	token, issuer, audience, jwks := makeTokenDanceWebSocketTokenWithJWKS(t)
	jwksServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(jwks))
	}))
	t.Cleanup(jwksServer.Close)

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

func TestWebSocketRouteRejectsHubLocalQueryTokenBeforeUpgrade(t *testing.T) {
	// #954: query access_token is no longer accepted for Hub WS upgrades.
	token, err := jwtutil.GenerateAccessToken("user-ws-query", "web", "device-ws-query", testWSSecret, time.Hour)
	if err != nil {
		t.Fatalf("generate access token: %v", err)
	}

	manager := hubws.NewManager()
	wsURL := newMiddlewareWebSocketTestServer(t, manager, &config.Config{
		JWT: config.JWTConfig{Secret: testWSSecret},
	})
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	conn, resp, dialErr := websocket.Dial(ctx, wsURL+"?access_token="+url.QueryEscape(token), nil)
	if conn != nil {
		conn.Close(websocket.StatusNormalClosure, "")
	}
	if dialErr == nil {
		t.Fatal("expected query-token Hub WS upgrade to fail after #954")
	}
	if resp == nil {
		t.Fatalf("expected HTTP response for rejected upgrade, got err=%v", dialErr)
	}
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusUnauthorized)
	}
	if got := manager.FindByUserDevice("user-ws-query", "web"); got != nil {
		t.Fatal("query token must not register a Hub WebSocket session")
	}
}

func TestWebSocketRouteAcceptsHubLocalBearerTokenBeforeUpgrade(t *testing.T) {
	token, err := jwtutil.GenerateAccessToken("user-ws-bearer", "web", "device-ws-bearer", testWSSecret, time.Hour)
	if err != nil {
		t.Fatalf("generate access token: %v", err)
	}

	manager := hubws.NewManager()
	wsURL := newMiddlewareWebSocketTestServer(t, manager, &config.Config{
		JWT: config.JWTConfig{Secret: testWSSecret},
	})
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	conn, _, dialErr := websocket.Dial(ctx, wsURL, &websocket.DialOptions{
		HTTPHeader: http.Header{"Authorization": []string{"Bearer " + token}},
	})
	if dialErr != nil {
		t.Fatalf("dial websocket with bearer: %v", dialErr)
	}
	defer conn.Close(websocket.StatusNormalClosure, "")

	frame := readFrame(t, conn)
	if frame.Type != hubws.TypeAuthOK {
		t.Fatalf("frame type = %q, want %q", frame.Type, hubws.TypeAuthOK)
	}
	if got := manager.FindByUserDevice("user-ws-bearer", "web"); got == nil {
		t.Fatal("expected Hub-local bearer token to register WebSocket session")
	}
}

func TestWebSocketRouteAcceptsSubprotocolTokenBeforeUpgrade(t *testing.T) {
	token, err := jwtutil.GenerateAccessToken("user-ws-proto", "web", "device-ws-proto", testWSSecret, time.Hour)
	if err != nil {
		t.Fatalf("generate access token: %v", err)
	}

	manager := hubws.NewManager()
	wsURL := newMiddlewareWebSocketTestServer(t, manager, &config.Config{
		JWT: config.JWTConfig{Secret: testWSSecret},
	})
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	conn, _, dialErr := websocket.Dial(ctx, wsURL, &websocket.DialOptions{
		// coder/websocket maps Subprotocols to Sec-WebSocket-Protocol.
		// Prefer explicit access_token.<jwt> form so the JWT is not split on commas.
		Subprotocols: []string{"access_token." + token},
	})
	if dialErr != nil {
		t.Fatalf("dial websocket with subprotocol: %v", dialErr)
	}
	defer conn.Close(websocket.StatusNormalClosure, "")

	frame := readFrame(t, conn)
	if frame.Type != hubws.TypeAuthOK {
		t.Fatalf("frame type = %q, want %q", frame.Type, hubws.TypeAuthOK)
	}
	if got := manager.FindByUserDevice("user-ws-proto", "web"); got == nil {
		t.Fatal("expected subprotocol token to register WebSocket session")
	}
}

func TestWebSocketRouteNegotiatesBearerSubprotocol(t *testing.T) {
	// #1360: the Accept layer must select the fixed bearer marker when the
	// client offers "agenthub.bearer.v1, <jwt>" (the preferred browser path).
	// Per RFC 6455 §4.1 a client that offered subprotocols MUST fail the
	// WebSocket connection when the server selects none, so an empty
	// negotiation breaks browser bearer auth at the handshake. The raw JWT
	// must never be echoed back in Sec-WebSocket-Protocol.
	token, err := jwtutil.GenerateAccessToken("user-ws-marker", "web", "device-ws-marker", testWSSecret, time.Hour)
	if err != nil {
		t.Fatalf("generate access token: %v", err)
	}

	manager := hubws.NewManager()
	wsURL := newMiddlewareWebSocketTestServer(t, manager, &config.Config{
		JWT: config.JWTConfig{Secret: testWSSecret},
	})
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	conn, resp, dialErr := websocket.Dial(ctx, wsURL, &websocket.DialOptions{
		// Preferred browser carriage: fixed marker + raw JWT.
		Subprotocols: []string{middleware.WSBearerSubprotocol, token},
	})
	if dialErr != nil {
		t.Fatalf("dial websocket with bearer subprotocol: %v", dialErr)
	}
	defer conn.Close(websocket.StatusNormalClosure, "")

	if got := conn.Subprotocol(); got != middleware.WSBearerSubprotocol {
		t.Fatalf("negotiated subprotocol = %q, want %q (browsers fail the connection when the offer is not answered)",
			got, middleware.WSBearerSubprotocol)
	}
	if proto := resp.Header.Get("Sec-WebSocket-Protocol"); proto != middleware.WSBearerSubprotocol {
		t.Fatalf("Sec-WebSocket-Protocol response header = %q, want %q (the JWT must never be echoed back)",
			proto, middleware.WSBearerSubprotocol)
	}

	frame := readFrame(t, conn)
	if frame.Type != hubws.TypeAuthOK {
		t.Fatalf("frame type = %q, want %q", frame.Type, hubws.TypeAuthOK)
	}
	if got := manager.FindByUserDevice("user-ws-marker", "web"); got == nil {
		t.Fatal("expected bearer-subprotocol token to register WebSocket session")
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
	wsURL := newConfiguredMiddlewareWebSocketTestServer(t, manager, &config.Config{
		JWT: config.JWTConfig{Secret: testWSSecret},
	}, func(h *handler.WebSocketHandler) {
		h.SetOnTyping(func(userID, sessionID string, memberIDs []string) {
			called <- map[string]string{
				"user_id":    userID,
				"session_id": sessionID,
				"members":    strings.Join(memberIDs, ","),
			}
		})
	}, nil)
	conn := dialWebSocketWithBearer(t, wsURL, token)
	defer conn.Close(websocket.StatusNormalClosure, "")

	if frame := readFrame(t, conn); frame.Type != hubws.TypeAuthOK {
		t.Fatalf("frame type = %q, want %q", frame.Type, hubws.TypeAuthOK)
	}
	writeTypingFrame(t, conn, "sess-typing")

	select {
	case got := <-called:
		if got["user_id"] != "user-ws-typing" || got["session_id"] != "sess-typing" {
			t.Fatalf("typing callback = %#v", got)
		}
		// #2154 P2-10: the admission check hands its resolved membership to the
		// callback so the fan-out does not resolve the same session twice.
		if got["members"] != "user-ws-typing,peer-ws-typing" {
			t.Fatalf("typing callback members = %q, want the admitted membership", got["members"])
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
	wsURL := newConfiguredMiddlewareWebSocketTestServer(t, manager, &config.Config{
		JWT: config.JWTConfig{Secret: testWSSecret},
	}, func(h *handler.WebSocketHandler) {
		h.SetOnTyping(func(userID, sessionID string, memberIDs []string) {
			called <- struct{}{}
		})
	}, nil)
	conn := dialWebSocketWithBearer(t, wsURL, token)
	defer conn.Close(websocket.StatusNormalClosure, "")

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
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	h := handler.NewWebSocketHandler(manager, "")
	r.GET("/client/ws", h.ServeWS)
	server := httptest.NewServer(r)
	t.Cleanup(server.Close)
	return "ws" + strings.TrimPrefix(server.URL, "http") + "/client/ws"
}

func newMiddlewareWebSocketTestServer(t *testing.T, manager *hubws.Manager, cfg *config.Config) string {
	return newConfiguredMiddlewareWebSocketTestServer(t, manager, cfg, nil, nil)
}

func newConfiguredMiddlewareWebSocketTestServer(t *testing.T, manager *hubws.Manager, cfg *config.Config, configure func(*handler.WebSocketHandler), tdVerifier *jwtutil.TokenDanceVerifier) string {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	h := handler.NewWebSocketHandler(manager, "")
	if configure != nil {
		configure(h)
	}
	r.GET("/client/ws", middleware.NewAuthMiddleware(cfg, middleware.AuthDependencies{}, tdVerifier).WSHandler(), h.ServeWS)
	server := httptest.NewServer(r)
	t.Cleanup(server.Close)
	return "ws" + strings.TrimPrefix(server.URL, "http") + "/client/ws"
}

func dialWebSocketWithBearer(t *testing.T, url, token string) *websocket.Conn {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, url, &websocket.DialOptions{
		HTTPHeader: http.Header{"Authorization": []string{"Bearer " + token}},
	})
	if err != nil {
		t.Fatalf("dial websocket: %v", err)
	}
	return conn
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

func makeTokenDanceWebSocketTokenWithJWKS(t *testing.T) (token, issuer, audience, jwks string) {
	t.Helper()
	key := oidcfixture.NewKey(t)
	issuer = "https://id.example"
	audience = "agenthub-client"
	token = oidcfixture.SignToken(t, key.Private, key.Kid, issuer, audience, "tokendance-user-ws", "", "")
	return token, issuer, audience, key.JWKS
}
