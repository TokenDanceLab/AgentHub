package repository

import (
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/model"
)

// AgentTeam CRUD

func CreateTeam(db *gorm.DB, team *model.AgentTeam) error {
	return db.Create(team).Error
}

func GetTeamByID(db *gorm.DB, id string) (*model.AgentTeam, error) {
	var t model.AgentTeam
	err := db.Where("id = ?", id).First(&t).Error
	return &t, err
}

func ListTeamsByOwner(db *gorm.DB, ownerID string) ([]model.AgentTeam, error) {
	var teams []model.AgentTeam
	err := db.Where("owner_id = ?", ownerID).Order("created_at DESC").Limit(200).Find(&teams).Error
	return teams, err
}

func ListTeamsReadableByUser(db *gorm.DB, userID string) ([]model.AgentTeam, error) {
	var teams []model.AgentTeam
	err := db.Table("agent_teams").
		Select("DISTINCT agent_teams.*").
		Joins("LEFT JOIN agent_team_members ON agent_team_members.team_id = agent_teams.id").
		Joins("LEFT JOIN custom_agents ON custom_agents.id = agent_team_members.agent_profile_id AND custom_agents.deleted_at IS NULL").
		Where("agent_teams.owner_id = ? OR custom_agents.owner_user_id = ?", userID, userID).
		Order("agent_teams.created_at DESC").
		Limit(200).
		Find(&teams).Error
	return teams, err
}

func TeamHasAgentOwnedByUser(db *gorm.DB, teamID, userID string) (bool, error) {
	var count int64
	err := db.Table("agent_team_members").
		Joins("JOIN custom_agents ON custom_agents.id = agent_team_members.agent_profile_id AND custom_agents.deleted_at IS NULL").
		Where("agent_team_members.team_id = ? AND custom_agents.owner_user_id = ?", teamID, userID).
		Count(&count).Error
	return count > 0, err
}

func UpdateTeam(db *gorm.DB, team *model.AgentTeam) error {
	return db.Save(team).Error
}

func DeleteTeam(db *gorm.DB, id string) error {
	return db.Where("id = ?", id).Delete(&model.AgentTeam{}).Error
}

// AgentTeamMember

func AddTeamMember(db *gorm.DB, member *model.AgentTeamMember) error {
	return db.Create(member).Error
}

func RemoveTeamMember(db *gorm.DB, memberID string) error {
	return db.Where("id = ?", memberID).Delete(&model.AgentTeamMember{}).Error
}

func ListTeamMembers(db *gorm.DB, teamID string) ([]model.AgentTeamMember, error) {
	var members []model.AgentTeamMember
	err := db.Where("team_id = ?", teamID).Order("position ASC, created_at ASC").Limit(200).Find(&members).Error
	return members, err
}

func GetTeamMemberByID(db *gorm.DB, memberID string) (*model.AgentTeamMember, error) {
	var m model.AgentTeamMember
	err := db.Where("id = ?", memberID).First(&m).Error
	return &m, err
}
