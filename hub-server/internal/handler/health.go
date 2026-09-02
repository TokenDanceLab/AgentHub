package handler

import (
	"github.com/agenthub/hub-server/internal/errcode"

	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/cache"
	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/repository"
)

// HealthHandler serves the load-balancer /health endpoint with component-level
// status, version, uptime, and migration version.
type HealthHandler struct {
	db          *gorm.DB
	cacheClient *cache.Client
	dbConfig    *config.DBConfig
	startTime   time.Time
	version     string

	mu       sync.RWMutex
	migCache migrationCache
}

type migrationCache struct {
	version  uint
	dirty    bool
	err      error
	cachedAt time.Time
}

const migrationCacheTTL = 30 * time.Second

// NewHealthHandler creates a HealthHandler tied to the running app instance.
// startTime should be the moment App.Run was called; version is the build
// version resolved by the caller (app.New: -X value, then VCS stamping, then "dev").
func NewHealthHandler(db *gorm.DB, cacheClient *cache.Client, dbConfig *config.DBConfig, startTime time.Time, version string) *HealthHandler {
	if version == "" {
		version = "dev"
	}
	return &HealthHandler{
		db:          db,
		cacheClient: cacheClient,
		dbConfig:    dbConfig,
		startTime:   startTime,
		version:     version,
	}
}

// Check returns a detailed health report for monitoring/LB probes.
func (h *HealthHandler) Check(c *gin.Context) {
	OK(c, h.readinessReport(c))
}

// Live returns process liveness only. It intentionally avoids dependency checks
// so orchestrators do not restart a live process just because it is unready.
func (h *HealthHandler) Live(c *gin.Context) {
	OK(c, h.liveReport())
}

// Ready returns dependency readiness. Degraded state is a 503 for load
// balancers and deployment scripts, while /health remains backward compatible.
func (h *HealthHandler) Ready(c *gin.Context) {
	report := h.readinessReport(c)
	statusCode := http.StatusOK
	if report["status"] != "ok" {
		statusCode = http.StatusServiceUnavailable
	}

	c.JSON(statusCode, Response{
		Code: errcode.OK.Code,
		Data: report,
	})
}

func (h *HealthHandler) liveReport() gin.H {
	uptime := time.Since(h.startTime).Truncate(time.Second).String()

	return gin.H{
		"status":  "ok",
		"live":    true,
		"version": h.version,
		"uptime":  uptime,
	}
}

func (h *HealthHandler) readinessReport(c *gin.Context) gin.H {
	checks := make(map[string]interface{}, 3)
	overall := "ok"

	// DB
	if h.db == nil {
		checks["database"] = "error"
		overall = "degraded"
	} else if sqlDB, err := h.db.DB(); err == nil {
		if err := sqlDB.Ping(); err != nil {
			checks["database"] = "error"
			overall = "degraded"
		} else {
			checks["database"] = "ok"
		}
	} else {
		checks["database"] = "error"
		overall = "degraded"
	}

	// Redis
	if h.cacheClient == nil {
		checks["redis"] = "error"
		overall = "degraded"
	} else if err := h.cacheClient.GetRDB().Ping(c.Request.Context()).Err(); err != nil {
		checks["redis"] = "error"
		overall = "degraded"
	} else {
		checks["redis"] = "ok"
	}

	// Migrations – report version; if dirty or unreadable, flag error.
	// Cache the result for 30s to avoid per-request DB round-trips to the
	// migration metadata table.
	if h.dbConfig == nil {
		checks["migrations"] = "error"
		overall = "degraded"
	} else {
		var version uint
		var dirty bool
		var migErr error

		h.mu.RLock()
		if time.Since(h.migCache.cachedAt) < migrationCacheTTL {
			version, dirty, migErr = h.migCache.version, h.migCache.dirty, h.migCache.err
			h.mu.RUnlock()
		} else {
			h.mu.RUnlock()
			version, dirty, migErr = repository.VerifyMigrations(h.dbConfig)
			h.mu.Lock()
			h.migCache = migrationCache{
				version:  version,
				dirty:    dirty,
				err:      migErr,
				cachedAt: time.Now(),
			}
			h.mu.Unlock()
		}

		if migErr != nil {
			checks["migrations"] = "error"
			overall = "degraded"
		} else if dirty {
			checks["migrations"] = gin.H{"version": version, "dirty": true}
			overall = "degraded"
		} else {
			checks["migrations"] = version
		}
	}

	uptime := time.Since(h.startTime).Truncate(time.Second).String()

	return gin.H{
		"status":  overall,
		"ready":   overall == "ok",
		"live":    true,
		"version": h.version,
		"uptime":  uptime,
		"checks":  checks,
	}
}
