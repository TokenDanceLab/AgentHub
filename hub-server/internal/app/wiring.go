package app

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/handler"
	"github.com/agenthub/hub-server/internal/jwtutil"
	"github.com/agenthub/hub-server/internal/log"
	"github.com/agenthub/hub-server/internal/middleware"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/hub-server/internal/service"
)

type messageServiceWithReactions struct {
	*service.MessageService
	reactions *service.MessageReactionService
}

func (s messageServiceWithReactions) AddMessageReaction(ctx context.Context, userID, sessionID, msgID, reaction string) (*service.MessageReactionResponse, error) {
	return s.reactions.AddMessageReaction(ctx, userID, sessionID, msgID, reaction)
}

func (s messageServiceWithReactions) RemoveMessageReaction(ctx context.Context, userID, sessionID, msgID, reaction string) (*service.MessageReactionResponse, error) {
	return s.reactions.RemoveMessageReaction(ctx, userID, sessionID, msgID, reaction)
}

func (s messageServiceWithReactions) ListMessageReactions(ctx context.Context, userID, sessionID, msgID string) ([]service.MessageReactionResponse, error) {
	return s.reactions.ListMessageReactions(ctx, userID, sessionID, msgID)
}

// Run starts the Hub Server and blocks until a shutdown signal is received.
func (a *App) Run(ctx context.Context) error {
	a.startTime = time.Now()

	// Startup health verification: ping DB and Redis to confirm connectivity
	// before registering routes or starting background goroutines.
	if sqlDB, err := a.DB.DB(); err == nil {
		if err := sqlDB.Ping(); err != nil {
			return fmt.Errorf("database ping failed: %w", err)
		}
	}
	if err := a.CacheClient.GetRDB().Ping(ctx).Err(); err != nil {
		return fmt.Errorf("redis ping failed: %w", err)
	}
	slog.Info("health check passed", "database", "ok", "redis", "ok")

	if a.Config.Server.LogLevel == "debug" {
		gin.SetMode(gin.DebugMode)
	} else {
		gin.SetMode(gin.ReleaseMode)
	}

	log.Init(&a.Config.Server)
	defer log.Sync()

	// Initialize TokenDance ID JWKS URI for JWT validation.
	if a.Config.TokenDanceID.JWKSURI != "" {
		jwtutil.SetJWKSURI(a.Config.TokenDanceID.JWKSURI)
	}

	// Legacy: sync existing session seq numbers to Redis
	go a.syncLegacySeqs()

	// WebSocket manager + callbacks
	a.setupWSManager()

	// Event bus
	bus, err := service.NewBus()
	if err != nil {
		return fmt.Errorf("event bus init failed: %w", err)
	}
	a.bus = bus

	// Service layer
	a.AuthService = service.NewAuthService(a.DB, a.Config.JWT, a.CacheClient)
	a.NotificationService = service.NewNotificationService(a.DB, a.mgr)
	// Attachment storage: S3 when configured, otherwise local filesystem.
	var attachmentStorage service.ObjectStorage
	if a.Config.S3.IsConfigured() {
		s3Store, err := service.NewS3StorageFromConfig(ctx, a.Config.S3)
		if err != nil {
			return fmt.Errorf("s3 attachment storage init failed: %w", err)
		} else {
			attachmentStorage = s3Store
			slog.Info("S3 attachment storage configured", "bucket", a.Config.S3.Bucket, "endpoint", a.Config.S3.Endpoint)
		}
	} else {
		attachmentStorage = service.NewLocalStorage(a.Config.Upload.Dir)
	}
	a.AttachmentService = service.NewAttachmentService(a.DB, a.Config.Upload, attachmentStorage)
	a.ContactService = service.NewContactService(a.DB, a.bus, a.CacheClient)
	a.SessionService = service.NewSessionService(a.DB, a.CacheClient, a.bus)
	a.MessageService = service.NewMessageService(a.DB, a.bus, a.CacheClient)
	a.MessageReactionService = service.NewMessageReactionService(a.DB, a.bus)
	a.AgentControlService = service.NewAgentControlService(a.CacheClient, a.mgr)

	// Execution Target service (needed by DeviceService).
	targetSvc := service.NewExecutionTargetService(a.DB)
	targetSvc.SetCache(a.CacheClient)
	a.ExecutionTargetHandler = handler.NewExecutionTargetHandler(targetSvc)

	// Relay service (needed by AgentService).
	a.RelayService = service.NewRelayService(a.CacheClient, a.mgr)
	a.RelayHandler = handler.NewRelayHandler(a.RelayService)

	a.DeviceService = service.NewDeviceService(a.DB, targetSvc)
	a.AgentService = service.NewAgentService(a.DB, a.bus, a.mgr, a.CacheClient, a.RelayService)

	// Agent Profile service
	agentProfileSvc := service.NewAgentProfileService(a.DB)
	a.AgentProfileHandler = handler.NewAgentProfileHandler(agentProfileSvc)

	// Skill + MCP Server services
	skillSvc := service.NewSkillService(a.DB)
	a.SkillHandler = handler.NewSkillHandler(skillSvc)
	mcpSvc := service.NewMCPService(a.DB)
	a.MCPServerHandler = handler.NewMCPServerHandler(mcpSvc)

	// Market handler (reuses AgentProfileService)
	a.MarketHandler = handler.NewMarketHandler(agentProfileSvc)

	// Provider Binding service
	pbSvc := service.NewProviderBindingService(a.DB)
	a.ProviderBindingHandler = handler.NewProviderBindingHandler(pbSvc)

	// Workspace service
	workspaceSvc := service.NewWorkspaceService(a.DB)
	a.WorkspaceHandler = handler.NewWorkspaceHandler(workspaceSvc)

	// Audit service
	auditSvc := service.NewAuditService(a.DB, &service.AuditServiceConfig{
		AuditLogFile:    a.Config.Server.AuditLogFile,
		RetryBufferSize: 1024,
	})
	a.AuditService = auditSvc
	a.AuditHandler = handler.NewAuditHandler(auditSvc)

	// Wire audit into middleware for permission decision logging.
	middleware.AuditPermissionFn = auditSvc.RecordPermissionDecision

	// AgentTeam service
	a.AgentTeamService = service.NewAgentTeamServiceWithGuardrails(a.DB, a.AgentService, a.CacheClient, service.AgentTeamGuardrails{
		MaxDelegationDepth:       a.Config.AgentTeam.MaxDelegationDepth,
		MaxActiveSubAgentsPerRun: int64(a.Config.AgentTeam.MaxActiveSubAgentsPerRun),
		MaxRouteRepeats:          a.Config.AgentTeam.MaxRouteRepeats,
		MaxTasksPerTeamRun:       int64(a.Config.AgentTeam.MaxTasksPerTeamRun),
		AssignmentTimeout:        a.Config.AgentTeam.AssignmentTimeout,
		MaxTeamRunBudgetTokens:   a.Config.AgentTeam.MaxTeamRunBudgetTokens,
		MaxTeamRunBudgetUsagePct: a.Config.AgentTeam.MaxTeamRunBudgetUsagePct,
	})
	a.AgentTeamService.SetBus(a.bus)
	a.AgentTeamService.SetHumanReviewEnabled(a.Config.AgentTeam.HumanReviewEnabled)
	a.AgentTeamHandler = handler.NewAgentTeamHandler(a.AgentTeamService)
	// Document service
	a.DocumentService = service.NewDocumentService(a.DB)
	a.DocumentHandler = handler.NewDocumentHandler(a.DocumentService)

	// Settings service
	settingsRepo := repository.NewUserSettingsRepository(a.DB)
	settingsSvc := service.NewUserSettingsService(settingsRepo)
	a.UserSettingsHandler = handler.NewUserSettingsHandler(settingsSvc)

	// OIDC Service (optional — only when TokenDance ID client is configured)
	if a.Config.TokenDanceID.ClientID != "" {
		a.OIDCService = service.NewOIDCService(a.DB, a.Config.TokenDanceID, a.Config.JWT, a.CacheClient)
		a.OIDCHandler = handler.NewOIDCHandler(a.OIDCService)
	}

	// Handler layer
	a.AuthHandler = handler.NewAuthHandler(a.AuthService)
	a.DeviceHandler = handler.NewDeviceHandler(a.DeviceService)
	a.DeviceHandler.SetJWTConfig(a.Config.JWT.Secret, a.Config.JWT.AccessTTL)
	a.ContactHandler = handler.NewContactHandler(a.ContactService)
	a.SessionHandler = handler.NewSessionHandler(a.SessionService)
	a.MessageHandler = handler.NewMessageHandler(messageServiceWithReactions{
		MessageService: a.MessageService,
		reactions:      a.MessageReactionService,
	})
	a.AgentHandler = handler.NewAgentHandler(a.AgentService)
	a.CustomAgentHandler = handler.NewCustomAgentHandler(a.AgentService)
	a.AttachmentHandler = handler.NewAttachmentHandler(a.AttachmentService)
	a.NotificationHandler = handler.NewNotificationHandler(a.NotificationService)
	a.HealthHandler = handler.NewHealthHandler(a.DB, a.CacheClient, &a.Config.DB, a.startTime, a.Version)
	a.PublicHandler = handler.NewPublicHandler(a.DB, a.startTime)

	// Router
	r, err := a.setupRouter()
	if err != nil {
		return err
	}

	// Event subscriptions
	a.startEventSubscriptions(a.coreCtx)

	// Background goroutines
	a.startTaskScheduler(a.coreCtx)
	a.startWebSocketCleanup(a.coreCtx)

	// Admin server (pprof + metrics)
	a.startAdminServer()

	// Periodic metrics collection
	a.startMetricsCollector(a.coreCtx)

	// HTTP server
	a.HTTPServer = &http.Server{
		Addr:              fmt.Sprintf(":%d", a.Config.Server.Port),
		Handler:           r,
		ReadHeaderTimeout: config.DefaultReadHeaderTimeout,
		ReadTimeout:       config.DefaultServerReadTimeout,
		WriteTimeout:      config.DefaultServerWriteTimeout,
		IdleTimeout:       config.DefaultServerIdleTimeout,
		MaxHeaderBytes:    config.DefaultMaxHeaderBytes,
	}

	go func() {
		slog.Info("server starting", "port", a.Config.Server.Port)
		if err := a.HTTPServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("server failed", "error", err)
			os.Exit(1)
		}
	}()

	// Wait for shutdown signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	select {
	case <-quit:
	case <-ctx.Done():
	}
	slog.Info("shutting down servers...")

	ctxShutdown, cancel := context.WithTimeout(context.Background(), config.DefaultShutdownTimeout)
	defer cancel()
	return a.Shutdown(ctxShutdown)
}
