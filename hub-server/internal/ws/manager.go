package ws

import (
	"context"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/metrics"
	"github.com/agenthub/hub-server/internal/uuidv7"
)

// Manager is the global WebSocket connection registry. It tracks connections
// by ID and per-user device type.
type Manager struct {
	OnRouteSet     func(userID, deviceType, deviceID, connID, oldConnID string, wasOffline bool)
	OnRouteDel     func(userID, deviceType, deviceID, connID string)
	ResolveMembers func(sessionID string) []string

	mu       sync.RWMutex
	conns    map[string]*Conn
	byUser   map[string]map[string]string
	byDevice map[string]string // deviceID -> connID (only for conns with non-empty DeviceID)

	// userConnCount tracks the number of active connections per user.
	// Updated atomically with byUser under mu.
	userConnCount map[string]int

	// sendBufferSize is the capacity of each new connection's outgoing send
	// channel (see NewConnWithBufferSize). Defaults to config.WSSendBufferSize;
	// SetSendBufferSize overrides it for backpressure tests.
	sendBufferSize int

	// pingHook is a test-only seam replacing pingAll's body (heartbeat
	// lifecycle tests count ticks without needing real connections).
	pingHook func()

	// goroutines tracks in-flight connection-scoped goroutines (writeLoop +
	// readLoop). Add before launch, Done on exit. Shutdown waits on this with
	// a bounded timeout so process exit does not race with in-flight frames.
	goroutines sync.WaitGroup

	// shutdown is set atomically at the start of Shutdown so Register and
	// Push paths can short-circuit without acquiring mu.
	shutdown atomic.Bool
}

func NewManager() *Manager {
	return &Manager{
		conns:          make(map[string]*Conn),
		byUser:         make(map[string]map[string]string),
		byDevice:       make(map[string]string),
		userConnCount:  make(map[string]int),
		sendBufferSize: config.WSSendBufferSize,
	}
}

// SetPingHook installs a test-only heartbeat probe; nil restores the real
// pingAll body.
func (m *Manager) SetPingHook(hook func()) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.pingHook = hook
}

// SetSendBufferSize overrides the per-connection send-buffer capacity for
// tests that must deterministically hit backpressure (capacity configuration
// seam). Sizes <= 0 reset to the production default.
func (m *Manager) SetSendBufferSize(n int) {
	if n <= 0 {
		n = config.WSSendBufferSize
	}
	m.mu.Lock()
	m.sendBufferSize = n
	m.mu.Unlock()
}

// SendBufferSize returns the send-buffer capacity used for new connections.
func (m *Manager) SendBufferSize() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.sendBufferSize
}

// GoroutineAdd increments the in-flight connection-goroutine counter by n.
// Callers MUST pair every Add with a corresponding Done (typically deferred
// in the goroutine body). This is intentionally exported so handler/ws can
// track writeLoop/readLoop lifetimes without reaching into Manager internals.
func (m *Manager) GoroutineAdd(n int) {
	m.goroutines.Add(n)
}

// GoroutineDone decrements the in-flight connection-goroutine counter.
func (m *Manager) GoroutineDone() {
	m.goroutines.Done()
}

// IsShutdown reports whether Shutdown has been initiated. Push/Register paths
// use this as a fast-path short-circuit before acquiring mu.
func (m *Manager) IsShutdown() bool {
	return m.shutdown.Load()
}

func (m *Manager) Count() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.conns)
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
	// Fast-path: reject new registrations once shutdown has begun so no new
	// connection goroutines are spawned while we are draining existing ones.
	if m.shutdown.Load() {
		return ErrShutdownInProgress
	}

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
	// Mirror the SetAuth byDevice indexing for pre-authenticated connections
	// (UserID/DeviceID pre-set by upgrade middleware); without this, relay
	// PushToDevice cannot reach devices registered via this path (#2101 G6).
	if c.DeviceID != "" {
		m.byDevice[c.DeviceID] = c.ID
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

	// Maintain byDevice index: when deviceID is provided, map it to this conn.
	// A reconnect with the same deviceID overwrites the previous entry; the old
	// conn remains in conns/byUser but PushToDevice will target the newest.
	if deviceID != "" {
		m.byDevice[deviceID] = connID
	}

	m.mu.Unlock()

	if oldConnID != "" {
		if metrics.WSReconnects != nil {
			metrics.WSReconnects.Inc()
		}
	}
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
	if c.DeviceID != "" {
		// Only delete if the index still points to this conn (a newer conn may
		// have overwritten it on reconnect).
		if m.byDevice[c.DeviceID] == c.ID {
			delete(m.byDevice, c.DeviceID)
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
	if metrics.WSDisconnects != nil {
		metrics.WSDisconnects.Inc()
	}
	slog.Info("ws disconnected", "conn_id", connID, "user_id", c.UserID)
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

// StartHeartbeat runs the heartbeat pinger until ctx is cancelled (#1542:
// the loop must be stoppable — previously it ran forever and leaked at
// shutdown).
func (m *Manager) StartHeartbeat(ctx context.Context) {
	m.StartHeartbeatWithInterval(ctx, config.WSHeartbeatInterval)
}

// StartHeartbeatWithInterval runs the heartbeat pinger at an explicit cadence
// until ctx is cancelled. Test-only override point (clock configuration
// seam): intervals <= 0 fall back to the production default so default
// semantics never change.
func (m *Manager) StartHeartbeatWithInterval(ctx context.Context, interval time.Duration) {
	if ctx == nil {
		ctx = context.Background()
	}
	if interval <= 0 {
		interval = config.WSHeartbeatInterval
	}
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				m.pingAll()
			case <-ctx.Done():
				return
			}
		}
	}()
}

