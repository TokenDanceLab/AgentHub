package ws

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/coder/websocket"
	"github.com/stretchr/testify/require"
)

func TestLiveSessionChecksRejectQueuedWritesAndIdleSockets(t *testing.T) {
	for _, boundary := range []string{"queued-write", "inbound-check", "heartbeat"} {
		for _, unavailable := range []bool{false, true} {
			name := boundary + "/revoked"
			if unavailable {
				name = boundary + "/unavailable"
			}
			t.Run(name, func(t *testing.T) {
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				manager := NewManager()
				t.Cleanup(manager.Shutdown)
				var rejected atomic.Bool
				ready := make(chan *Conn, 1)
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					transport, err := websocket.Accept(w, r, nil)
					if err != nil {
						return
					}
					conn := NewConn(transport)
					conn.SetSessionVerifier("identity", func(context.Context) error {
						if !rejected.Load() {
							return nil
						}
						if unavailable {
							return errcode.AuthUnavailable
						}
						return errcode.AuthInvalidToken
					})
					if err := manager.Register(conn); err != nil {
						_ = transport.CloseNow()
						return
					}
					ready <- conn
				}))
				t.Cleanup(server.Close)
				peer, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(server.URL, "http"), nil)
				require.NoError(t, err)
				t.Cleanup(func() { _ = peer.CloseNow() })
				var conn *Conn
				select {
				case conn = <-ready:
				case <-ctx.Done():
					t.Fatal("server connection was not registered")
				}
				require.NoError(t, conn.ValidateSession(ctx))
				require.True(t, manager.PushToConn(conn.ID, NewFrame(TypeTyping, map[string]string{"text": "queued-before-revocation"})).Queued)
				rejected.Store(true)
				done := make(chan error, 1)
				go func() {
					switch boundary {
					case "queued-write":
						done <- conn.WriteAuthenticated(ctx, <-conn.Send)
					case "inbound-check":
						done <- conn.ValidateSession(ctx)
					case "heartbeat":
						manager.pingAll()
						done <- nil
					}
				}()
				_, data, err := peer.Read(ctx)
				if unavailable {
					require.Error(t, err, "dependency errors must not send an auth.revoked event")
					require.Equal(t, websocket.StatusTryAgainLater, websocket.CloseStatus(err))
				} else {
					require.NoError(t, err)
					var frame struct {
						Type    string            `json:"type"`
						Payload map[string]string `json:"payload"`
					}
					require.NoError(t, json.Unmarshal(data, &frame))
					require.Equal(t, TypeAuthRevoked, frame.Type, "queued product data must not drain after revocation")
					require.Equal(t, "session_revoked", frame.Payload["reason"])
					_, _, err = peer.Read(ctx)
					require.Equal(t, websocket.StatusPolicyViolation, websocket.CloseStatus(err))
				}
				select {
				case err := <-done:
					if boundary == "heartbeat" {
						require.Zero(t, manager.Count())
					} else if unavailable {
						require.ErrorIs(t, err, errcode.AuthUnavailable)
					} else {
						require.ErrorIs(t, err, errcode.AuthInvalidToken)
					}
				case <-ctx.Done():
					t.Fatal("session shutdown did not finish")
				}
			})
		}
	}
}
