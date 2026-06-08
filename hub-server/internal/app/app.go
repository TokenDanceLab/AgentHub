package app

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/cache"
	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/handler"
	"github.com/agenthub/hub-server/internal/jwtutil"
	"github.com/agenthub/hub-server/internal/log"
	"github.com/agenthub/hub-server/internal/metrics"
	"github.com/agenthub/hub-server/internal/middleware"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/router"
	"github.com/agenthub/hub-server/internal/service"
	"github.com/agenthub/hub-server/internal/ws"
	debugpkg "github.com/agenthub/pkg/debug"
)

// App is the top-level DI container for the Hub Server.
// All dependencies are assembled here and passed to the components that need them.
type App struct {
	Config      *config.Config
	DB          *gorm.DB
	CacheClient *cache.Client
	HTTPServer  *http.Server
	AdminServer *http.Server

	// Internal runtime state
	mgr       *ws.Manager
	bus       *service.Bus
	startTime time.Time

	// Version is the build version, settable via -ldflags. Defaults to "dev".
	Version string

	// Service layer
	AuthService            *service.AuthService
	ContactService         *service.ContactService
	SessionService         *service.SessionService
	MessageService         *service.MessageService
	MessageReactionService *service.MessageReactionService
	AgentService           *service.AgentService
	AgentControlService    *service.AgentControlService
	AttachmentService      *service.AttachmentService
	NotificationService    *service.NotificationService
	DeviceService          *service.DeviceService

	// OIDC (optional — only when TokenDance ID is configured)
	OIDCService *service.OIDCService
	OIDCHandler *handler.OIDCHandler

	// Handler layer
	AuthHandler            *handler.AuthHandler
	WebSocketHandler       *handler.WebSocketHandler
	DeviceHandler          *handler.DeviceHandler
	ContactHandler         *handler.ContactHandler
	SessionHandler         *handler.SessionHandler
	MessageHandler         *handler.MessageHandler
	AgentHandler           *handler.AgentHandler
	CustomAgentHandler     *handler.CustomAgentHandler
	AttachmentHandler      *handler.AttachmentHandler
	NotificationHandler    *handler.NotificationHandler
	HealthHandler          *handler.HealthHandler
	PublicHandler          *handler.PublicHandler
	AgentProfileHandler    *handler.AgentProfileHandler
	SkillHandler           *handler.SkillHandler
	MCPServerHandler       *handler.MCPServerHandler
	MarketHandler          *handler.MarketHandler
	ProviderBindingHandler *handler.ProviderBindingHandler
	ExecutionTargetHandler *handler.ExecutionTargetHandler
	WorkspaceHandler       *handler.WorkspaceHandler
	AuditHandler           *handler.AuditHandler
	AgentTeamHandler       *handler.AgentTeamHandler

	// AgentTeam
	AgentTeamService *service.AgentTeamService

	// Relay
	RelayService *service.RelayService
	RelayHandler *handler.RelayHandler

	// Audit
	AuditService *service.AuditService

	// Goroutine lifecycle
	coreCtx    context.Context
	coreCancel context.CancelFunc
}

// New creates a new App with the given infrastructure dependencies.
// cfg, db, and cacheClient are expected to be fully initialized by the caller.
func New(cfg *config.Config, db *gorm.DB, cacheClient *cache.Client) *App {
	coreCtx, coreCancel := context.WithCancel(context.Background())
	return &App{
		Config:      cfg,
		DB:          db,
		CacheClient: cacheClient,
		coreCtx:     coreCtx,
		coreCancel:  coreCancel,
	}
}

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
	a.bus = service.NewBus()

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
	a.AgentService = service.NewAgentService(a.DB, a.bus, a.mgr, a.CacheClient)
	a.AgentControlService = service.NewAgentControlService(a.CacheClient, a.mgr)
	a.DeviceService = service.NewDeviceService(a.DB)

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

	// Execution Target service
	targetSvc := service.NewExecutionTargetService(a.DB)
	targetSvc.SetCache(a.CacheClient)
	a.ExecutionTargetHandler = handler.NewExecutionTargetHandler(targetSvc)

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
	a.AgentTeamService.SetControlService(a.AgentControlService)
	a.AgentTeamService.SetBus(a.bus)
	a.AgentService.SetTeamRouteHandler(a.AgentTeamService)
	a.AgentTeamHandler = handler.NewAgentTeamHandler(a.AgentTeamService)

	// Relay service
	a.RelayService = service.NewRelayService(a.CacheClient, a.mgr)
	a.RelayHandler = handler.NewRelayHandler(a.RelayService)
	a.AgentService.SetRelayService(a.RelayService)

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
	r := a.setupRouter()

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

