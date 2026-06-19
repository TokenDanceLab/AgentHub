package service

import (
	"context"
	"testing"

	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

// setupBenchDB creates an in-memory SQLite DB with team-related tables.
func setupBenchDB(b *testing.B) *gorm.DB {
	b.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		b.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		b.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)

	tables := []string{
		`CREATE TABLE agent_teams (
			id TEXT PRIMARY KEY,
			owner_id TEXT NOT NULL,
			name TEXT NOT NULL,
			description TEXT DEFAULT '',
			avatar_url TEXT DEFAULT '',
			created_at DATETIME,
			updated_at DATETIME
		)`,
		`CREATE TABLE agent_team_members (
			id TEXT PRIMARY KEY,
			team_id TEXT NOT NULL,
			agent_profile_id TEXT,
			role TEXT NOT NULL DEFAULT 'executor',
			position INTEGER NOT NULL DEFAULT 0,
			created_at DATETIME
		)`,
		`CREATE TABLE agent_team_runs (
			id TEXT PRIMARY KEY,
			team_id TEXT NOT NULL,
			session_id TEXT,
			trigger_user_id TEXT NOT NULL,
			trigger_message TEXT DEFAULT '',
			target_id TEXT,
			mode TEXT NOT NULL DEFAULT 'supervisor',
			status TEXT NOT NULL DEFAULT 'queued',
			created_at DATETIME,
			updated_at DATETIME
		)`,
		`CREATE TABLE agent_team_assignments (
			id TEXT PRIMARY KEY,
			team_run_id TEXT NOT NULL,
			from_member_id TEXT NOT NULL,
			to_member_id TEXT NOT NULL,
			type TEXT NOT NULL DEFAULT 'delegate',
			task_prompt TEXT NOT NULL DEFAULT '',
			context TEXT DEFAULT '',
			status TEXT NOT NULL DEFAULT 'pending',
			depth INTEGER NOT NULL DEFAULT 0,
			run_id TEXT,
			result TEXT,
			created_at DATETIME,
			updated_at DATETIME
		)`,
		`CREATE TABLE agent_team_events (
			id TEXT PRIMARY KEY,
			team_run_id TEXT NOT NULL,
			seq INTEGER NOT NULL,
			type TEXT NOT NULL,
			payload TEXT NOT NULL DEFAULT '',
			created_at DATETIME
		)`,
		`CREATE TABLE agent_team_tasks (
			id TEXT PRIMARY KEY,
			team_run_id TEXT NOT NULL,
			assignment_id TEXT,
			assignee_member_id TEXT NOT NULL,
			parent_task_id TEXT,
			status TEXT NOT NULL DEFAULT 'pending',
			objective TEXT NOT NULL,
			input_refs TEXT NOT NULL DEFAULT '{}',
			run_id TEXT,
			attempt INTEGER NOT NULL DEFAULT 1,
			risk_level TEXT NOT NULL DEFAULT 'normal',
			created_at DATETIME,
			updated_at DATETIME
		)`,
		`CREATE TABLE custom_agents (
			id TEXT PRIMARY KEY,
			owner_user_id TEXT NOT NULL,
			name TEXT NOT NULL,
			agent_type TEXT NOT NULL DEFAULT '',
			system_prompt TEXT DEFAULT '',
			created_at DATETIME,
			updated_at DATETIME
		)`,
	}
	for _, ddl := range tables {
		if err := db.Exec(ddl).Error; err != nil {
			b.Fatal(err)
		}
	}
	return db
}

func seedBenchTeamRun(b *testing.B, db *gorm.DB) (*model.AgentTeam, *model.AgentTeamMember, *model.AgentTeamMember, *model.AgentTeamRun) {
	b.Helper()
	team := &model.AgentTeam{OwnerID: "user-1", Name: "Bench Team"}
	if err := repository.CreateTeam(db, team); err != nil {
		b.Fatal(err)
	}

	supervisorProfileID := "profile-supervisor"
	executorProfileID := "profile-executor"
	supervisor := &model.AgentTeamMember{
		TeamID:         team.ID,
		AgentProfileID: &supervisorProfileID,
		Role:           model.TeamMemberRoleSupervisor,
	}
	executor := &model.AgentTeamMember{
		TeamID:         team.ID,
		AgentProfileID: &executorProfileID,
		Role:           model.TeamMemberRoleExecutor,
	}
	if err := repository.AddTeamMember(db, supervisor); err != nil {
		b.Fatal(err)
	}
	if err := repository.AddTeamMember(db, executor); err != nil {
		b.Fatal(err)
	}

	run := &model.AgentTeamRun{
		TeamID:         team.ID,
		SessionID:      "session-1",
		TriggerUserID:  "user-1",
		TriggerMessage: "ship it",
		Status:         model.TeamRunStatusRunning,
	}
	if err := repository.CreateTeamRun(db, run); err != nil {
		b.Fatal(err)
	}
	return team, supervisor, executor, run
}

func BenchmarkRouteDecisionValidation(b *testing.B) {
	db := setupBenchDB(b)
	svc := NewAgentTeamService(db, nil, nil)
	_, _, executor, run := seedBenchTeamRun(b, db)

	decision := model.CoordinatorRouteDecision{
		Action:       "delegate",
		NextWorker:   executor.ID,
		Instructions: "Implement the benchmark feature",
		Reasoning:    "Executor owns this area",
		Context:      "API is ready",
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = svc.countMatchingRouteDecisions(run.ID, decision)
	}
	b.StopTimer()
}

func BenchmarkRouteDecisionFull(b *testing.B) {
	ctx := context.Background()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		b.StopTimer()
		db := setupBenchDB(b)
		svc := NewAgentTeamService(db, nil, nil)
		_, _, executor, run := seedBenchTeamRun(b, db)
		b.StartTimer()

		_, _ = svc.HandleRouteDecision(ctx, "user-1", run.TeamID, run.ID, model.CoordinatorRouteDecision{
			Action:       "delegate",
			NextWorker:   executor.ID,
			Instructions: "Implement the feature",
		})
	}
}

func BenchmarkRouteDecisionFinish(b *testing.B) {
	ctx := context.Background()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		b.StopTimer()
		db := setupBenchDB(b)
		svc := NewAgentTeamService(db, nil, nil)
		_, _, _, run := seedBenchTeamRun(b, db)
		b.StartTimer()

		_, _ = svc.HandleRouteDecision(ctx, "user-1", run.TeamID, run.ID, model.CoordinatorRouteDecision{
			Action:  "finish",
			Summary: "All tasks completed successfully",
		})
	}
}

func BenchmarkRouteDecisionRejectInvalidWorker(b *testing.B) {
	ctx := context.Background()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		b.StopTimer()
		db := setupBenchDB(b)
		svc := NewAgentTeamService(db, nil, nil)
		_, _, _, run := seedBenchTeamRun(b, db)
		b.StartTimer()

		_, _ = svc.HandleRouteDecision(ctx, "user-1", run.TeamID, run.ID, model.CoordinatorRouteDecision{
			Action:       "delegate",
			NextWorker:   "missing-member",
			Instructions: "Do work",
		})
	}
}
