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

	"github.com/agenthub/hub-server/internal/bus"
	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/egress"
	"github.com/agenthub/hub-server/internal/handler"
	"github.com/agenthub/hub-server/internal/log"
	"github.com/agenthub/hub-server/internal/outboundhttp"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/hub-server/internal/service/agent"
	"github.com/agenthub/hub-server/internal/service/agentcontrol"
	"github.com/agenthub/hub-server/internal/service/agentevent"
	"github.com/agenthub/hub-server/internal/service/agentprofile"
	"github.com/agenthub/hub-server/internal/service/agentteam"
	"github.com/agenthub/hub-server/internal/service/attachment"
	"github.com/agenthub/hub-server/internal/service/audit"
	"github.com/agenthub/hub-server/internal/service/auth"
	"github.com/agenthub/hub-server/internal/service/contact"
	"github.com/agenthub/hub-server/internal/service/device"
	"github.com/agenthub/hub-server/internal/service/document"
	"github.com/agenthub/hub-server/internal/service/executiontarget"
	"github.com/agenthub/hub-server/internal/service/mcpserver"
	"github.com/agenthub/hub-server/internal/service/message"
	"github.com/agenthub/hub-server/internal/service/messagereaction"
	"github.com/agenthub/hub-server/internal/service/notification"
	"github.com/agenthub/hub-server/internal/service/oidc"
	"github.com/agenthub/hub-server/internal/service/providerbinding"
	"github.com/agenthub/hub-server/internal/service/publicstats"
	"github.com/agenthub/hub-server/internal/service/relay"
	"github.com/agenthub/hub-server/internal/service/session"
	"github.com/agenthub/hub-server/internal/service/skill"
	"github.com/agenthub/hub-server/internal/service/usersettings"
	"github.com/agenthub/hub-server/internal/service/workspace"
)

type messageServiceWithReactions struct {
	*message.Service
	reactions *messagereaction.Service
}

func (s messageServiceWithReactions) AddMessageReaction(ctx context.Context, userID, sessionID, msgID, reaction string) (*messagereaction.MessageReactionResponse, error) {
	return s.reactions.AddMessageReaction(ctx, userID, sessionID, msgID, reaction)
}

func (s messageServiceWithReactions) RemoveMessageReaction(ctx context.Context, userID, sessionID, msgID, reaction string) (*messagereaction.MessageReactionResponse, error) {
	return s.reactions.RemoveMessageReaction(ctx, userID, sessionID, msgID, reaction)
}

func (s messageServiceWithReactions) ListMessageReactions(ctx context.Context, userID, sessionID, msgID string) ([]messagereaction.MessageReactionResponse, error) {
	return s.reactions.ListMessageReactions(ctx, userID, sessionID, msgID)
}

// Run starts the Hub Server and blocks until a shutdown signal is received.
func (a *App) Run(ctx context.Context) error {
	defer log.Sync()

	if err := a.initInfra(ctx); err != nil {
		return err
	}
	if err := a.initServices(ctx); err != nil {
		return err
	}
	if err := a.initHandlers(ctx); err != nil {
		return err
	}
	return a.startServer(ctx)
}

