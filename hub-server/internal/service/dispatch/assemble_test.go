package dispatch

import (
	"encoding/json"
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
)

func TestAssembleDispatchPayload(t *testing.T) {
	schema := json.RawMessage(`{"type":"object"}`)
	msgs := []Message{{Role: "user", Content: "hi", Timestamp: "2026-01-01T00:00:00Z"}}
	pins := []Message{{Role: "assistant", Content: "pin", Timestamp: "2026-01-01T00:01:00Z"}}

	p := AssembleDispatchPayload(AssemblePayloadInput{
		TaskID:           "task-1",
		AgentInstanceID:  "ai-1",
		AgentType:        "claude",
		TargetID:         "t1",
		EdgeDeviceID:     "d1",
		SessionID:        "s1",
		TriggerMessageID: "m1",
		TriggerUserID:    "u1",
		Prompt:           "hello",
		DisplayName:      "Bot",
		CustomAgentID:    "ca-1",
		CustomFields: &CustomAgentFields{
			SystemPrompt:  "sys",
			ModelParams:   `{"model":"x"}`,
			ToolWhitelist: `["bash"]`,
			OutputSchema:  &schema,
		},
		ModelParams:    `{"reasoning_effort":"high"}`,
		Team:           TeamContext{TeamID: "team", TeamRunID: "run", TeamMemberID: "mem", TeamMemberRole: "lead"},
		Messages:       msgs,
		PinnedMessages: pins,
	})

	assert.Equal(t, "task-1", p.TaskID)
	assert.Equal(t, "claude-code", p.AgentType)
	assert.Equal(t, "ca-1", p.CustomAgentID)
	assert.Equal(t, "sys", p.SystemPrompt)
	assert.Equal(t, `["bash"]`, p.ToolWhitelist)
	require.NotNil(t, p.OutputSchema)
	var got map[string]any
	require.NoError(t, json.Unmarshal([]byte(p.ModelParams), &got))
	assert.Equal(t, "x", got["model"])
	assert.Equal(t, "high", got["reasoning_effort"])
	assert.Equal(t, "team", p.TeamID)
	assert.Equal(t, "run", p.TeamRunID)
	assert.Equal(t, msgs, p.Messages)
	assert.Equal(t, pins, p.PinnedMessages)

	// empty custom agent id skips profile
	p2 := AssembleDispatchPayload(AssemblePayloadInput{
		TaskID: "t", AgentInstanceID: "ai", AgentType: "codex",
		SessionID: "s", TriggerMessageID: "m", TriggerUserID: "u",
		Prompt: "p", DisplayName: "n",
		CustomFields: &CustomAgentFields{SystemPrompt: "should-skip"},
	})
	assert.Equal(t, "", p2.CustomAgentID)
	assert.Equal(t, "", p2.SystemPrompt)
}

func TestFinalizeAfterDeliveryRecord(t *testing.T) {
	p := NewPayload("task", "ai", "claude-code", "", "", "s", "m", "u", "prompt", "n")
	got, body := FinalizeAfterDeliveryRecord(p, "del-1")
	assert.Equal(t, "del-1", got.DeliveryID)
	assert.Equal(t, "", p.DeliveryID)
	want, err := MarshalWithDeliveryID(p, "del-1")
	require.NoError(t, err)
	assert.JSONEq(t, string(want), string(body))
}

func TestMarshalPayload(t *testing.T) {
	p := NewPayload("task", "ai", "claude-code", "", "", "s", "m", "u", "prompt", "n")
	raw, err := MarshalPayload(p)
	require.NoError(t, err)
	var decoded Payload
	require.NoError(t, json.Unmarshal(raw, &decoded))
	assert.Equal(t, "task", decoded.TaskID)
}

func TestHistoryAndTeamGuards(t *testing.T) {
	assert.True(t, HistoryLoadIDs("s", "m"))
	assert.False(t, HistoryLoadIDs("", "m"))
	assert.False(t, HistoryLoadIDs("s", ""))
	assert.True(t, ShouldLoadPinnedMessages("s"))
	assert.False(t, ShouldLoadPinnedMessages(""))

	ca := "ca-1"
	assert.True(t, ShouldResolveTeamContext(&ca))
	assert.False(t, ShouldResolveTeamContext(nil))
	assert.True(t, TeamContextFromRun("run-1"))
	assert.False(t, TeamContextFromRun(""))
}

