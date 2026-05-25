package ws

import (
	"context"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/metrics"
	"github.com/agenthub/hub-server/pkg/uuidv7"
	"github.com/coder/websocket"
)

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

	// closed is set atomically before the Send channel is closed.  PushToConn
	// checks this flag as a best-effort guard against sending on a closed
	// channel; a recover() inside PushToConn provides a hard safety net.
	closed atomic.Bool
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

// closeSend closes the Send channel exactly once and marks the connection as
// closed so PushToConn can avoid a panic on closed-channel send.
func (c *Conn) closeSend() {
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
}

func NewManager() *Manager {
	return &Manager{
		conns:  make(map[string]*Conn),
		byUser: make(map[string]map[string]string),
	}
}

func (m *Manager) Count() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.conns)
}

func NewConn(ws *websocket.Conn) *Conn {
	return &Conn{
		W:    ws,
		Send: make(chan []byte, config.WSSendBufferSize),
	}
}

func (m *Manager) Register(c *Conn) error {
	id, err := uuidv7.New()
	if err != nil {
		return err
	}
	c.ID = id

	m.mu.Lock()
	m.conns[c.ID] = c
	if c.UserID != "" {
		if m.byUser[c.UserID] == nil {
			m.byUser[c.UserID] = make(map[string]string)
		}
		m.byUser[c.UserID][c.ID] = c.ID
	}
	m.mu.Unlock()

	slog.Info("ws connected", "conn_id", c.ID)
	return nil
}

func (m *Manager) SetAuth(connID string, userID, deviceType, deviceID string) {
	m.mu.Lock()

	c, ok := m.conns[connID]
	if !ok {
		m.mu.Unlock()
		return
	}

	oldConnID := ""
	if m.byUser[userID] == nil {
		m.byUser[userID] = make(map[string]string)
	}
	// Find existing connection of same device type (for oldConnID tracking)
	for _, existingCID := range m.byUser[userID] {
		if ec, ok := m.conns[existingCID]; ok && ec.DeviceType == deviceType {
			oldConnID = existingCID
			break
		}
	}

	wasOffline := len(m.byUser[userID]) == 0

	// Use connID as route key to prevent same-type devices from overwriting each other
	m.byUser[userID][connID] = connID

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

// PushToConn sends a frame to a single connection.  It protects against
// sending on a closed channel via a recover safety net, so callers never
// panic even during shutdown races.
func (m *Manager) PushToConn(connID string, frame Frame) {
	m.mu.RLock()
	c, ok := m.conns[connID]
	m.mu.RUnlock()
	if !ok {
		return
	}
	if c.closed.Load() {
		return
	}
	data, err := frame.Marshal()
	if err != nil {
		return
	}

	// recover catches the race where closeSend() is called between the
	// c.closed.Load() check above and the channel send below.
	defer func() {
		if r := recover(); r != nil {
			slog.Warn("ws push recovered from closed-channel send",
				"conn_id", connID, "recover", r)
		}
	}()

	select {
	case c.Send <- data:
	default:
		metrics.WSDroppedFrames.Inc()
		sessionID := extractSessionID(frame.Payload)
		slog.Warn("ws frame dropped: send buffer full",
			"conn_id", connID,
			"user_id", c.UserID,
			"device_type", c.DeviceType,
			"frame_type", frame.Type,
			"session_id", sessionID,
		)
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
