package app

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"time"

	"github.com/prometheus/client_golang/prometheus/promhttp"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/metrics"
	"github.com/agenthub/hub-server/internal/middleware"
	debugpkg "github.com/agenthub/pkg/debug"
)

// startAdminServer starts the admin HTTP server (#1547). Capability split:
//
//	observability (always):  /metrics, /health, /ready
//	high-sensitivity debug:  /debug/pprof/*, /debug/config, /debug/state
//
// The debug capabilities are only registered when AGENTHUB_PPROF_USER and
// AGENTHUB_PPROF_PASS are BOTH set — absent credentials fail closed (routes
// simply do not exist → 404, never weak defaults). Metrics and health never
// depend on debug credentials, so a config omission cannot blind production
// monitoring. The listener is bound synchronously so AdminServerUp reflects
// the real bind result (no transient 1 before a bind failure is known).
func (a *App) startAdminServer() error {
	// Register Prometheus metrics unconditionally so middleware never nil-pointer dereferences.
	metrics.Register()
	metrics.RegisterOrphanMetrics()
	metrics.RegisterSessionMetrics()

	adminPort := a.Config.Server.AdminPort
	pprofUser := os.Getenv("AGENTHUB_PPROF_USER")
	pprofPass := os.Getenv("AGENTHUB_PPROF_PASS")
	debugEnabled := pprofUser != "" && pprofPass != ""

	adminMux := http.NewServeMux()
	debugCfg := debugpkg.MuxConfig{
		HealthCheckers: map[string]debugpkg.HealthChecker{
			"database": func(ctx context.Context) error {
				if a.DB == nil {
					return fmt.Errorf("database not initialized")
				}
				sqlDB, err := a.DB.DB()
				if err != nil {
					return err
				}
				return sqlDB.PingContext(ctx)
			},
			"redis": func(ctx context.Context) error {
				if a.CacheClient == nil {
					return fmt.Errorf("redis not initialized")
				}
				return a.CacheClient.GetRDB().Ping(ctx).Err()
			},
		},
		EnablePprof:    debugEnabled,
		MetricsHandler: promhttp.Handler(),
		Version:        a.Version,
		StartTime:      a.startTime,
		// High-sensitivity endpoints require credentials; metrics use their
		// own (default public — the listener is loopback-bound).
		Auth: debugpkg.BasicAuth(pprofUser, pprofPass),
	}
	if debugEnabled {
		debugCfg.ConfigDumper = a.hubConfigDumper()
		debugCfg.StateDumper = a.hubStateDumper()
	}
	debugpkg.RegisterEndpoints(adminMux, debugCfg)

	// Synchronous bind: a busy port must be known before AdminServerUp is
	// set to 1 (previously the goroutine discovered it asynchronously).
	listen := net.Listen
	if a.adminListen != nil {
		listen = a.adminListen
	}
	listener, err := listen("tcp", adminListenAddr(adminPort))
	if err != nil {
		if metrics.AdminServerUp != nil {
			metrics.AdminServerUp.Set(0)
		}
		return fmt.Errorf("admin server bind failed: %w", err)
	}

	server := &http.Server{
		Addr:              listener.Addr().String(),
		Handler:           middleware.RecoveryHTTPHandler(adminMux),
		ReadHeaderTimeout: config.DefaultReadHeaderTimeout,
		ReadTimeout:       config.DefaultServerReadTimeout,
		WriteTimeout:      config.DefaultServerWriteTimeout,
		IdleTimeout:       config.DefaultServerIdleTimeout,
	}
	serveDone := make(chan struct{})
	a.AdminServer = server
	a.adminServeDone = serveDone
	if metrics.AdminServerUp != nil {
		metrics.AdminServerUp.Set(1)
	}
	go func() {
		defer close(serveDone)
		defer func() {
			if metrics.AdminServerUp != nil {
				metrics.AdminServerUp.Set(0)
			}
		}()
		slog.Info("admin server starting", "addr", server.Addr, "debug_capabilities", debugEnabled)
		if err := server.Serve(listener); err != nil && err != http.ErrServerClosed {
			slog.Error("admin server failed", "error", err)
		}
	}()
	if !debugEnabled {
		slog.Warn("admin server started without debug capabilities (AGENTHUB_PPROF_USER/PASS not both set): pprof/config/state disabled, metrics+health available")
	}
	return nil
}

// shutdownAdminServer closes the net/http server and waits for the Serve
// goroutine to relinquish the listener. http.Server.Shutdown can otherwise
// return before a just-started Serve call has registered its listener.
func (a *App) shutdownAdminServer(ctx context.Context) error {
	if a.AdminServer == nil {
		return nil
	}

	shutdownErr := a.AdminServer.Shutdown(ctx)
	done := a.adminServeDone
	if done == nil {
		return shutdownErr
	}

	select {
	case <-done:
		return shutdownErr
	case <-ctx.Done():
		if shutdownErr != nil {
			return shutdownErr
		}
		return ctx.Err()
	}
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
	a.bg.Go(func() error {
		ticker := time.NewTicker(config.MetricsCollectionInterval)
		defer ticker.Stop()
		// G11: redis.PoolStats().Hits is a cumulative monotonic counter; we track
		// the delta per tick and Add() to the Counter (was incorrectly Set on a Gauge).
		var prevRedisPoolHits uint32
		for {
			select {
			case <-ticker.C:
				prevRedisPoolHits = a.collectRuntimeMetrics(prevRedisPoolHits)
			case <-ctx.Done():
				return nil
			}
		}
	})
}

// collectRuntimeMetrics reports DB pool, WS connections, Redis hits, and bus
// queue length for one metrics tick, returning the latest Redis hits counter
// so the caller can compute the next-tick delta. All sources stay optional:
// runtime-nil components are skipped exactly as before.
func (a *App) collectRuntimeMetrics(prevRedisPoolHits uint32) uint32 {
	if sqlDB, err := a.DB.DB(); err == nil {
		stats := sqlDB.Stats()
		metrics.DBPoolInUse.Set(float64(stats.InUse))
		// G8: optional pool saturation gauge.
		if metrics.DBPoolIdle != nil {
			metrics.DBPoolIdle.Set(float64(stats.Idle))
		}
	}
	if a.mgr != nil {
		metrics.WSConnections.Set(float64(a.mgr.Count()))
	}
	if a.CacheClient != nil {
		hits := a.CacheClient.PoolStats().Hits
		if delta := hits - prevRedisPoolHits; delta > 0 {
			if metrics.RedisPoolHitsTotal != nil {
				metrics.RedisPoolHitsTotal.Add(float64(delta))
			}
		}
		prevRedisPoolHits = hits
	}
	if a.bus != nil {
		metrics.EventBusQueueLen.Set(float64(a.bus.Running()))
	}
	return prevRedisPoolHits
}

// ── Helpers ────────────────────────────────────────────────────────────────

func adminListenAddr(adminPort int) string {
	if adminPort == 0 {
		adminPort = 6060
	}
	return fmt.Sprintf("127.0.0.1:%d", adminPort)
}
