// #1162

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
	TeamID         string    `gorm:"type:uuid;not null;index:idx_team_members_team_pos,priority:1" json:"team_id"`
	AgentProfileID *string   `gorm:"type:uuid" json:"agent_profile_id,omitempty"`
	Role           string    `gorm:"type:varchar(20);not null;default:executor" json:"role"`
	Position       int       `gorm:"not null;default:0;index:idx_team_members_team_pos,priority:2" json:"position"`
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
	TeamRunStatusQueued        = "queued"
	TeamRunStatusRunning       = "running"
	TeamRunStatusPendingReview = "pending_review"
	TeamRunStatusCompleted     = "completed"
	TeamRunStatusFailed        = "failed"
	TeamRunStatusCancelled     = "cancelled"
)

// HumanReviewAction constants for POST /web/team-runs/{id}/review-decision.
const (
	ReviewActionApprove = "approve"
	ReviewActionDiscuss = "discuss"
	ReviewActionModify  = "modify"
)

// AgentTeamRun mode constants.
const (
	TeamRunModeSupervisor = "supervisor"
	TeamRunModeCompete    = "compete"
)

// CompeteMaxAgentsDefault is the default cap on parallel agents in compete mode.
const CompeteMaxAgentsDefault = 3

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
	TargetID       *string   `gorm:"type:uuid" json:"target_id,omitempty"`
	Mode           string    `gorm:"type:varchar(20);not null;default:supervisor" json:"mode"`
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
