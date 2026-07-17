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