// Shutdown gracefully stops all servers and background goroutines with
// the following order: HTTP → Admin → WS → EventBus → cancel background → DB → Redis.
func (a *App) Shutdown(ctx context.Context) error {
	// 1. Stop accepting new HTTP requests.
	if a.HTTPServer != nil {
		if err := a.HTTPServer.Shutdown(ctx); err != nil {
			slog.Error("http server shutdown failed", "error", err)
		}
	}
	// 2. Stop admin server (pprof/metrics).
	if a.AdminServer != nil {
		if err := a.AdminServer.Shutdown(ctx); err != nil {
			slog.Error("admin server shutdown failed", "error", err)
		}
	}

	// 3. Close all WebSocket connections.
	if a.mgr != nil {
		a.mgr.Shutdown()
	}

	// 4. Close event bus (stop publishing events).
	if a.bus != nil {
		a.bus.Close()
	}

	// 5. Cancel background goroutines (scheduler, heartbeat, metrics collector).
	if a.coreCancel != nil {
		a.coreCancel()
	}

	// 5b. Shutdown audit service (drains retry queue, closes file sink).
	if a.AuditService != nil {
		a.AuditService.Shutdown()
	}

	// 6. Close database connection pool.
	if a.DB != nil {
		if sqlDB, err := a.DB.DB(); err == nil {
			if closeErr := sqlDB.Close(); closeErr != nil {
				slog.Error("db close failed", "error", closeErr)
			}
		}
	}

	// 7. Close Redis connection pool.
	if a.CacheClient != nil {
		if err := a.CacheClient.Close(); err != nil {
			slog.Error("redis close failed", "error", err)
		}
	}

	slog.Info("shutdown complete")
	return nil
}

// setupRouter creates the Gin engine and installs all routes.
func (a *App) setupRouter() *gin.Engine {
	r := gin.New()
	r.Use(gin.Recovery())
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
		a.WorkspaceHandler,
	)
	return r
}

// setupWSManager creates the WebSocket manager and configures callbacks.
func (a *App) setupWSManager() {
	a.mgr = ws.NewManager()
	a.mgr.OnRouteSet = a.onRouteSet
	a.mgr.OnRouteDel = a.onRouteDel
	a.mgr.ResolveMembers = func(sessionID string) []string {
		ctx := a.coreCtx
		ids, err := cache.GetOrLoad(a.CacheClient, ctx, "session:members:"+sessionID, config.SessionMemberCacheTTL, func(ctx context.Context) ([]string, error) {
			members, err := a.SessionService.ListActiveMembers(sessionID)
			if err != nil {
				return nil, err
			}
			ids := make([]string, len(members))
			for i, m := range members {
				ids[i] = m.MemberID
			}
			return ids, nil
		})
		if err != nil {
			return nil
		}
		return ids
	}

	// WebSocket handler (created once here; reused by routes)
	a.WebSocketHandler = handler.NewWebSocketHandler(a.mgr, a.Config.JWT.Secret)
	a.WebSocketHandler.SetOnTyping(func(userID, sessionID string) {
		frame := ws.NewFrame(ws.TypeTyping, map[string]interface{}{
			"user_id":    userID,
			"session_id": sessionID,
		})
		members, err := a.SessionService.ListActiveMembers(sessionID)
		if err != nil {
			return
		}
		senderIsMember := false
		for _, member := range members {
			if member.MemberID == userID {
				senderIsMember = true
				break
			}
		}
		if !senderIsMember {
			return
		}
		for _, member := range members {
			if member.MemberID != userID {
				a.mgr.PushToUser(member.MemberID, frame)
			}
		}
	})
}

