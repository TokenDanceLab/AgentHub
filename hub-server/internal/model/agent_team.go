package model

import (
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/pkg/uuidv7"
)

// AgentTeam represents a product-level team of AI agents.
type AgentTeam struct {
	ID          string    `gorm:"primaryKey;type:uuid" json:"id"`
	OwnerID     string    `gorm:"type:uuid;not null" json:"owner_id"`
	Name        string    `gorm:"type:varchar(100);not null" json:"name"`
	Description string    `gorm:"type:text" json:"description,omitempty"`
	AvatarURL   string    `gorm:"type:varchar(500)" json:"avatar_url,omitempty"`
	CreatedAt   time.Time `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt   time.Time `gorm:"autoUpdateTime" json:"updated_at"`
}

func (a *AgentTeam) BeforeCreate(tx *gorm.DB) error {
	id, err := uuidv7.New()
	if err != nil {
		return err
	}
	a.ID = id
	return nil
}

func (AgentTeam) TableName() string {
	return "agent_teams"
}

// AgentTeamMember represents a member of an AgentTeam.
type AgentTeamMember struct {
	ID             string    `gorm:"primaryKey;type:uuid" json:"id"`
	TeamID         string    `gorm:"type:uuid;not null" json:"team_id"`
	AgentProfileID *string   `gorm:"type:uuid" json:"agent_profile_id,omitempty"`
	Role           string    `gorm:"type:varchar(20);not null;default:executor" json:"role"`
	Position       int       `gorm:"not null;default:0" json:"position"`
	CreatedAt      time.Time `gorm:"autoCreateTime" json:"created_at"`
}

func (a *AgentTeamMember) BeforeCreate(tx *gorm.DB) error {
	id, err := uuidv7.New()
	if err != nil {
		return err
	}
	a.ID = id
	return nil
}

func (AgentTeamMember) TableName() string {
	return "agent_team_members"
}

// AgentTeamRun status constants.
const (
	TeamRunStatusQueued    = "queued"
	TeamRunStatusRunning   = "running"
	TeamRunStatusCompleted = "completed"
	TeamRunStatusFailed    = "failed"
	TeamRunStatusCancelled = "cancelled"
)

// AgentTeamMember role constants.
const (
	TeamMemberRoleSupervisor = "supervisor"
	TeamMemberRoleExecutor   = "executor"
	TeamMemberRoleReviewer   = "reviewer"
)

// AgentTeamRun represents a single run of an AgentTeam.
type AgentTeamRun struct {
	ID             string    `gorm:"primaryKey;type:uuid" json:"id"`
	TeamID         string    `gorm:"type:uuid;not null" json:"team_id"`
	SessionID      string    `gorm:"type:uuid;not null" json:"session_id"`
	TriggerUserID  string    `gorm:"type:uuid;not null" json:"trigger_user_id"`
	TriggerMessage string    `gorm:"type:text" json:"trigger_message,omitempty"`
	Status         string    `gorm:"type:varchar(20);not null;default:queued" json:"status"`
	CreatedAt      time.Time `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt      time.Time `gorm:"autoUpdateTime" json:"updated_at"`
}

func (a *AgentTeamRun) BeforeCreate(tx *gorm.DB) error {
	id, err := uuidv7.New()
	if err != nil {
		return err
	}
	a.ID = id
	return nil
}

func (AgentTeamRun) TableName() string {
	return "agent_team_runs"
}

// TeamDetail is the response type for getting a team with its members.
type TeamDetail struct {
	*AgentTeam
	Members []AgentTeamMember `json:"members"`
}

// AssignmentType and AssignmentStatus constants.
const (
	AssignmentTypeDelegate = "delegate"
	AssignmentTypeReview   = "review"
	AssignmentTypeApprove  = "approve"
	AssignmentTypeNotify   = "notify"
)

const (
	AssignmentStatusPending    = "pending"
	AssignmentStatusDispatched = "dispatched"
	AssignmentStatusRunning    = "running"
	AssignmentStatusDone       = "done"
	AssignmentStatusFailed     = "failed"
	AssignmentStatusCancelled  = "cancelled"
)

// AgentTeamAssignment represents a structured delegation from one team member to another.
type AgentTeamAssignment struct {
	ID           string    `gorm:"primaryKey;type:uuid" json:"id"`
	TeamRunID    string    `gorm:"type:uuid;not null" json:"team_run_id"`
	FromMemberID string    `gorm:"type:uuid;not null" json:"from_member_id"`
	ToMemberID   string    `gorm:"type:uuid;not null" json:"to_member_id"`
	Type         string    `gorm:"type:varchar(20);not null;default:delegate" json:"type"`
	TaskPrompt   string    `gorm:"type:text;not null" json:"task_prompt"`
	Context      string    `gorm:"type:text" json:"context,omitempty"`
	Status       string    `gorm:"type:varchar(20);not null;default:pending" json:"status"`
	RunID        *string   `gorm:"type:uuid" json:"run_id,omitempty"`
	Result       string    `gorm:"type:text" json:"result,omitempty"`
	Depth        int       `gorm:"not null;default:0" json:"depth"`
	CreatedAt    time.Time `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt    time.Time `gorm:"autoUpdateTime" json:"updated_at"`
}

func (a *AgentTeamAssignment) BeforeCreate(tx *gorm.DB) error {
	id, err := uuidv7.New()
	if err != nil {
		return err
	}
	a.ID = id
	return nil
}

func (AgentTeamAssignment) TableName() string {
	return "agent_team_assignments"
}