func TestPreDeviceTargetValidation(t *testing.T) {
	require.NoError(t, PreDeviceTargetValidation("u1", "u1", LocalEdgeTargetType, "online"))
	require.ErrorIs(t, PreDeviceTargetValidation("u2", "u1", LocalEdgeTargetType, "online"), errcode.TargetNotFound)
	require.Error(t, PreDeviceTargetValidation("u1", "u1", "hub_relay", "online"))
	require.Error(t, PreDeviceTargetValidation("u1", "u1", LocalEdgeTargetType, "offline"))

	err := DeviceMissingNotRoutable()
	require.Error(t, err)
	assert.Contains(t, err.Error(), DeviceNotRoutableErrorMessage)
	require.NoError(t, PostDeviceTargetValidation("u1", "u1", DesktopDeviceType))
	require.Error(t, PostDeviceTargetValidation("u1", "u2", DesktopDeviceType))
}

func TestRedispatchPrepFailure(t *testing.T) {
	kind, unwrap := RedispatchPrepFailure(nil)
	assert.Equal(t, "", kind)
	assert.Nil(t, unwrap)

	prep := &PayloadPrepError{Kind: DeadLetterKindPayloadMarshal, Err: errors.New("boom")}
	kind, unwrap = RedispatchPrepFailure(prep)
	assert.Equal(t, DeadLetterKindPayloadMarshal, kind)
	assert.EqualError(t, unwrap, "boom")
	assert.True(t, IsPayloadMarshalDeadLetter(kind))
	assert.False(t, IsPayloadMarshalDeadLetter(DeadLetterKindPayloadUnmarshal))

	kind, unwrap = RedispatchPrepFailure(errors.New("raw"))
	assert.Equal(t, DeadLetterKindPayloadUnmarshal, kind)
	assert.EqualError(t, unwrap, "raw")
}

func TestObserveRedeliveryConnAndOfflineKind(t *testing.T) {
	facts := ObserveRedeliveryConn(false, "u1", "u1")
	assert.False(t, facts.ConnFound)
	assert.False(t, facts.ConnUserMatch)

	facts = ObserveRedeliveryConn(true, "u1", "u1")
	assert.True(t, facts.ConnFound)
	assert.True(t, facts.ConnUserMatch)

	facts = ObserveRedeliveryConn(true, "u1", "u2")
	assert.True(t, facts.ConnFound)
	assert.False(t, facts.ConnUserMatch)

	assert.Equal(t, "offline", RedeliveryOfflineLogKind(true))
	assert.Equal(t, "fallback", RedeliveryOfflineLogKind(false))
}

func TestDeliveryMarkAndCapabilityGuards(t *testing.T) {
	assert.True(t, DeliveryMarkAfterDispatch("del-1"))
	assert.False(t, DeliveryMarkAfterDispatch(""))
	assert.False(t, DeliveryMarkAfterOfflineQueue("del-1"), "offline accept must not mark sent (#1031)")
	assert.False(t, DeliveryMarkAfterOfflineQueue(""))

	assert.True(t, ShouldReplayOfflinePayload("", "sent", true), "legacy empty delivery_id replays")
	assert.True(t, ShouldReplayOfflinePayload("del-1", "pending", true))
	assert.True(t, ShouldReplayOfflinePayload("del-1", "retrying", true))
	assert.True(t, ShouldReplayOfflinePayload("del-1", "sent", true), "alive sent rows must replay on reconnect")
	assert.False(t, ShouldReplayOfflinePayload("del-1", "delivered", true))
	assert.False(t, ShouldReplayOfflinePayload("del-1", "dead", true))
	assert.True(t, ShouldReplayOfflinePayload("del-1", "sent", false), "lookup failure fails open")

	assert.True(t, IsHTTPEdgeDispatchSuccess("run-1"))
	assert.False(t, IsHTTPEdgeDispatchSuccess(""))
	assert.True(t, ShouldIssueCapabilityToken(CapabilityMintResolved{Ok: true}))
	assert.False(t, ShouldIssueCapabilityToken(CapabilityMintResolved{}))

	// smoke: queued pending task still builds
	_ = model.TaskStatusQueued
}

