package dispatch

// residual.go holds pure residual helpers peeled from agent_dispatch
// (#1033 → #1056). Decision helpers, identity extractors, delivery-mark plans,
// and DTO assembly cores only — no DB / WS / cache / *Service ownership.
// Preserve #866/#999/#1000/#1009/#1031 semantics.

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

// TeamRunIdentity extracts pure team-run identity for MatchTeamContext.
// When runPresent is false both IDs are empty (short-circuit before TeamRunLoadable).
func TeamRunIdentity(runPresent bool, teamID, runID string) (teamIDOut, runIDOut string) {
	if !runPresent {
		return "", ""
	}
	return teamID, runID
}

// MapPendingTaskRedeliveryLookup maps a redelivery SELECT row onto a snapshot, or
// returns the lookup error unchanged (getPendingTaskForRedelivery).
func MapPendingTaskRedeliveryLookup(
	err error,
	id, agentInstanceID, triggeredByUserID, status, edgeDeviceID, edgeRunID, targetID string,
) (*PendingTaskSnapshot, error) {
	if err != nil {
		return nil, err
	}
	snap := MapPendingTaskRedeliveryRow(
		id, agentInstanceID, triggeredByUserID, status, edgeDeviceID, edgeRunID, targetID,
	)
	return &snap, nil
}

// EdgeHTTPClientResponsePlan is the pure post-HTTP-Do classification for
// dispatchToEdgeHTTP (run id vs non-success vs decode failure).
type EdgeHTTPClientResponsePlan struct {
	RunID      string
	NonSuccess bool
	DecodeFail bool
	DecodeErr  error
	LogMessage string
}

// PlanEdgeHTTPClientResponse classifies an Edge /v1/runs response body/status.
func PlanEdgeHTTPClientResponse(statusCode int, respBody []byte) EdgeHTTPClientResponsePlan {
	runID, nonSuccess, decodeErr := EdgeHTTPDispatchResult(statusCode, respBody)
	if nonSuccess {
		return EdgeHTTPClientResponsePlan{NonSuccess: true, LogMessage: EdgeHTTPLogNonSuccess}
	}
	if decodeErr != nil {
		return EdgeHTTPClientResponsePlan{DecodeFail: true, DecodeErr: decodeErr, LogMessage: EdgeHTTPLogDecodeFailed}
	}
	return EdgeHTTPClientResponsePlan{RunID: runID}
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

// UnboundInviterDesktopWSQueued is true when inviter-desktop PushToConn queued
// the agent_dispatch frame (live path). Mirrors RedeliveryWSPushSucceeded under
// the initial-dispatch naming so call sites stay symmetric with target-bound.
func UnboundInviterDesktopWSQueued(queued bool) bool {
	return RedeliveryWSPushSucceeded(queued)
}

// TargetBoundOfflinePushInfoLog is true when target-bound offline queue accepted
// a push that carried a non-nil prior error (route/WS failure path logs Info).
// When priorErr is nil (conn mismatch with no route err), only Error on push
// failure is emitted — historical dispatchTargetBoundTask queueTargetTask branch.
func TargetBoundOfflinePushInfoLog(priorErr error) bool {
	return priorErr != nil
}

// RepoUpdateSucceeded is true when a repository write (UpdatePendingTask*) returned no error.
func RepoUpdateSucceeded(err error) bool {
	return err == nil
}

// OfflineQueuePushSucceeded is true when PushPendingTask / PushPendingTargetTask
// returned no error (queue acceptance; not Edge receipt — #1031).
func OfflineQueuePushSucceeded(err error) bool {
	return err == nil
}

// CapabilityMintResult is the pure post-mint decision for issueRunStartCapability.
// Token is non-empty only when minting succeeded; LogFailure means warn + return "".
type CapabilityMintResult struct {
	Token      string
	LogFailure bool
}

// PlanCapabilityMintResult maps IssueCapabilityToken outcome onto token vs warn.
// On mint error LogFailure is true and Token is empty (local/dev skip path).
func PlanCapabilityMintResult(token string, err error) CapabilityMintResult {
	if !CapabilityTokenMintSucceeded(err) {
		return CapabilityMintResult{LogFailure: true}
	}
	return CapabilityMintResult{Token: token}
}

// RedispatchPrepGate is the pure dead-letter branch after PrepareRedispatchPayload.
// DeadLetter=true means redispatchDelivery should move the row and return nil.
type RedispatchPrepGate struct {
	DeadLetter bool
	Kind       string
	Unwrap     error
	LogMessage string
}

// PlanRedispatchPrepGate classifies PrepareRedispatchPayload errors for the
// historical redispatchDelivery dead-letter path. err==nil yields DeadLetter=false.
func PlanRedispatchPrepGate(err error) RedispatchPrepGate {
	if err == nil {
		return RedispatchPrepGate{}
	}
	kind, unwrap := RedispatchPrepFailure(err)
	return RedispatchPrepGate{
		DeadLetter: true,
		Kind:       kind,
		Unwrap:     unwrap,
		LogMessage: RedispatchPrepLogMessage(kind),
	}
}

// IsUnboundInviterDesktopRoute is true when post-HTTP unbound fallback is inviter desktop.
func IsUnboundInviterDesktopRoute(route RouteKind) bool {
	return route == RouteInviterDesktop
}

// TeamMatchCustomAgentID resolves the custom-agent id string passed to MatchTeamContext
// after TeamContextResolutionReady already established agent presence + binding.
func TeamMatchCustomAgentID(customAgentID *string) string {
	return CustomAgentIDValue(customAgentID)
}
