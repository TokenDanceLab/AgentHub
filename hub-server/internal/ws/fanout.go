package ws

import (
	"errors"
	"log/slog"

	"github.com/agenthub/hub-server/internal/metrics"
)

type DeliveryResult struct {
	Queued bool
	Status DeliveryStatus
	Err    error

	// ConnDrops is the cumulative number of buffer-full drops on the target
	// connection, set only when Status is DeliveryStatusBufferFull. Fanout
	// callers use it with shouldLogDrop to sample aggregate drop logging.
	ConnDrops int64
}

// FanoutResult aggregates the per-connection DeliveryResults of a
// PushToUser / PushToSession fanout so callers and logs can observe drops
// instead of silently discarding them.
type FanoutResult struct {
	Conns   int // connections targeted
	Queued  int // frames successfully queued
	Dropped int // frames dropped because the send buffer was full
	Failed  int // conn closed / not found / marshal failures

	// LogSampled reports whether at least one constituent drop hit the
	// per-connection log-sampling boundary (first drop or every
	// dropLogSampleEvery-th drop on that connection).
	LogSampled bool
}

// merge folds another FanoutResult into r.
func (r *FanoutResult) merge(o FanoutResult) {
	r.Conns += o.Conns
	r.Queued += o.Queued
	r.Dropped += o.Dropped
	r.Failed += o.Failed
	r.LogSampled = r.LogSampled || o.LogSampled
}

// dropLogSampleEvery controls sampled logging of buffer-full drops: the first
// drop on a connection is always logged, then every Nth drop after that, so
// hot push paths cannot emit one warn line per frame.
const dropLogSampleEvery = 100

// shouldLogDrop reports whether the n-th cumulative drop on a connection
// should be logged.
func shouldLogDrop(n int64) bool {
	return n == 1 || n%dropLogSampleEvery == 0
}

// PushToConn sends a frame to a single connection.
//
// Every delivery attempt that reaches the connection (i.e. the conn exists and
// is not closed) is stamped with the connection's monotonic seq_id inside the
// sendMu critical section, so queue order — and therefore wire order, since a
// single writeLoop drains Send — always equals seq order. frame is a value
// copy, so stamping never races with concurrent fanout of the same logical
// frame to other connections. Dropped (buffer-full) and marshal-failed frames
// consume a seq too: the resulting gap is the client-side loss signal.
func (m *Manager) PushToConn(connID string, frame Frame) DeliveryResult {
	// Fast-path: once shutdown has begun, reject all pushes so no new frames
	// enter the drain window. This is cheaper than acquiring mu and avoids
	// racing with map-clear in Shutdown.
	if m.shutdown.Load() {
		if metrics.WSDeliveryFailures != nil {
			metrics.WSDeliveryFailures.WithLabelValues("shutdown").Inc()
		}
		return DeliveryResult{Status: DeliveryStatusConnClosed, Err: ErrShutdownInProgress}
	}

	m.mu.RLock()
	c, ok := m.conns[connID]
	m.mu.RUnlock()
	if !ok {
		if metrics.WSDeliveryFailures != nil {
			metrics.WSDeliveryFailures.WithLabelValues("conn_not_found").Inc()
		}
		return DeliveryResult{Status: DeliveryStatusConnNotFound, Err: ErrDeliveryConnNotFound}
	}
	if c.closed.Load() {
		if metrics.WSDeliveryFailures != nil {
			metrics.WSDeliveryFailures.WithLabelValues("conn_closed").Inc()
		}
		return DeliveryResult{Status: DeliveryStatusConnClosed, Err: ErrDeliveryConnClosed}
	}

	c.sendMu.Lock()
	defer c.sendMu.Unlock()
	if c.closed.Load() {
		if metrics.WSDeliveryFailures != nil {
			metrics.WSDeliveryFailures.WithLabelValues("conn_closed").Inc()
		}
		return DeliveryResult{Status: DeliveryStatusConnClosed, Err: ErrDeliveryConnClosed}
	}

	frame.SeqID = c.seq.Add(1)
	data, err := frame.Marshal()
	if err != nil {
		if metrics.WSDeliveryFailures != nil {
			metrics.WSDeliveryFailures.WithLabelValues("marshal_error").Inc()
		}
		return DeliveryResult{Status: DeliveryStatusMarshalError, Err: errors.Join(ErrDeliveryMarshalError, err)}
	}

	select {
	case c.Send <- data:
		return DeliveryResult{Queued: true, Status: DeliveryStatusQueued}
	default:
		if metrics.WSDroppedFrames != nil {
			metrics.WSDroppedFrames.Inc()
		}
		drops := c.droppedFrames.Add(1)
		if shouldLogDrop(drops) {
			sessionID := extractSessionID(frame.Payload)
			slog.Warn("ws frame dropped: send buffer full",
				"conn_id", connID,
				"user_id", c.UserID,
				"device_type", c.DeviceType,
				"frame_type", frame.Type,
				"session_id", sessionID,
				"seq_id", frame.SeqID,
				"conn_dropped_total", drops,
			)
		}
		return DeliveryResult{Status: DeliveryStatusBufferFull, Err: ErrDeliveryBufferFull, ConnDrops: drops}
	}
}

// PushToUser fans a frame out to every connection of a user and aggregates the
// per-connection delivery results. When at least one drop hits the
// per-connection log-sampling boundary, a single aggregated warn line is
// emitted for the whole fanout.
func (m *Manager) PushToUser(userID string, frame Frame) FanoutResult {
	m.mu.RLock()
	devs, ok := m.byUser[userID]
	if !ok {
		m.mu.RUnlock()
		return FanoutResult{}
	}
	connIDs := make([]string, 0, len(devs))
	for _, cid := range devs {
		connIDs = append(connIDs, cid)
	}
	m.mu.RUnlock()

	res := FanoutResult{Conns: len(connIDs)}
	for _, cid := range connIDs {
		r := m.PushToConn(cid, frame)
		switch r.Status {
		case DeliveryStatusQueued:
			res.Queued++
		case DeliveryStatusBufferFull:
			res.Dropped++
			if shouldLogDrop(r.ConnDrops) {
				res.LogSampled = true
			}
		default:
			res.Failed++
		}
	}
	if res.LogSampled {
		slog.Warn("ws push to user dropped frames: send buffer full",
			"user_id", userID,
			"frame_type", frame.Type,
			"conns", res.Conns,
			"queued", res.Queued,
			"dropped", res.Dropped,
		)
	}
	return res
}

// PushToSession fans a frame out to every member of a session and aggregates
// the delivery results across members. Aggregate drop logging follows the same
// per-connection sampling as PushToUser.
func (m *Manager) PushToSession(sessionID string, frame Frame) (res FanoutResult) {
	if m.ResolveMembers == nil {
		return res
	}
	defer func() {
		if r := recover(); r != nil {
			slog.Error("ws PushToSession panic recovered in ResolveMembers callback",
				"session_id", sessionID, "panic", r)
		}
	}()
	memberIDs := m.ResolveMembers(sessionID)
	for _, userID := range memberIDs {
		res.merge(m.PushToUser(userID, frame))
	}
	if res.LogSampled {
		slog.Warn("ws push to session dropped frames: send buffer full",
			"session_id", sessionID,
			"frame_type", frame.Type,
			"members", len(memberIDs),
			"conns", res.Conns,
			"queued", res.Queued,
			"dropped", res.Dropped,
		)
	}
	return res
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
