package repository

import (
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/model"
)

// AgentTeamArtifact

func ReplaceTeamArtifactsForRun(db *gorm.DB, teamRunID string, artifacts []model.AgentTeamArtifact) error {
	return db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("team_run_id = ?", teamRunID).Delete(&model.AgentTeamArtifact{}).Error; err != nil {
			return err
		}
		if len(artifacts) == 0 {
			return nil
		}
		return tx.Create(&artifacts).Error
	})
}

func ListTeamArtifactsByRun(db *gorm.DB, teamRunID string) ([]model.AgentTeamArtifact, error) {
	var artifacts []model.AgentTeamArtifact
	err := db.Where("team_run_id = ?", teamRunID).Order("created_at ASC, id ASC").Limit(500).Find(&artifacts).Error
	return artifacts, err
}
