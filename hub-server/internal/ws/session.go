package ws

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/pkg/safego"
	"github.com/coder/websocket"
)

// SetSessionVerifier must run before the connection is registered. The closure
// verifies the persistent browser session or native identity generation.
func (c *Conn) SetSessionVerifier(identityID string, check func(context.Context) error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.sessionIdentityID, c.sessionCheck = identityID, check
}

func (c *Conn) validateSessionLocked(ctx context.Context) error {
	if c.sessionStopped {
		return errcode.AuthInvalidToken
	}
	c.mu.Lock()
	check := c.sessionCheck
	c.mu.Unlock()
	if check == nil {
		return nil
	}
	if err := check(ctx); err != nil {
		c.sessionStopped = true
		if c.W != nil {
			// A storage outage closes fail-closed without claiming an Account
			// logout. The browser may reconnect and restore after recovery.
			status := websocket.StatusTryAgainLater
			if errors.Is(err, errcode.AuthInvalidToken) {
				status = websocket.StatusPolicyViolation
				frame := NewFrame(TypeAuthRevoked, map[string]string{"reason": "session_revoked"})
				frame.SeqID = c.seq.Add(1)
				data, marshalErr := frame.Marshal()
				if marshalErr == nil {
					notifyCtx, cancel := context.WithTimeout(context.Background(), time.Second)
					_ = c.W.Write(notifyCtx, websocket.MessageText, data)
					cancel()
				}
			}
			_ = c.W.Close(status, "")
		}
		return err
	}
	return nil
}

// ValidateSession is called before admitting inbound frames and on heartbeat.
// It also protects the gap between HTTP upgrade and connection registration.
func (c *Conn) ValidateSession(ctx context.Context) error {
	c.sessionWriteMu.Lock()
	defer c.sessionWriteMu.Unlock()
	return c.validateSessionLocked(ctx)
}

// WriteAuthenticated checks again at the actual write boundary, so queued
// product frames cannot drain to a session after revocation is observed.
func (c *Conn) WriteAuthenticated(ctx context.Context, data []byte) error {
	c.sessionWriteMu.Lock()
	defer c.sessionWriteMu.Unlock()
	if err := c.validateSessionLocked(ctx); err != nil {
		return err
	}
	return c.W.Write(ctx, websocket.MessageText, data)
}

// RevalidateSessions is an immediate local wakeup after durable revocation.
// Other Hub processes reject old epochs on inbound/outbound frames and reap
// idle sockets on heartbeat; correctness does not rely on ephemeral pub/sub.
func (m *Manager) RevalidateSessions(identityID string) {
	m.mu.RLock()
	var conns []*Conn
	for _, c := range m.conns {
		c.mu.Lock()
		matches := c.sessionIdentityID == identityID
		c.mu.Unlock()
		if matches {
			conns = append(conns, c)
		}
	}
	m.mu.RUnlock()
	// A peer can delay its close handshake. Use a bounded pool so one such
	// peer cannot hold up every other session or the Account callback reply.
	const workers = 8
	jobs := make(chan *Conn, len(conns))
	var done sync.WaitGroup
	for i := 0; i < min(workers, len(conns)); i++ {
		done.Add(1)
		safego.SafeGo("ws.session_revalidation", func() {
			defer done.Done()
			for c := range jobs {
				ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
				_ = c.ValidateSession(ctx)
				cancel()
			}
		})
	}
	for _, c := range conns {
		jobs <- c
	}
	close(jobs)
	done.Wait()
}
