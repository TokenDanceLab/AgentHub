package app

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/pprof"
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
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/hub-server/internal/router"
	"github.com/agenthub/hub-server/internal/service"
	"github.com/agenthub/hub-server/internal/ws"
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
	AuthService         *service.AuthService
	ContactService      *service.ContactService
	SessionService      *service.SessionService
	MessageService      *service.MessageService
	AgentService        *service.AgentService
	AttachmentService   *service.AttachmentService
	NotificationService *service.NotificationService
	DeviceService       *service.DeviceService

	// Handler layer
	AuthHandler         *handler.AuthHandler
	WebSocketHandler    *handler.WebSocketHandler
	DeviceHandler       *handler.DeviceHandler
	ContactHandler      *handler.ContactHandler
	SessionHandler      *handler.SessionHandler
	MessageHandler      *handler.MessageHandler
	AgentHandler        *handler.AgentHandler
	CustomAgentHandler  *handler.CustomAgentHandler
	AttachmentHandler   *handler.AttachmentHandler
	NotificationHandler *handler.NotificationHandler
	HealthHandler       *handler.HealthHandler
	PublicHandler       *handler.PublicHandler

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
	a.AttachmentService = service.NewAttachmentService(a.DB, a.Config.Upload)
	a.ContactService = service.NewContactService(a.DB, a.bus, a.CacheClient)
	a.SessionService = service.NewSessionService(a.DB, a.CacheClient)
	a.MessageService = service.NewMessageService(a.DB, a.bus, a.CacheClient)
	a.AgentService = service.NewAgentService(a.DB, a.bus, a.mgr, a.CacheClient)
	a.DeviceService = service.NewDeviceService(a.DB)

	// Handler layer
	a.AuthHandler = handler.NewAuthHandler(a.AuthService)
	a.DeviceHandler = handler.NewDeviceHandler(a.DeviceService)
	a.ContactHandler = handler.NewContactHandler(a.ContactService)
	a.SessionHandler = handler.NewSessionHandler(a.SessionService)
	a.MessageHandler = handler.NewMessageHandler(a.MessageService)
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
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      config.DefaultServerWriteTimeout,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    1 << 20,
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
			members, err := repository.ListActiveMembers(a.DB, sessionID)
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
		members, err := repository.ListActiveMembers(a.DB, sessionID)
		if err != nil {
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

	a.bus.Subscribe("message.read", func(ctx context.Context, event service.Event) {
		payload, ok := event.Payload.(map[string]interface{})
		if !ok {
			return
		}
		frame := ws.NewFrame(ws.TypeMessageRead, payload)
		sessionID, _ := payload["session_id"].(string)
		a.mgr.PushToSession(sessionID, frame)
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
			task, err := repository.GetPendingTaskByID(a.DB, taskID)
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
}

// startTaskScheduler periodically scans for expired agent tasks and publishes timeout events.
func (a *App) startTaskScheduler(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(1 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			tasks, err := repository.ScanExpiredTasks(a.DB)
			if err != nil {
				slog.Warn("failed to scan expired agent tasks", "error", err)
				continue
			}
			for _, task := range tasks {
				_ = repository.UpdatePendingTaskStatus(a.DB, task.ID, model.TaskStatusTimeout, "")
				ai, _ := repository.GetAgentInstanceByID(a.DB, task.AgentInstanceID)
				sessionID := ""
				if ai != nil {
					sessionID = ai.SessionID
				}
				a.bus.Publish(a.coreCtx, service.Event{
					Type: "agent.timeout",
					Payload: map[string]interface{}{
						"task_id":           task.ID,
						"agent_instance_id": task.AgentInstanceID,
						"session_id":        sessionID,
					},
				})
			}
		}
	}()
}

// startWebSocketCleanup starts heartbeat-based stale connection cleanup.
func (a *App) startWebSocketCleanup(ctx context.Context) {
	a.mgr.StartHeartbeat()
}

// startAdminServer starts the admin HTTP server with pprof and /metrics endpoints.
func (a *App) startAdminServer() {
	metrics.Register()

	adminPort := a.Config.Server.AdminPort
	if adminPort == 0 {
		adminPort = 6060
	}
	adminMux := http.NewServeMux()
	adminMux.HandleFunc("/debug/pprof/", pprof.Index)
	adminMux.HandleFunc("/debug/pprof/cmdline", pprof.Cmdline)
	adminMux.HandleFunc("/debug/pprof/profile", pprof.Profile)
	adminMux.HandleFunc("/debug/pprof/symbol", pprof.Symbol)
	adminMux.HandleFunc("/debug/pprof/trace", pprof.Trace)
	adminMux.Handle("/metrics", promhttp.Handler())
	pprofUser := os.Getenv("AGENTHUB_PPROF_USER")
	pprofPass := os.Getenv("AGENTHUB_PPROF_PASS")
	if pprofUser == "" || pprofPass == "" {
		slog.Error("admin server not started: AGENTHUB_PPROF_USER and AGENTHUB_PPROF_PASS must both be set")
		return
	}
	adminHandler := pprofBasicAuth(adminMux, pprofUser, pprofPass)
	a.AdminServer = &http.Server{
		Addr:              fmt.Sprintf("127.0.0.1:%d", adminPort),
		Handler:           adminHandler,
		ReadHeaderTimeout: config.DefaultReadHeaderTimeout,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      config.DefaultServerWriteTimeout,
		IdleTimeout:       120 * time.Second,
	}
	go func() {
		slog.Info("admin server starting", "port", adminPort)
		if err := a.AdminServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("admin server failed", "error", err)
		}
	}()
}

