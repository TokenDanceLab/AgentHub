package router

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/agenthub/hub-server/internal/cache"
	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/handler"
	"github.com/agenthub/hub-server/internal/middleware"
	"github.com/agenthub/pkg/reqlog"
)

func SetupRoutes(r *gin.Engine, cfg *config.Config, jwtSecret string, cacheClient *cache.Client, authHandler *handler.AuthHandler, wsHandler *handler.WebSocketHandler, deviceHandler *handler.DeviceHandler, contactHandler *handler.ContactHandler, sessionHandler *handler.SessionHandler, messageHandler *handler.MessageHandler, agentHandler *handler.AgentHandler, customAgentHandler *handler.CustomAgentHandler, attachmentHandler *handler.AttachmentHandler, notificationHandler *handler.NotificationHandler, healthHandler *handler.HealthHandler, publicHandler *handler.PublicHandler, oidcHandler *handler.OIDCHandler, agentProfileHandler *handler.AgentProfileHandler, skillHandler *handler.SkillHandler, mcpHandler *handler.MCPServerHandler, marketHandler *handler.MarketHandler, pbHandler *handler.ProviderBindingHandler, targetHandler *handler.ExecutionTargetHandler, auditHandler *handler.AuditHandler, relayHandler *handler.RelayHandler, agentTeamHandler *handler.AgentTeamHandler, workspaceHandlers ...*handler.WorkspaceHandler) {
	var workspaceHandler *handler.WorkspaceHandler
	if len(workspaceHandlers) > 0 {
		workspaceHandler = workspaceHandlers[0]
	}
	corsMiddleware, err := middleware.CORS()
	if err != nil {
		panic("CORS middleware init failed: " + err.Error())
	}
	r.Use(corsMiddleware)
	r.Use(middleware.APIVersion())
	r.Use(middleware.BodyLimit(config.DefaultRequestBodyLimit))
	r.Use(middleware.GlobalRateLimit(cacheClient))
	r.Use(middleware.RequestID())
	r.Use(reqlog.AccessLogGin())
	r.Use(middleware.PrometheusMiddleware())
	r.Use(middleware.Timeout(config.DefaultRequestTimeout))
	r.NoRoute(func(c *gin.Context) {
		c.JSON(http.StatusNotFound, gin.H{
			"error": gin.H{
				"code":    "NOT_FOUND",
				"message": "route not found",
			},
		})
	})
	r.NoMethod(func(c *gin.Context) {
		c.JSON(http.StatusMethodNotAllowed, gin.H{
			"error": gin.H{
				"code":    "METHOD_NOT_ALLOWED",
				"message": "method not allowed",
			},
		})
	})

	if healthHandler != nil {
		r.GET("/health", healthHandler.Check)
	} else {
		r.GET("/health", func(c *gin.Context) {
			handler.OK(c, gin.H{"status": "ok"})
		})
	}

	// Public API — no auth required (official website hub.vectorcontrol.tech)
	if publicHandler != nil {
		public := r.Group("/api/public")
		{
			public.GET("/stats", publicHandler.Stats)
		}
	}

	client := r.Group("/client")
	{
		client.GET("/ws", middleware.WSAuthMiddleware(cfg), wsHandler.ServeWS)

		auth := client.Group("/auth")
		{
			auth.POST("/refresh", middleware.RateLimit(cacheClient, config.AuthLoginRateLimit, config.AuthRateLimitWindow, middleware.IPKey), authHandler.Refresh)

			// OIDC (TokenDance ID — the only auth entry point)
			if oidcHandler != nil {
				auth.POST("/oidc/authorize", middleware.RateLimit(cacheClient, config.AuthLoginRateLimit, config.AuthRateLimitWindow, middleware.IPKey), oidcHandler.PostOIDCAuthorize)
				auth.POST("/oidc/callback", middleware.RateLimit(cacheClient, config.AuthLoginRateLimit, config.AuthRateLimitWindow, middleware.IPKey), oidcHandler.PostOIDCCallback)
				auth.GET("/oidc/callback", oidcHandler.GetOIDCCallback)
			}
		}

		authProtected := client.Group("/auth")
		authProtected.Use(middleware.AuthMiddleware(cfg))
		authProtected.Use(middleware.RequireHubSession())
		{
			authProtected.GET("/me", authHandler.Me)
			authProtected.POST("/logout", authHandler.Logout)
			authProtected.PUT("/profile", authHandler.UpdateProfile)
		}

		contacts := client.Group("/contacts")
		contacts.Use(middleware.AuthMiddleware(cfg))
		contacts.Use(middleware.RequireHubSession())
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
		sessions.Use(middleware.AuthMiddleware(cfg))
		sessions.Use(middleware.RequireHubSession())
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
		messages.Use(middleware.AuthMiddleware(cfg))
		messages.Use(middleware.RequireHubSession())
		{
			messages.POST("/:id/recall", messageHandler.RecallMessage)
			messages.PUT("/:id", messageHandler.EditMessage)
			messages.POST("/:id/pin", messageHandler.PinMessage)
			messages.DELETE("/:id/pin", messageHandler.UnpinMessage)
			messages.POST("/:id/reactions", messageHandler.AddMessageReaction)
			messages.DELETE("/:id/reactions", messageHandler.RemoveMessageReaction)
			messages.POST("/:id/forward", messageHandler.ForwardMessage)
			messages.GET("/search", messageHandler.SearchMessages)
		}

		attachments := client.Group("/attachments")
		attachments.Use(middleware.AuthMiddleware(cfg))
		attachments.Use(middleware.RequireHubSession())
		{
			attachments.POST("/probe", attachmentHandler.Probe)
			attachments.POST("", middleware.Timeout(config.UploadRequestTimeout), attachmentHandler.Upload)
			attachments.GET("/:id", attachmentHandler.Download)
		}

		notifications := client.Group("/notifications")
		notifications.Use(middleware.AuthMiddleware(cfg))
		notifications.Use(middleware.RequireHubSession())
		{
			notifications.GET("", notificationHandler.ListNotifications)
			notifications.POST("/:id/read", notificationHandler.MarkRead)
			notifications.POST("/read-all", notificationHandler.ReadAll)
		}
	}

	edge := r.Group("/edge")
	edge.Use(middleware.AuthMiddleware(cfg))
	edge.Use(middleware.RequireHubSession())
	edge.Use(middleware.DeviceTypeCheck("desktop"))
	{
		edge.POST("/devices/register", deviceHandler.Register)
		edge.POST("/agent-tasks/:id/ack", agentHandler.TaskAck)
		edge.POST("/agent-tasks/:id/stream", agentHandler.TaskStream)
		edge.POST("/agent-tasks/:id/done", agentHandler.TaskDone)
		edge.POST("/agent-tasks/:id/fail", agentHandler.TaskFail)
	}

	// Cloud Edge registration (authenticated, no device type restriction)
	cloud := r.Group("/cloud")
	cloud.Use(middleware.AuthMiddleware(cfg))
	cloud.Use(middleware.RequireHubSession())
	{
		cloud.POST("/edge/register", deviceHandler.CloudEdgeRegister)
	}

	web := r.Group("/web")
	web.Use(middleware.AuthMiddleware(cfg))
	web.Use(middleware.RequireHubSession())
	web.Use(middleware.DeviceTypeCheck("web"))
	{
		web.POST("/agent-tasks", agentHandler.TriggerTask)
		web.POST("/agent-tasks/:id/cancel", agentHandler.CancelTask)
		web.GET("/agent-tasks/:id/summary", agentHandler.TaskEventSummary)
		web.GET("/agent-tasks/:id/events/summary", agentHandler.TaskEventSummary)
		web.GET("/agent-tasks/:id/events", agentHandler.TaskEvents)
		web.GET("/custom-agents", customAgentHandler.List)
		web.POST("/custom-agents", customAgentHandler.Create)
		web.PUT("/custom-agents/:id", customAgentHandler.Update)
		web.DELETE("/custom-agents/:id", customAgentHandler.Delete)

		// Agent Profiles (Phase 2)
		if agentProfileHandler != nil {
			web.GET("/agent-profiles", agentProfileHandler.ListProfiles)
			web.POST("/agent-profiles", agentProfileHandler.CreateProfile)
			web.GET("/agent-profiles/:id", agentProfileHandler.GetProfile)
			web.PATCH("/agent-profiles/:id", agentProfileHandler.UpdateProfile)
			web.DELETE("/agent-profiles/:id", agentProfileHandler.DeleteProfile)
			web.POST("/agent-profiles/:id/publish", middleware.RequireAdmin(), agentProfileHandler.PublishProfile)
			web.POST("/agent-profiles/:id/install", agentProfileHandler.InstallProfile)
		}

		// Skills (Phase 3)
		if skillHandler != nil {
			web.GET("/skills", skillHandler.ListSkills)
			web.POST("/skills", skillHandler.CreateSkill)
			web.GET("/skills/:id", skillHandler.GetSkill)
			web.PUT("/skills/:id", skillHandler.UpdateSkill)
			web.DELETE("/skills/:id", skillHandler.DeleteSkill)
			web.POST("/skills/:id/publish", middleware.RequireAdmin(), skillHandler.PublishSkill)
			web.POST("/skills/:id/unpublish", middleware.RequireAdmin(), skillHandler.UnpublishSkill)
		}

		// MCP Servers (Phase 3)
		if mcpHandler != nil {
			web.GET("/mcp-servers", mcpHandler.ListMCPServers)
			web.POST("/mcp-servers", mcpHandler.CreateMCPServer)
			web.GET("/mcp-servers/:id", mcpHandler.GetMCPServer)
			web.PUT("/mcp-servers/:id", mcpHandler.UpdateMCPServer)
			web.DELETE("/mcp-servers/:id", mcpHandler.DeleteMCPServer)
			web.POST("/mcp-servers/:id/publish", middleware.RequireAdmin(), mcpHandler.PublishMCPServer)
			web.POST("/mcp-servers/:id/unpublish", middleware.RequireAdmin(), mcpHandler.UnpublishMCPServer)
		}

		// Market (Phase 4)
		if marketHandler != nil {
			web.GET("/market/profiles", marketHandler.SearchMarketProfiles)
			web.GET("/market/profiles/:id", marketHandler.GetMarketProfile)
			web.POST("/market/profiles/:id/install", marketHandler.InstallMarketProfile)
			web.POST("/market/profiles/:id/rate", marketHandler.RateMarketProfile)
		}

		// Provider Bindings (Phase 4)
		if pbHandler != nil {
			web.GET("/provider-bindings", pbHandler.List)
			web.POST("/provider-bindings", pbHandler.Create)
			web.PUT("/provider-bindings/:id", pbHandler.Update)
			web.DELETE("/provider-bindings/:id", pbHandler.Delete)
		}

		// Execution Targets (Phase 5)
		if targetHandler != nil {
			web.GET("/execution-targets", targetHandler.ListTargets)
			web.POST("/execution-targets", targetHandler.CreateTarget)
			web.GET("/execution-targets/:id", targetHandler.GetTarget)
			web.PATCH("/execution-targets/:id", targetHandler.UpdateTarget)
			web.DELETE("/execution-targets/:id", targetHandler.DeleteTarget)
			web.POST("/execution-targets/:id/ping", targetHandler.PingTarget)
		}

		// Projects backed by Hub workspaces
		if workspaceHandler != nil {
			web.GET("/projects", workspaceHandler.ListWorkspaces)
			web.POST("/projects", workspaceHandler.CreateWorkspace)
			web.GET("/projects/:id", workspaceHandler.GetWorkspace)
			web.PATCH("/projects/:id", workspaceHandler.UpdateWorkspace)
		}

		// Audit Events (Phase 6)
		if auditHandler != nil {
			web.GET("/audit-events", middleware.RequireAdmin(), auditHandler.ListAuditEvents)
		}

		// Relay Commands
		if relayHandler != nil {
			web.POST("/relay/commands", middleware.RequireAdmin(), relayHandler.CreateCommand)
			web.GET("/relay/commands/:id", middleware.RequireAdmin(), relayHandler.GetCommand)
			web.POST("/relay/commands/:id/ack", middleware.RequireAdmin(), relayHandler.AckCommand)
		}

		// Devices
		web.GET("/devices", deviceHandler.ListDevices)

		// Agent Teams
		if agentTeamHandler != nil {
			web.POST("/agent-teams", agentTeamHandler.CreateTeam)
			web.GET("/agent-teams", agentTeamHandler.ListTeams)
			web.GET("/agent-teams/:id", agentTeamHandler.GetTeam)
			web.PUT("/agent-teams/:id", agentTeamHandler.UpdateTeam)
			web.DELETE("/agent-teams/:id", agentTeamHandler.DeleteTeam)
			web.POST("/agent-teams/:id/members", agentTeamHandler.AddMember)
			web.DELETE("/agent-teams/:id/members/:member_id", agentTeamHandler.RemoveMember)
			web.POST("/agent-teams/:id/runs", agentTeamHandler.StartRun)
			web.GET("/agent-teams/:id/runs", agentTeamHandler.ListRuns)
			web.GET("/agent-teams/:id/runs/:run_id", agentTeamHandler.GetRun)
			web.GET("/agent-teams/:id/runs/:run_id/state", agentTeamHandler.GetRunState)
			web.GET("/agent-teams/:id/runs/:run_id/tasks", agentTeamHandler.ListTeamTasks)
			web.GET("/agent-teams/:id/runs/:run_id/events", agentTeamHandler.ListTeamEvents)
			web.POST("/agent-teams/:id/runs/:run_id/route-decisions", agentTeamHandler.HandleRouteDecision)
			web.POST("/agent-teams/:id/runs/:run_id/approvals/:approval_id/decide", agentTeamHandler.DecideApproval)
			web.POST("/agent-teams/:id/runs/:run_id/conflicts/:conflict_id/resolve", agentTeamHandler.ResolveConflict)
			web.POST("/agent-teams/:id/runs/:run_id/assignments", agentTeamHandler.CreateAssignment)
			web.POST("/agent-teams/:id/runs/:run_id/assignments/:assignment_id/dispatch", agentTeamHandler.DispatchAssignment)
			web.POST("/agent-teams/:id/runs/:run_id/assignments/:assignment_id/complete", agentTeamHandler.CompleteAssignment)
			web.POST("/agent-teams/:id/runs/:run_id/assignments/:assignment_id/fail", agentTeamHandler.FailAssignment)
			web.GET("/agent-teams/:id/runs/:run_id/assignments", agentTeamHandler.ListAssignments)
		}
	}
}