// initInfra initializes infrastructure: health checks, logging, WebSocket manager, and event bus.
func (a *App) initInfra(ctx context.Context) error {
	a.startTime = time.Now()

	// Startup health verification: ping DB and Redis to confirm connectivity
	// before registering routes or starting background goroutines.
	sqlDB, err := a.DB.DB()
	if err != nil {
		return fmt.Errorf("database handle unavailable: %w", err)
	}
	if err := sqlDB.Ping(); err != nil {
		return fmt.Errorf("database ping failed: %w", err)
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
	// Note: defer log.Sync() is in Run() so it fires at shutdown, not after initInfra.

	// One-time legacy migration: sync existing session seq numbers to Redis.
	// syncLegacySeqs sets a Redis marker on first success and no-ops on every
	// later startup (#1675). Tracked in the background group — cancellable
	// and awaited at shutdown (#1542).
	a.bg.Go(func() error {
		a.syncLegacySeqs(a.bg.Ctx())
		return nil
	})

	// WebSocket manager + callbacks
	a.setupWSManager()

	// Event bus
	bus, err := bus.New()
	if err != nil {
		return fmt.Errorf("event bus init failed: %w", err)
	}
	a.bus = bus

	return nil
}

// initServices constructs all service-layer components and their inline handlers.
func (a *App) initServices(ctx context.Context) error {
	// Service layer
	a.AuthService = auth.NewService(a.DB, a.Config.JWT, a.CacheClient)
	a.NotificationService = notification.NewService(a.DB, a.mgr)
	// Attachment storage: S3 when configured, otherwise local filesystem.
	var attachmentStorage attachment.ObjectStorage
	if a.Config.S3.IsConfigured() {
		s3Store, err := attachment.NewS3StorageFromConfig(ctx, a.Config.S3)
		if err != nil {
			return fmt.Errorf("s3 attachment storage init failed: %w", err)
		}
		attachmentStorage = s3Store
		slog.Info("S3 attachment storage configured", "bucket", a.Config.S3.Bucket, "endpoint", a.Config.S3.Endpoint)
	} else {
		attachmentStorage = attachment.NewLocalStorage(a.Config.Upload.Dir)
	}
	a.AttachmentService = attachment.NewService(a.DB, a.Config.Upload, attachmentStorage)
	a.ContactService = contact.NewService(a.DB, a.bus, a.CacheClient)
	a.SessionService = session.NewService(a.DB, a.CacheClient, a.bus)
	a.MessageService = message.NewService(a.DB, a.bus, a.CacheClient)
	a.MessageReactionService = messagereaction.NewService(a.DB, a.bus)
	a.AgentControlService = agentcontrol.NewService(a.CacheClient, a.mgr)

	// Execution Target service (needed by the device service).
	// Egress policy (#1540): default-deny; the administrator must explicitly
	// allowlist target ranges for hub-initiated pings.
	targetSvc, err := executiontarget.NewService(a.DB, egress.Config{
		AllowCIDRs:     a.Config.Egress.AllowCIDRs,
		AllowHostnames: a.Config.Egress.AllowHostnames,
		AllowPlainHTTP: a.Config.Egress.AllowPlainHTTP,
		Timeout:        a.Config.Egress.Timeout,
	})
	if err != nil {
		return fmt.Errorf("execution target service: %w", err)
	}
	targetSvc.SetCache(a.CacheClient)
	a.ExecutionTargetHandler = handler.NewExecutionTargetHandler(targetSvc)

	// Relay service (needed by AgentService).
	a.RelayService = relay.NewService(a.CacheClient, a.mgr)
	a.RelayHandler = handler.NewRelayHandler(a.RelayService)

	a.DeviceService = device.NewService(a.DB, targetSvc)
	// Shared Hub→Edge dispatch client (#1594): built once at the composition
	// root from the injected edge config with the sanctioned outboundhttp
	// policy (bounded timeout, redirects refused). The service layer never
	// constructs transport clients.
	edgeDispatchClient := outboundhttp.NewClient(a.Config.Edge.Timeout)
	a.AgentService = agent.NewService(a.DB, a.bus, a.mgr, a.CacheClient, a.RelayService, a.Config.Edge, edgeDispatchClient, a.Config.JWT.Secret)

	// Agent Profile service
	agentProfileSvc := agentprofile.NewService(a.DB)
	a.AgentProfileHandler = handler.NewAgentProfileHandler(agentProfileSvc)

	// Skill + MCP Server services
	skillSvc := skill.NewService(a.DB)
	a.SkillHandler = handler.NewSkillHandler(skillSvc)
	mcpSvc := mcpserver.NewService(a.DB)
	a.MCPServerHandler = handler.NewMCPServerHandler(mcpSvc)

	// Market handler (reuses agentprofile.Service)
	a.MarketHandler = handler.NewMarketHandler(agentProfileSvc)

	// Provider Binding service
	pbSvc := providerbinding.NewService(a.DB)
	a.ProviderBindingHandler = handler.NewProviderBindingHandler(pbSvc)

	// Workspace service (second IM typed-service package; DB-only, no bus/cache)
	workspaceSvc := workspace.NewService(a.DB)
	a.WorkspaceHandler = handler.NewWorkspaceHandler(workspaceSvc)

	// Audit service
	auditSvc := audit.NewService(a.DB, &audit.Config{
		AuditLogFile:    a.Config.Server.AuditLogFile,
		RetryBufferSize: 1024,
		// Lifecycle governs the async retry loop: on process shutdown the
		// background root is cancelled (bg.Cancel) so retries abort instead
		// of sleeping on a dead process.
		LifecycleContext: a.bg.Ctx(),
	})
	a.AuditService = auditSvc
	a.AuditHandler = handler.NewAuditHandler(auditSvc)

	// AgentTeam service
	a.AgentTeamService = agentteam.NewAgentTeamServiceWithGuardrails(a.DB, a.AgentService, a.CacheClient, agentteam.AgentTeamGuardrails{
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
	a.DocumentService = document.NewService(a.DB)
	a.DocumentHandler = handler.NewDocumentHandler(a.DocumentService)

	// Settings service
	settingsRepo := repository.NewUserSettingsRepository(a.DB)
	settingsSvc := usersettings.NewService(settingsRepo)
	a.UserSettingsHandler = handler.NewUserSettingsHandler(settingsSvc)

	// OIDC Service (optional — only when TokenDance ID client is configured)
	if a.Config.TokenDanceID.ClientID != "" {
		a.OIDCService = oidc.NewService(a.DB, a.Config.TokenDanceID, a.Config.JWT, a.CacheClient)
		a.OIDCHandler = handler.NewOIDCHandler(a.OIDCService)
	}

	return nil
}

// initHandlers constructs the handler-layer components.
func (a *App) initHandlers(_ context.Context) error {
	// Handler layer
	a.AuthHandler = handler.NewAuthHandler(a.AuthService)
	a.DeviceHandler = handler.NewDeviceHandler(a.DeviceService)
	a.DeviceHandler.SetJWTConfig(a.Config.JWT.Secret, a.Config.JWT.AccessTTL)
	a.ContactHandler = handler.NewContactHandler(a.ContactService)
	a.SessionHandler = handler.NewSessionHandler(a.SessionService)
	a.MessageHandler = handler.NewMessageHandler(messageServiceWithReactions{
		Service:   a.MessageService,
		reactions: a.MessageReactionService,
	})
	a.AgentHandler = handler.NewAgentHandler(a.AgentService)
	a.CustomAgentHandler = handler.NewCustomAgentHandler(a.AgentService)
	a.AttachmentHandler = handler.NewAttachmentHandler(a.AttachmentService)
	a.NotificationHandler = handler.NewNotificationHandler(a.NotificationService)
	a.HealthHandler = handler.NewHealthHandler(a.DB, a.CacheClient, &a.Config.DB, a.startTime, a.Version)
	pubStatsSvc := publicstats.NewPublicStatsService(a.DB)
	a.PublicHandler = handler.NewPublicHandler(pubStatsSvc, a.startTime)

	return nil
}

// startServer configures the router, starts background services, and blocks until shutdown.
func (a *App) startServer(ctx context.Context) error {
	// Router
	r, err := a.setupRouter()
	if err != nil {
		return err
	}

	// Event subscriptions
	a.startEventSubscriptions(a.bg.Ctx())

	// Background goroutines
	a.startTaskScheduler(a.bg.Ctx())
	a.startWebSocketCleanup(a.bg.Ctx())
	// AH-SR-049: durable Hub->Edge delivery retry loop (delivery_outbox).
	if a.AgentService != nil {
		a.AgentService.StartDeliveryRetryLoop(a.bg.Ctx())
		// Bounds outbox table growth: purge delivered/dead-letter rows past
		// the retention window on a 24h cadence (#1212 — previously
		// CleanupOldDeliveries was test-only and the outbox grew unbounded).
		a.AgentService.StartDeliveryCleanupLoop(a.bg.Ctx())
		// Macro baseline §5 goal 5 (#2070): bound agent_run_events growth —
		// purge terminal-task events past retention, keep per-task tail snapshot.
		agentevent.StartRunEventRetentionLoop(a.bg.Ctx(), a.DB, agentevent.DefaultRetentionConfig())
	}

	// Admin server (observability always, debug capabilities fail-closed).
	// Bind failure is fatal like the main server — a busy admin port must
	// not leave monitoring silently dark (#1547).
	if err := a.startAdminServer(); err != nil {
		return err
	}

	// Periodic metrics collection
	a.startMetricsCollector(a.bg.Ctx())

	// Wait for shutdown signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	// HTTP server. A bind/serve failure must cancel the whole task group and
	// surface as Run's error — not only a log line (#1542 must-test 9).
	serveErrCh := make(chan error, 1)
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
			serveErrCh <- err
			quit <- syscall.SIGTERM
		}
	}()

	select {
	case <-quit:
	case <-ctx.Done():
	}
	slog.Info("shutting down servers...")

	ctxShutdown, cancel := context.WithTimeout(context.Background(), config.DefaultShutdownTimeout)
	defer cancel()
	shutdownErr := a.Shutdown(ctxShutdown)

	// Surface a fatal serve error (e.g. bind failure) instead of only the
	// signal-driven clean shutdown result.
	select {
	case serveErr := <-serveErrCh:
		if serveErr != nil {
			return fmt.Errorf("http server: %w", serveErr)
		}
	default:
	}
	return shutdownErr
}
