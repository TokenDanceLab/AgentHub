package handler_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"

	"github.com/agenthub/hub-server/internal/handler"
	"github.com/agenthub/hub-server/internal/model"
)

func TestPublicStatsBucketsCountsAndUptime(t *testing.T) {
	db := setupPublicStatsDB(t)
	seedPublicStatsRows(t, db, "users", 37)
	seedPublicStatsRows(t, db, "agent_instances", 1234)
	seedPublicStatsRows(t, db, "messages", 987)
	for i := 0; i < 24; i++ {
		require.NoError(t, db.Exec(
			"INSERT INTO pending_agent_tasks (id, agent_instance_id, status) VALUES (?, ?, ?)",
			fmt.Sprintf("task_running_%02d", i),
			fmt.Sprintf("agent_%02d", i),
			model.TaskStatusRunning,
		).Error)
	}
	require.NoError(t, db.Exec(
		"INSERT INTO pending_agent_tasks (id, agent_instance_id, status) VALUES (?, ?, ?)",
		"task_done_01",
		"agent_done_01",
		model.TaskStatusDone,
	).Error)

	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/public/stats", nil)
	h := handler.NewPublicHandler(db, time.Now().Add(-25*time.Hour-13*time.Minute))

	h.Stats(c)

	require.Equal(t, http.StatusOK, w.Code)
	var resp struct {
		Status string              `json:"status"`
		Data   handler.PublicStats `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	require.Equal(t, "ok", resp.Status)
	require.Equal(t, int64(30), resp.Data.TotalUsers)
	require.Equal(t, int64(1000), resp.Data.TotalAgents)
	require.Equal(t, int64(20), resp.Data.OnlineAgents)
	require.Equal(t, int64(900), resp.Data.TotalMessages)
	require.Equal(t, "1d+", resp.Data.Uptime)
}

func setupPublicStatsDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: gormlogger.Default.LogMode(gormlogger.Silent),
	})
	require.NoError(t, err)
	for _, stmt := range []string{
		"CREATE TABLE users (id TEXT PRIMARY KEY)",
		"CREATE TABLE agent_instances (id TEXT PRIMARY KEY)",
		"CREATE TABLE messages (id TEXT PRIMARY KEY)",
		"CREATE TABLE pending_agent_tasks (id TEXT PRIMARY KEY, agent_instance_id TEXT NOT NULL, status TEXT NOT NULL)",
	} {
		require.NoError(t, db.Exec(stmt).Error)
	}
	return db
}

func seedPublicStatsRows(t *testing.T, db *gorm.DB, table string, count int) {
	t.Helper()
	for i := 0; i < count; i++ {
		require.NoError(t, db.Exec(
			fmt.Sprintf("INSERT INTO %s (id) VALUES (?)", table),
			fmt.Sprintf("%s_%04d", table, i),
		).Error)
	}
}
