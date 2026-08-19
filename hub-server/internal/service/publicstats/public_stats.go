package publicstats

import (
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/model"
)

// PublicStats is the response body for public stats queries.
type PublicStats struct {
	TotalUsers    int64 `json:"totalUsers"`
	TotalAgents   int64 `json:"totalAgents"`
	OnlineAgents  int64 `json:"onlineAgents"`
	TotalMessages int64 `json:"totalMessages"`
}

// PublicStatsService provides public-facing statistics without exposing raw DB access
// to the handler layer.
type PublicStatsService struct {
	db *gorm.DB
}

// NewPublicStatsService creates a PublicStatsService backed by the given DB handle.
func NewPublicStatsService(db *gorm.DB) *PublicStatsService {
	return &PublicStatsService{db: db}
}

// GetStats returns raw (un-rounded) counts for users, agents, online agents, and messages.
// The handler is responsible for applying privacy-preserving bucketing.
func (s *PublicStatsService) GetStats() PublicStats {
	var stats PublicStats

	// Total registered users
	s.db.Model(&model.User{}).Count(&stats.TotalUsers)

	// Total agent instances ever created
	s.db.Model(&model.AgentInstance{}).Count(&stats.TotalAgents)

	// Online agents: distinct agent instances with an active task
	s.db.Model(&model.PendingAgentTask{}).
		Where("status IN ?", []string{model.TaskStatusRunning, model.TaskStatusDispatched}).
		Distinct("agent_instance_id").
		Count(&stats.OnlineAgents)

	// Total messages
	s.db.Model(&model.Message{}).Count(&stats.TotalMessages)

	return stats
}
