package agentteam

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"sync"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/model"
)

func newMockDBAgent(t *testing.T) (*gorm.DB, sqlmock.Sqlmock, *sql.DB) {
	t.Helper()
	sqlDB, mock, err := sqlmock.New(
		sqlmock.QueryMatcherOption(sqlmock.QueryMatcherFunc(
			func(expectedSQL, actualSQL string) error {
				if strings.Contains(actualSQL, expectedSQL) {
					return nil
				}
				return fmt.Errorf("expected SQL to contain %q, but got %q", expectedSQL, actualSQL)
			},
		)),
	)
	require.NoError(t, err)
	gormDB, err := gorm.Open(postgres.New(postgres.Config{Conn: sqlDB}), &gorm.Config{
		SkipDefaultTransaction: true,
		PrepareStmt:            false,
	})
	require.NoError(t, err)
	return gormDB, mock, sqlDB
}

// mockDBTeamService implements agentTeamAgentSvc backed by a gorm.DB for tests
// that need real DB-driven agent operations (e.g. integration tests with SQLite).
type mockDBTeamService struct {
	db *gorm.DB
}

func (m *mockDBTeamService) AddAgentToSession(ctx context.Context, userID, sessionID, agentType, customAgentID, displayName string) (*model.AgentInstance, error) {
	return &model.AgentInstance{}, nil
}

func (m *mockDBTeamService) TriggerAgentTask(ctx context.Context, userID, triggerMessageID, targetAgentInstanceID, targetAgentType, targetCustomAgentID, modelParams, targetID string) (*model.PendingAgentTask, error) {
	return &model.PendingAgentTask{}, nil
}

// mockTeamCache implements agentTeamCache for tests that need a no-op cache.
type mockTeamCache struct {
	mu  sync.Mutex
	seq int64
}

func (m *mockTeamCache) AllocateSeq(ctx context.Context, sessionID string) (int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.seq++
	return m.seq, nil
}

func (m *mockTeamCache) InitSeqIfAbsent(ctx context.Context, sessionID string, seq int64) error {
	return nil
}

