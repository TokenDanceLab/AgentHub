package service

import (
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/hub-server/internal/service/dispatch"
)

func (s *DispatchService) resolveDispatchTeamContext(ai *model.AgentInstance) dispatchTeamContext {
	var rawCustomAgentID *string
	if ai != nil {
		rawCustomAgentID = ai.CustomAgentID
	}
	customAgentID := dispatch.CustomAgentIDFromAgentPresence(ai != nil, rawCustomAgentID)
	if !dispatch.TeamContextResolutionReady(s != nil, s != nil && s.db != nil, ai != nil, customAgentID) {
		return dispatch.EmptyTeamContext()
	}
	run, err := repository.GetTeamRunBySessionID(s.db, ai.SessionID)
	var rawRunID string
	if run != nil {
		rawRunID = run.ID
	}
	runID := dispatch.TeamRunIDValue(run != nil, rawRunID)
	if !dispatch.TeamRunLoadable(err, run != nil, runID) {
		return dispatch.EmptyTeamContext()
	}
	members, err := repository.ListTeamMembers(s.db, run.TeamID)
	if !dispatch.TeamMembersPresent(err) {
		return dispatch.EmptyTeamContext()
	}
	return dispatch.MatchTeamContext(run.TeamID, runID, dispatch.TeamMatchCustomAgentID(customAgentID), dispatch.TeamMemberRefsFromMembers(members))
}

// loadThreadHistory loads recent thread messages (before the trigger message) for context continuity.
// Limits to dispatch.MaxThreadHistory messages to avoid oversized dispatch payloads.
func (s *DispatchService) loadThreadHistory(sessionID, triggerMessageID string) []dispatchMessage {
	if !dispatch.HistoryLoadIDs(sessionID, triggerMessageID) {
		return nil
	}
	triggerMsg, err := repository.GetMessageByID(s.db, triggerMessageID)
	if !dispatch.HistoryTriggerMessageLoadable(err, triggerMsg != nil) {
		return nil
	}
	msgs, err := repository.GetMessagesBySession(s.db, sessionID, triggerMsg.SeqID, dispatch.MaxThreadHistory)
	if !dispatch.HistoryMessagesPresent(err, len(msgs)) {
		return nil
	}
	// Reverse to chronological order (GetMessagesBySession returns DESC) via pure mapper (#756).
	return dispatch.MapMessagesChronological(msgs, true)
}

// loadPinnedMessages loads pinned messages for a session for context continuity.
func (s *DispatchService) loadPinnedMessages(sessionID string) []dispatchMessage {
	if !dispatch.ShouldLoadPinnedMessages(sessionID) {
		return nil
	}
	pins, err := repository.ListPinsBySession(s.db, sessionID)
	if !dispatch.PinnedRowsPresent(err, len(pins)) {
		return nil
	}
	messageIDs := dispatch.PinMessageIDsFromModels(pins)
	msgs, err := repository.GetMessagesByIDs(s.db, messageIDs)
	if !dispatch.PinMessagesLoadable(err) {
		return nil
	}
	return dispatch.MapPinnedMessages(msgs)
}

// dispatchTargetBoundTask routes a target-bound task. Returns true when a live
// WS push was queued (caller may MarkDeliverySent). Offline queue acceptance