// startEventSubscriptions subscribes to all bus events for WebSocket push.
func (a *App) startEventSubscriptions(ctx context.Context) {
	a.bus.Subscribe("message.new", func(ctx context.Context, event service.Event) {
		msg, ok := event.Payload.(*model.Message)
		if !ok {
			return
		}
		if msg.SenderType == model.SenderTypeAgent {
			return
		}
		frame := ws.NewFrame(ws.TypeMessageNew, msg)
		a.mgr.PushToSession(msg.SessionID, frame)
	})

	a.bus.Subscribe("message.recall", func(ctx context.Context, event service.Event) {
		msg, ok := event.Payload.(*model.Message)
		if !ok {
			return
		}
		frame := ws.NewFrame(ws.TypeMessageRecall, map[string]string{
			"message_id": msg.ID,
			"session_id": msg.SessionID,
		})
		a.mgr.PushToSession(msg.SessionID, frame)
	})

	a.bus.Subscribe("message.pin", func(ctx context.Context, event service.Event) {
		pin, ok := event.Payload.(*model.MessagePin)
		if !ok {
			return
		}
		frame := ws.NewFrame(ws.TypeMessagePin, pin)
		a.mgr.PushToSession(pin.SessionID, frame)
	})

	a.bus.Subscribe("message.unpin", func(ctx context.Context, event service.Event) {
		payload, ok := event.Payload.(map[string]string)
		if !ok {
			return
		}
		frame := ws.NewFrame(ws.TypeMessageUnpin, payload)
		a.mgr.PushToSession(payload["session_id"], frame)
	})

	for _, reactionEvent := range []struct {
		eventType string
		frameType string
	}{
		{eventType: ws.TypeMessageReactionAdded, frameType: ws.TypeMessageReactionAdded},
		{eventType: ws.TypeMessageReactionRemoved, frameType: ws.TypeMessageReactionRemoved},
	} {
		reactionEvent := reactionEvent
		a.bus.Subscribe(reactionEvent.eventType, func(ctx context.Context, event service.Event) {
			payload, ok := event.Payload.(service.MessageReactionEventPayload)
			if !ok {
				return
			}
			frame := ws.NewFrame(reactionEvent.frameType, payload)
			a.mgr.PushToSession(payload.SessionID, frame)
		})
	}

	a.bus.Subscribe("message.read", func(ctx context.Context, event service.Event) {
		payload, ok := event.Payload.(map[string]interface{})
		if !ok {
			return
		}
		frame := ws.NewFrame(ws.TypeMessageRead, payload)
		sessionID, _ := payload["session_id"].(string)
		a.mgr.PushToSession(sessionID, frame)
	})

	a.bus.Subscribe(ws.TypeAgentStream, func(ctx context.Context, event service.Event) {
		runEvent, ok := event.Payload.(*model.AgentRunEvent)
		if !ok {
			return
		}
		frame := ws.NewFrame(ws.TypeAgentStream, runEvent)
		a.mgr.PushToSession(runEvent.SessionID, frame)
	})

	a.bus.Subscribe("agent.done", func(ctx context.Context, event service.Event) {
		payload, ok := event.Payload.(map[string]interface{})
		if !ok {
			return
		}
		frame := ws.NewFrame(ws.TypeAgentDone, payload)
		sessionID, _ := payload["session_id"].(string)
		a.mgr.PushToSession(sessionID, frame)

		taskID, _ := payload["task_id"].(string)
		if taskID != "" {
			task, err := a.AgentService.GetPendingTaskByID(taskID)
			if err == nil && task != nil {
				a.NotificationService.Notify(ctx, task.TriggeredByUserID, model.TypeAgentDone, map[string]interface{}{
					"task_id":           payload["task_id"],
					"agent_instance_id": payload["agent_instance_id"],
					"session_id":        payload["session_id"],
				})
			}
		}
	})

	a.bus.Subscribe("agent.failed", func(ctx context.Context, event service.Event) {
		payload, ok := event.Payload.(map[string]interface{})
		if !ok {
			return
		}
		frame := ws.NewFrame(ws.TypeAgentFailed, payload)
		sessionID, _ := payload["session_id"].(string)
		a.mgr.PushToSession(sessionID, frame)
	})

	a.bus.Subscribe("agent.timeout", func(ctx context.Context, event service.Event) {
		payload, ok := event.Payload.(map[string]interface{})
		if !ok {
			return
		}
		frame := ws.NewFrame(ws.TypeAgentFailed, payload)
		sessionID, _ := payload["session_id"].(string)
		a.mgr.PushToSession(sessionID, frame)
	})

	a.bus.Subscribe("agent.cancel", func(ctx context.Context, event service.Event) {
		payload, ok := event.Payload.(map[string]string)
		if !ok {
			return
		}
		frame := ws.NewFrame(ws.TypeAgentCancel, payload)
		sessionID := payload["session_id"]
		a.mgr.PushToSession(sessionID, frame)
	})

	for _, teamEvent := range []struct {
		eventType        string
		frameType        string
		pushUserIfNoSess bool
	}{
		{eventType: "team.run.started", frameType: ws.TypeTeamRunStarted, pushUserIfNoSess: true},
		{eventType: "team.event", frameType: ws.TypeTeamEvent},
		{eventType: "team.assignment.completed", frameType: ws.TypeTeamAssignmentDone},
		{eventType: "team.assignment.failed", frameType: ws.TypeTeamAssignmentFailed},
	} {
		teamEvent := teamEvent
		a.bus.Subscribe(teamEvent.eventType, func(ctx context.Context, event service.Event) {
			payload, ok := event.Payload.(map[string]interface{})
			if !ok {
				return
			}
			frame := ws.NewFrame(teamEvent.frameType, payload)
			sessionID, _ := payload["session_id"].(string)
			if sessionID != "" {
				a.mgr.PushToSession(sessionID, frame)
				return
			}
			if teamEvent.pushUserIfNoSess {
				userID, _ := payload["user_id"].(string)
				if userID != "" {
					a.mgr.PushToUser(userID, frame)
				}
			}
		})
	}

	a.bus.Subscribe("friend.request", func(ctx context.Context, event service.Event) {
		payload, ok := event.Payload.(map[string]interface{})
		if !ok {
			return
		}
		receiverID, _ := payload["receiver_id"].(string)
		if receiverID != "" {
			a.NotificationService.Notify(ctx, receiverID, model.TypeFriendRequest, payload)
		}
	})

	a.bus.Subscribe(ws.TypeFriendAccepted, func(ctx context.Context, event service.Event) {
		payload, ok := event.Payload.(map[string]interface{})
		if !ok {
			return
		}
		userID, _ := payload["user_id"].(string)
		if userID == "" {
			return
		}
		a.mgr.PushToUser(userID, ws.NewFrame(ws.TypeFriendAccepted, payload))
	})

	a.bus.Subscribe(ws.TypeSessionCreated, func(ctx context.Context, event service.Event) {
		payload, ok := event.Payload.(map[string]interface{})
		if !ok {
			return
		}
		frame := ws.NewFrame(ws.TypeSessionCreated, payload)
		if members := payloadStringSlice(payload, "members"); len(members) > 0 {
			for _, userID := range members {
				a.mgr.PushToUser(userID, frame)
			}
			return
		}
		sessionID, _ := payload["session_id"].(string)
		a.mgr.PushToSession(sessionID, frame)
	})

	for _, eventType := range []string{
		ws.TypeSessionMemberJoined,
		ws.TypeSessionMemberLeft,
		ws.TypeSessionInfoUpdated,
		ws.TypeSessionDissolved,
	} {
		eventType := eventType
		a.bus.Subscribe(eventType, func(ctx context.Context, event service.Event) {
			payload, ok := event.Payload.(map[string]interface{})
			if !ok {
				return
			}
			sessionID, _ := payload["session_id"].(string)
			if sessionID == "" {
				return
			}
			a.mgr.PushToSession(sessionID, ws.NewFrame(eventType, payload))
		})
	}
}

