package dispatchsvc

import (
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/hub-server/internal/service/dispatch"
)

func (s *DispatchService) resolveDispatchTeamContext(ai *model.AgentInstance) dispatchTeamContext {
	var customAgentID *string
	if ai != nil {
		customAgentID = ai.CustomAgentID
	}
	if s == nil || s.db == nil || ai == nil || dispatch.CustomAgentIDValue(customAgentID) == "" {
		return dispatch.TeamContext{}
	}
	run, err := repository.GetTeamRunBySessionID(s.db, ai.SessionID)
	var runID string
	if run != nil {
		runID = run.ID
	}
	if err != nil || run == nil || runID == "" {
		return dispatch.TeamContext{}
	}
	members, err := repository.ListTeamMembers(s.db, run.TeamID)
	if err != nil {
		return dispatch.TeamContext{}
	}
	return dispatch.MatchTeamContext(run.TeamID, runID, dispatch.CustomAgentIDValue(customAgentID), dispatch.TeamMemberRefsFromMembers(members))
}

// loadThreadHistory loads recent thread messages (before the trigger message) for context continuity.
// Limits to dispatch.MaxThreadHistory messages to avoid oversized dispatch payloads.
func (s *DispatchService) loadThreadHistory(sessionID, triggerMessageID string) []dispatchMessage {
	if sessionID == "" || triggerMessageID == "" {
		return nil
	}
	triggerMsg, err := repository.GetMessageByID(s.db, triggerMessageID)
	if err != nil || triggerMsg == nil {
		return nil
	}
	msgs, err := repository.GetMessagesBySession(s.db, sessionID, triggerMsg.SeqID, dispatch.MaxThreadHistory)
	if err != nil || len(msgs) == 0 {
		return nil
	}
	// Reverse to chronological order (GetMessagesBySession returns DESC) via pure mapper (#756).
	return dispatch.MapMessagesChronological(msgs, true)
}

// loadPinnedMessages loads pinned messages for a session for context continuity.
func (s *DispatchService) loadPinnedMessages(sessionID string) []dispatchMessage {
	if sessionID == "" {
		return nil
	}
	pins, err := repository.ListPinsBySession(s.db, sessionID)
	if err != nil || len(pins) == 0 {
		return nil
	}
	messageIDs := dispatch.PinMessageIDsFromModels(pins)
	msgs, err := repository.GetMessagesByIDs(s.db, messageIDs)
	if err != nil {
		return nil
	}
	return dispatch.MapPinnedMessages(msgs)
}

// dispatchTargetBoundTask routes a target-bound task. Returns true when a live
// WS push was queued (caller may MarkDeliverySent). Offline queue acceptance
