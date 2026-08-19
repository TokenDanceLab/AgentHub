package handler

import (
	"fmt"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/agenthub/hub-server/internal/service/publicstats"
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
	statsSvc  *publicstats.PublicStatsService
	startTime time.Time
}

// NewPublicHandler creates a PublicHandler.
// startTime should be the moment App.Run was called.
func NewPublicHandler(statsSvc *publicstats.PublicStatsService, startTime time.Time) *PublicHandler {
	return &PublicHandler{statsSvc: statsSvc, startTime: startTime}
}

// Stats returns live public stats for the official website.
// GET /api/public/stats
func (h *PublicHandler) Stats(c *gin.Context) {
	raw := h.statsSvc.GetStats()

	stats := PublicStats{
		TotalUsers:    publicCountBucket(raw.TotalUsers),
		TotalAgents:   publicCountBucket(raw.TotalAgents),
		OnlineAgents:  publicCountBucket(raw.OnlineAgents),
		TotalMessages: publicCountBucket(raw.TotalMessages),
		Uptime:        publicUptimeBucket(time.Since(h.startTime)),
	}

	OK(c, stats)
}

func publicCountBucket(count int64) int64 {
	switch {
	case count <= 0:
		return 0
	case count < 100:
		return 50 // coarse mid-point for <100
	case count < 1000:
		return count / 100 * 100
	case count < 10000:
		return count / 1000 * 1000
	default:
		return count / 10000 * 10000
	}
}

func publicUptimeBucket(d time.Duration) string {
	switch {
	case d < time.Hour:
		return "<1h"
	case d < 24*time.Hour:
		return fmt.Sprintf("%dh+", int(d.Hours()))
	case d < 30*24*time.Hour:
		return fmt.Sprintf("%dd+", int(d.Hours()/24))
	default:
		return "30d+"
	}
}
