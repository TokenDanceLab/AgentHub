package dispatch

// residual.go holds pure residual helpers peeled from agent_dispatch (#1033).
// Decision helpers, identity extractors, and delivery-mark plans only — no DB /
// WS / cache / *Service ownership. Preserve #866/#999/#1000/#1009/#1031 semantics.

// CustomAgentIDFromAgentPresence returns the custom-agent pointer when the agent
// row is present; nil when the agent argument was nil (resolveDispatchTeamContext).
func CustomAgentIDFromAgentPresence(agentPresent bool, customAgentID *string) *string {
	if !agentPresent {
		return nil
	}
	return customAgentID
}

// TeamRunIDValue returns runID when the team-run row is present; empty otherwise.
func TeamRunIDValue(runPresent bool, runID string) string {
	if !runPresent {
		return ""
	}
	return runID
}

// TaskStatusOrEmpty returns task.Status for redispatch gating, or "" when task is nil.
// Used so PlanRedispatchTaskGate receives pure status facts without nil deref.
func TaskStatusOrEmpty(task *PendingTaskSnapshot) string {
	if task == nil {
		return ""
	}
	return task.Status
}

// OutboxRecordSucceeded is true when RecordDelivery returned no error (delivery
// durability was recorded; empty deliveryID still means degraded elsewhere).
func OutboxRecordSucceeded(err error) bool {
	return err == nil
}

// PlanTargetBoundDeliveryMark decides whether MarkDeliverySent should run after
// target-bound routing. live=true means a WS push was queued (live path #866);
// live=false means offline-queue-only so outbox retains ownership (#1031).
func PlanTargetBoundDeliveryMark(live bool, deliveryID string) bool {
	if live {
		return DeliveryMarkAfterDispatch(deliveryID)
	}
	return DeliveryMarkAfterOfflineQueue(deliveryID)
}

// PlanUnboundInviterDesktopMark decides MarkDeliverySent after inviter-desktop
// WS outcome. liveWS=true means PushToConn queued; false means offline fallthrough
// (conn nil or WS not queued) where #1031 keeps outbox pending.
func PlanUnboundInviterDesktopMark(liveWS bool, deliveryID string) bool {
	if liveWS {
		return DeliveryMarkAfterDispatch(deliveryID)
	}
	return DeliveryMarkAfterOfflineQueue(deliveryID)
}

// PlanLiveDispatchMark is true when a live path (HTTP / hub_relay success / live
// WS) should mark the outbox row sent after recording.
func PlanLiveDispatchMark(deliveryID string) bool {
	return DeliveryMarkAfterDispatch(deliveryID)
}

// PlanOfflineDispatchMark is always false: offline queue acceptance is not Edge
// receipt (#1031). Named plan keeps call sites symmetric with PlanLiveDispatchMark.
func PlanOfflineDispatchMark(deliveryID string) bool {
	return DeliveryMarkAfterOfflineQueue(deliveryID)
}

// AssembleInputCore builds the pure AssemblePayloadInput core from identity /
// profile / history fields already resolved by orchestration. Team / Messages /
// PinnedMessages are supplied by the caller after IO.
func AssembleInputCore(
	taskID, agentInstanceID, agentType, targetID, edgeDeviceID, sessionID string,
	triggerMessageID, triggerUserID, prompt, displayName, customAgentID string,
	customFields *CustomAgentFields,
	modelParams string,
	team TeamContext,
	messages, pinned []Message,
) AssemblePayloadInput {
	return AssemblePayloadInput{
		TaskID:           taskID,
		AgentInstanceID:  agentInstanceID,
		AgentType:        agentType,
		TargetID:         targetID,
		EdgeDeviceID:     edgeDeviceID,
		SessionID:        sessionID,
		TriggerMessageID: triggerMessageID,
		TriggerUserID:    triggerUserID,
		Prompt:           prompt,
		DisplayName:      displayName,
		CustomAgentID:    customAgentID,
		CustomFields:     customFields,
		ModelParams:      modelParams,
		Team:             team,
		Messages:         messages,
		PinnedMessages:   pinned,
	}
}

// RedeliveryPreferDeviceRoute is PreferDeviceBoundRedelivery under the residual
// redispatch naming (retryDispatchToTarget route lookup branch).
func RedeliveryPreferDeviceRoute(edgeDeviceID string) bool {
	return PreferDeviceBoundRedelivery(edgeDeviceID)
}

// TargetBoundConnFound is true when FindByConnID returned a non-nil connection.
func TargetBoundConnFound(connFound bool) bool {
	return connFound
}

// TargetBoundConnRejected is true when the looked-up conn is missing or does not
// match user/desktop/device (historical dispatchTargetBoundTask predicate).
func TargetBoundConnRejected(connFound bool, connUserID, connDeviceType, connDeviceID, userID, deviceID string) bool {
	return !IsTargetBoundConnUsable(connFound, connUserID, connDeviceType, connDeviceID, userID, deviceID)
}

// HubRelayCreateSucceeded is true when relay.CreateCommand returned no error.
func HubRelayCreateSucceeded(err error) bool {
	return err == nil
}

// CapabilityTokenMintSucceeded is true when jwtutil.IssueCapabilityToken returned no error.
func CapabilityTokenMintSucceeded(err error) bool {
	return err == nil
}
