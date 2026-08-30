package router

import (
	"fmt"

	"github.com/gin-gonic/gin"

	sharederr "github.com/agenthub/pkg/errcode"

	"github.com/agenthub/hub-server/internal/cache"
	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/handler"
	"github.com/agenthub/hub-server/internal/middleware"
	"github.com/agenthub/pkg/reqlog"
)

func SetupRoutes(r *gin.Engine, cfg *config.Config, authMW *middleware.AuthMiddleware, jwtSecret string, cacheClient *cache.Client, authHandler *handler.AuthHandler, wsHandler *handler.WebSocketHandler, deviceHandler *handler.DeviceHandler, contactHandler *handler.ContactHandler, sessionHandler *handler.SessionHandler, messageHandler *handler.MessageHandler, agentHandler *handler.AgentHandler, customAgentHandler *handler.CustomAgentHandler, attachmentHandler *handler.AttachmentHandler, notificationHandler *handler.NotificationHandler, healthHandler *handler.HealthHandler, publicHandler *handler.PublicHandler, oidcHandler *handler.OIDCHandler, agentProfileHandler *handler.AgentProfileHandler, skillHandler *handler.SkillHandler, mcpHandler *handler.MCPServerHandler, marketHandler *handler.MarketHandler, pbHandler *handler.ProviderBindingHandler, targetHandler *handler.ExecutionTargetHandler, auditHandler *handler.AuditHandler, relayHandler *handler.RelayHandler, agentTeamHandler *handler.AgentTeamHandler, documentHandler *handler.DocumentHandler, settingsHandler *handler.UserSettingsHandler, workspaceHandlers ...*handler.WorkspaceHandler) error {
	var workspaceHandler *handler.WorkspaceHandler
	if len(workspaceHandlers) > 0 {
		workspaceHandler = workspaceHandlers[0]
	}
	corsMiddleware, err := middleware.CORS(cfg.Server.Env)
	if err != nil {
		return fmt.Errorf("CORS middleware init failed: %w", err)
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
		handler.Fail(c, sharederr.ErrNotFound)
	})
	r.NoMethod(func(c *gin.Context) {
		handler.Fail(c, sharederr.ErrMethodNotAllowed)
	})

	if healthHandler != nil {
		r.GET("/health", healthHandler.Check)
		r.GET("/health/live", healthHandler.Live)
		r.GET("/health/ready", healthHandler.Ready)
	} else {
		healthOK := func(c *gin.Context) {
			handler.OK(c, gin.H{"status": "ok", "live": true, "ready": true})
		}
		r.GET("/health", healthOK)
		r.GET("/health/live", func(c *gin.Context) {
			handler.OK(c, gin.H{"status": "ok", "live": true})
		})
		r.GET("/health/ready", healthOK)
	}

	// Dev-only debug endpoint — returns an intentional 500 to verify error handling.
	// Enabled only when log_level is "debug".
	if cfg.Server.LogLevel == "debug" {
		r.GET("/debug/panic", func(c *gin.Context) {
			handler.Fail(c, sharederr.ErrInternal.WithMessage("deliberate test error from /debug/panic"))
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
		// WS upgrade: IP rate limit + JWT parse + shared hub-session purpose/device gate
		// (WSAuthMiddleware embeds RequireHubSession policy; chain is belt-and-suspenders).
		client.GET("/ws", middleware.WSIPRateLimit(), authMW.WSHandler(), authMW.RequireHubSession(), wsHandler.ServeWS)

		auth := client.Group("/auth")
		{
			auth.POST("/refresh", middleware.RateLimit(cacheClient, config.AuthLoginRateLimit, config.AuthRateLimitWindow, middleware.IPKey), authHandler.Refresh)

			// OIDC (TokenDance ID — the only auth entry point)
			if oidcHandler != nil {
				auth.POST("/oidc/authorize", middleware.RateLimit(cacheClient, config.AuthLoginRateLimit, config.AuthRateLimitWindow, middleware.IPKey), oidcHandler.PostOIDCAuthorize)
				auth.POST("/oidc/callback", middleware.RateLimit(cacheClient, config.AuthLoginRateLimit, config.AuthRateLimitWindow, middleware.IPKey), oidcHandler.PostOIDCCallback)
				auth.GET("/oidc/callback", middleware.RateLimit(cacheClient, config.AuthLoginRateLimit, config.AuthRateLimitWindow, middleware.IPKey), oidcHandler.GetOIDCCallback)
			}
		}

		authProtected := client.Group("/auth")
		authProtected.Use(authMW.Handler())
		authProtected.Use(authMW.RequireHubSession())
		{
			authProtected.GET("/me", authHandler.Me)
			authProtected.POST("/logout", authHandler.Logout)
			authProtected.PUT("/profile", authHandler.UpdateProfile)
		}

		contacts := client.Group("/contacts")
		contacts.Use(authMW.Handler())
		contacts.Use(authMW.RequireHubSession())
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
		sessions.Use(authMW.Handler())
		sessions.Use(authMW.RequireHubSession())
		{
			sessions.GET("", sessionHandler.List)
			sessions.POST("", sessionHandler.Create)
			sessions.POST("/private", sessionHandler.CreatePrivate)
			sessions.POST("/group", sessionHandler.CreateGroup)
			sessions.POST("/:id/members", sessionHandler.AddMembers)
			sessions.DELETE("/:id/members/:target_user_id", sessionHandler.RemoveMember)
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
		messages.Use(authMW.Handler())
		messages.Use(authMW.RequireHubSession())
		{
			messages.POST("/:id/recall", messageHandler.RecallMessage)
			messages.PUT("/:id", messageHandler.EditMessage)
			messages.POST("/:id/pin", messageHandler.PinMessage)
			messages.DELETE("/:id/pin", messageHandler.UnpinMessage)
			messages.GET("/:id/reactions", messageHandler.ListMessageReactions)
			messages.POST("/:id/reactions", messageHandler.AddMessageReaction)
			messages.DELETE("/:id/reactions", messageHandler.RemoveMessageReaction)
			messages.POST("/:id/forward", messageHandler.ForwardMessage)
			messages.GET("/search", messageHandler.SearchMessages)
		}

		attachments := client.Group("/attachments")
		attachments.Use(authMW.Handler())
		attachments.Use(authMW.RequireHubSession())
		{
			attachments.POST("/probe", attachmentHandler.Probe)
			attachments.POST("", middleware.Timeout(config.UploadRequestTimeout), attachmentHandler.Upload)
			attachments.GET("/:id", attachmentHandler.Download)
		}

		notifications := client.Group("/notifications")
		notifications.Use(authMW.Handler())
		notifications.Use(authMW.RequireHubSession())
		{
			notifications.GET("", notificationHandler.ListNotifications)
			notifications.POST("/:id/read", notificationHandler.MarkRead)
			notifications.POST("/read-all", notificationHandler.ReadAll)
		}

		// Settings (user preferences — per-user key-value store)
		if settingsHandler != nil {
			settings := client.Group("/settings")
			settings.Use(authMW.Handler())
			settings.Use(authMW.RequireHubSession())
			{
				settings.GET("", settingsHandler.GetSettings)
				settings.PATCH("", settingsHandler.PatchSettings)
			}
		}
	}

	edge := r.Group("/edge")
	edge.Use(authMW.Handler())
	edge.Use(authMW.RequireHubSession())
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
	cloud.Use(authMW.Handler())
	cloud.Use(authMW.RequireHubSession())
	{
		cloud.POST("/edge/register", deviceHandler.CloudEdgeRegister)
	}

	web := r.Group("/web")
	web.Use(authMW.Handler())
	web.Use(authMW.RequireHubSession())
	web.Use(middleware.DeviceTypeCheck("web", "mobile"))
	{
		web.POST("/agent-tasks", agentHandler.TriggerTask)
		web.POST("/agent-tasks/:id/cancel", agentHandler.CancelTask)
		web.POST("/agent-tasks/:id/regenerate", agentHandler.RegenerateTask)
		web.GET("/agent-tasks/:id/summary", agentHandler.TaskEventSummary)
		web.GET("/agent-tasks/:id/events/summary", agentHandler.TaskEventSummary)
		web.GET("/agent-tasks/:id/events", agentHandler.TaskEvents)
		web.GET("/agent-tasks/:id/approvals", agentHandler.TaskApprovals)
		web.POST("/agent-tasks/:id/approvals/:approval_id/decide", agentHandler.DecideTaskApproval)
		web.GET("/agent-tasks/:id/artifacts", agentHandler.TaskArtifacts)
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
			web.POST("/agent-profiles/:id/publish", authMW.RequireAdmin(), agentProfileHandler.PublishProfile)
			web.POST("/agent-profiles/:id/install", agentProfileHandler.InstallProfile)
		}

		// Skills (Phase 3)
		if skillHandler != nil {
			web.GET("/skills", skillHandler.ListSkills)
			web.POST("/skills", skillHandler.CreateSkill)
			web.GET("/skills/:id", skillHandler.GetSkill)
			web.PUT("/skills/:id", skillHandler.UpdateSkill)
			web.DELETE("/skills/:id", skillHandler.DeleteSkill)
			web.POST("/skills/:id/publish", authMW.RequireAdmin(), skillHandler.PublishSkill)
			web.POST("/skills/:id/unpublish", authMW.RequireAdmin(), skillHandler.UnpublishSkill)
		}

		// MCP Servers (Phase 3)
		if mcpHandler != nil {
			web.GET("/mcp-servers", mcpHandler.ListMCPServers)
			web.POST("/mcp-servers", mcpHandler.CreateMCPServer)
			web.GET("/mcp-servers/:id", mcpHandler.GetMCPServer)
			web.PUT("/mcp-servers/:id", mcpHandler.UpdateMCPServer)
			web.DELETE("/mcp-servers/:id", mcpHandler.DeleteMCPServer)
			web.POST("/mcp-servers/:id/publish", authMW.RequireAdmin(), mcpHandler.PublishMCPServer)
			web.POST("/mcp-servers/:id/unpublish", authMW.RequireAdmin(), mcpHandler.UnpublishMCPServer)
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

		// Documents (Docs Hub)
		if documentHandler != nil {
			web.GET("/documents", documentHandler.ListDocuments)
			web.POST("/documents", documentHandler.CreateDocument)
			web.GET("/documents/:id", documentHandler.GetDocument)
			web.PATCH("/documents/:id", documentHandler.UpdateDocument)
			web.DELETE("/documents/:id", documentHandler.DeleteDocument)
		}

		// Projects backed by Hub workspaces
		if workspaceHandler != nil {
			web.GET("/projects", workspaceHandler.ListWorkspaces)
			web.POST("/projects", workspaceHandler.CreateWorkspace)
			web.GET("/projects/:id", workspaceHandler.GetWorkspace)
			web.PATCH("/projects/:id", workspaceHandler.UpdateWorkspace)
			web.GET("/projects/:id/threads", workspaceHandler.ListProjectThreads)
			web.POST("/projects/:id/threads", workspaceHandler.CreateProjectThread)
			web.GET("/projects/:id/threads/:threadId/messages", workspaceHandler.ListProjectThreadMessages)
			web.POST("/projects/:id/threads/:threadId/messages", workspaceHandler.CreateProjectThreadMessage)
		}

		// Audit Events (Phase 6)
		if auditHandler != nil {
			web.GET("/audit-events", authMW.RequireAdmin(), auditHandler.ListAuditEvents)
		}

		// Relay Commands
		if relayHandler != nil {
			web.POST("/relay/commands", authMW.RequireAdmin(), relayHandler.CreateCommand)
			web.GET("/relay/commands/:id", authMW.RequireAdmin(), relayHandler.GetCommand)
			web.POST("/relay/commands/:id/ack", authMW.RequireAdmin(), relayHandler.AckCommand)
			web.POST("/relay/commands/:id/device-ack", relayHandler.DeviceAckCommand)
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
			// Compete summary (authenticated web endpoint).
			web.GET("/team-runs/:id/compete-summary", agentTeamHandler.CompeteSummary)
			// Human review gate (authenticated web endpoint).
			web.POST("/team-runs/:id/review-decision", agentTeamHandler.ReviewDecision)
		}
	}
	return nil
}
