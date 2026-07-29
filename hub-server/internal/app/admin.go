package app

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/prometheus/client_golang/prometheus/promhttp"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/metrics"
	"github.com/agenthub/hub-server/internal/middleware"
	debugpkg "github.com/agenthub/pkg/debug"
)

// startAdminServer starts the admin HTTP server with pprof, /metrics, /debug/config, /debug/state endpoints.
func (a *App) startAdminServer() {
	// Register Prometheus metrics unconditionally so middleware never nil-pointer dereferences.
	metrics.Register()

	adminPort := a.Config.Server.AdminPort
	pprofUser := os.Getenv("AGENTHUB_PPROF_USER")
	pprofPass := os.Getenv("AGENTHUB_PPROF_PASS")
	if pprofUser == "" || pprofPass == "" {
		slog.Error("admin server not started: AGENTHUB_PPROF_USER and AGENTHUB_PPROF_PASS must both be set")
		if metrics.AdminServerUp != nil {
			metrics.AdminServerUp.Set(0)
		}
		return
	}

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
		Handler:           middleware.RecoveryHTTPHandler(adminMux),
		ReadHeaderTimeout: config.DefaultReadHeaderTimeout,
		ReadTimeout:       config.DefaultServerReadTimeout,
		WriteTimeout:      config.DefaultServerWriteTimeout,
		IdleTimeout:       config.DefaultServerIdleTimeout,
	}
	go func() {
		slog.Info("admin server starting", "addr", a.AdminServer.Addr)
		if err := a.AdminServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("admin server failed", "error", err)
			if metrics.AdminServerUp != nil {
				metrics.AdminServerUp.Set(0)
			}
		}
	}()
	if metrics.AdminServerUp != nil {
		metrics.AdminServerUp.Set(1)
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
	go func() {
		ticker := time.NewTicker(config.MetricsCollectionInterval)
		defer ticker.Stop()
		// G11: redis.PoolStats().Hits is a cumulative monotonic counter; we track
		// the delta per tick and Add() to the Counter (was incorrectly Set on a Gauge).
		var prevRedisPoolHits uint32
		for {
			select {
			case <-ticker.C:
				if sqlDB, err := a.DB.DB(); err == nil {
					stats := sqlDB.Stats()
					metrics.DBPoolInUse.Set(float64(stats.InUse))
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
			case <-ctx.Done():
				return
			}
		}
	}()
}

// ── Helpers ────────────────────────────────────────────────────────────────

func adminListenAddr(adminPort int) string {
	if adminPort == 0 {
		adminPort = 6060
	}
	return fmt.Sprintf("127.0.0.1:%d", adminPort)
}
