package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/agenthub/hub-server/internal/cache"
	"github.com/agenthub/hub-server/internal/config"
	"github.com/alicebob/miniredis/v2"
	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestHealthHandler_Check(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := newDegradedHealthHandler(t, "1.0.0-test")

	r := gin.New()
	r.GET("/health", h.Check)

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	data := decodeHealthData(t, w)
	assert.Equal(t, "degraded", data["status"])
	assert.Equal(t, false, data["ready"])
	assert.Equal(t, true, data["live"])
	assert.Equal(t, "1.0.0-test", data["version"])
	assert.Contains(t, data, "uptime")
	assert.Contains(t, data, "checks")
}

func TestHealthHandler_ReadyReturnsServiceUnavailableWhenDegraded(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := newDegradedHealthHandler(t, "1.0.0-test")

	r := gin.New()
	r.GET("/health/ready", h.Ready)

	req := httptest.NewRequest(http.MethodGet, "/health/ready", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusServiceUnavailable, w.Code)

	data := decodeHealthData(t, w)
	assert.Equal(t, "degraded", data["status"])
	assert.Equal(t, false, data["ready"])
	assert.Equal(t, true, data["live"])
	assert.Contains(t, data, "checks")
}

func TestHealthHandler_LiveReturnsOKWithoutDependencyChecks(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := NewHealthHandler(nil, nil, nil, time.Now(), "1.0.0-test")

	r := gin.New()
	r.GET("/health/live", h.Live)

	req := httptest.NewRequest(http.MethodGet, "/health/live", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	data := decodeHealthData(t, w)
	assert.Equal(t, "ok", data["status"])
	assert.Equal(t, true, data["live"])
	assert.Equal(t, "1.0.0-test", data["version"])
	assert.Contains(t, data, "uptime")
}

func newDegradedHealthHandler(t *testing.T, version string) *HealthHandler {
	t.Helper()

	sqlDB, mock, err := sqlmock.New(sqlmock.MonitorPingsOption(true))
	require.NoError(t, err)
	t.Cleanup(func() {
		_ = sqlDB.Close()
	})

	gormDB, err := gorm.Open(postgres.New(postgres.Config{Conn: sqlDB}), &gorm.Config{
		SkipDefaultTransaction: true,
		PrepareStmt:            false,
		DisableAutomaticPing:   true,
	})
	require.NoError(t, err)

	mock.ExpectPing()

	// Setup miniredis for cache client
	mr, err := miniredis.Run()
	require.NoError(t, err)
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		require.NoError(t, rdb.Close())
	})
	cacheClient := cache.NewClient(rdb)

	dbConfig := &config.DBConfig{
		Host: "127.0.0.1",
		Port: 9999,
		User: "test",
		Name: "testdb",
	}

	return NewHealthHandler(gormDB, cacheClient, dbConfig, time.Now(), version)
}

func decodeHealthData(t *testing.T, w *httptest.ResponseRecorder) map[string]interface{} {
	t.Helper()

	var body struct {
		Data map[string]interface{} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
	require.NotNil(t, body.Data)
	return body.Data
}
