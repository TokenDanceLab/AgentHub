package handler

import (
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

	// Setup sqlmock for gorm.DB
	sqlDB, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer sqlDB.Close()

	gormDB, err := gorm.Open(postgres.New(postgres.Config{Conn: sqlDB}), &gorm.Config{
		SkipDefaultTransaction: true,
		PrepareStmt:            false,
	})
	require.NoError(t, err)

	mock.ExpectPing()

	// Setup miniredis for cache client
	mr, err := miniredis.Run()
	require.NoError(t, err)
	defer mr.Close()
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	cacheClient := cache.NewClient(rdb)

	dbConfig := &config.DBConfig{
		Host: "127.0.0.1",
		Port: 9999,
		User: "test",
		Name: "testdb",
	}

	h := NewHealthHandler(gormDB, cacheClient, dbConfig, time.Now(), "1.0.0-test")

	r := gin.New()
	r.GET("/health", h.Check)

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), "status")
	assert.Contains(t, w.Body.String(), "version")
	assert.Contains(t, w.Body.String(), "uptime")
	assert.Contains(t, w.Body.String(), "checks")
	assert.Contains(t, w.Body.String(), "1.0.0-test")
}