func TestResidual1033Helpers(t *testing.T) {
	// Delivery-mark plans preserve #1031 offline ownership vs live mark.
	assert.True(t, PlanLiveDispatchMark("del-1"))
	assert.False(t, PlanLiveDispatchMark(""))
	assert.False(t, PlanOfflineDispatchMark("del-1"))
	assert.False(t, PlanOfflineDispatchMark(""))
	assert.True(t, PlanTargetBoundDeliveryMark(true, "del-1"))
	assert.False(t, PlanTargetBoundDeliveryMark(false, "del-1"), "target-bound offline keeps outbox pending")
	assert.False(t, PlanTargetBoundDeliveryMark(true, ""))
	assert.True(t, PlanUnboundInviterDesktopMark(true, "del-1"))
	assert.False(t, PlanUnboundInviterDesktopMark(false, "del-1"))

	// Identity extractors.
	ca := "ca-1"
	assert.Nil(t, CustomAgentIDFromAgentPresence(false, &ca))
	assert.Equal(t, &ca, CustomAgentIDFromAgentPresence(true, &ca))
	assert.Equal(t, "run-1", TeamRunIDValue(true, "run-1"))
	assert.Equal(t, "", TeamRunIDValue(false, "run-1"))
	assert.Equal(t, "", TaskStatusOrEmpty(nil))
	snap := NewPendingTaskSnapshot("id", "ai", "u", "queued", "d", "r", "t")
	assert.Equal(t, "queued", TaskStatusOrEmpty(&snap))

	assert.True(t, OutboxRecordSucceeded(nil))
	assert.False(t, OutboxRecordSucceeded(errors.New("x")))
	assert.True(t, HubRelayCreateSucceeded(nil))
	assert.False(t, HubRelayCreateSucceeded(errors.New("x")))
	assert.True(t, CapabilityTokenMintSucceeded(nil))
	assert.False(t, CapabilityTokenMintSucceeded(errors.New("x")))
	assert.True(t, RedeliveryPreferDeviceRoute("d1"))
	assert.False(t, RedeliveryPreferDeviceRoute(""))
	assert.True(t, TargetBoundConnFound(true))
	assert.False(t, TargetBoundConnFound(false))
	assert.False(t, TargetBoundConnRejected(true, "u1", DesktopDeviceType, "d1", "u1", "d1"))
	assert.True(t, TargetBoundConnRejected(false, "u1", DesktopDeviceType, "d1", "u1", "d1"))
	assert.True(t, TargetBoundConnRejected(true, "u2", DesktopDeviceType, "d1", "u1", "d1"))

	in := AssembleInputCore(
		"task-1", "ai-1", "claude", "t1", "d1", "s1",
		"m1", "u1", "hi", "Bot", "ca-1",
		&CustomAgentFields{SystemPrompt: "sys"},
		`{"model":"x"}`,
		TeamContext{TeamID: "team", TeamRunID: "run"},
		[]Message{{Role: "user", Content: "hi"}},
		[]Message{{Role: "assistant", Content: "pin"}},
	)
	assert.Equal(t, "task-1", in.TaskID)
	assert.Equal(t, "ca-1", in.CustomAgentID)
	assert.Equal(t, "sys", in.CustomFields.SystemPrompt)
	assert.Equal(t, "team", in.Team.TeamID)
	require.Len(t, in.Messages, 1)
	require.Len(t, in.PinnedMessages, 1)
}