// shutdownDrainTimeout is the maximum time Shutdown waits for in-flight
// connection goroutines (writeLoop + readLoop) to exit after signaling
// closure. 2 s is chosen to be well above typical TCP close RTT (~100 ms)
// yet short enough to keep process-shutdown latency bounded; exceeding it
// indicates a stuck goroutine and is logged as a warning, not a fatal.
const shutdownDrainTimeout = 2 * time.Second

// Shutdown closes all WebSocket connections and waits (with a bounded
// timeout) for connection-scoped goroutines to converge.
//
// Sequence:
//  1. Set the shutdown flag so Register/Push short-circuit immediately.
//  2. Under mu: closeSend + Close every connection, clear registry maps.
//  3. Release mu and wait up to shutdownDrainTimeout for the goroutine
//     WaitGroup to reach zero.
//  4. If the timeout elapses, log a Warn with the outstanding count and
//     return — do NOT block process exit indefinitely.
//
// The shutdown flag is sticky; subsequent calls to Shutdown are no-ops.
func (m *Manager) Shutdown() {
	if !m.shutdown.CompareAndSwap(false, true) {
		return // already shutting down
	}

	m.mu.Lock()
	pending := len(m.conns)
	for id, c := range m.conns {
		c.closeSend() // Unblock writeLoop goroutine (blocks on <-c.Send)
		c.Close()     // Unblock readLoop goroutine (blocks on Read)
		delete(m.conns, id)
	}
	m.byUser = make(map[string]map[string]string)
	m.byDevice = make(map[string]string)
	m.userConnCount = make(map[string]int)
	m.mu.Unlock()

	// Wait for in-flight goroutines outside the lock so they can complete
	// their deferred Unregister/cleanup without deadlocking on mu.
	done := make(chan struct{})
	go func() {
		m.goroutines.Wait()
		close(done)
	}()

	select {
	case <-done:
		slog.Info("ws shutdown: all connection goroutines converged",
			"connections_closed", pending)
	case <-time.After(shutdownDrainTimeout):
		// We cannot cheaply read the outstanding WG count without an
		// auxiliary atomic; log what we know at entry and warn.
		slog.Warn("ws shutdown: timed out waiting for connection goroutines",
			"timeout", shutdownDrainTimeout,
			"connections_closed_at_entry", pending)
	}
}

func (m *Manager) pingAll() {
	m.mu.RLock()
	hook := m.pingHook
	m.mu.RUnlock()
	if hook != nil {
		hook()
		return
	}
	m.mu.RLock()
	conns := make([]*Conn, 0, len(m.conns))
	for _, c := range m.conns {
		conns = append(conns, c)
	}
	m.mu.RUnlock()

	// Parallel ping with a bounded worker pool so N half-open connections no
	// longer take N × WSPingTimeout (serial) but max(WSPingTimeout, N/8). The
	// missed-pong semantics are unchanged: each connection independently
	// increments its missedPong counter on failure and closes at the
	// WSMaxMissedPongs threshold. The worker count is intentionally modest
	// (8) so the ping storm does not itself become a goroutine storm and the
	// per-ping timeout still bounds each worker's worst case.
	const pingAllWorkerCount = 8
	workers := pingAllWorkerCount
	if len(conns) < workers {
		workers = len(conns)
	}
	if workers <= 0 {
		return
	}
	jobs := make(chan *Conn, len(conns))
	var wg sync.WaitGroup
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for c := range jobs {
				ctx, cancel := context.WithTimeout(context.Background(), config.WSPingTimeout)
				err := c.W.Ping(ctx)
				cancel()
				if err != nil {
					missed := c.missedPong.Add(1)
					slog.Warn("ws ping failed", "conn_id", c.ID, "missed", missed)
					if missed >= config.WSMaxMissedPongs {
						if metrics.WSStaleClose != nil {
							metrics.WSStaleClose.Inc()
						}
						slog.Info("ws closing stale connection", "conn_id", c.ID)
						c.Close()
						m.Unregister(c.ID)
					}
				} else {
					c.missedPong.Store(0)
				}
			}
		}()
	}
	for _, c := range conns {
		jobs <- c
	}
	close(jobs)
	wg.Wait()
}
