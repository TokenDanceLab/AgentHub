package app

import (
	"fmt"

	"github.com/gin-gonic/gin"

	"github.com/agenthub/hub-server/internal/middleware"
	"github.com/agenthub/hub-server/internal/router"
)

// setupRouter creates the Gin engine and installs all routes.
func (a *App) setupRouter() *gin.Engine {
	r := gin.New()
	// Trust only loopback proxies (127.0.0.0/8, ::1) for X-Forwarded-For.
	// Hub sits behind nginx on the same host, so loopback is sufficient.
	// nil disables all external proxy trust; we explicitly trust loopback.
	if err := r.SetTrustedProxies([]string{"127.0.0.0/8", "::1"}); err != nil {
		panic(fmt.Errorf("failed to set trusted proxies: %w", err))
	}
	r.Use(middleware.CustomRecovery())
	router.SetupRoutes(r, a.Config, a.Config.JWT.Secret, a.CacheClient,
		a.AuthHandler, a.WebSocketHandler, a.DeviceHandler,
		a.ContactHandler, a.SessionHandler, a.MessageHandler,
		a.AgentHandler, a.CustomAgentHandler,
		a.AttachmentHandler, a.NotificationHandler,
		a.HealthHandler, a.PublicHandler,
		a.OIDCHandler,
		a.AgentProfileHandler,
		a.SkillHandler, a.MCPServerHandler,
		a.MarketHandler,
		a.ProviderBindingHandler,
		a.ExecutionTargetHandler,
		a.AuditHandler,
		a.RelayHandler,
		a.AgentTeamHandler,
		a.DocumentHandler,
		a.UserSettingsHandler,
		a.WorkspaceHandler,
	)
	return r
}
