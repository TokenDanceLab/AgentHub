package router

import (
	"time"

	"github.com/agenthub/hub-server/internal/cache"
	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/handler"
	"github.com/agenthub/hub-server/internal/middleware"
	"github.com/gin-gonic/gin"
)

func setupPairedEdgeRoutes(r *gin.Engine, auth *middleware.AuthMiddleware, cacheClient *cache.Client, h *handler.EdgeEnrollmentHandler, agent *handler.AgentHandler) {
	if h == nil {
		return
	}
	body := middleware.BodyLimit(config.DefaultRequestBodyLimit)
	timeout := middleware.Timeout(config.DefaultRequestTimeout)
	limit := func(scope string, n int, user bool) gin.HandlerFunc {
		return middleware.RateLimit(cacheClient, n, time.Minute, func(c *gin.Context) string {
			key := scope + ":" + c.ClientIP()
			if user {
				key += ":" + c.GetString("user_id")
			}
			return key
		})
	}
	enroll := r.Group("/edge/enrollments", body, timeout)
	enroll.POST("/start", limit("edge-enroll-start", 6, false), h.Start)
	enroll.POST("/exchange", limit("edge-enroll-exchange", 60, false), h.Exchange)
	web := r.Group("/web", body, timeout, auth.Handler(), auth.RequireHubSession())
	web.GET("/edge-enrollments/:code", limit("edge-enroll-confirm", 12, true), h.Preview)
	web.POST("/edge-enrollments/confirm", limit("edge-enroll-confirm", 12, true), h.Confirm)
	web.POST("/edge-devices/:device_id/revoke", h.Revoke)
	device := r.Group("/edge/device", body, h.DeviceAuth)
	device.POST("/heartbeat", timeout, h.Heartbeat)
	// Poll's 20-second contract must not inherit the normal 15-second guard.
	device.GET("/poll", middleware.Timeout(25*time.Second), h.Poll)
	device.POST("/controls/:control_id/ack", timeout, h.AckControl)
	tasks := device.Group("/tasks", timeout, h.TaskAuthorization)
	tasks.POST("/:id/ack", agent.TaskAck)
	tasks.POST("/:id/stream", agent.TaskStream)
	tasks.POST("/:id/done", agent.TaskDone)
	tasks.POST("/:id/fail", agent.TaskFail)
}