func payloadStringSlice(payload map[string]interface{}, key string) []string {
	switch value := payload[key].(type) {
	case []string:
		return value
	case []interface{}:
		result := make([]string, 0, len(value))
		for _, item := range value {
			if s, ok := item.(string); ok && s != "" {
				result = append(result, s)
			}
		}
		return result
	default:
		return nil
	}
}

// startTaskScheduler periodically scans for expired agent tasks and publishes timeout events.
func (a *App) startTaskScheduler(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(config.PendingTaskScanInterval)
		defer ticker.Stop()
		for range ticker.C {
			tasks, err := a.AgentService.ScanExpiredTasks()
			if err != nil {
				slog.Warn("failed to scan expired agent tasks", "error", err)
				continue
			}
			for _, task := range tasks {
				a.publishExpiredTaskTimeout(ctx, task)
			}
		}
	}()
}

func (a *App) publishExpiredTaskTimeout(ctx context.Context, task model.PendingAgentTask) {
	timedOut, err := a.AgentService.TimeoutExpiredTask(task.ID, task.Status)
	if err != nil {
		slog.Warn("failed to mark expired agent task timeout", "task_id", task.ID, "status", task.Status, "error", err)
		return
	}
	if !timedOut {
		slog.Info("skip stale expired agent task timeout", "task_id", task.ID, "scanned_status", task.Status)
		return
	}

	ai, _ := a.AgentService.GetAgentInstanceByID(task.AgentInstanceID)
	sessionID := ""
	if ai != nil {
		sessionID = ai.SessionID
	}
	a.bus.Publish(ctx, service.Event{
		Type: "agent.timeout",
		Payload: map[string]interface{}{
			"task_id":           task.ID,
			"agent_instance_id": task.AgentInstanceID,
			"session_id":        sessionID,
		},
	})
}

