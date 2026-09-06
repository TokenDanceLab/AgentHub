package agent

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/model"
)

const customAgentContextID = "context-agent"
const customAgentContextOwner = "context-owner"

func customAgentContextFixture(t *testing.T) (*Service, *gorm.DB) {
	t.Helper()
	database := newCustomAgentUpdateDB(t)
	sqlDB, err := database.DB()
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
	seedCustomAgent(t, database, customAgentContextID, customAgentContextOwner, "Before cancellation", time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	return &Service{db: database}, database
}

func assertCustomAgentContextUnchanged(t *testing.T, database *gorm.DB) {
	t.Helper()
	var count int64
	require.NoError(t, database.Model(&model.CustomAgent{}).Count(&count).Error)
	assert.Equal(t, int64(1), count, "a canceled create must not insert a late row")
	var row model.CustomAgent
	require.NoError(t, database.Where("id = ?", customAgentContextID).First(&row).Error)
	assert.Equal(t, "Before cancellation", row.Name)
	assert.Equal(t, customAgentContextOwner, row.OwnerUserID)
	assert.Nil(t, row.DeletedAt, "a canceled delete must not hide the agent")
	require.NotNil(t, row.OutputSchema)
	assert.JSONEq(t, customAgentUpdateTestSchema, string(*row.OutputSchema))
}

func updateCustomAgentWithContext(s *Service, ctx context.Context) error {
	return s.UpdateCustomAgent(ctx, customAgentContextOwner, &model.CustomAgent{
		ID: customAgentContextID, Name: "After cancellation", AgentType: "claude-code", SystemPrompt: "Changed prompt",
	})
}

func TestCustomAgentCanceledContext(t *testing.T) {
	tests := []struct {
		name string
		call func(*Service, context.Context) error
	}{
		{"create", func(s *Service, ctx context.Context) error {
			_, err := s.CreateCustomAgent(ctx, customAgentContextOwner, "Unexpected agent", "", "claude-code", "Fixture prompt", "[]", "[]", "{}")
			return err
		}},
		{"list", func(s *Service, ctx context.Context) error {
			_, err := s.ListCustomAgents(ctx, customAgentContextOwner)
			return err
		}},
		{"update", updateCustomAgentWithContext},
		{"delete", func(s *Service, ctx context.Context) error {
			return s.DeleteCustomAgent(ctx, customAgentContextOwner, customAgentContextID)
		}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s, database := customAgentContextFixture(t)
			ctx, cancel := context.WithCancel(context.Background())
			cancel()
			assert.ErrorIs(t, tt.call(s, ctx), context.Canceled)
			assertCustomAgentContextUnchanged(t, database)
			// Request binding must not poison the shared handle for the next caller.
			agents, err := s.ListCustomAgents(context.Background(), customAgentContextOwner)
			require.NoError(t, err)
			assert.Len(t, agents, 1)
		})
	}
}

func TestCustomAgentCancelAfterOwnershipRead(t *testing.T) {
	tests := []struct {
		name string
		call func(*Service, context.Context) error
	}{
		{"update", updateCustomAgentWithContext},
		{"delete", func(s *Service, ctx context.Context) error {
			return s.DeleteCustomAgent(ctx, customAgentContextOwner, customAgentContextID)
		}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s, database := customAgentContextFixture(t)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			// Cancel only after the real ownership SELECT has returned. An entry-only
			// ctx.Err check cannot protect the subsequent UPDATE or soft DELETE.
			const callback = "test:cancel-custom-agent-after-owner-read"
			require.NoError(t, database.Callback().Query().After("gorm:query").Register(callback, func(tx *gorm.DB) {
				if tx.Statement.Table == "custom_agents" && tx.Error == nil && tx.RowsAffected > 0 {
					cancel()
				}
			}))
			t.Cleanup(func() { require.NoError(t, database.Callback().Query().Remove(callback)) })
			err := tt.call(s, ctx)
			require.ErrorIs(t, ctx.Err(), context.Canceled, "the cancellation interleaving must have happened")
			assert.ErrorIs(t, err, context.Canceled)
			assertCustomAgentContextUnchanged(t, database)
		})
	}
}