func TestResidual1056Helpers(t *testing.T) {
	// Team-run identity extractors (#1056).
	teamID, runID := TeamRunIdentity(true, "team-1", "run-1")
	assert.Equal(t, "team-1", teamID)
	assert.Equal(t, "run-1", runID)
	teamID, runID = TeamRunIdentity(false, "team-1", "run-1")
	assert.Equal(t, "", teamID)
	assert.Equal(t, "", runID)

	ca := "ca-1"
	assert.Equal(t, "ca-1", TeamMatchCustomAgentID(&ca))
	assert.Equal(t, "", TeamMatchCustomAgentID(nil))

	// Repo / offline / WS residual predicates — #1031 offline still never marks sent.
	assert.True(t, RepoUpdateSucceeded(nil))
	assert.False(t, RepoUpdateSucceeded(errors.New("db")))
	assert.True(t, OfflineQueuePushSucceeded(nil))
	assert.False(t, OfflineQueuePushSucceeded(errors.New("redis")))
	assert.True(t, UnboundInviterDesktopWSQueued(true))
	assert.False(t, UnboundInviterDesktopWSQueued(false))
	assert.True(t, TargetBoundOfflinePushInfoLog(errors.New("route")))
	assert.False(t, TargetBoundOfflinePushInfoLog(nil))
	assert.True(t, IsUnboundInviterDesktopRoute(RouteInviterDesktop))
	assert.False(t, IsUnboundInviterDesktopRoute(RouteOffline))

	// Capability mint result plan.
	ok := PlanCapabilityMintResult("tok", nil)
	assert.Equal(t, "tok", ok.Token)
	assert.False(t, ok.LogFailure)
	fail := PlanCapabilityMintResult("tok", errors.New("mint"))
	assert.Equal(t, "", fail.Token)
	assert.True(t, fail.LogFailure)

	// Redispatch prep gate: err → dead-letter; nil → retry path.
	prepOK := PlanRedispatchPrepGate(nil)
	assert.False(t, prepOK.DeadLetter)
	prepFail := PlanRedispatchPrepGate(&PayloadPrepError{Kind: DeadLetterKindPayloadUnmarshal, Err: errors.New("bad")})
	assert.True(t, prepFail.DeadLetter)
	assert.Equal(t, DeadLetterKindPayloadUnmarshal, prepFail.Kind)
	assert.Equal(t, "failed to unmarshal delivery payload for redispatch", prepFail.LogMessage)
	require.Error(t, prepFail.Unwrap)

	// Redelivery lookup mapper.
	snap, err := MapPendingTaskRedeliveryLookup(nil, "id", "ai", "u", "queued", "d", "r", "t")
	require.NoError(t, err)
	require.NotNil(t, snap)
	assert.Equal(t, "id", snap.ID)
	assert.Equal(t, "queued", snap.Status)
	_, err = MapPendingTaskRedeliveryLookup(errors.New("missing"), "", "", "", "", "", "", "")
	require.Error(t, err)

	// Edge HTTP client response plan.
	plan := PlanEdgeHTTPClientResponse(http.StatusAccepted, []byte(`{"success":true,"data":{"runId":"run-9"}}`))
	assert.Equal(t, "run-9", plan.RunID)
	assert.False(t, plan.NonSuccess)
	assert.False(t, plan.DecodeFail)
	plan = PlanEdgeHTTPClientResponse(http.StatusBadRequest, []byte(`nope`))
	assert.True(t, plan.NonSuccess)
	assert.Equal(t, EdgeHTTPLogNonSuccess, plan.LogMessage)
	plan = PlanEdgeHTTPClientResponse(http.StatusOK, []byte(`{`))
	assert.True(t, plan.DecodeFail)
	assert.Equal(t, EdgeHTTPLogDecodeFailed, plan.LogMessage)
	require.Error(t, plan.DecodeErr)
}

