package router

import (
	"time"

	"github.com/gin-gonic/gin"

	"github.com/agenthub/hub-server/internal/cache"
	"github.com/agenthub/hub-server/internal/handler"
	"github.com/agenthub/hub-server/internal/middleware"
)

func SetupRoutes(r *gin.Engine, jwtSecret string, cacheClient *cache.Client, authHandler *handler.AuthHandler, wsHandler *handler.WebSocketHandler, deviceHandler *handler.DeviceHandler, contactHandler *handler.ContactHandler, sessionHandler *handler.SessionHandler, messageHandler *handler.MessageHandler, agentHandler *handler.AgentHandler, customAgentHandler *handler.CustomAgentHandler, attachmentHandler *handler.AttachmentHandler, notificationHandler *handler.NotificationHandler) {
	r.Use(middleware.AccessLog())
	r.Use(middleware.PrometheusMiddleware())
	r.Use(middleware.Timeout(15 * time.Second))

	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	client := r.Group("/client")
	{
		client.GET("/ws", wsHandler.ServeWS)

		auth := client.Group("/auth")
		{
			auth.POST("/register", middleware.RateLimit(cacheClient, 3, time.Minute, middleware.IPKey), authHandler.Register)
			auth.POST("/login", middleware.RateLimit(cacheClient, 5, time.Minute, middleware.IPKey), authHandler.Login)
			auth.POST("/refresh", authHandler.Refresh)
		}

		authProtected := client.Group("/auth")
		authProtected.Use(middleware.AuthMiddleware(jwtSecret))
		{
			authProtected.POST("/logout", authHandler.Logout)
			authProtected.GET("/me", authHandler.Me)
			authProtected.PUT("/profile", authHandler.UpdateProfile)
			authProtected.PUT("/password", authHandler.ChangePassword)
		}

		contacts := client.Group("/contacts")
		contacts.Use(middleware.AuthMiddleware(jwtSecret))
		{
			contacts.GET("/search", contactHandler.SearchUser)
			contacts.GET("/friend-requests", contactHandler.ListFriendRequests)
			contacts.POST("/friend-requests", contactHandler.SendFriendRequest)
			contacts.POST("/friend-requests/:id/accept", contactHandler.AcceptFriendRequest)
			contacts.POST("/friend-requests/:id/reject", contactHandler.RejectFriendRequest)
			contacts.GET("", contactHandler.ListContacts)
			contacts.DELETE("/:user_id", contactHandler.RemoveContact)
			contacts.POST("/:user_id/block", contactHandler.BlockContact)
			contacts.POST("/:user_id/unblock", contactHandler.UnblockContact)
			contacts.PUT("/:user_id/remark", contactHandler.UpdateRemark)
		}

		sessions := client.Group("/sessions")
		sessions.Use(middleware.AuthMiddleware(jwtSecret))
		{
			sessions.GET("", sessionHandler.List)
			sessions.POST("/private", sessionHandler.CreatePrivate)
			sessions.POST("/group", sessionHandler.CreateGroup)
			sessions.POST("/:id/members", sessionHandler.AddMembers)
			sessions.DELETE("/:id/members/:user_id", sessionHandler.RemoveMember)
			sessions.POST("/:id/leave", sessionHandler.Leave)
			sessions.POST("/:id/transfer-owner", sessionHandler.TransferOwner)
			sessions.POST("/:id/dissolve", sessionHandler.Dissolve)
			sessions.PUT("/:id/info", sessionHandler.UpdateGroupInfo)
			sessions.PUT("/:id/settings", sessionHandler.UpdateMemberSettings)
			sessions.DELETE("/:id", sessionHandler.DeleteForMe)

			sessions.POST("/:id/messages", messageHandler.SendMessage)
			sessions.GET("/:id/messages", messageHandler.GetMessages)
			sessions.GET("/:id/messages/sync", messageHandler.GetIncrementalMessages)

			sessions.GET("/:id/pins", messageHandler.ListPins)
			sessions.POST("/:id/read", messageHandler.MarkRead)

			sessions.POST("/:id/agents", agentHandler.AddAgentToSession)

			sessions.GET("/:id/messages/search", messageHandler.SearchSessionMessages)
			sessions.GET("/search", sessionHandler.SearchSessions)
		}

		messages := client.Group("/messages")
		messages.Use(middleware.AuthMiddleware(jwtSecret))
		{
			messages.POST("/:id/recall", messageHandler.RecallMessage)
			messages.POST("/:id/pin", messageHandler.PinMessage)
			messages.DELETE("/:id/pin", messageHandler.UnpinMessage)
			messages.POST("/:id/forward", messageHandler.ForwardMessage)
			messages.GET("/search", messageHandler.SearchMessages)
		}

		attachments := client.Group("/attachments")
		attachments.Use(middleware.AuthMiddleware(jwtSecret))
		{
			attachments.POST("/probe", attachmentHandler.Probe)
			attachments.POST("", middleware.Timeout(30*time.Second), attachmentHandler.Upload)
			attachments.GET("/:id", attachmentHandler.Download)
		}

		notifications := client.Group("/notifications")
		notifications.Use(middleware.AuthMiddleware(jwtSecret))
		{
			notifications.GET("", notificationHandler.ListNotifications)
			notifications.POST("/:id/read", notificationHandler.MarkRead)
			notifications.POST("/read-all", notificationHandler.ReadAll)
		}
	}

	edge := r.Group("/edge")
	edge.Use(middleware.AuthMiddleware(jwtSecret))
	edge.Use(middleware.DeviceTypeCheck("desktop"))
	{
		edge.POST("/devices/register", deviceHandler.Register)
		edge.POST("/agent-tasks/:id/ack", agentHandler.TaskAck)
		edge.POST("/agent-tasks/:id/stream", agentHandler.TaskStream)
		edge.POST("/agent-tasks/:id/done", agentHandler.TaskDone)
		edge.POST("/agent-tasks/:id/fail", agentHandler.TaskFail)
	}

	web := r.Group("/web")
	web.Use(middleware.AuthMiddleware(jwtSecret))
	web.Use(middleware.DeviceTypeCheck("web"))
	{
		web.POST("/agent-tasks", agentHandler.TriggerTask)
		web.POST("/agent-tasks/:id/cancel", agentHandler.CancelTask)
		web.GET("/custom-agents", customAgentHandler.List)
		web.POST("/custom-agents", customAgentHandler.Create)
		web.PUT("/custom-agents/:id", customAgentHandler.Update)
		web.DELETE("/custom-agents/:id", customAgentHandler.Delete)
	}
}
