package ws

import (
	"context"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"github.com/agenthub/hub-server/internal/metrics"
	"github.com/agenthub/hub-server/pkg/uuidv7"
	"github.com/coder/websocket"
)

const sendBufSize = 256

type Conn struct {
	ID         string
	UserID     string
	DeviceType string
	DeviceID   string
	W          *websocket.Conn
	Send       chan []byte
	missedPong atomic.Int32
	mu         sync.Mutex
}

func (c *Conn) SetAuth(userID, deviceType, deviceID string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.UserID = userID
	c.DeviceType = deviceType
	c.DeviceID = deviceID
}

func (c *Conn) Close() {
	c.W.Close(websocket.StatusNormalClosure, "")
}

type Manager struct {
	OnRouteSet     func(userID, deviceType, connID, oldConnID string, wasOffline bool)
	OnRouteDel     func(userID, deviceType, connID string)
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
		Send: make(chan []byte, sendBufSize),
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
		m.byUser[c.UserID][c.DeviceType] = c.ID
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
	if m.byUser[userID] != nil {
		oldConnID = m.byUser[userID][deviceType]
	}

	wasOffline := len(m.byUser[userID]) == 0

	if m.byUser[userID] == nil {
		m.byUser[userID] = make(map[string]string)
	}
	m.byUser[userID][deviceType] = connID

	c.mu.Lock()
	c.UserID = userID
	c.DeviceType = deviceType
	c.DeviceID = deviceID
	c.mu.Unlock()

	m.mu.Unlock()

	if m.OnRouteSet != nil {
		m.OnRouteSet(userID, deviceType, connID, oldConnID, wasOffline)
	}
}

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
			delete(devs, c.DeviceType)
			if len(devs) == 0 {
				delete(m.byUser, c.UserID)
			}
		}
	}

	userID := c.UserID
	deviceType := c.DeviceType
	connIDForDel := c.ID

	m.mu.Unlock()

	if userID != "" && m.OnRouteDel != nil {
		m.OnRouteDel(userID, deviceType, connIDForDel)
	}

	close(c.Send)
	slog.Info("ws disconnected", "conn_id", connID, "user_id", c.UserID)
}

func (m *Manager) PushToConn(connID string, frame Frame) {
	m.mu.RLock()
	c, ok := m.conns[connID]
	m.mu.RUnlock()
	if !ok {
		return
	}
	data, err := frame.Marshal()
	if err != nil {
		return
	}
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

func (m *Manager) FindByUserDevice(userID, deviceType string) *Conn {
	m.mu.RLock()
	defer m.mu.RUnlock()
	devs, ok := m.byUser[userID]
	if !ok {
		return nil
	}
	connID, ok := devs[deviceType]
	if !ok {
		return nil
	}
	return m.conns[connID]
}

func (m *Manager) StartHeartbeat() {
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			m.pingAll()
		}
	}()
}

func (m *Manager) pingAll() {
	m.mu.RLock()
	conns := make([]*Conn, 0, len(m.conns))
	for _, c := range m.conns {
		conns = append(conns, c)
	}
	m.mu.RUnlock()

	for _, c := range conns {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		err := c.W.Ping(ctx)
		cancel()
		if err != nil {
			missed := c.missedPong.Add(1)
			slog.Warn("ws ping failed", "conn_id", c.ID, "missed", missed)
			if missed >= 2 {
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
