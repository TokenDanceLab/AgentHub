package model

const (
	AgentControlKindPermissionDecide = "permission.decide"
)

// AgentControlPayload is a Hub-to-Desktop/Edge control command. It is delivered
// over the agent.control WebSocket frame and is scoped to one Edge device.
type AgentControlPayload struct {
	Kind         string                   `json:"kind"`
	AgentTaskID  string                   `json:"agent_task_id,omitempty"`
	TargetID     string                   `json:"target_id,omitempty"`
	EdgeDeviceID string                   `json:"edge_device_id,omitempty"`
	TeamID       string                   `json:"team_id,omitempty"`
	TeamRunID    string                   `json:"team_run_id,omitempty"`
	TeamTaskID   string                   `json:"team_task_id,omitempty"`
	AssignmentID string                   `json:"assignment_id,omitempty"`
	MemberID     string                   `json:"member_id,omitempty"`
	ApprovalID   string                   `json:"approval_id,omitempty"`
	EdgeControl  *TeamApprovalEdgeControl `json:"edge_control,omitempty"`
}
