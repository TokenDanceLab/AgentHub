package dispatch

// OutboxPortAvailable is true when nil-safe outbox wrappers may forward calls.
func OutboxPortAvailable(serviceOK, outboxOK bool) bool {
	return serviceOK && outboxOK
}

// BusPortAvailable is true when nil-safe bus publish may forward.
func BusPortAvailable(serviceOK, busOK bool) bool {
	return serviceOK && busOK
}

// ManagerPortAvailable is true when a WS manager port is present for Find/Push.
func ManagerPortAvailable(mgrOK bool) bool {
	return mgrOK
}

// RelayPortAvailable is true when hub_relay CreateCommand may be attempted.
func RelayPortAvailable(relayOK bool) bool {
	return relayOK
}

// ServiceReceiverAvailable is true when a nil-safe method receiver is present.
func ServiceReceiverAvailable(serviceOK bool) bool {
	return serviceOK
}

// InviterDesktopConnPresent is true when FindByConnID returned a connection for
// unbound inviter-desktop dispatch.
func InviterDesktopConnPresent(connFound bool) bool {
	return connFound
}

// ComposedDispatchReady is true when AgentService already holds a composed
// DispatchService (skip lazy construction).
func ComposedDispatchReady(dispatchOK bool) bool {
	return dispatchOK
}