func TestTriggerGuards(t *testing.T) {
	assert.Equal(t, "t1", NormalizeOptionalTargetID(" t1 "))
	assert.True(t, IsEmptyTargetID(""))
	assert.True(t, IsEmptyTargetID("  "))
	assert.False(t, IsEmptyTargetID("t1"))

	require.ErrorIs(t, TriggerSessionDissolvedError(true), errcode.SessionDissolved)
	require.NoError(t, TriggerSessionDissolvedError(false))

	require.ErrorIs(t, TriggerAgentsAvailableError(errors.New("db"), 1), errcode.AgentNotFound)
	require.ErrorIs(t, TriggerAgentsAvailableError(nil, 0), errcode.AgentNotFound)
	require.NoError(t, TriggerAgentsAvailableError(nil, 2))

	require.ErrorIs(t, TriggerMemberActiveError(nil, false), errcode.SessionNotMember)
	require.NoError(t, TriggerMemberActiveError(nil, true))
	memberCheckErr := errors.New("db down")
	require.ErrorIs(t, TriggerMemberActiveError(memberCheckErr, false), memberCheckErr)
	require.ErrorIs(t, TriggerMemberActiveError(memberCheckErr, true), memberCheckErr)
	require.NotErrorIs(t, TriggerMemberActiveError(memberCheckErr, false), errcode.SessionNotMember)

	// #1430: TurnInProgress gate — active=true → 409; other errors pass through.
	require.ErrorIs(t, TurnInProgressError(nil, true), errcode.TurnInProgress)
	require.NoError(t, TurnInProgressError(nil, false))
	turnDBErr := errors.New("db down")
	require.ErrorIs(t, TurnInProgressError(turnDBErr, false), turnDBErr)
	require.NotErrorIs(t, TurnInProgressError(turnDBErr, false), errcode.TurnInProgress)
}

func TestTargetBoundAndOutboxHelpers(t *testing.T) {
	assert.True(t, IsTargetBoundConnUsable(true, "u1", DesktopDeviceType, "d1", "u1", "d1"))
	assert.False(t, IsTargetBoundConnUsable(false, "u1", DesktopDeviceType, "d1", "u1", "d1"))
	assert.False(t, IsTargetBoundConnUsable(true, "u2", DesktopDeviceType, "d1", "u1", "d1"))
	assert.Equal(t, TargetBoundReasonRouteUnavailable, "route unavailable")
	assert.Equal(t, TargetBoundReasonConnMismatch, "connection mismatch")
	assert.Equal(t, TargetBoundReasonWSNotQueued, "websocket delivery not queued")

	err := ErrOutboxUnavailable()
	require.Error(t, err)
	assert.Equal(t, OutboxUnavailableErrorMessage, err.Error())
}

func TestEdgeHTTPPrepHelpers(t *testing.T) {
	payload := Payload{
		TaskID:       "task-1",
		DeliveryID:   "del-1",
		AgentType:    "claude-code",
		Prompt:       "hi",
		SystemPrompt: "sys",
	}
	parts, insecure, err := PrepareEdgeHTTPRequest(
		DefaultEdgeHTTPURL, "secret", payload, "cap",
	)
	require.NoError(t, err)
	assert.False(t, insecure)
	assert.Equal(t, DefaultEdgeHTTPURL+"/v1/runs", parts.RunsURL)
	assert.Equal(t, "Bearer secret", parts.Headers.Get("Authorization"))
	assert.Equal(t, "cap", parts.Headers.Get(CapabilityTokenHeader))
	assert.NotEmpty(t, parts.Body)
	assert.Equal(t, time.Duration(EdgeHTTPClientTimeoutSeconds)*time.Second, parts.Timeout)

	parts, insecure, err = PrepareEdgeHTTPRequest(
		"http://example.com:3210", "", Payload{}, "",
	)
	require.NoError(t, err)
	assert.True(t, insecure)
	assert.Equal(t, "http://example.com:3210", parts.EdgeURL)

	runID, nonSuccess, decodeErr := EdgeHTTPDispatchResult(http.StatusAccepted, []byte(`{"success":true,"data":{"runId":"run-9"}}`))
	require.NoError(t, decodeErr)
	assert.False(t, nonSuccess)
	assert.Equal(t, "run-9", runID)

	runID, nonSuccess, decodeErr = EdgeHTTPDispatchResult(http.StatusBadRequest, []byte(`nope`))
	require.NoError(t, decodeErr)
	assert.True(t, nonSuccess)
	assert.Equal(t, "", runID)

	_, nonSuccess, decodeErr = EdgeHTTPDispatchResult(http.StatusOK, []byte(`{`))
	assert.False(t, nonSuccess)
	require.Error(t, decodeErr)
}

