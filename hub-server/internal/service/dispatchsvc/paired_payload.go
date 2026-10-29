package dispatchsvc

import (
	"context"
	"errors"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/hub-server/internal/service/dispatch"
	"gorm.io/gorm"
)

// Paired text conversations use Hub history, never an implicit runtime session.
// Unlike best-effort legacy dispatch, a failed history read cannot silently
// turn a second turn into a context-free model request.
func (s *DispatchService) buildPairedPayload(ctx context.Context, task *model.PendingAgentTask, ai *model.AgentInstance, prompt, modelParams string, custom *model.CustomAgent) (dispatch.Payload, error) {
	db := s.db.WithContext(ctx)
	if run, err := repository.GetTeamRunBySessionID(db, ai.SessionID); err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return dispatch.Payload{}, err
	} else if run != nil {
		return dispatch.Payload{}, errcode.ErrBadRequest.WithMessage("paired SDK target does not support Team execution")
	}
	trigger, err := repository.GetMessageByID(db, task.TriggerMessageID)
	if err != nil {
		return dispatch.Payload{}, err
	}
	messages, err := repository.GetMessagesBySession(db, ai.SessionID, trigger.SeqID, dispatch.MaxThreadHistory)
	if err != nil {
		return dispatch.Payload{}, err
	}
	pins, err := repository.ListPinsBySession(db, ai.SessionID)
	if err != nil {
		return dispatch.Payload{}, err
	}
	pinned, err := repository.GetMessagesByIDs(db, dispatch.PinMessageIDsFromModels(pins))
	if err != nil {
		return dispatch.Payload{}, err
	}
	return dispatch.AssembleDispatchPayload(dispatch.AssemblePayloadInput{
		TaskID: task.ID, AgentInstanceID: ai.ID, AgentType: ai.AgentType,
		TargetID: task.TargetID, EdgeDeviceID: task.EdgeDeviceID, SessionID: ai.SessionID,
		TriggerMessageID: task.TriggerMessageID, TriggerUserID: task.TriggeredByUserID,
		Prompt: prompt, DisplayName: ai.DisplayName, CustomAgentID: dispatch.CustomAgentIDValue(ai.CustomAgentID),
		CustomFields: dispatch.CustomAgentFieldsFromModel(custom), ModelParams: modelParams,
		Messages: dispatch.MapMessagesChronological(messages, true), PinnedMessages: dispatch.MapPinnedMessages(pinned),
	}), nil
}
