package handler

import (
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
}

// NewHealthHandler creates a HealthHandler tied to the running app instance.
// startTime should be the moment App.Run was called; version is the build
// version (defaults to "dev").
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
	checks := make(map[string]interface{}, 3)
	overall := "ok"

	// DB
	if sqlDB, err := h.db.DB(); err == nil {
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
	if err := h.cacheClient.GetRDB().Ping(c.Request.Context()).Err(); err != nil {
		checks["redis"] = "error"
		overall = "degraded"
	} else {
		checks["redis"] = "ok"
	}

	// Migrations – report version; if dirty or unreadable, flag error.
	if version, dirty, err := repository.VerifyMigrations(h.dbConfig); err != nil {
		checks["migrations"] = "error"
		overall = "degraded"
	} else if dirty {
		checks["migrations"] = gin.H{"version": version, "dirty": true}
		overall = "degraded"
	} else {
		checks["migrations"] = version
	}

	uptime := time.Since(h.startTime).Truncate(time.Second).String()

	c.JSON(200, gin.H{
		"status":  overall,
		"version": h.version,
		"uptime":  uptime,
		"checks":  checks,
	})
}