func TestHistoryPresenceAndCancelNoRows(t *testing.T) {
	assert.True(t, HistoryTriggerMessageLoadable(nil, true))
	assert.False(t, HistoryTriggerMessageLoadable(errors.New("x"), true))
	assert.False(t, HistoryTriggerMessageLoadable(nil, false))
	assert.True(t, HistoryMessagesPresent(nil, 1))
	assert.False(t, HistoryMessagesPresent(nil, 0))
	assert.True(t, PinnedRowsPresent(nil, 2))
	assert.False(t, PinnedRowsPresent(errors.New("x"), 2))

	require.ErrorIs(t, CancelTaskNoRowsError(0), errcode.ErrBadRequest)
	require.NoError(t, CancelTaskNoRowsError(1))
}

func TestRedispatchLogHelpers(t *testing.T) {
	assert.Equal(t, "failed to marshal redispatch payload", RedispatchPrepLogMessage(DeadLetterKindPayloadMarshal))
	assert.Equal(t, "failed to unmarshal delivery payload for redispatch", RedispatchPrepLogMessage(DeadLetterKindPayloadUnmarshal))
	assert.Equal(t, "redispatch: queued to offline queue", RedispatchOfflineSuccessLogMessage(true))
	assert.Equal(t, "redispatch: queued to fallback queue", RedispatchOfflineSuccessLogMessage(false))
	assert.True(t, RedispatchOfflineSuccessIncludesUserID(true))
	assert.False(t, RedispatchOfflineSuccessIncludesUserID(false))
	assert.True(t, RedeliveryWSPushSucceeded(true))
	assert.False(t, RedeliveryWSPushSucceeded(false))
	assert.Equal(t, "redispatch: failed to push to offline queue", RedispatchOfflinePushFailedLogMessage(true))
	assert.Equal(t, "redispatch: failed to push to fallback queue", RedispatchOfflinePushFailedLogMessage(false))
	assert.Equal(t, RedispatchLogTaskLookupFailed, "redispatch: task lookup failed, marking dead-letter")
	assert.Equal(t, RedispatchLogTaskTerminal, "redispatch: task in terminal state, moving delivery to dead-letter")
	assert.Equal(t, RedispatchLogHTTPSucceeded, "redispatch: HTTP dispatch succeeded")
	assert.Equal(t, RedispatchLogWSSucceeded, "redispatch: WS dispatch succeeded")
	assert.Equal(t, RedispatchLogWSNotQueued, "redispatch: WS push not queued")
	assert.Equal(t, RedispatchLogWSFallbackSucceeded, "redispatch: WS fallback dispatch succeeded")

	in := NewCapabilityMintInput("sec", "d1", "", "u1", "t1")
	assert.Equal(t, "sec", in.JWTSecret)
	assert.Equal(t, "d1", in.PayloadDeviceID)
	assert.Equal(t, "u1", in.TriggerUserID)

	resolved := CapabilityMintFromEnv("sec", "d1", "", "u1", "t1")
	assert.True(t, resolved.Ok)
	args := CapabilityTokenArgs(resolved)
	assert.Equal(t, []byte("sec"), args.Secret)
	assert.Equal(t, "d1", args.DeviceID)
	assert.Equal(t, "u1", args.UserID)
	assert.Equal(t, LocalProjectID, args.ProjectID)
	assert.Equal(t, LocalThreadID, args.ThreadID)
	assert.Equal(t, DefaultCapabilityAction, args.Action)
}

func TestLookupErrorMappers(t *testing.T) {
	require.ErrorIs(t, MapTriggerMessageLookupError(errors.New("x")), errcode.MsgNotFound)
	require.NoError(t, MapTriggerMessageLookupError(nil))
	require.ErrorIs(t, MapSessionLookupError(errors.New("x")), errcode.SessionNotFound)
	require.NoError(t, MapSessionLookupError(nil))

	require.ErrorIs(t, MapPendingTaskLookupError(errors.New("missing"), true), errcode.AgentTaskNotFound)
	raw := errors.New("db")
	assert.Equal(t, raw, MapPendingTaskLookupError(raw, false))
	require.NoError(t, MapPendingTaskLookupError(nil, false))

	require.ErrorIs(t, MapTargetLookupError(errors.New("missing"), true), errcode.TargetNotFound)
	assert.Equal(t, raw, MapTargetLookupError(raw, false))
	require.Error(t, MapBoundDeviceLookupError(errors.New("missing"), true))
	assert.Contains(t, MapBoundDeviceLookupError(errors.New("missing"), true).Error(), DeviceNotRoutableErrorMessage)
	assert.Equal(t, raw, MapBoundDeviceLookupError(raw, false))
}

