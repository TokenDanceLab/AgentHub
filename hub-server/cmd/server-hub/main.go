package main

import (
	"context"
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

	"github.com/agenthub/hub-server/internal/cache"
	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/handler"
	"github.com/agenthub/hub-server/internal/log"
	"github.com/agenthub/hub-server/internal/metrics"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/hub-server/internal/router"
	"github.com/agenthub/hub-server/internal/service"
	"github.com/agenthub/hub-server/internal/ws"
)

var mgr *ws.Manager
var bus *service.Bus

func main() {
	cfg, err := config.Load("configs/config.yaml")
	if err != nil {
		slog.Error("failed to load config", "error", err)
		os.Exit(1)
	}

	if cfg.Server.LogLevel == "debug" {
		gin.SetMode(gin.DebugMode)
	} else {
		gin.SetMode(gin.ReleaseMode)
	}

	log.Init(&cfg.Server)
	defer log.Sync()

	if err := repository.InitDB(&cfg.DB); err != nil {
		slog.Error("failed to init database", "error", err)
		os.Exit(1)
	}

	if err := repository.RunMigrations(&cfg.DB); err != nil {
		slog.Error("failed to run migrations", "error", err)
		os.Exit(1)
	}

	if err := cache.InitRedis(&cfg.Redis); err != nil {
		slog.Error("failed to init redis", "error", err)
		os.Exit(1)
	}

	go func() {
		ctx := context.Background()
		var sessions []model.Session
		if err := repository.DB.Select("id, next_seq").Where("next_seq > 0").Find(&sessions).Error; err != nil {
			slog.Warn("failed to query sessions for seq sync", "error", err)
			return
		}
		count := 0
		for _, sess := range sessions {
			if err := cache.InitSeqIfAbsent(ctx, sess.ID, sess.NextSeq); err != nil {
				slog.Warn("failed to init seq in redis", "session_id", sess.ID, "error", err)
			} else {
				count++
			}
		}
		slog.Info("legacy session seq sync completed", "total", len(sessions), "synced", count)
	}()

	mgr = ws.NewManager()
	mgr.OnRouteSet = onRouteSet
	mgr.OnRouteDel = onRouteDel
	mgr.ResolveMembers = func(sessionID string) []string {
		ctx := context.Background()
		ids, err := cache.GetOrLoad(ctx, "session:members:"+sessionID, 5*time.Minute, func(ctx context.Context) ([]string, error) {
			members, err := repository.ListActiveMembers(repository.DB, sessionID)
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
	mgr.StartHeartbeat()

	wsHandler := handler.NewWebSocketHandler(mgr, cfg.JWT.Secret)
	wsHandler.SetOnTyping(func(userID, sessionID string) {
		frame := ws.NewFrame(ws.TypeTyping, map[string]interface{}{
			"user_id":    userID,
			"session_id": sessionID,
		})
		members, err := repository.ListActiveMembers(repository.DB, sessionID)
		if err != nil {
			return
		}
		for _, member := range members {
			if member.MemberID != userID {
				mgr.PushToUser(member.MemberID, frame)
			}
		}
	})
	authService := service.NewAuthService(repository.DB)
	authHandler := handler.NewAuthHandler(authService)
	deviceHandler := handler.NewDeviceHandler(repository.DB)

	bus = service.NewBus()
	defer bus.Close()

	notificationService := service.NewNotificationService(repository.DB, mgr)
	notificationHandler := handler.NewNotificationHandler(notificationService)

	attachmentService := service.NewAttachmentService(repository.DB)
	attachmentHandler := handler.NewAttachmentHandler(attachmentService)

	contactService := service.NewContactService(repository.DB, bus)
	contactHandler := handler.NewContactHandler(contactService)
	sessionService := service.NewSessionService(repository.DB)
	sessionHandler := handler.NewSessionHandler(sessionService)

	messageService := service.NewMessageService(repository.DB, bus)
	messageHandler := handler.NewMessageHandler(messageService)

	agentService := service.NewAgentService(repository.DB, bus, mgr)
	agentHandler := handler.NewAgentHandler(agentService)
	customAgentHandler := handler.NewCustomAgentHandler(agentService)

	bus.Subscribe("message.new", func(ctx context.Context, event service.Event) {
		msg, ok := event.Payload.(*model.Message)
		if !ok {
			return
		}
		frame := ws.NewFrame(ws.TypeMessageNew, msg)
		mgr.PushToSession(msg.SessionID, frame)
	})

	bus.Subscribe("message.recall", func(ctx context.Context, event service.Event) {
		msg, ok := event.Payload.(*model.Message)
		if !ok {
			return
		}
		frame := ws.NewFrame(ws.TypeMessageRecall, map[string]string{
			"message_id": msg.ID,
			"session_id": msg.SessionID,
		})
		mgr.PushToSession(msg.SessionID, frame)
	})

	bus.Subscribe("message.pin", func(ctx context.Context, event service.Event) {
		pin, ok := event.Payload.(*model.MessagePin)
		if !ok {
			return
		}
		frame := ws.NewFrame(ws.TypeMessagePin, pin)
		mgr.PushToSession(pin.SessionID, frame)
	})

	bus.Subscribe("message.unpin", func(ctx context.Context, event service.Event) {
		payload, ok := event.Payload.(map[string]string)
		if !ok {
			return
		}
		frame := ws.NewFrame(ws.TypeMessageUnpin, payload)
		mgr.PushToSession(payload["session_id"], frame)
	})

	bus.Subscribe("message.read", func(ctx context.Context, event service.Event) {
		payload, ok := event.Payload.(map[string]interface{})
		if !ok {
			return
		}
		frame := ws.NewFrame(ws.TypeMessageRead, payload)
		sessionID, _ := payload["session_id"].(string)
		mgr.PushToSession(sessionID, frame)
	})

	bus.Subscribe("agent.done", func(ctx context.Context, event service.Event) {
		payload, ok := event.Payload.(map[string]interface{})
		if !ok {
			return
		}
		frame := ws.NewFrame(ws.TypeAgentDone, payload)
		sessionID, _ := payload["session_id"].(string)
		mgr.PushToSession(sessionID, frame)

		taskID, _ := payload["task_id"].(string)
		if taskID != "" {
			task, err := repository.GetPendingTaskByID(repository.DB, taskID)
			if err == nil && task != nil {
				notificationService.Notify(ctx, task.TriggeredByUserID, model.TypeAgentDone, map[string]interface{}{
					"task_id":           payload["task_id"],
					"agent_instance_id": payload["agent_instance_id"],
					"session_id":        payload["session_id"],
				})
			}
		}
	})

	bus.Subscribe("agent.failed", func(ctx context.Context, event service.Event) {
		payload, ok := event.Payload.(map[string]interface{})
		if !ok {
			return
		}
		frame := ws.NewFrame(ws.TypeAgentFailed, payload)
		sessionID, _ := payload["session_id"].(string)
		mgr.PushToSession(sessionID, frame)
	})

	bus.Subscribe("agent.timeout", func(ctx context.Context, event service.Event) {
		payload, ok := event.Payload.(map[string]interface{})
		if !ok {
			return
		}
		frame := ws.NewFrame(ws.TypeAgentFailed, payload)
		sessionID, _ := payload["session_id"].(string)
		mgr.PushToSession(sessionID, frame)
	})

	bus.Subscribe("agent.cancel", func(ctx context.Context, event service.Event) {
		payload, ok := event.Payload.(map[string]string)
		if !ok {
			return
		}
		frame := ws.NewFrame(ws.TypeAgentCancel, payload)
		sessionID := payload["session_id"]
		mgr.PushToSession(sessionID, frame)
	})

	bus.Subscribe("friend.request", func(ctx context.Context, event service.Event) {
		payload, ok := event.Payload.(map[string]interface{})
		if !ok {
			return
		}
		receiverID, _ := payload["receiver_id"].(string)
		if receiverID != "" {
			notificationService.Notify(ctx, receiverID, model.TypeFriendRequest, payload)
		}
	})

	// P11.8: timeout scanner — scans expired tasks every minute
	go func() {
		ticker := time.NewTicker(1 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			tasks, err := repository.ScanExpiredTasks(repository.DB)
			if err != nil {
				slog.Warn("failed to scan expired agent tasks", "error", err)
				continue
			}
			for _, task := range tasks {
				_ = repository.UpdatePendingTaskStatus(repository.DB, task.ID, model.TaskStatusTimeout, "")
				ai, _ := repository.GetAgentInstanceByID(repository.DB, task.AgentInstanceID)
				sessionID := ""
				if ai != nil {
					sessionID = ai.SessionID
				}
				bus.Publish(context.Background(), service.Event{
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

	// Register prometheus metrics and start admin HTTP server for pprof + /metrics
	metrics.Register()

	adminPort := cfg.Server.AdminPort
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
	adminSrv := &http.Server{
		Addr:              fmt.Sprintf(":%d", adminPort),
		Handler:           adminMux,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	go func() {
		slog.Info("admin server starting", "port", adminPort)
		if err := adminSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("admin server failed", "error", err)
		}
	}()

	// Periodic metrics collection
	go func() {
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			if sqlDB, err := repository.DB.DB(); err == nil {
				stats := sqlDB.Stats()
				metrics.DBPoolInUse.Set(float64(stats.InUse))
			}
			metrics.WSConnections.Set(float64(mgr.Count()))
			metrics.RedisPoolHits.Set(float64(cache.RDB.PoolStats().Hits))
			metrics.EventBusQueueLen.Set(float64(bus.Running()))
		}
	}()

	r := gin.New()
	r.Use(gin.Recovery())
	router.SetupRoutes(r, authHandler, wsHandler, deviceHandler, contactHandler, sessionHandler, messageHandler, agentHandler, customAgentHandler, attachmentHandler, notificationHandler)

	srv := &http.Server{
		Addr:              fmt.Sprintf(":%d", cfg.Server.Port),
		Handler:           r,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}

	go func() {
		slog.Info("server starting", "port", cfg.Server.Port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("server failed", "error", err)
			os.Exit(1)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	slog.Info("shutting down servers...")

	ctxShutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctxShutdown); err != nil {
		slog.Error("server shutdown failed", "error", err)
	}
	if err := adminSrv.Shutdown(ctxShutdown); err != nil {
		slog.Error("admin server shutdown failed", "error", err)
	}

	slog.Info("servers exited")
}

func onRouteSet(userID, deviceType, connID, oldConnID string, wasOffline bool) {
	ctx := context.Background()

	if oldConnID != "" && oldConnID != connID {
		cache.MarkKicked(ctx, oldConnID)
		mgr.PushToConn(oldConnID, ws.NewFrame(ws.TypeDeviceKicked, map[string]string{
			"reason": "logged_in_elsewhere",
		}))
		if c := mgr.FindByUserDevice(userID, deviceType); c != nil && c.ID == oldConnID {
			c.Close()
		}
	}

	cache.SetRoute(ctx, userID, deviceType, connID)

	if wasOffline {
		go broadcastOnlineStatus(ctx, userID, true)
	}

	if deviceType == "desktop" {
		go pushPendingTasks(ctx, userID, connID)
	}
}

func pushPendingTasks(ctx context.Context, userID, connID string) {
	tasks, err := cache.PopPendingTasks(ctx, userID)
	if err != nil || len(tasks) == 0 {
		return
	}
	for _, taskJSON := range tasks {
		var payload json.RawMessage
		if json.Unmarshal([]byte(taskJSON), &payload) == nil {
			mgr.PushToConn(connID, ws.NewFrame(ws.TypeAgentDispatch, payload))
		}
	}
}

func onRouteDel(userID, deviceType, connID string) {
	ctx := context.Background()

	kicked, _ := cache.IsKicked(ctx, connID)
	if !kicked {
		cache.DeleteRoute(ctx, userID, deviceType)
		online, _ := cache.IsOnline(ctx, userID)
		if !online {
			go broadcastOnlineStatus(ctx, userID, false)
		}
	}
}

func broadcastOnlineStatus(ctx context.Context, userID string, online bool) {
	friendIDs, err := repository.GetFriendIDs(repository.DB, userID)
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
		if online, _ := cache.IsOnline(ctx, friendID); online {
			mgr.PushToUser(friendID, frame)
		}
	}
}