// startMetricsCollector periodically reports DB pool, WS connections, Redis hits, and bus queue length.
func (a *App) startMetricsCollector(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(15 * time.Second)
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

func (a *App) onRouteSet(userID, deviceType, connID, oldConnID string, wasOffline bool) {
	ctx := a.coreCtx

	if oldConnID != "" && oldConnID != connID {
		a.CacheClient.MarkKicked(ctx, oldConnID)
		a.mgr.PushToConn(oldConnID, ws.NewFrame(ws.TypeDeviceKicked, map[string]string{
			"reason": "logged_in_elsewhere",
		}))
		if c := a.mgr.FindByUserDevice(userID, deviceType); c != nil && c.ID == oldConnID {
			c.Close()
		}
	}

	a.CacheClient.SetRoute(ctx, userID, deviceType, connID)

	if wasOffline {
		go a.broadcastOnlineStatus(ctx, userID, true)
	}

	if deviceType == "desktop" {
		go a.pushPendingTasks(ctx, userID, connID)
	}
}

func (a *App) pushPendingTasks(ctx context.Context, userID, connID string) {
	tasks, err := a.CacheClient.PopPendingTasks(ctx, userID)
	if err != nil || len(tasks) == 0 {
		return
	}
	for _, taskJSON := range tasks {
		var payload json.RawMessage
		if json.Unmarshal([]byte(taskJSON), &payload) == nil {
			a.mgr.PushToConn(connID, ws.NewFrame(ws.TypeAgentDispatch, payload))
		}
	}
}

func (a *App) onRouteDel(userID, deviceType, connID string) {
	ctx := a.coreCtx

	kicked, _ := a.CacheClient.IsKicked(ctx, connID)
	if !kicked {
		a.CacheClient.DeleteRoute(ctx, userID, deviceType)
		online, _ := a.CacheClient.IsOnline(ctx, userID)
		if !online {
			go a.broadcastOnlineStatus(ctx, userID, false)
		}
	}
}

func (a *App) broadcastOnlineStatus(ctx context.Context, userID string, online bool) {
	friendIDs, err := repository.GetFriendIDs(a.DB, userID)
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

func pprofBasicAuth(next http.Handler, user, pass string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u, p, ok := r.BasicAuth()
		if !ok || subtle.ConstantTimeCompare([]byte(u), []byte(user)) != 1 || subtle.ConstantTimeCompare([]byte(p), []byte(pass)) != 1 {
			w.Header().Set("WWW-Authenticate", `Basic realm="pprof"`)
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}