func TestPortAndTeamResidualHelpers(t *testing.T) {
	assert.True(t, OutboxPortAvailable(true, true))
	assert.False(t, OutboxPortAvailable(true, false))
	assert.False(t, OutboxPortAvailable(false, true))
	assert.True(t, BusPortAvailable(true, true))
	assert.False(t, BusPortAvailable(false, true))
	assert.True(t, ManagerPortAvailable(true))
	assert.False(t, ManagerPortAvailable(false))

	ca := "ca-1"
	assert.True(t, TeamContextResolutionReady(true, true, true, &ca))
	assert.False(t, TeamContextResolutionReady(true, true, true, nil))
	assert.False(t, TeamContextResolutionReady(false, true, true, &ca))
	assert.True(t, TeamRunLoadable(nil, true, "run-1"))
	assert.False(t, TeamRunLoadable(errors.New("x"), true, "run-1"))
	assert.False(t, TeamRunLoadable(nil, false, "run-1"))
	assert.False(t, TeamRunLoadable(nil, true, ""))
	assert.True(t, TeamMembersPresent(nil))
	assert.False(t, TeamMembersPresent(errors.New("x")))
	assert.Equal(t, TeamContext{}, EmptyTeamContext())
	assert.True(t, PinMessagesLoadable(nil))
	assert.False(t, PinMessagesLoadable(errors.New("x")))

	assert.True(t, AcceptCustomAgentPreload(nil))
	assert.False(t, AcceptCustomAgentPreload(errors.New("x")))
	assert.Nil(t, CustomAgentPreloadOrNil(errors.New("x"), &model.CustomAgent{ID: "ca"}))
	got := CustomAgentPreloadOrNil(nil, &model.CustomAgent{ID: "ca"})
	require.NotNil(t, got)
	assert.Equal(t, "ca", got.ID)

	assert.Equal(t, EdgeHTTPLogInsecureCleartext, "edge http dispatch: non-loopback URL without TLS, dispatch payloads sent in cleartext")
	assert.Equal(t, EdgeHTTPLogMarshalFailed, "edge http dispatch: failed to marshal request")
	assert.Equal(t, EdgeHTTPLogCreateReqFailed, "edge http dispatch: failed to create request")
	assert.Equal(t, EdgeHTTPLogUnreachable, "edge http dispatch: edge server unreachable")
	assert.Equal(t, EdgeHTTPLogNonSuccess, "edge http dispatch: edge returned non-success")
	assert.Equal(t, EdgeHTTPLogDecodeFailed, "edge http dispatch: failed to decode response")
	assert.Equal(t, EdgeHTTPLogDispatched, "edge http dispatch: task dispatched to local Edge")
}

