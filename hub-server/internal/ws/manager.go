package ws

import (
	"context"
	"errors"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/metrics"
	"github.com/agenthub/hub-server/pkg/uuidv7"
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
)

type DeliveryResult struct {
	Queued bool
	Status DeliveryStatus
	Err    error
}

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
		c.W.Close(websocket.StatusNormalClosure, "")
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

// Manager is the global WebSocket connection registry. It tracks connections
// by ID and per-user device type.
type Manager struct {
	OnRouteSet     func(userID, deviceType, deviceID, connID, oldConnID string, wasOffline bool)
	OnRouteDel     func(userID, deviceType, deviceID, connID string)
	ResolveMembers func(sessionID string) []string

	mu     sync.RWMutex
	conns  map[string]*Conn
	byUser map[string]map[string]string

	// userConnCount tracks the number of active connections per user.
	// Updated atomically with byUser under mu.
	userConnCount map[string]int
}

func NewManager() *Manager {
	return &Manager{
		conns:         make(map[string]*Conn),
		byUser:        make(map[string]map[string]string),
		userConnCount: make(map[string]int),
	}
}

func (m *Manager) Count() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.conns)
}

func NewConn(ws *websocket.Conn) *Conn {
	r := rate.Every(time.Second / time.Duration(config.WSMessageRateLimit))
	if ws != nil {
		ws.SetReadLimit(512 * 1024)
	}
	return &Conn{
		W:          ws,
		Send:       make(chan []byte, config.WSSendBufferSize),
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

// Register assigns a unique UUIDv7 connection ID to c and adds it to the global
// registry. If c.UserID is already set (e.g. by a pre-authenticated upgrade
// middleware), a per-user connection cap check is performed against
// config.WSMaxConnsPerUser (default 10). When the cap is exceeded the connection
// is rejected with ErrPerUserCapReached.
//
// For connections that authenticate after registration (the common path), the
// cap is enforced in SetAuth instead.
func (m *Manager) Register(c *Conn) error {
	id, err := uuidv7.New()
	if err != nil {
		return err
	}
	c.ID = id

	m.mu.Lock()

	// Per-user connection cap check (only applicable when UserID is pre-set,
	// e.g. by pre-authenticated upgrade middleware).
	if c.UserID != "" && m.userConnCount[c.UserID] >= config.WSMaxConnsPerUser {
		m.mu.Unlock()
		slog.Warn("ws register rejected: per-user connection cap reached",
			"user_id", c.UserID,
			"current", m.userConnCount[c.UserID],
			"max", config.WSMaxConnsPerUser,
		)
		return ErrPerUserCapReached
	}

	m.conns[c.ID] = c
	if c.UserID != "" {
		if m.byUser[c.UserID] == nil {
			m.byUser[c.UserID] = make(map[string]string)
		}
		m.byUser[c.UserID][c.ID] = c.ID
		m.userConnCount[c.UserID]++
	}
	m.mu.Unlock()

	slog.Info("ws connected", "conn_id", c.ID)
	return nil
}

// SetAuth binds user identity and device metadata to an already-registered
// connection. It enforces the per-user connection cap (config.WSMaxConnsPerUser,
// default 10): when the user already has the maximum number of active
// connections, the incoming connection is closed and unregistered immediately to
// prevent a zombie connection that would otherwise linger until read/write
// timeout.
//
// SetAuth also tracks whether the user was previously offline (wasOffline) and
// whether a same-device-type connection already existed (oldConnID), then fires
// the OnRouteSet callback so higher layers can react to routing changes.
func (m *Manager) SetAuth(connID string, userID, deviceType, deviceID string) {
	m.mu.Lock()

	c, ok := m.conns[connID]
	if !ok {
		m.mu.Unlock()
		return
	}

	// Per-user connection cap: reject new connections when the user already
	// has WSMaxConnsPerUser active connections. The connection is already
	// registered (in conns map, writeLoop running), so we must close and
	// unregister it to avoid a zombie that consumes resources until timeout.
	if m.userConnCount[userID] >= config.WSMaxConnsPerUser {
		m.mu.Unlock()
		slog.Warn("ws setauth rejected: per-user connection cap reached",
			"user_id", userID,
			"conn_id", connID,
			"current", m.userConnCount[userID],
			"max", config.WSMaxConnsPerUser,
		)
		c.Close()
		m.Unregister(connID)
		return
	}

	oldConnID := ""
	if m.byUser[userID] == nil {
		m.byUser[userID] = make(map[string]string)
	}
	// Find existing connection of same device type (for oldConnID tracking)
	for _, existingCID := range m.byUser[userID] {
		if ec, ok := m.conns[existingCID]; ok && ec.DeviceType == deviceType && ec.DeviceID == deviceID {
			oldConnID = existingCID
			break
		}
	}

	wasOffline := len(m.byUser[userID]) == 0

	// Use connID as route key to prevent same-type devices from overwriting each other
	m.byUser[userID][connID] = connID
	m.userConnCount[userID]++

	c.mu.Lock()
	c.UserID = userID
	c.DeviceType = deviceType
	c.DeviceID = deviceID
	c.mu.Unlock()

	m.mu.Unlock()

	if m.OnRouteSet != nil {
		m.OnRouteSet(userID, deviceType, deviceID, connID, oldConnID, wasOffline)
	}
}

// Unregister removes a connection from the registry and closes its Send
// channel. It is safe to call multiple times (idempotent); after a
// connection has been removed, subsequent calls are no-ops.
func (m *Manager) Unregister(connID string) {
	m.mu.Lock()
	c, ok := m.conns[connID]
	if !ok {
		m.mu.Unlock()
		return
	}
	delete(m.conns, connID)
	if c.UserID != "" {
		m.userConnCount[c.UserID]--
		if m.userConnCount[c.UserID] <= 0 {
			delete(m.userConnCount, c.UserID)
		}
		if devs, ok := m.byUser[c.UserID]; ok {
			delete(devs, c.ID)
			if len(devs) == 0 {
				delete(m.byUser, c.UserID)
			}
		}
	}

	userID := c.UserID
	deviceType := c.DeviceType
	deviceID := c.DeviceID
	connIDForDel := c.ID

	m.mu.Unlock()

	if userID != "" && m.OnRouteDel != nil {
		m.OnRouteDel(userID, deviceType, deviceID, connIDForDel)
	}

	c.closeSend()
	slog.Info("ws disconnected", "conn_id", connID, "user_id", c.UserID)
}

// PushToConn sends a frame to a single connection.
func (m *Manager) PushToConn(connID string, frame Frame) DeliveryResult {
	m.mu.RLock()
	c, ok := m.conns[connID]
	m.mu.RUnlock()
	if !ok {
		return DeliveryResult{Status: DeliveryStatusConnNotFound, Err: ErrDeliveryConnNotFound}
	}
	if c.closed.Load() {
		return DeliveryResult{Status: DeliveryStatusConnClosed, Err: ErrDeliveryConnClosed}
	}
	data, err := frame.Marshal()
	if err != nil {
		return DeliveryResult{Status: DeliveryStatusMarshalError, Err: errors.Join(ErrDeliveryMarshalError, err)}
	}

	c.sendMu.Lock()
	defer c.sendMu.Unlock()
	if c.closed.Load() {
		return DeliveryResult{Status: DeliveryStatusConnClosed, Err: ErrDeliveryConnClosed}
	}

	select {
	case c.Send <- data:
		return DeliveryResult{Queued: true, Status: DeliveryStatusQueued}
	default:
		if metrics.WSDroppedFrames != nil {
			metrics.WSDroppedFrames.Inc()
		}
		sessionID := extractSessionID(frame.Payload)
		slog.Warn("ws frame dropped: send buffer full",
			"conn_id", connID,
			"user_id", c.UserID,
			"device_type", c.DeviceType,
			"frame_type", frame.Type,
			"session_id", sessionID,
		)
		return DeliveryResult{Status: DeliveryStatusBufferFull, Err: ErrDeliveryBufferFull}
	}
}

func (m *Manager) PushToUser(userID string, frame Frame) {
	m.mu.RLock()
	devs, ok := m.byUser[userID]
	if !ok {
		m.mu.RUnlock()
		return
	}
	connIDs := make([]string, 0, len(devs))
	for _, cid := range devs {
		connIDs = append(connIDs, cid)
	}
	m.mu.RUnlock()
	for _, cid := range connIDs {
		m.PushToConn(cid, frame)
	}
}

func (m *Manager) PushToSession(sessionID string, frame Frame) {
	if m.ResolveMembers == nil {
		return
	}
	defer func() {
		if r := recover(); r != nil {
			slog.Error("ws PushToSession panic recovered in ResolveMembers callback",
				"session_id", sessionID, "panic", r)
		}
	}()
	memberIDs := m.ResolveMembers(sessionID)
	for _, userID := range memberIDs {
		m.PushToUser(userID, frame)
	}
}

func (m *Manager) FindByConnID(connID string) *Conn {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.conns[connID]
}

func (m *Manager) FindByUserDevice(userID, deviceType string) *Conn {
	m.mu.RLock()
	defer m.mu.RUnlock()
	devs, ok := m.byUser[userID]
	if !ok {
		return nil
	}
	// Iterate connections to find one matching the requested device type
	for _, connID := range devs {
		if c, ok := m.conns[connID]; ok && c.DeviceType == deviceType {
			return c
		}
	}
	return nil
}

func (m *Manager) StartHeartbeat() {
	go func() {
		ticker := time.NewTicker(config.WSHeartbeatInterval)
		defer ticker.Stop()
		for range ticker.C {
			m.pingAll()
		}
	}()
}

// Shutdown closes all WebSocket connections and cleans up internal state.
// It closes each connection's Send channel first (unblocking writeLoop
// goroutines), then closes the WebSocket connection (unblocking readLoop
// goroutines), and finally clears the registry maps.  This ensures that
// all connection-scoped goroutines will eventually exit rather than leak.
func (m *Manager) Shutdown() {
	m.mu.Lock()
	defer m.mu.Unlock()
	for id, c := range m.conns {
		c.closeSend() // Unblock writeLoop goroutine (blocks on <-c.Send)
		c.Close()     // Unblock readLoop goroutine (blocks on Read)
		delete(m.conns, id)
	}
	m.byUser = make(map[string]map[string]string)
	m.userConnCount = make(map[string]int)
}

func (m *Manager) pingAll() {
	m.mu.RLock()
	conns := make([]*Conn, 0, len(m.conns))
	for _, c := range m.conns {
		conns = append(conns, c)
	}
	m.mu.RUnlock()

	for _, c := range conns {
		ctx, cancel := context.WithTimeout(context.Background(), config.WSPingTimeout)
		err := c.W.Ping(ctx)
		cancel()
		if err != nil {
			missed := c.missedPong.Add(1)
			slog.Warn("ws ping failed", "conn_id", c.ID, "missed", missed)
			if missed >= config.WSMaxMissedPongs {
				slog.Info("ws closing stale connection", "conn_id", c.ID)
				c.Close()
				m.Unregister(c.ID)
			}
		} else {
			c.missedPong.Store(0)
		}
	}
}

func extractSessionID(payload any) string {
	if m, ok := payload.(map[string]interface{}); ok {
		if sid, ok := m["session_id"].(string); ok {
			return sid
		}
	}
	if m, ok := payload.(map[string]string); ok {
		if sid, ok := m["session_id"]; ok {
			return sid
		}
	}
	return ""
}