// startWebSocketCleanup starts heartbeat-based stale connection cleanup.
func (a *App) startWebSocketCleanup(ctx context.Context) {
	a.mgr.StartHeartbeat()
}

// startAdminServer starts the admin HTTP server with pprof, /metrics, /debug/config, /debug/state endpoints.
func (a *App) startAdminServer() {
	adminPort := a.Config.Server.AdminPort
	pprofUser := os.Getenv("AGENTHUB_PPROF_USER")
	pprofPass := os.Getenv("AGENTHUB_PPROF_PASS")
	if pprofUser == "" || pprofPass == "" {
		slog.Error("admin server not started: AGENTHUB_PPROF_USER and AGENTHUB_PPROF_PASS must both be set")
		return
	}

	metrics.Register()
	adminMux := http.NewServeMux()
	debugpkg.RegisterEndpoints(adminMux, debugpkg.MuxConfig{
		HealthCheckers: map[string]debugpkg.HealthChecker{
			"database": func(ctx context.Context) error {
				sqlDB, err := a.DB.DB()
				if err != nil {
					return err
				}
				return sqlDB.PingContext(ctx)
			},
			"redis": func(ctx context.Context) error {
				return a.CacheClient.GetRDB().Ping(ctx).Err()
			},
		},
		EnablePprof:    true,
		MetricsHandler: promhttp.Handler(),
		Auth:           debugpkg.BasicAuth(pprofUser, pprofPass),
		ConfigDumper:   a.hubConfigDumper(),
		StateDumper:    a.hubStateDumper(),
		Version:        "dev",
		StartTime:      a.startTime,
	})

	a.AdminServer = &http.Server{
		Addr:              adminListenAddr(adminPort),
		Handler:           adminMux,
		ReadHeaderTimeout: config.DefaultReadHeaderTimeout,
		ReadTimeout:       config.DefaultServerReadTimeout,
		WriteTimeout:      config.DefaultServerWriteTimeout,
		IdleTimeout:       config.DefaultServerIdleTimeout,
	}
	go func() {
		slog.Info("admin server starting", "addr", a.AdminServer.Addr)
		if err := a.AdminServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("admin server failed", "error", err)
		}
	}()
}

func (a *App) hubConfigDumper() debugpkg.ConfigDumper {
	return func() map[string]any {
		cfg := a.Config
		return map[string]any{
			"server_port":    cfg.Server.Port,
			"admin_port":     cfg.Server.AdminPort,
			"db_host":        cfg.DB.Host,
			"db_port":        cfg.DB.Port,
			"db_name":        cfg.DB.Name,
			"db_user":        cfg.DB.User,
			"db_password":    redactConfigSecret(cfg.DB.Password),
			"redis_addr":     cfg.Redis.Addr,
			"redis_password": redactConfigSecret(cfg.Redis.Password),
			"jwt_secret":     redactConfigSecret(cfg.JWT.Secret),
		}
	}
}

func redactConfigSecret(secret string) string {
	if secret == "" {
		return ""
	}
	return "[REDACTED]"
}

func (a *App) hubStateDumper() debugpkg.StateDumper {
	return func() map[string]any {
		state := map[string]any{}
		if a.DB != nil {
			if sqlDB, err := a.DB.DB(); err == nil {
				state["db_pool"] = map[string]any{
					"open_connections": sqlDB.Stats().OpenConnections,
					"in_use":           sqlDB.Stats().InUse,
					"idle":             sqlDB.Stats().Idle,
				}
			}
		}
		if a.mgr != nil {
			state["ws_connections"] = a.mgr.Count()
		}
		return state
	}
}

