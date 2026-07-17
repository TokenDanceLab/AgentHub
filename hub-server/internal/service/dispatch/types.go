package dispatch

// TeamContext is the pure team-run attribution attached to a dispatch payload
// when the agent instance maps to a team member profile.
type TeamContext struct {
	TeamID         string
	TeamRunID      string
	TeamMemberID   string
	TeamMemberRole string
}

// TargetSnapshot is the pure validated execution-target routing surface used by
// TriggerAgentTask after ownership/health/device checks.
type TargetSnapshot struct {
	ID         string
	TargetType string
	DeviceID   string
}

// PendingTaskSnapshot is the minimal pending-task row used for redelivery
// routing (no GORM model dependency).
type PendingTaskSnapshot struct {
	ID                string
	AgentInstanceID   string
	TriggeredByUserID string
	Status            string
	EdgeDeviceID      string
	EdgeRunID         string
	TargetID          string
}

// EdgeRunResponse captures the relevant fields from Edge's /v1/runs response.
type EdgeRunResponse struct {
	Success bool `json:"success"`
	Data    struct {
		RunID string `json:"runId"`
	} `json:"data"`
}

// TeamMemberRef is the pure subset of a team-member row needed to match a
// custom-agent profile onto a team run context.
type TeamMemberRef struct {
	ID             string
	Role           string
	AgentProfileID *string
}
