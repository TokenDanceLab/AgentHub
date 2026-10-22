//go:build integration

package integration

import (
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMigration0078_RealPG_RestoresFriendshipUpsertArbiter(t *testing.T) {
	db, cleanup := openTempMigratedDB(t)
	t.Cleanup(cleanup)

	up, err := os.ReadFile("../../migrations/0078_friendships_unique_pair.up.sql")
	require.NoError(t, err)

	tx := db.Begin()
	require.NoError(t, tx.Error)
	t.Cleanup(func() { _ = tx.Rollback().Error })

	execSQLStatements(t, tx, `
		CREATE SCHEMA migration_0078_legacy;
		SET LOCAL search_path TO migration_0078_legacy, public;
		CREATE TABLE friendships (
			id UUID PRIMARY KEY,
			user_id UUID NOT NULL,
			friend_id UUID NOT NULL,
			status VARCHAR(16) NOT NULL,
			remark VARCHAR(64),
			request_message VARCHAR(255),
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE INDEX idx_friendships_user_friend_status
			ON friendships (user_id, friend_id, status);
		INSERT INTO friendships (id, user_id, friend_id, status)
		VALUES (
			'40000000-0000-4000-8000-000000000078',
			'10000000-0000-4000-8000-000000000078',
			'20000000-0000-4000-8000-000000000078',
			'pending'
		);
	`)
	execSQLStatements(t, tx, string(up))

	require.NoError(t, tx.Exec(`
		INSERT INTO friendships (id, user_id, friend_id, status)
		VALUES (
			'50000000-0000-4000-8000-000000000078',
			'10000000-0000-4000-8000-000000000078',
			'20000000-0000-4000-8000-000000000078',
			'accepted'
		)
		ON CONFLICT (user_id, friend_id)
		DO UPDATE SET status = EXCLUDED.status
	`).Error)

	var status string
	require.NoError(t, tx.Raw(`
		SELECT status FROM friendships
		WHERE user_id = '10000000-0000-4000-8000-000000000078'
		  AND friend_id = '20000000-0000-4000-8000-000000000078'
	`).Scan(&status).Error)
	assert.Equal(t, "accepted", status)
}