func TestDispatchLogConstantsAndPorts(t *testing.T) {
	assert.Equal(t, DispatchLogOutboxRecordFailed, "AH-SR-049 delivery outbox record failed; dispatch continues without durable tracking")
	assert.Equal(t, DispatchLogHTTPMarkFailed, "failed to mark http-dispatched task")
	assert.Equal(t, DispatchLogOfflinePushConnNil, "failed to push agent task to offline queue (conn nil)")
	assert.Equal(t, DispatchLogMarkAgentDispatched, "failed to mark agent task dispatched")
	assert.Equal(t, DispatchLogWSNotQueuedPreserve, "agent task websocket dispatch not queued; preserving pending task")
	assert.Equal(t, DispatchLogPreserveAfterWSFailure, "failed to preserve agent task after websocket dispatch failure")
	assert.Equal(t, DispatchLogOfflinePushFailed, "failed to push agent task to offline queue")
	assert.Equal(t, DispatchLogMissingTargetEdgeDevice, "target-bound agent task missing edge device id")
	assert.Equal(t, DispatchLogRelayCreateFailed, "failed to create relay command for hub_relay dispatch")
	assert.Equal(t, DispatchLogRelayOfflinePushFailed, "failed to push hub_relay task to offline queue")
	assert.Equal(t, DispatchLogMarkHubRelayDispatched, "failed to mark hub_relay task dispatched")
	assert.Equal(t, DispatchLogTargetBoundOfflinePushFailed, "failed to push target-bound agent task to offline queue")
	assert.Equal(t, DispatchLogTargetBoundQueued, "queued target-bound agent task")
	assert.Equal(t, DispatchLogTargetBoundMarkFailed, "failed to mark target-bound agent task dispatched")
	assert.Equal(t, DispatchLogTargetBoundWSNotQueued, "target-bound agent task websocket dispatch not queued; preserving pending task")
	assert.Equal(t, DispatchLogPayloadMarshalFailed, "agent dispatch payload marshal failed; task not dispatched")
	assert.Equal(t, DispatchLogMarkDeliverySentFailed, "failed to mark delivery sent; outbox row stays pending")
	assert.Equal(t, CapabilityMintFailedLog, "AH-SR-046 failed to issue capability token")

	assert.True(t, RelayPortAvailable(true))
	assert.False(t, RelayPortAvailable(false))
	assert.True(t, ServiceReceiverAvailable(true))
	assert.False(t, ServiceReceiverAvailable(false))
	assert.True(t, InviterDesktopConnPresent(true))
	assert.False(t, InviterDesktopConnPresent(false))
	assert.True(t, CapabilityPayloadPresent(true))
	assert.False(t, CapabilityPayloadPresent(false))
	assert.True(t, ComposedDispatchReady(true))
	assert.False(t, ComposedDispatchReady(false))

	snap := MapPendingTaskRedeliveryRow("id", "ai", "u", "queued", "d", "r", "t")
	assert.Equal(t, "id", snap.ID)
	assert.Equal(t, "queued", snap.Status)
	assert.Equal(t, "t", snap.TargetID)
}

func TestPlanRedispatchTaskGate(t *testing.T) {
	// Lookup failure → intentional dead-letter (#999 path remains soft-fail elsewhere).
	lookupErr := errors.New("missing")
	gate := PlanRedispatchTaskGate(lookupErr, "")
	assert.Equal(t, RedispatchGateDeadLetterLookup, gate.Kind)
	assert.Equal(t, RedispatchLogTaskLookupFailed, gate.LogMessage)
	assert.Equal(t, DeadLetterReason(DeadLetterKindTaskLookup, lookupErr), gate.DeadLetterReason)

	// Running is not retryable (#1000 safety net).
	gate = PlanRedispatchTaskGate(nil, model.TaskStatusRunning)
	assert.Equal(t, RedispatchGateDeadLetterStatus, gate.Kind)
	assert.Equal(t, RedispatchLogTaskTerminal, gate.LogMessage)
	assert.Equal(t, DeadLetterTaskStatus(model.TaskStatusRunning), gate.DeadLetterReason)

	// Terminal status → dead-letter.
	gate = PlanRedispatchTaskGate(nil, model.TaskStatusDone)
	assert.Equal(t, RedispatchGateDeadLetterStatus, gate.Kind)

	// Queued / dispatched remain retryable.
	gate = PlanRedispatchTaskGate(nil, model.TaskStatusQueued)
	assert.Equal(t, RedispatchGateRetry, gate.Kind)
	assert.Empty(t, gate.LogMessage)
	gate = PlanRedispatchTaskGate(nil, model.TaskStatusDispatched)
	assert.Equal(t, RedispatchGateRetry, gate.Kind)

	// Offline soft-fail error wrapper preserves #999 wording.
	base := errors.New("redis down")
	wrapped := RedispatchOfflineQueueError(base)
	require.Error(t, wrapped)
	assert.Contains(t, wrapped.Error(), "redispatch offline queue")
	require.ErrorIs(t, wrapped, base)
	require.ErrorContains(t, wrapped, "redis down")

	attrs := RedispatchOfflineSuccessLogAttrs(true, "d1", "t1", "u1")
	assert.Equal(t, []any{"delivery_id", "d1", "task_id", "t1", "user_id", "u1"}, attrs)
	attrs = RedispatchOfflineSuccessLogAttrs(false, "d1", "t1", "u1")
	assert.Equal(t, []any{"delivery_id", "d1", "task_id", "t1"}, attrs)
}
