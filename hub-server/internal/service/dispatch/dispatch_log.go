package dispatch

// Historical dispatchTask / dispatchTargetBoundTask / capability slog messages.
// Kept pure so orchestration only interpolates structured attrs.
const (
	DispatchLogOutboxRecordFailed = "AH-SR-049 delivery outbox record failed; dispatch continues without durable tracking"

	DispatchLogHTTPMarkFailed          = "failed to mark http-dispatched task"
	DispatchLogOfflinePushConnNil      = "failed to push agent task to offline queue (conn nil)"
	DispatchLogMarkAgentDispatched     = "failed to mark agent task dispatched"
	DispatchLogWSNotQueuedPreserve     = "agent task websocket dispatch not queued; preserving pending task"
	DispatchLogPreserveAfterWSFailure  = "failed to preserve agent task after websocket dispatch failure"
	DispatchLogOfflinePushFailed       = "failed to push agent task to offline queue"
	DispatchLogMissingTargetEdgeDevice = "target-bound agent task missing edge device id"
	DispatchLogRelayCreateFailed       = "failed to create relay command for hub_relay dispatch"
	DispatchLogRelayOfflinePushFailed  = "failed to push hub_relay task to offline queue"
	DispatchLogMarkHubRelayDispatched  = "failed to mark hub_relay task dispatched"

	DispatchLogTargetBoundOfflinePushFailed = "failed to push target-bound agent task to offline queue"
	DispatchLogTargetBoundQueued            = "queued target-bound agent task"
	DispatchLogTargetBoundMarkFailed        = "failed to mark target-bound agent task dispatched"
	DispatchLogTargetBoundWSNotQueued       = "target-bound agent task websocket dispatch not queued; preserving pending task"

	CapabilityMintFailedLog = "AH-SR-046 failed to issue capability token"
)
