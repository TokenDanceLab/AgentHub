package handler

import (
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/model"
)

// PublicStats is the response body for GET /api/public/stats.
type PublicStats struct {
	TotalUsers    int64  `json:"totalUsers"`
	TotalAgents   int64  `json:"totalAgents"`
	OnlineAgents  int64  `json:"onlineAgents"`
	TotalMessages int64  `json:"totalMessages"`
	Uptime        string `json:"uptime"`
}

// PublicHandler serves unauthenticated public endpoints for the website.
type PublicHandler struct {
	db        *gorm.DB
	startTime time.Time
}

// NewPublicHandler creates a PublicHandler.
// startTime should be the moment App.Run was called.
func NewPublicHandler(db *gorm.DB, startTime time.Time) *PublicHandler {
	return &PublicHandler{db: db, startTime: startTime}
}

// Stats returns live public stats for the official website.
// GET /api/public/stats
func (h *PublicHandler) Stats(c *gin.Context) {
	var stats PublicStats

	// Total registered users
	h.db.Model(&model.User{}).Count(&stats.TotalUsers)

	// Total agent instances ever created
	h.db.Model(&model.AgentInstance{}).Count(&stats.TotalAgents)

	// Online agents: distinct agent instances with an active task
	h.db.Model(&model.PendingAgentTask{}).
		Where("status IN ?", []string{model.TaskStatusRunning, model.TaskStatusDispatched}).
		Distinct("agent_instance_id").
		Count(&stats.OnlineAgents)

	// Total messages
	h.db.Model(&model.Message{}).Count(&stats.TotalMessages)

	// Uptime
	stats.Uptime = time.Since(h.startTime).Truncate(time.Second).String()

	c.JSON(200, gin.H{
		"status": "ok",
		"data":   stats,
	})
}
