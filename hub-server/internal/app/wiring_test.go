package app

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/glebarez/sqlite"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/cache"
	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/ws"
)

// TestInitServicesWiresAgentTeamCollaborators runs the real composition root:
// dropping the auditor, control service, compete limit, or human-review flag
// from initServices leaves this test red instead of shipping un-audited
// approvals.
func TestInitServicesWiresAgentTeamCollaborators(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	redisServer, err := miniredis.Run()
	require.NoError(t, err)
	t.Cleanup(redisServer.Close)
	cacheClient := cache.NewClient(redis.NewClient(&redis.Options{Addr: redisServer.Addr()}))

	application := New(&config.Config{
		AgentTeam: config.AgentTeamConfig{CompeteMaxAgents: 7, HumanReviewEnabled: true},
	}, db, cacheClient)
	application.mgr = ws.NewManager()
	t.Cleanup(application.bg.Cancel)

	require.NoError(t, application.initServices(context.Background()))
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		application.AuditService.Shutdown(ctx)
	})

	require.NotNil(t, application.AgentTeamService)
	wiring := application.AgentTeamService.Wiring()
	require.True(t, wiring.Audit)
	require.True(t, wiring.Control)
	require.Equal(t, 7, wiring.CompeteMaxAgents)
	require.True(t, wiring.HumanReview)
}