// startMetricsCollector periodically reports DB pool, WS connections, Redis hits, and bus queue length.
func (a *App) startMetricsCollector(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(config.MetricsCollectionInterval)
		defer ticker.Stop()
		for range ticker.C {
			if sqlDB, err := a.DB.DB(); err == nil {
				stats := sqlDB.Stats()
				metrics.DBPoolInUse.Set(float64(stats.InUse))
			}
			metrics.WSConnections.Set(float64(a.mgr.Count()))
			metrics.RedisPoolHits.Set(float64(a.CacheClient.PoolStats().Hits))
			metrics.EventBusQueueLen.Set(float64(a.bus.Running()))
		}
	}()
}

// syncLegacySeqs copies existing session next_seq values from DB into Redis.
func (a *App) syncLegacySeqs() {
	ctx := a.coreCtx
	var sessions []model.Session
	if err := a.DB.Select("id, next_seq").Where("next_seq > 0").Find(&sessions).Error; err != nil {
		slog.Warn("failed to query sessions for seq sync", "error", err)
		return
	}
	count := 0
	for _, sess := range sessions {
		if err := a.CacheClient.InitSeqIfAbsent(ctx, sess.ID, sess.NextSeq); err != nil {
			slog.Warn("failed to init seq in redis", "session_id", sess.ID, "error", err)
		} else {
			count++
		}
	}
	slog.Info("legacy session seq sync completed", "total", len(sessions), "synced", count)
}

// ── WebSocket route callbacks ──────────────────────────────────────────────

func (a *App) onRouteSet(userID, deviceType, deviceID, connID, oldConnID string, wasOffline bool) {
	ctx := a.coreCtx

	if oldConnID != "" && oldConnID != connID {
		a.CacheClient.MarkKicked(ctx, oldConnID)
		a.mgr.PushToConn(oldConnID, ws.NewFrame(ws.TypeDeviceKicked, map[string]string{
			"reason": "logged_in_elsewhere",
		}))
		if c := a.mgr.FindByConnID(oldConnID); c != nil {
			c.Close()
		}
	}

	routeField := deviceType
	if deviceID != "" {
		routeField = deviceType + ":" + deviceID
	}
	a.CacheClient.SetRoute(ctx, userID, routeField, connID)

	if wasOffline {
		go a.broadcastOnlineStatus(ctx, userID, true)
	}

	if deviceType == "desktop" {
		if deviceID != "" {
			go a.pushPendingTargetTasks(ctx, userID, deviceID, connID)
			go a.pushPendingAgentControls(ctx, userID, deviceID, connID)
		}
		go a.pushPendingTasks(ctx, userID, connID)
	}
}

func (a *App) pushPendingTargetTasks(ctx context.Context, userID, deviceID, connID string) {
	tasks, err := a.CacheClient.ListPendingTargetTasksForDevice(ctx, userID, deviceID)
	if err != nil || len(tasks) == 0 {
		return
	}
	for _, task := range tasks {
		var payload json.RawMessage
		if json.Unmarshal([]byte(task.Payload), &payload) == nil {
			var meta struct {
				TaskID string `json:"task_id"`
			}
			if json.Unmarshal([]byte(task.Payload), &meta) == nil && meta.TaskID != "" {
				if err := a.AgentService.UpdatePendingTaskDispatched(meta.TaskID, deviceID); err != nil {
					slog.Error("failed to mark target-bound queued task dispatched", "task_id", meta.TaskID, "user_id", userID, "device_id", deviceID, "error", err)
					continue
				}
			}
			result := a.mgr.PushToConn(connID, ws.NewFrame(ws.TypeAgentDispatch, payload))
			if !result.Queued {
				slog.Warn("target-bound queued task replay not queued; keeping pending task", "task_id", meta.TaskID, "target_id", task.TargetID, "user_id", userID, "device_id", deviceID, "conn_id", connID, "delivery_status", result.Status, "error", result.Err)
				continue
			}
			if err := a.CacheClient.AckPendingTargetTask(ctx, userID, task.TargetID, deviceID, task.Payload); err != nil {
				slog.Error("failed to ack target-bound queued task", "task_id", meta.TaskID, "target_id", task.TargetID, "user_id", userID, "device_id", deviceID, "error", err)
				continue
			}
		}
	}
}

