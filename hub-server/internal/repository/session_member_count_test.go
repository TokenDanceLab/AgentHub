//go:build integration

package repository

import (
	"database/sql"
	"fmt"
	"os"
	"strconv"
	"testing"
	"time"

	_ "github.com/lib/pq"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/model"
)

// TestSessionMemberCountBehavior verifies that ListUserSessions, SearchSessions,
// and ListWorkspaceSessions return correct member_count values:
// - Active members (left_at IS NULL) are counted
// - Left members (left_at NOT NULL) are NOT counted
// - Sessions with no members return member_count = 0
// This test uses a temporary PG database to validate the correlated scalar subquery rewrite (#2102 F1).
func TestSessionMemberCountBehavior(t *testing.T) {
	db, cleanup := setupTempPG(t)
	defer cleanup()

	// Create test users
	userA := "aaaaaaaa-0000-0000-0000-000000000001"
	userB := "aaaaaaaa-0000-0000-0000-000000000002"
	userC := "aaaaaaaa-0000-0000-0000-000000000003"
	workspaceID := "a0a0a0a0-0000-0000-0000-000000000001"

	// Insert users (needed for workspace owner and session members FK)
	for _, uid := range []string{userA, userB, userC, "aaaaaaa0-0000-0000-0000-000000000099"} {
		require.NoError(t, db.Exec(
			"INSERT INTO users (id, username, nickname, created_at, updated_at) VALUES (?, ?, ?, now(), now()) ON CONFLICT DO NOTHING",
			uid, "u-"+uid[:8], "User-"+uid[:8],
		).Error)
	}

	// Insert workspace with owner
	require.NoError(t, db.Exec(
		"INSERT INTO workspaces (id, name, owner_id, created_at, updated_at) VALUES (?, 'test-ws', ?, now(), now())",
		workspaceID, userA,
	).Error)

	// Session 1: group with 3 active members + 1 left member → member_count = 3
	s1 := &model.Session{Type: model.SessionTypeGroup, Name: "group-active-mix"}
	require.NoError(t, CreateSession(db, s1))
	now := time.Now()
	// Active members
	require.NoError(t, CreateSessionMember(db, &model.SessionMember{SessionID: s1.ID, MemberType: model.MemberTypeUser, MemberID: userA, Role: model.MemberRoleMember}))
	require.NoError(t, CreateSessionMember(db, &model.SessionMember{SessionID: s1.ID, MemberType: model.MemberTypeUser, MemberID: userB, Role: model.MemberRoleMember}))
	require.NoError(t, CreateSessionMember(db, &model.SessionMember{SessionID: s1.ID, MemberType: model.MemberTypeUser, MemberID: userC, Role: model.MemberRoleMember}))
	// Left member (should NOT be counted)
	require.NoError(t, CreateSessionMember(db, &model.SessionMember{SessionID: s1.ID, MemberType: model.MemberTypeUser, MemberID: "aaaaaaa0-0000-0000-0000-000000000099", Role: model.MemberRoleMember, LeftAt: &now}))

	// Session 2: private session with only userA as active member → member_count = 1
	s2 := &model.Session{Type: model.SessionTypePrivate, Name: "private-solo"}
	require.NoError(t, CreateSession(db, s2))
	require.NoError(t, CreateSessionMember(db, &model.SessionMember{SessionID: s2.ID, MemberType: model.MemberTypeUser, MemberID: userA, Role: model.MemberRoleMember}))

	// Session 3: workspace session with 2 active members
	s3 := &model.Session{Type: model.SessionTypeGroup, Name: "ws-session", WorkspaceID: &workspaceID}
	require.NoError(t, CreateSession(db, s3))
	require.NoError(t, CreateSessionMember(db, &model.SessionMember{SessionID: s3.ID, MemberType: model.MemberTypeUser, MemberID: userA, Role: model.MemberRoleMember}))
	require.NoError(t, CreateSessionMember(db, &model.SessionMember{SessionID: s3.ID, MemberType: model.MemberTypeUser, MemberID: userB, Role: model.MemberRoleMember}))

	t.Run("ListUserSessions_member_count_excludes_left_members", func(t *testing.T) {
		sessions, err := ListUserSessions(db, userA)
		require.NoError(t, err)

		countBySession := make(map[string]int64)
		for _, s := range sessions {
			countBySession[s.ID] = s.MemberCount
		}

		// s1: 3 active (userA, userB, userC), 1 left → count = 3
		require.Equal(t, int64(3), countBySession[s1.ID], "s1 should have 3 active members")
		// s2: 1 active (userA only) → count = 1
		require.Equal(t, int64(1), countBySession[s2.ID], "s2 should have 1 active member")
		// s3: 2 active (userA, userB) → count = 2
		require.Equal(t, int64(2), countBySession[s3.ID], "s3 should have 2 active members")
	})

	t.Run("SearchSessions_member_count_excludes_left_members", func(t *testing.T) {
		sessions, err := SearchSessions(db, userA, "group-active")
		require.NoError(t, err)
		require.Len(t, sessions, 1, "should find s1 by name")
		require.Equal(t, int64(3), sessions[0].MemberCount, "search result should have 3 active members")
	})

	t.Run("ListWorkspaceSessions_member_count_correct", func(t *testing.T) {
		sessions, err := ListWorkspaceSessions(db, workspaceID, userA)
		require.NoError(t, err)
		require.Len(t, sessions, 1, "should find s3 in workspace")
		require.Equal(t, int64(2), sessions[0].MemberCount, "workspace session should have 2 active members")
	})

	t.Run("ListUserSessions_empty_session_returns_zero", func(t *testing.T) {
		// Create a session where userA is a member but all other members left
		s4 := &model.Session{Type: model.SessionTypeGroup, Name: "empty-after-leave"}
		require.NoError(t, CreateSession(db, s4))
		require.NoError(t, CreateSessionMember(db, &model.SessionMember{SessionID: s4.ID, MemberType: model.MemberTypeUser, MemberID: userA, Role: model.MemberRoleMember}))
		// Add a member who left
		require.NoError(t, CreateSessionMember(db, &model.SessionMember{SessionID: s4.ID, MemberType: model.MemberTypeUser, MemberID: userB, Role: model.MemberRoleMember, LeftAt: &now}))

		sessions, err := ListUserSessions(db, userA)
		require.NoError(t, err)
		var found bool
		for _, s := range sessions {
			if s.ID == s4.ID {
				found = true
				// Only userA is active → count = 1
				require.Equal(t, int64(1), s.MemberCount, "session with only self active should have count 1")
			}
		}
		require.True(t, found, "s4 should appear in user's session list")
	})
}

