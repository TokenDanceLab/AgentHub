package bus

// Event type catalog (#1548): every in-process event type is a named
// constant here instead of a free string. Frame types in internal/ws mirror
// these values for the wire; message/team payloads are typed in their owning
// packages (model.Message, model.AgentRunEvent, ...).

const (
	EventTypeMessageNew         = "message.new"
	EventTypeMessageRecall      = "message.recall"
	EventTypeMessageEdited      = "message.edited"
	EventTypeMessagePin         = "message.pin"
	EventTypeMessageUnpin       = "message.unpin"
	EventTypeMessageRead        = "message.read"
	EventTypeMessageReactionAdd = "message.reaction_added"
	EventTypeMessageReactionRem = "message.reaction_removed"
	EventTypeAgentStream        = "agent.stream"
	EventTypeAgentDone          = "agent.done"
	EventTypeAgentFailed        = "agent.failed"
	EventTypeAgentTimeout       = "agent.timeout"
	EventTypeAgentCancel        = "agent.cancel"
	EventTypeAgentRegenerate    = "agent.regenerate"
	EventTypeAgentRouteDecision = "agent.route_decision"
	EventTypeTeamRunStarted     = "team.run.started"
	EventTypeTeamEvent          = "team.event"
	EventTypeTeamAssignmentDone = "team.assignment.done"
	EventTypeTeamAssignmentFail = "team.assignment.failed"
	EventTypeTeamSubagentStream = "team.subagent.stream"
	EventTypeFriendRequest      = "friend.request"
	EventTypeFriendAccepted     = "friend.accepted"
)

// AgentTaskPayload is the common shape of the agent lifecycle events
// (agent.done / agent.failed / agent.timeout / agent.cancel). Field names
// match the historical map keys so WS frame serialization is unchanged.
type AgentTaskPayload struct {
	TaskID          string `json:"task_id"`
	AgentInstanceID string `json:"agent_instance_id"`
	SessionID       string `json:"session_id"`
}

// AgentFailedPayload extends AgentTaskPayload with the failure reason.
type AgentFailedPayload struct {
	AgentTaskPayload
	Error string `json:"error"`
}

// AgentCancelPayload is the agent.cancel payload (includes the actor).
type AgentCancelPayload struct {
	AgentTaskPayload
	TriggeredBy string `json:"triggered_by"`
}

// AgentRegeneratePayload is the agent.regenerate payload.
type AgentRegeneratePayload struct {
	OriginalTaskID   string `json:"original_task_id"`
	NewTaskID        string `json:"new_task_id"`
	AgentInstanceID  string `json:"agent_instance_id"`
	SessionID        string `json:"session_id"`
	TriggerMessageID string `json:"trigger_message_id"`
}
