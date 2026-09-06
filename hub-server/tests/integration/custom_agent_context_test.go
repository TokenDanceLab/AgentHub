//go:build integration

package integration

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/handler"
	"github.com/agenthub/hub-server/internal/middleware"
	"github.com/agenthub/hub-server/internal/service/agent"
	"github.com/agenthub/pkg/testkit"
)

// This is L1: real HTTP, handler, service and PostgreSQL; identity is a fixture.
// Canceling an HTTP client alone is insufficient evidence: the server-side SQL
// and the queued pool caller must finish BEFORE the blocking lock is released.
func TestCustomAgentRequestCancellationReleasesPool(t *testing.T) {
	for _, mode := range []string{"deadline", "disconnect"} {
		t.Run(mode, func(t *testing.T) {
			t.Cleanup(func() { CleanDB(t, db) })
			ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			t.Cleanup(cancel)
			u := register(t, "custom-context-"+mode, "pass1234", "Context fixture")

			// A private pool makes saturation observable without changing the
			// shared integration server's pool or any runtime configuration.
			dialect, ok := db.Dialector.(*postgres.Dialector)
			require.True(t, ok)
			scopedDB, err := gorm.Open(postgres.Open(dialect.DSN), &gorm.Config{
				Logger: db.Logger, SkipDefaultTransaction: db.SkipDefaultTransaction,
				PrepareStmt: db.PrepareStmt,
			})
			require.NoError(t, err)
			pool, err := scopedDB.DB()
			require.NoError(t, err)
			pool.SetMaxOpenConns(1)
			pool.SetMaxIdleConns(1)
			t.Cleanup(func() { require.NoError(t, pool.Close()) })
			// Cancellation, not a server-side statement/lock timeout, must end SQL.
			_, err = pool.ExecContext(ctx, "SET statement_timeout = 0")
			require.NoError(t, err)
			_, err = pool.ExecContext(ctx, "SET lock_timeout = 0")
			require.NoError(t, err)
			var queryPID int
			require.NoError(t, pool.QueryRowContext(ctx, "SELECT pg_backend_pid()").Scan(&queryPID))

			service := agent.NewService(scopedDB, eventBus, mgr, testCacheClient, nil, config.EdgeDispatchConfig{}, nil, "")
			created, err := service.CreateCustomAgent(ctx, u.ID, "Still present", "", "codex", "Fixture prompt", "[]", "[]", "{}")
			require.NoError(t, err)

			sharedPool, err := db.DB()
			require.NoError(t, err)
			lock, err := sharedPool.BeginTx(ctx, nil)
			require.NoError(t, err)
			unlock := sync.OnceFunc(func() { require.NoError(t, lock.Rollback()) })
			t.Cleanup(unlock)
			_, err = lock.ExecContext(ctx, "LOCK TABLE custom_agents IN ACCESS EXCLUSIVE MODE")
			require.NoError(t, err)

			deadline := time.Second
			if mode == "disconnect" {
				deadline = 10 * time.Second
			}
			started, serverDone := make(chan struct{}), make(chan struct{})
			var requestCtx context.Context
			r := gin.New()
			r.Use(func(c *gin.Context) { defer close(serverDone); c.Next() })
			r.Use(middleware.Timeout(deadline))
			h := handler.NewCustomAgentHandler(service)
			r.GET("/web/custom-agents", func(c *gin.Context) {
				c.Set("user_id", u.ID)
				requestCtx = c.Request.Context()
				close(started)
				h.List(c)
			})
			server := httptest.NewServer(r)
			// Also on a regression failure, unlock BEFORE waiting for the server
			// to close: the old service otherwise leaves Close waiting on SQL.
			t.Cleanup(func() { unlock(); server.Close() })
			clientCtx, cancelClient := context.WithCancel(ctx)
			defer cancelClient()
			req, err := http.NewRequestWithContext(clientCtx, http.MethodGet, server.URL+"/web/custom-agents", nil)
			require.NoError(t, err)
			clientDone := make(chan struct{})
			var clientErr error
			var status int
			requestStart := time.Now()
			go func() {
				defer close(clientDone)
				response, err := server.Client().Do(req)
				clientErr = err
				if response != nil {
					status = response.StatusCode
					_, _ = io.Copy(io.Discard, response.Body)
					_ = response.Body.Close()
				}
			}()
			testkit.WaitFor(t, 2*time.Second, started, "HTTP handler did not start")
			isBlocked := func() bool {
				var blocked bool
				err := db.WithContext(ctx).Raw("SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE pid = ? AND state = 'active' AND wait_event_type = 'Lock')", queryPID).Scan(&blocked).Error
				require.NoError(t, err)
				return blocked
			}
			testkit.Eventually(t, time.Second, isBlocked, "request SQL did not enter the PostgreSQL lock wait", nil)
			require.Equal(t, 1, pool.Stats().InUse)
			waitsBefore := pool.Stats().WaitCount
			pingCtx, cancelPing := context.WithTimeout(ctx, 5*time.Second)
			defer cancelPing()
			pingDone := make(chan struct{})
			var pingErr error
			go func() { defer close(pingDone); pingErr = pool.PingContext(pingCtx) }()
			testkit.Eventually(t, time.Second, func() bool { return pool.Stats().WaitCount > waitsBefore }, "second caller did not queue for the single connection", nil)
			require.NoError(t, requestCtx.Err(), "fixture must reach pool saturation before cancellation")

			if mode == "disconnect" {
				cancelClient()
			}
			testkit.WaitFor(t, 2*time.Second, requestCtx.Done(), "request context was not canceled")
			canceledAt := time.Now()
			testkit.Eventually(t, 2*time.Second, func() bool {
				select {
				case <-serverDone:
				default:
					return false
				}
				select {
				case <-pingDone:
					return true
				default:
					return false
				}
			}, "canceled request kept the handler or connection pool occupied while the lock was held", func() string {
				return fmt.Sprintf("request_elapsed=%v canceled_elapsed=%v pool=%+v", time.Since(requestStart), time.Since(canceledAt), pool.Stats())
			})
			require.NoError(t, pingErr, "queued caller must acquire a usable connection without unlocking the table")
			testkit.Eventually(t, time.Second, func() bool { return !isBlocked() }, "canceled PostgreSQL query is still waiting on the lock", nil)
			var lockHeld bool
			require.NoError(t, lock.QueryRowContext(ctx, "SELECT EXISTS (SELECT 1 FROM pg_locks WHERE pid = pg_backend_pid() AND relation = 'custom_agents'::regclass AND mode = 'AccessExclusiveLock' AND granted)").Scan(&lockHeld))
			require.True(t, lockHeld, "the fixture must not release its lock to make the pool assertion pass")
			assert.Zero(t, pool.Stats().InUse)
			testkit.WaitFor(t, time.Second, clientDone, "HTTP client did not finish")
			if mode == "deadline" {
				assert.ErrorIs(t, requestCtx.Err(), context.DeadlineExceeded)
				require.NoError(t, clientErr)
				assert.Equal(t, http.StatusGatewayTimeout, status)
			} else {
				assert.ErrorIs(t, requestCtx.Err(), context.Canceled)
				assert.ErrorIs(t, clientErr, context.Canceled)
			}
			t.Logf("mode=%s deadline=%v request_elapsed=%v canceled_to_released=%v lock_held=%t pool=%+v", mode, deadline, time.Since(requestStart), time.Since(canceledAt), lockHeld, pool.Stats())
			unlock()
			agents, err := service.ListCustomAgents(ctx, u.ID)
			require.NoError(t, err, "a fresh context must remain usable after cancellation")
			require.Len(t, agents, 1)
			assert.Equal(t, created.ID, agents[0].ID)
		})
	}
}