// TestSessionMemberCountPlanNoFullTableAggregate verifies that the query plan
// for ListUserSessions uses index scans (not full-table Seq Scan) on session_members
// for the correlated scalar subquery. This is the core performance fix for #2102 F1.
func TestSessionMemberCountPlanNoFullTableAggregate(t *testing.T) {
	db, cleanup := setupTempPG(t)
	defer cleanup()

	sqlDB, err := db.DB()
	require.NoError(t, err)

	// EXPLAIN the ListUserSessions query pattern (correlated scalar subquery form)
	explainSQL := `EXPLAIN SELECT s.*, sm.role, sm.pinned, sm.archived, sm.muted, sm.last_read_seq,
		(SELECT COUNT(*) FROM session_members sm2 WHERE sm2.session_id = s.id AND sm2.left_at IS NULL) as member_count
	FROM sessions s
	INNER JOIN session_members sm ON sm.session_id = s.id AND sm.member_id = $1 AND sm.left_at IS NULL
	WHERE s.dissolved = false
	ORDER BY sm.pinned DESC, COALESCE(s.last_message_at, s.created_at) DESC
	LIMIT 500`

	rows, err := sqlDB.Query(explainSQL, "00000000-0000-0000-0000-000000000001")
	require.NoError(t, err)
	defer rows.Close()

	var planLines []string
	for rows.Next() {
		var line string
		require.NoError(t, rows.Scan(&line))
		planLines = append(planLines, line)
	}
	require.NoError(t, rows.Err())

	planText := ""
	for _, l := range planLines {
		planText += l + "\n"
	}

	// The correlated scalar subquery should use idx_session_members_session_left
	// for an Index Only Scan / Index Scan, avoiding any Seq Scan on session_members.
	require.NotContains(t, planText, "Seq Scan on session_members",
		"Plan should not contain Seq Scan on session_members (full table scan). Plan:\n%s", planText)

	// Verify the plan uses an index scan for the member count aggregation
	hasIndexScan := false
	for _, l := range planLines {
		if contains(l, "Index Scan") && contains(l, "session_members") {
			hasIndexScan = true
			break
		}
	}
	require.True(t, hasIndexScan,
		"Plan should use Index Scan on session_members for member count. Plan:\n%s", planText)

	t.Logf("Query plan:\n%s", planText)
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && searchString(s, substr)
}

func searchString(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}

// setupTempPG creates a temporary PostgreSQL database, runs migrations,
// and returns a gorm.DB connected to it. The caller must call cleanup().
func setupTempPG(t *testing.T) (*gorm.DB, func()) {
	t.Helper()

	password := os.Getenv("AGENTHUB_DB_PASSWORD")
	if password == "" {
		t.Fatal("AGENTHUB_DB_PASSWORD env var required for integration tests")
	}

	host := os.Getenv("AGENTHUB_DB_HOST")
	if host == "" {
		host = "localhost"
	}
	portStr := os.Getenv("AGENTHUB_DB_PORT")
	if portStr == "" {
		portStr = "5432"
	}
	user := os.Getenv("AGENTHUB_DB_USER")
	if user == "" {
		user = "agenthub"
	}

	// Connect to default 'postgres' database to create temp DB
	portInt, _ := strconv.Atoi(portStr)
	adminDSN := fmt.Sprintf("host=%s port=%d user=%s password=%s dbname=postgres sslmode=disable", host, portInt, user, password)
	adminDB, err := sql.Open("postgres", adminDSN)
	require.NoError(t, err)

	tempDBName := fmt.Sprintf("test_session_mc_%d", time.Now().UnixNano())
	_, err = adminDB.Exec(fmt.Sprintf("CREATE DATABASE %s", tempDBName))
	require.NoError(t, err, "failed to create temp database")

	cleanup := func() {
		adminDB.Exec(fmt.Sprintf("DROP DATABASE IF EXISTS %s", tempDBName))
		adminDB.Close()
	}

	// Connect to temp DB and run migrations
	cfg := &config.DBConfig{
		Host:     host,
		Port:     portInt,
		User:     user,
		Password: password,
		Name:     tempDBName,
		SSLMode:  "disable",
	}

	db, err := gorm.Open(postgres.Open(cfg.DSN()), &gorm.Config{
		Logger: gormlogger.Default.LogMode(gormlogger.Silent),
	})
	require.NoError(t, err)

	// Run migrations
	err = RunMigrationsFrom(cfg, "file://../../migrations")
	require.NoError(t, err, "failed to run migrations on temp DB")

	return db, cleanup
}
