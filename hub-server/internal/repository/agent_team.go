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
	err := db.Where("owner_id = ?", ownerID).Order("created_at DESC").Find(&teams).Error
	return teams, err
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
	err := db.Where("team_id = ?", teamID).Order("position ASC, created_at ASC").Find(&members).Error
	return members, err
}

func GetTeamMemberByID(db *gorm.DB, memberID string) (*model.AgentTeamMember, error) {
	var m model.AgentTeamMember
	err := db.Where("id = ?", memberID).First(&m).Error
	return &m, err
}

// AgentTeamRun

func CreateTeamRun(db *gorm.DB, run *model.AgentTeamRun) error {
	return db.Create(run).Error
}

func GetTeamRunByID(db *gorm.DB, runID string) (*model.AgentTeamRun, error) {
	var r model.AgentTeamRun
	err := db.Where("id = ?", runID).First(&r).Error
	return &r, err
}

func ListTeamRunsByTeam(db *gorm.DB, teamID string) ([]model.AgentTeamRun, error) {
	var runs []model.AgentTeamRun
	err := db.Where("team_id = ?", teamID).Order("created_at DESC").Find(&runs).Error
	return runs, err
}

func UpdateTeamRunStatus(db *gorm.DB, runID, status string) error {
	return db.Model(&model.AgentTeamRun{}).Where("id = ?", runID).Update("status", status).Error
}
