package ws

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"time"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/coder/websocket"
	"golang.org/x/time/rate"
)

// WSReadTimeout is the maximum time to wait for a single WebSocket message
// read before the connection is considered stale.  Set at 2x the heartbeat
// interval so idle connections are detected and closed cleanly without
// interfering with normal heartbeat pings.
const WSReadTimeout = 2 * config.WSHeartbeatInterval

// Conn represents a single WebSocket connection tracked by the Manager.
type Conn struct {
	ID         string
	UserID     string
	DeviceType string
	DeviceID   string
	W          *websocket.Conn
	Send       chan []byte
	missedPong atomic.Int32
	mu         sync.Mutex
	sendMu     sync.Mutex

	// closed is set atomically before the Send channel is closed.  PushToConn
	// and closeSend use sendMu so channel send and close never race.
	closed atomic.Bool

	// msgLimiter enforces per-connection message rate limiting using a
	// token-bucket algorithm.
	msgLimiter *rate.Limiter

	// seq is the per-connection monotonic frame sequence counter. PushToConn
	// stamps every delivery attempt with seq.Add(1) inside the sendMu critical
	// section, so wire order always equals seq order and clients can detect
	// lost frames as gaps.
	seq atomic.Int64

	// droppedFrames counts frames dropped on this connection because the send
	// buffer was full. Drives sampled drop logging (first drop, then every
	// dropLogSampleEvery-th drop).
	droppedFrames atomic.Int64
}

// DeliveryStatus describes the observable result of a non-blocking WebSocket
// enqueue attempt.
type DeliveryStatus string

const (
	DeliveryStatusQueued       DeliveryStatus = "queued"
	DeliveryStatusConnNotFound DeliveryStatus = "conn_not_found"
	DeliveryStatusConnClosed   DeliveryStatus = "conn_closed"
	DeliveryStatusMarshalError DeliveryStatus = "marshal_error"
	DeliveryStatusBufferFull   DeliveryStatus = "buffer_full"
)

var (
	ErrDeliveryConnNotFound = errors.New("websocket connection not found")
	ErrDeliveryConnClosed   = errors.New("websocket connection closed")
	ErrDeliveryMarshalError = errors.New("websocket frame marshal failed")
	ErrDeliveryBufferFull   = errors.New("websocket send buffer full")
	ErrPerUserCapReached    = errors.New("websocket per-user connection cap reached")
	ErrShutdownInProgress   = errors.New("websocket manager shutdown in progress")
)

func (c *Conn) SetAuth(userID, deviceType, deviceID string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.UserID = userID
	c.DeviceType = deviceType
	c.DeviceID = deviceID
}

// Close closes the underlying WebSocket connection. It is safe to call
// multiple times and tolerates a nil *websocket.Conn (useful in tests).
func (c *Conn) Close() {
	if c.W != nil {
		_ = c.W.Close(websocket.StatusNormalClosure, "")
	}
}

// AllowMessage checks the per-connection message rate limiter. Returns true
// if the message should be processed, false if it should be dropped.
func (c *Conn) AllowMessage() bool {
	if c.msgLimiter == nil {
		return true
	}
	return c.msgLimiter.Allow()
}

// closeSend closes the Send channel exactly once and marks the connection as
// closed so PushToConn can avoid a panic on closed-channel send.
func (c *Conn) closeSend() {
	c.sendMu.Lock()
	defer c.sendMu.Unlock()
	if c.closed.CompareAndSwap(false, true) {
		close(c.Send)
	}
}

func NewConn(ws *websocket.Conn) *Conn {
	return NewConnWithBufferSize(ws, config.WSSendBufferSize)
}

// NewConnWithBufferSize builds a Conn with an explicit send-buffer capacity.
// Test-only override point (capacity configuration seam): sizes <= 0 fall back
// to the production default so default semantics never change.
func NewConnWithBufferSize(ws *websocket.Conn, size int) *Conn {
	if size <= 0 {
		size = config.WSSendBufferSize
	}
	r := rate.Every(time.Second / time.Duration(config.WSMessageRateLimit))
	if ws != nil {
		ws.SetReadLimit(512 * 1024)
	}
	return &Conn{
		W:          ws,
		Send:       make(chan []byte, size),
		msgLimiter: rate.NewLimiter(r, config.WSMessageBurst),
	}
}

// ReadMessage reads a single WebSocket message with a read deadline.  The
// deadline is set to WSReadTimeout (2x heartbeat interval).  When the parent
// context carries its own deadline, the earlier of the two applies.
//
// Callers should replace conn.W.Read(ctx) with conn.ReadMessage(ctx) to gain
// idle-timeout protection.
func (c *Conn) ReadMessage(ctx context.Context) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, WSReadTimeout)
	defer cancel()
	_, data, err := c.W.Read(ctx)
	return data, err
}