func (a *App) pushPendingAgentControls(ctx context.Context, userID, deviceID, connID string) {
	controls, err := a.CacheClient.ListPendingAgentControlsForDevice(ctx, userID, deviceID)
	if err != nil || len(controls) == 0 {
		return
	}
	for _, controlJSON := range controls {
		var payload json.RawMessage
		if json.Unmarshal([]byte(controlJSON), &payload) == nil {
			result := a.mgr.PushToConn(connID, ws.NewFrame(ws.TypeAgentControl, payload))
			if !result.Queued {
				slog.Warn("agent control replay not queued; keeping pending control", "user_id", userID, "device_id", deviceID, "conn_id", connID, "delivery_status", result.Status, "error", result.Err)
				continue
			}
			if err := a.CacheClient.AckPendingAgentControl(ctx, userID, deviceID, controlJSON); err != nil {
				slog.Error("failed to ack pending agent control", "user_id", userID, "device_id", deviceID, "error", err)
				continue
			}
		}
	}
}

func (a *App) pushPendingTasks(ctx context.Context, userID, connID string) {
	tasks, err := a.CacheClient.PopPendingTasks(ctx, userID)
	if err != nil || len(tasks) == 0 {
		return
	}
	conn := a.mgr.FindByConnID(connID)
	edgeDeviceID := ""
	if conn != nil {
		edgeDeviceID = conn.DeviceID
	}
	failedTasks := make([]string, 0)
	for _, taskJSON := range tasks {
		var payload json.RawMessage
		if json.Unmarshal([]byte(taskJSON), &payload) == nil {
			var meta struct {
				TaskID string `json:"task_id"`
			}
			if json.Unmarshal([]byte(taskJSON), &meta) == nil && meta.TaskID != "" {
				if err := a.AgentService.UpdatePendingTaskDispatched(meta.TaskID, edgeDeviceID); err != nil {
					slog.Error("failed to mark queued task dispatched", "task_id", meta.TaskID, "user_id", userID, "device_id", edgeDeviceID, "error", err)
					continue
				}
			}
			result := a.mgr.PushToConn(connID, ws.NewFrame(ws.TypeAgentDispatch, payload))
			if !result.Queued {
				slog.Warn("queued task replay not queued; requeueing pending task", "task_id", meta.TaskID, "user_id", userID, "device_id", edgeDeviceID, "conn_id", connID, "delivery_status", result.Status, "error", result.Err)
				failedTasks = append(failedTasks, taskJSON)
			}
		}
	}
	for i := len(failedTasks) - 1; i >= 0; i-- {
		if err := a.CacheClient.PushPendingTask(ctx, userID, failedTasks[i]); err != nil {
			slog.Error("failed to requeue pending task after websocket delivery failure", "user_id", userID, "conn_id", connID, "error", err)
		}
	}
}

func (a *App) onRouteDel(userID, deviceType, deviceID, connID string) {
	ctx := a.coreCtx

	kicked, _ := a.CacheClient.IsKicked(ctx, connID)
	if !kicked {
		routeField := deviceType
		if deviceID != "" {
			routeField = deviceType + ":" + deviceID
		}
		a.CacheClient.DeleteRoute(ctx, userID, routeField)
		online, _ := a.CacheClient.IsOnline(ctx, userID)
		if !online {
			go a.broadcastOnlineStatus(ctx, userID, false)
		}
	}
}

func (a *App) broadcastOnlineStatus(ctx context.Context, userID string, online bool) {
	friendIDs, err := a.ContactService.GetFriendIDs(userID)
	if err != nil || len(friendIDs) == 0 {
		return
	}

	var eventType string
	if online {
		eventType = ws.TypeDeviceOnline
	} else {
		eventType = ws.TypeDeviceOffline
	}

	frame := ws.NewFrame(eventType, map[string]string{"user_id": userID})
	for _, friendID := range friendIDs {
		if online, _ := a.CacheClient.IsOnline(ctx, friendID); online {
			a.mgr.PushToUser(friendID, frame)
		}
	}
}

// ── Helpers ────────────────────────────────────────────────────────────────

func adminListenAddr(adminPort int) string {
	if adminPort == 0 {
		adminPort = 6060
	}
	return fmt.Sprintf("127.0.0.1:%d", adminPort)
}
