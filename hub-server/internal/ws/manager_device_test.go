package ws

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"
)

// TestPushToDevice_DeliversToTargetEdge verifies that PushToDevice routes a
// frame to the connection registered for the target deviceID, and NOT to
// other connections of the same user. This is the regression test for #2101 G6:
// relay.CreateCommand previously called PushToUser(targetEdgeID), which keyed
// on userID and silently dropped frames destined for edge devices.
func TestPushToDevice_DeliversToTargetEdge(t *testing.T) {
	m := NewManager()

	target := &Conn{Send: make(chan []byte, 4)}
	other := &Conn{Send: make(chan []byte, 4)}
	require.NoError(t, m.Register(target))
	require.NoError(t, m.Register(other))

	m.SetAuth(target.ID, "user-1", "edge", "edge-target")
	m.SetAuth(other.ID, "user-1", "desktop", "desktop-other")

	frame := NewFrame(TypeAgentDispatch, map[string]interface{}{"relay_command_id": "c1"})
	res := m.PushToDevice("edge-target", frame)

	require.Equal(t, 1, res.Conns)
	require.Equal(t, 1, res.Queued)
	require.Equal(t, 0, res.Dropped)
	require.Equal(t, 0, res.Failed)

	// Target must have received the frame.
	require.Len(t, target.Send, 1)
	got := <-target.Send
	var f Frame
	require.NoError(t, json.Unmarshal(got, &f))
	require.Equal(t, TypeAgentDispatch, f.Type)

	// Other connection must NOT have received anything.
	require.Empty(t, other.Send)
}

// TestPushToDevice_NonTargetReceivesNothing ensures fanout does not leak to
// unrelated devices when the deviceID exists but belongs to a different user.
func TestPushToDevice_NonTargetReceivesNothing(t *testing.T) {
	m := NewManager()

	a := &Conn{Send: make(chan []byte, 4)}
	b := &Conn{Send: make(chan []byte, 4)}
	require.NoError(t, m.Register(a))
	require.NoError(t, m.Register(b))

	m.SetAuth(a.ID, "user-a", "edge", "edge-a")
	m.SetAuth(b.ID, "user-b", "edge", "edge-b")

	res := m.PushToDevice("edge-a", NewFrame(TypeAgentDispatch, nil))
	require.Equal(t, 1, res.Queued)
	require.Len(t, a.Send, 1)
	require.Empty(t, b.Send)
}

// TestPushToDevice_UnknownDeviceReturnsEmpty verifies graceful handling when
// no connection is registered for the device (no panic, no delivery).
func TestPushToDevice_UnknownDeviceReturnsEmpty(t *testing.T) {
	m := NewManager()
	res := m.PushToDevice("nonexistent", NewFrame(TypeAgentDispatch, nil))
	require.Equal(t, 0, res.Conns)
	require.Equal(t, 0, res.Queued)
}

// TestPushToDevice_EmptyDeviceIDIsNoop guards against accidental empty-string
// lookups that would otherwise hit the zero-value map entry.
func TestPushToDevice_EmptyDeviceIDIsNoop(t *testing.T) {
	m := NewManager()
	c := &Conn{Send: make(chan []byte, 4)}
	require.NoError(t, m.Register(c))
	m.SetAuth(c.ID, "u", "edge", "") // empty deviceID should not be indexed

	res := m.PushToDevice("", NewFrame(TypeAgentDispatch, nil))
	require.Equal(t, 0, res.Conns)
	require.Empty(t, c.Send)
}

// TestPushToDevice_AfterUnregisterDoesNotPanicOrLeak ensures that after a
// device connection is unregistered, PushToDevice returns an empty result and
// does not deliver to any stale channel. Also verifies the byDevice index is
// cleaned up so a later re-registration with the same deviceID works.
func TestPushToDevice_AfterUnregisterDoesNotPanicOrLeak(t *testing.T) {
	m := NewManager()

	c := &Conn{Send: make(chan []byte, 4)}
	require.NoError(t, m.Register(c))
	m.SetAuth(c.ID, "user-1", "edge", "edge-x")

	// Sanity: delivery works before unregister.
	res := m.PushToDevice("edge-x", NewFrame(TypeAgentDispatch, nil))
	require.Equal(t, 1, res.Queued)
	<-c.Send // drain so later Empty assertion reflects post-unregister state

	m.Unregister(c.ID)

	// After unregister: no delivery, no panic.
	res = m.PushToDevice("edge-x", NewFrame(TypeAgentDispatch, nil))
	require.Equal(t, 0, res.Conns)
	require.Equal(t, 0, res.Queued)

	// Re-register a NEW connection with the same deviceID; index must point
	// to the new conn, not the unregistered one.
	c2 := &Conn{Send: make(chan []byte, 4)}
	require.NoError(t, m.Register(c2))
	m.SetAuth(c2.ID, "user-1", "edge", "edge-x")

	res = m.PushToDevice("edge-x", NewFrame(TypeAgentDispatch, nil))
	require.Equal(t, 1, res.Queued)
	require.Len(t, c2.Send, 1)
	require.Empty(t, c.Send) // old conn's channel untouched
}

// TestPushToDevice_ReconnectOverwritesIndex verifies that when two conns
// authenticate with the same deviceID (reconnect), PushToDevice targets the
// newest one. The old conn remains in conns/byUser (it may still receive
// PushToUser fanout) but device-targeted traffic goes to the replacement.
func TestPushToDevice_ReconnectOverwritesIndex(t *testing.T) {
	m := NewManager()

	old := &Conn{Send: make(chan []byte, 4)}
	newC := &Conn{Send: make(chan []byte, 4)}
	require.NoError(t, m.Register(old))
	require.NoError(t, m.Register(newC))

	m.SetAuth(old.ID, "user-1", "edge", "edge-r")
	m.SetAuth(newC.ID, "user-1", "edge", "edge-r") // reconnect

	res := m.PushToDevice("edge-r", NewFrame(TypeAgentDispatch, nil))
	require.Equal(t, 1, res.Queued)
	require.Len(t, newC.Send, 1)
	require.Empty(t, old.Send)
}
