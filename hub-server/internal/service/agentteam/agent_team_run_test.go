package agentteam

import (
	"context"
	"errors"
	"reflect"
	"sync"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/bus"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
)

// Read-fanout tests for GetTeamRunState (#2154 P2-11).
//
// The six reads used to be strictly serial (2-10 ms of stacked round trips on
// the endpoint the team-run UI polls every 1-3 s). They are now two errgroup
// layers. Two properties must survive that change and are locked here:
//
//  1. the reads really do overlap (otherwise the change bought nothing);
// The fixtures use setupAgentTeamStateSQLite, i.e. sqlite pinned to a single
// connection (SetMaxOpenConns(1)): every read then shares one connection and
// one catalog, so the fan-out is safe, and the barrier hooks run before gorm
// takes a connection — they observe the reads being issued concurrently even
// though the driver serializes their execution. Production (Postgres) gets the
// same fan-out with real connection parallelism; an *uncapped* private
// ":memory:" fixture would not be safe and must pin itself the same way (see
// teamRunStateReadConcurrency).
//
//  2. the error the endpoint returns is still the first one in the *original
//     source order* — members → assignments → tasks → pendingTaskSnapshot →
//     runEvents → team events — and not whichever goroutine happened to fail
//     first, because that error is what the handler maps to an API error code.

// seedTeamRunStateFixture creates a team with two members, a running team run,
// one assignment bound to a pending agent task, and one team event, so all six
// reads have something to resolve.
func seedTeamRunStateFixture(t *testing.T, db *gorm.DB) (teamID, runID string) {
	t.Helper()
	team := &model.AgentTeam{OwnerID: "user-1", Name: "Fanout Team"}
	require.NoError(t, repository.CreateTeam(db, team))

	supervisorProfile := "profile-supervisor"
	executorProfile := "profile-executor"
	supervisor := &model.AgentTeamMember{
		TeamID: team.ID, AgentProfileID: &supervisorProfile, Role: model.TeamMemberRoleSupervisor,
	}
	executor := &model.AgentTeamMember{
		TeamID: team.ID, AgentProfileID: &executorProfile, Role: model.TeamMemberRoleExecutor,
	}
	require.NoError(t, repository.AddTeamMember(db, supervisor))
	require.NoError(t, repository.AddTeamMember(db, executor))

	run := &model.AgentTeamRun{
		TeamID: team.ID, SessionID: "session-1", TriggerUserID: "user-1",
		TriggerMessage: "ship it", Status: model.TeamRunStatusRunning,
	}
	require.NoError(t, repository.CreateTeamRun(db, run))

	// RunID binds the assignment to a pending agent task, which is what makes
	// layer 2 (pendingTaskSnapshot + runEvents) issue real queries.
	edgeRunID := "edge-run-1"
	require.NoError(t, repository.CreateAssignment(db, &model.AgentTeamAssignment{
		TeamRunID: run.ID, FromMemberID: supervisor.ID, ToMemberID: executor.ID,
		Type: model.AssignmentTypeDelegate, TaskPrompt: "Implement fanout",
		Status: model.AssignmentStatusRunning, Depth: 1, RunID: &edgeRunID,
	}))
	require.NoError(t, db.Exec(
		`INSERT INTO pending_agent_tasks (id, agent_instance_id, triggered_by_user_id, trigger_message_id, status, expire_at, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		"edge-run-1", "ai-1", "user-1", "msg-1", model.TaskStatusRunning, time.Now().Add(time.Hour), time.Now()).Error)
	require.NoError(t, repository.AppendTeamEvent(db, &model.AgentTeamEvent{
		TeamRunID: run.ID, Type: model.TeamEventRunStarted, Payload: `{"status":"running"}`,
	}))
	return team.ID, run.ID
}

// destType returns the gorm Statement.Dest type a repository list helper
// produces, which is how the hooks below recognize a specific read.
func destType(slicePtr interface{}) reflect.Type {
	return reflect.TypeOf(slicePtr)
}

var (
	destTeamMembers   = destType(&[]model.AgentTeamMember{})
	destAssignments   = destType(&[]model.AgentTeamAssignment{})
	destTeamTasks     = destType(&[]model.AgentTeamTask{})
	destTeamEvents    = destType(&[]model.AgentTeamEvent{})
	destPendingTasks  = destType(&[]model.PendingAgentTask{})
	destAgentRunEvent = destType(&[]model.AgentRunEvent{})
)

// failReadsOn registers a gorm Query hook that makes every read whose
// destination matches one of failures return the mapped error instead of
// hitting the DB. gorm's built-in query callback is a no-op once db.Error is
// set, so the injection is exact and needs no sqlmock.
func failReadsOn(t *testing.T, db *gorm.DB, failures map[reflect.Type]error) {
	t.Helper()
	require.NoError(t, db.Callback().Query().Before("gorm:query").Register(
		"test:fail_reads",
		func(tx *gorm.DB) {
			if err, ok := failures[reflect.TypeOf(tx.Statement.Dest)]; ok {
				_ = tx.AddError(err)
			}
		},
	))
}

// readBarrier blocks the first of two target reads until the second one has
// also started, which can only happen if the two reads are issued concurrently.
// It never sleeps: the wait is bounded by the statement context, so a serial
// implementation fails the test through ctx expiry instead of hanging it.
type readBarrier struct {
	typeA, typeB reflect.Type
	once         sync.Once
	open         chan struct{}
	mu           sync.Mutex
	started      map[reflect.Type]bool
}

func newReadBarrier(typeA, typeB reflect.Type) *readBarrier {
	return &readBarrier{
		typeA: typeA, typeB: typeB,
		open:    make(chan struct{}),
		started: make(map[reflect.Type]bool, 2),
	}
}

func (b *readBarrier) register(t *testing.T, db *gorm.DB) {
	t.Helper()
	require.NoError(t, db.Callback().Query().Before("gorm:query").Register(
		"test:read_barrier",
		func(tx *gorm.DB) {
			dest := reflect.TypeOf(tx.Statement.Dest)
			if dest != b.typeA && dest != b.typeB {
				return
			}
			b.mu.Lock()
			b.started[dest] = true
			both := len(b.started) == 2
			b.mu.Unlock()
			if both {
				b.once.Do(func() { close(b.open) })
			}
			select {
			case <-b.open:
			case <-tx.Statement.Context.Done():
				// Serial execution: the second read can never start while the
				// first is parked here, so the request deadline breaks the wait
				// and the test reports the regression instead of hanging.
				_ = tx.AddError(tx.Statement.Context.Err())
			}
		},
	))
}

func TestGetTeamRunState_RunsIndependentReadsConcurrently(t *testing.T) {
	db := setupAgentTeamStateSQLite(t)
	teamID, runID := seedTeamRunStateFixture(t, db)
	svc := NewAgentTeamService(db, nil, nil)

	barrier := newReadBarrier(destTeamMembers, destAssignments)
	barrier.register(t, db)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	state, err := svc.GetTeamRunState(ctx, "user-1", teamID, runID)
	require.NoError(t, err,
		"a context error here means the members/assignments reads did not overlap (#2154 P2-11)")
	require.NotNil(t, state)
	require.Len(t, state.Members, 2)
	require.Len(t, state.Assignments, 1)
}

func TestGetTeamRunState_SecondLayerReadsConcurrently(t *testing.T) {
	db := setupAgentTeamStateSQLite(t)
	teamID, runID := seedTeamRunStateFixture(t, db)
	svc := NewAgentTeamService(db, nil, nil)

	barrier := newReadBarrier(destPendingTasks, destAgentRunEvent)
	barrier.register(t, db)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	state, err := svc.GetTeamRunState(ctx, "user-1", teamID, runID)
	require.NoError(t, err,
		"a context error here means pendingTaskSnapshot/runEvents did not overlap (#2154 P2-11)")
	require.NotNil(t, state)
}

func TestGetTeamRunState_PreservesSerialErrorPriority(t *testing.T) {
	errMembers := errors.New("members read failed")
	errAssignments := errors.New("assignments read failed")
	errTasks := errors.New("tasks read failed")
	errPending := errors.New("pending snapshot read failed")
	errRunEvents := errors.New("run events read failed")
	errEvents := errors.New("team events read failed")

	tests := []struct {
		name     string
		failures map[reflect.Type]error
		want     error
	}{
		{
			name: "members is checked first",
			failures: map[reflect.Type]error{
				destTeamMembers: errMembers, destAssignments: errAssignments,
				destTeamTasks: errTasks, destPendingTasks: errPending,
				destAgentRunEvent: errRunEvents, destTeamEvents: errEvents,
			},
			want: errMembers,
		},
		{
			name: "assignments beats tasks and events",
			failures: map[reflect.Type]error{
				destAssignments: errAssignments, destTeamTasks: errTasks,
				destPendingTasks: errPending, destAgentRunEvent: errRunEvents,
				destTeamEvents: errEvents,
			},
			want: errAssignments,
		},
		{
			name: "tasks beats the second layer",
			failures: map[reflect.Type]error{
				destTeamTasks: errTasks, destPendingTasks: errPending,
				destAgentRunEvent: errRunEvents, destTeamEvents: errEvents,
			},
			want: errTasks,
		},
		{
			name: "pending snapshot beats run events and team events",
			failures: map[reflect.Type]error{
				destPendingTasks: errPending, destAgentRunEvent: errRunEvents,
				destTeamEvents: errEvents,
			},
			want: errPending,
		},
		{
			name: "run events beat team events",
			failures: map[reflect.Type]error{
				destAgentRunEvent: errRunEvents, destTeamEvents: errEvents,
			},
			want: errRunEvents,
		},
		{
			name:     "team events is last",
			failures: map[reflect.Type]error{destTeamEvents: errEvents},
			want:     errEvents,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db := setupAgentTeamStateSQLite(t)
			teamID, runID := seedTeamRunStateFixture(t, db)
			failReadsOn(t, db, tt.failures)
			svc := NewAgentTeamService(db, nil, nil)

			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()

			state, err := svc.GetTeamRunState(ctx, teamID2User(teamID), teamID, runID)
			require.Nil(t, state)
			require.Error(t, err)
			// errors.Is, not ==: the point is that the *identity* of the surfaced
			// error follows the pre-parallelization source order, so an errgroup
			// first-completed error (or a context.Canceled from a sibling) can
			// never replace it and change the API error code.
			require.True(t, errors.Is(err, tt.want),
				"got %v, want the earliest error in the original serial order (%v)", err, tt.want)
		})
	}
}

// teamID2User keeps the fixture's owner (user-1) as the reader.
func teamID2User(_ string) string { return "user-1" }

func TestGetTeamRunState_PropagatesRequestCancellation(t *testing.T) {
	db := setupAgentTeamStateSQLite(t)
	teamID, runID := seedTeamRunStateFixture(t, db)
	svc := NewAgentTeamService(db, nil, nil)

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // already canceled before the call

	state, err := svc.GetTeamRunState(ctx, "user-1", teamID, runID)
	require.Nil(t, state)
	require.Error(t, err, "s.db.WithContext(gctx) must carry request cancellation into the reads")
	require.True(t, errors.Is(err, context.Canceled), "got %v, want context.Canceled", err)
}

func TestGetTeamRunState_ProjectionUnchangedByParallelReads(t *testing.T) {
	db := setupAgentTeamStateSQLite(t)
	teamID, runID := seedTeamRunStateFixture(t, db)
	svc := NewAgentTeamService(db, nil, nil)

	state, err := svc.GetTeamRunState(context.Background(), "user-1", teamID, runID)
	require.NoError(t, err)
	require.NotNil(t, state)
	require.Equal(t, runID, state.RunID)
	require.Equal(t, teamID, state.TeamID)
	require.Len(t, state.Members, 2)
	require.Len(t, state.Assignments, 1)
	require.NotNil(t, state.Tasks)
	require.NotNil(t, state.RunEvents)
	// The replay of team events still runs after the parallel reads, so the
	// run-started event must be reflected exactly as in the serial version.
	require.NotEmpty(t, state.Status)
}

func TestAgentTeamService_GetTeamRun(t *testing.T) {
	db, mock := newMockAgentTeamDB(t)
	svc := NewAgentTeamService(db, nil, nil)

	// Get team
	teamRows := sqlmock.NewRows([]string{"id", "owner_id", "name", "description", "avatar_url", "created_at", "updated_at"}).
		AddRow("team-1", "user-1", "My Team", "", "", time.Now(), time.Now())
	mock.ExpectQuery(`SELECT * FROM "agent_teams"`).
		WillReturnRows(teamRows)

	// Get run
	runRows := sqlmock.NewRows([]string{"id", "team_id", "session_id", "trigger_user_id", "trigger_message", "status", "created_at", "updated_at"}).
		AddRow("run-1", "team-1", "session-1", "user-1", "hello", "completed", time.Now(), time.Now())
	mock.ExpectQuery(`SELECT * FROM "agent_team_runs"`).
		WillReturnRows(runRows)

	run, err := svc.GetTeamRun(context.Background(), "user-1", "team-1", "run-1")
	require.NoError(t, err)
	assert.Equal(t, "completed", run.Status)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestAgentTeamService_GetTeamRunWrongTeam(t *testing.T) {
	db, mock := newMockAgentTeamDB(t)
	svc := NewAgentTeamService(db, nil, nil)

	// Get team
	teamRows := sqlmock.NewRows([]string{"id", "owner_id", "name", "description", "avatar_url", "created_at", "updated_at"}).
		AddRow("team-1", "user-1", "My Team", "", "", time.Now(), time.Now())
	mock.ExpectQuery(`SELECT * FROM "agent_teams"`).
		WillReturnRows(teamRows)

	// Get run (different team)
	runRows := sqlmock.NewRows([]string{"id", "team_id", "session_id", "trigger_user_id", "trigger_message", "status", "created_at", "updated_at"}).
		AddRow("run-1", "team-2", "session-2", "user-1", "hello", "completed", time.Now(), time.Now())
	mock.ExpectQuery(`SELECT * FROM "agent_team_runs"`).
		WillReturnRows(runRows)

	_, err := svc.GetTeamRun(context.Background(), "user-1", "team-1", "run-1")
	require.Error(t, err)
	assert.Equal(t, errcode.AgentTaskNotFound, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestAgentTeamService_ListTeamRuns(t *testing.T) {
	db, mock := newMockAgentTeamDB(t)
	svc := NewAgentTeamService(db, nil, nil)

	// Get team
	teamRows := sqlmock.NewRows([]string{"id", "owner_id", "name", "description", "avatar_url", "created_at", "updated_at"}).
		AddRow("team-1", "user-1", "My Team", "", "", time.Now(), time.Now())
	mock.ExpectQuery(`SELECT * FROM "agent_teams"`).
		WillReturnRows(teamRows)

	// List runs
	runRows := sqlmock.NewRows([]string{"id", "team_id", "session_id", "trigger_user_id", "trigger_message", "status", "created_at", "updated_at"}).
		AddRow("run-1", "team-1", "session-1", "user-1", "msg1", "completed", time.Now(), time.Now()).
		AddRow("run-2", "team-1", "session-2", "user-1", "msg2", "running", time.Now(), time.Now())
	mock.ExpectQuery(`SELECT * FROM "agent_team_runs"`).
		WillReturnRows(runRows)

	runs, err := svc.ListTeamRuns(context.Background(), "user-1", "team-1")
	require.NoError(t, err)
	assert.Len(t, runs, 2)
	assert.NoError(t, mock.ExpectationsWereMet())
}

// --- StartTeamRun tests ---

func TestAgentTeamService_StartTeamRun_TeamNotFound(t *testing.T) {
	db, mock := newMockAgentTeamDB(t)
	svc := NewAgentTeamService(db, nil, nil)

	mock.ExpectQuery(`SELECT * FROM "agent_teams"`).
		WillReturnError(gorm.ErrRecordNotFound)

	_, err := svc.StartTeamRun(context.Background(), "user-1", "team-1", "hello", "")
	require.Error(t, err)
	assert.Equal(t, errcode.AgentNotFound, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestAgentTeamService_StartTeamRun_EmptyMembers(t *testing.T) {
	db, mock := newMockAgentTeamDB(t)
	svc := NewAgentTeamService(db, nil, nil)

	// Get team
	teamRows := sqlmock.NewRows([]string{"id", "owner_id", "name", "description", "avatar_url", "created_at", "updated_at"}).
		AddRow("team-1", "user-1", "My Team", "", "", time.Now(), time.Now())
	mock.ExpectQuery(`SELECT * FROM "agent_teams"`).
		WillReturnRows(teamRows)

	// List members (empty)
	mock.ExpectQuery(`SELECT * FROM "agent_team_members"`).
		WillReturnRows(sqlmock.NewRows([]string{"id", "team_id", "agent_profile_id", "role", "position", "created_at"}))

	_, err := svc.StartTeamRun(context.Background(), "user-1", "team-1", "hello", "")
	require.Error(t, err)
	assert.ErrorIs(t, err, errcode.ErrBadRequest)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestAgentTeamService_StartTeamRun_Success(t *testing.T) {
	db, mock := newMockAgentTeamDB(t)
	agentSvc := &mockAgentTeamAgentSvc{}
	svc := NewAgentTeamService(db, agentSvc, nil)
	eventBus, err := bus.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { eventBus.Close(context.Background()) })
	events := make(chan bus.Event, 1)
	eventBus.Subscribe("team.run.started", func(ctx context.Context, event bus.Event) {
		events <- event
	})
	svc.SetBus(eventBus)

	now := time.Now()
	agentProfileID := "agent-1"

	// Get team
	teamRows := sqlmock.NewRows([]string{"id", "owner_id", "name", "description", "avatar_url", "created_at", "updated_at"}).
		AddRow("team-1", "user-1", "My Team", "desc", "", now, now)
	mock.ExpectQuery(`SELECT * FROM "agent_teams"`).
		WillReturnRows(teamRows)

	// List members (one supervisor)
	memberRows := sqlmock.NewRows([]string{"id", "team_id", "agent_profile_id", "role", "position", "created_at"}).
		AddRow("member-1", "team-1", agentProfileID, "supervisor", 0, now)
	mock.ExpectQuery(`SELECT * FROM "agent_team_members"`).
		WillReturnRows(memberRows)

	// Transaction: Begin
	mock.ExpectBegin()

	// CreateSession
	mock.ExpectExec(`INSERT INTO "sessions"`).
		WillReturnResult(sqlmock.NewResult(1, 1))

	// CreateSessionMember (owner)
	mock.ExpectExec(`INSERT INTO "session_members"`).
		WillReturnResult(sqlmock.NewResult(1, 1))

	// Batch query custom agents
	agentRows := sqlmock.NewRows([]string{"id", "owner_user_id", "name", "avatar_url", "agent_type", "system_prompt", "capability_tags", "tool_whitelist", "model_params", "deleted_at", "created_at", "updated_at"}).
		AddRow("agent-1", "user-1", "My Agent", "", "codex", "prompt", "[]", "[]", "{}", nil, now, now)
	mock.ExpectQuery(`SELECT * FROM "custom_agents" WHERE id IN`).
		WillReturnRows(agentRows)

	// CreateAgentInstance
	mock.ExpectExec(`INSERT INTO "agent_instances"`).
		WillReturnResult(sqlmock.NewResult(1, 1))

	// CreateSessionMember (agent)
	mock.ExpectExec(`INSERT INTO "session_members"`).
		WillReturnResult(sqlmock.NewResult(1, 1))

	// AllocateSeqID (UPDATE ... RETURNING next_seq)
	mock.ExpectQuery(`UPDATE sessions SET next_seq`).
		WillReturnRows(sqlmock.NewRows([]string{"next_seq"}).AddRow(1))

	// InsertMessage
	mock.ExpectExec(`INSERT INTO "messages"`).
		WillReturnResult(sqlmock.NewResult(1, 1))

	// CreateTeamRun
	mock.ExpectExec(`INSERT INTO "agent_team_runs"`).
		WillReturnResult(sqlmock.NewResult(1, 1))

	// Transaction: Commit
	mock.ExpectCommit()

	// AppendTeamEvent(team.run.started) after successful trigger.
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT id FROM agent_team_runs WHERE id`).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("run-placeholder"))
	mock.ExpectQuery(`COALESCE(MAX(seq)`).
		WillReturnRows(sqlmock.NewRows([]string{"coalesce"}).AddRow(0))
	mock.ExpectExec(`INSERT INTO "agent_team_events"`).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	run, err := svc.StartTeamRun(context.Background(), "user-1", "team-1", "hello", "")
	require.NoError(t, err)
	assert.NotNil(t, run)
	assert.Equal(t, "team-1", run.TeamID)
	assert.Equal(t, model.TeamRunStatusRunning, run.Status)
	assert.NotEmpty(t, agentSvc.triggerMessageID)
	assert.Contains(t, agentSvc.modelParams, "structured_output_schema")
	assert.Contains(t, agentSvc.modelParams, "AgentHub TeamRun supervisor mode")
	event := readAgentTeamEvent(t, events)
	assert.Equal(t, "team.run.started", event.Type)
	payload, ok := event.Payload.(map[string]interface{})
	require.True(t, ok)
	assert.Equal(t, "team-1", payload["team_id"])
	assert.Equal(t, run.ID, payload["run_id"])
	assert.Equal(t, run.SessionID, payload["session_id"])
	assert.Equal(t, "user-1", payload["user_id"])
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestAgentTeamService_StartTeamRunPassesTargetIDToSupervisor(t *testing.T) {
	db, mock := newMockAgentTeamDB(t)
	agentSvc := &mockAgentTeamAgentSvc{}
	svc := NewAgentTeamService(db, agentSvc, nil)

	now := time.Now()
	agentProfileID := "agent-1"

	teamRows := sqlmock.NewRows([]string{"id", "owner_id", "name", "description", "avatar_url", "created_at", "updated_at"}).
		AddRow("team-1", "user-1", "My Team", "desc", "", now, now)
	mock.ExpectQuery(`SELECT * FROM "agent_teams"`).
		WillReturnRows(teamRows)

	memberRows := sqlmock.NewRows([]string{"id", "team_id", "agent_profile_id", "role", "position", "created_at"}).
		AddRow("member-1", "team-1", agentProfileID, "supervisor", 0, now)
	mock.ExpectQuery(`SELECT * FROM "agent_team_members"`).
		WillReturnRows(memberRows)

	mock.ExpectBegin()
	mock.ExpectExec(`INSERT INTO "sessions"`).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`INSERT INTO "session_members"`).
		WillReturnResult(sqlmock.NewResult(1, 1))
	agentRows := sqlmock.NewRows([]string{"id", "owner_user_id", "name", "avatar_url", "agent_type", "system_prompt", "capability_tags", "tool_whitelist", "model_params", "deleted_at", "created_at", "updated_at"}).
		AddRow("agent-1", "user-1", "My Agent", "", "codex", "prompt", "[]", "[]", "{}", nil, now, now)
	mock.ExpectQuery(`SELECT * FROM "custom_agents" WHERE id IN`).
		WillReturnRows(agentRows)
	mock.ExpectExec(`INSERT INTO "agent_instances"`).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`INSERT INTO "session_members"`).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery(`UPDATE sessions SET next_seq`).
		WillReturnRows(sqlmock.NewRows([]string{"next_seq"}).AddRow(1))
	mock.ExpectExec(`INSERT INTO "messages"`).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`INSERT INTO "agent_team_runs"`).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT id FROM agent_team_runs WHERE id`).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("run-placeholder"))
	mock.ExpectQuery(`COALESCE(MAX(seq)`).
		WillReturnRows(sqlmock.NewRows([]string{"coalesce"}).AddRow(0))
	mock.ExpectExec(`INSERT INTO "agent_team_events"`).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	run, err := svc.StartTeamRun(context.Background(), "user-1", "team-1", "hello", "target-local-edge-1")
	require.NoError(t, err)
	require.NotNil(t, run.TargetID)
	assert.Equal(t, "target-local-edge-1", *run.TargetID)
	assert.Equal(t, "target-local-edge-1", agentSvc.targetID)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestAgentTeamService_GetTeamRunStateReplaysEvents(t *testing.T) {
	db := setupAgentTeamStateSQLite(t)
	svc := NewAgentTeamService(db, nil, nil)

	team := &model.AgentTeam{OwnerID: "user-1", Name: "State Team"}
	require.NoError(t, repository.CreateTeam(db, team))

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
	require.NoError(t, repository.AddTeamMember(db, supervisor))
	require.NoError(t, repository.AddTeamMember(db, executor))

	run := &model.AgentTeamRun{
		TeamID:         team.ID,
		SessionID:      "session-1",
		TriggerUserID:  "user-1",
		TriggerMessage: "ship it",
		Status:         model.TeamRunStatusRunning,
	}
	require.NoError(t, repository.CreateTeamRun(db, run))

	assignment := &model.AgentTeamAssignment{
		TeamRunID:    run.ID,
		FromMemberID: supervisor.ID,
		ToMemberID:   executor.ID,
		Type:         model.AssignmentTypeDelegate,
		TaskPrompt:   "Implement replay",
		Status:       model.AssignmentStatusDone,
		Result:       "done",
		Depth:        1,
		RunID:        stringPtr("edge-run-1"),
	}
	require.NoError(t, repository.CreateAssignment(db, assignment))

	require.NoError(t, repository.AppendTeamEvent(db, &model.AgentTeamEvent{
		TeamRunID: run.ID,
		Type:      model.TeamEventRunStarted,
		Payload:   `{"status":"running"}`,
	}))
	require.NoError(t, repository.AppendTeamEvent(db, &model.AgentTeamEvent{
		TeamRunID: run.ID,
		Type:      model.TeamEventRouteDecided,
		Payload:   `{"action":"delegate","next_worker":"` + executor.ID + `","instructions":"Implement replay","reasoning":"needs executor"}`,
	}))
	require.NoError(t, repository.AppendTeamEvent(db, &model.AgentTeamEvent{
		TeamRunID: run.ID,
		Type:      model.TeamEventRunCompleted,
		Payload:   `{"summary":"done"}`,
	}))

	state, err := svc.GetTeamRunState(context.Background(), "user-1", team.ID, run.ID)
	require.NoError(t, err)
	assert.Equal(t, run.ID, state.RunID)
	assert.Equal(t, team.ID, state.TeamID)
	assert.Equal(t, model.TeamRunStatusCompleted, state.Status)
	assert.Equal(t, "done", state.TerminalReason)
	require.Len(t, state.Members, 2)
	assert.Equal(t, 1, state.Members[1].CompletedTasks)
	require.Len(t, state.Assignments, 1)
	assert.Equal(t, assignment.ID, state.Assignments[0].AssignmentID)
	assert.Equal(t, "edge-run-1", state.Assignments[0].RunID)
	require.Len(t, state.RouteLog, 1)
	assert.Equal(t, "delegate", state.RouteLog[0].Action)
	assert.Equal(t, executor.ID, state.RouteLog[0].NextWorker)
}

func TestAgentTeamService_ListTeamTasksIsOwnerScoped(t *testing.T) {
	db := setupAgentTeamStateSQLite(t)
	svc := NewAgentTeamService(db, nil, nil)
	team, _, executor, run := seedAgentTeamRun(t, db)
	require.NoError(t, repository.CreateTeamTask(db, &model.AgentTeamTask{
		TeamRunID:        run.ID,
		AssigneeMemberID: executor.ID,
		Status:           model.TeamTaskStatusPending,
		Objective:        "Build task board",
		InputRefs:        "{}",
		Attempt:          1,
		RiskLevel:        model.TeamTaskRiskNormal,
	}))

	tasks, err := svc.ListTeamTasks(context.Background(), "user-1", team.ID, run.ID)
	require.NoError(t, err)
	require.Len(t, tasks, 1)
	assert.Equal(t, "Build task board", tasks[0].Objective)

	_, err = svc.ListTeamTasks(context.Background(), "other-user", team.ID, run.ID)
	require.Error(t, err)
	assert.Equal(t, errcode.AgentNotFound, err)
}

func TestAgentTeamService_GetTeamRunStateProjectsDependenciesAndBudget(t *testing.T) {
	db := setupAgentTeamStateSQLite(t)
	svc := NewAgentTeamService(db, nil, nil)
	team, _, executor, run := seedAgentTeamRun(t, db)
	reviewerProfileID := "profile-reviewer"
	reviewer := &model.AgentTeamMember{
		TeamID:         team.ID,
		AgentProfileID: &reviewerProfileID,
		Role:           model.TeamMemberRoleReviewer,
	}
	require.NoError(t, repository.AddTeamMember(db, reviewer))
	pending := &model.PendingAgentTask{
		AgentInstanceID:   "agent-executor",
		TriggeredByUserID: "user-1",
		TriggerMessageID:  "message-1",
		Status:            model.TaskStatusRunning,
		EdgeRunID:         "edge-run-budget",
		ExpireAt:          time.Now().Add(time.Hour),
	}
	require.NoError(t, db.Create(pending).Error)

	root := &model.AgentTeamTask{
		TeamRunID:        run.ID,
		AssigneeMemberID: executor.ID,
		Status:           model.TeamTaskStatusRunning,
		Objective:        "Root task",
		RunID:            &pending.ID,
	}
	require.NoError(t, repository.CreateTeamTask(db, root))
	child := &model.AgentTeamTask{
		TeamRunID:        run.ID,
		AssigneeMemberID: executor.ID,
		ParentTaskID:     &root.ID,
		Status:           model.TeamTaskStatusPending,
		Objective:        "Child task",
	}
	require.NoError(t, repository.CreateTeamTask(db, child))
	conflictingPending := &model.PendingAgentTask{
		AgentInstanceID:   "agent-reviewer",
		TriggeredByUserID: "user-1",
		TriggerMessageID:  "message-2",
		Status:            model.TaskStatusDone,
		EdgeRunID:         "edge-run-reviewer",
		ExpireAt:          time.Now().Add(time.Hour),
	}
	require.NoError(t, db.Create(conflictingPending).Error)
	conflictingTask := &model.AgentTeamTask{
		TeamRunID:        run.ID,
		AssigneeMemberID: reviewer.ID,
		Status:           model.TeamTaskStatusDone,
		Objective:        "Review same file",
		RunID:            &conflictingPending.ID,
	}
	require.NoError(t, repository.CreateTeamTask(db, conflictingTask))

	require.NoError(t, repository.CreateAgentRunEventWithNextSeq(db, &model.AgentRunEvent{
		TaskID:          pending.ID,
		EdgeRunID:       "edge-run-budget",
		SessionID:       run.SessionID,
		AgentInstanceID: "agent-executor",
		EventType:       "run.agent.result",
		Payload:         `{"success":true,"usage":{"input_tokens":1200,"output_tokens":800},"tokenLimit":200000,"tokensRemaining":198000,"usagePercent":1.0}`,
	}))
	require.NoError(t, repository.CreateAgentRunEventWithNextSeq(db, &model.AgentRunEvent{
		TaskID:          pending.ID,
		EdgeRunID:       "edge-run-budget",
		SessionID:       run.SessionID,
		AgentInstanceID: "agent-executor",
		EventType:       "run.agent.context_warning",
		Payload:         `{"usagePercent":86.5,"threshold":85}`,
	}))
	require.NoError(t, repository.CreateAgentRunEventWithNextSeq(db, &model.AgentRunEvent{
		TaskID:          pending.ID,
		EdgeRunID:       "edge-run-budget",
		SessionID:       run.SessionID,
		AgentInstanceID: "agent-executor",
		EventType:       "run.agent.permission_requested",
		Payload:         `{"requestId":"req-1","toolUseId":"tool-1","toolName":"Bash","status":"pending"}`,
	}))
	require.NoError(t, repository.CreateAgentRunEventWithNextSeq(db, &model.AgentRunEvent{
		TaskID:          pending.ID,
		EdgeRunID:       "edge-run-budget",
		SessionID:       run.SessionID,
		AgentInstanceID: "agent-executor",
		EventType:       "run.agent.permission_decided",
		Payload:         `{"requestId":"req-1","decision":"allow","reason":"safe command"}`,
	}))
	require.NoError(t, repository.CreateAgentRunEventWithNextSeq(db, &model.AgentRunEvent{
		TaskID:          pending.ID,
		EdgeRunID:       "edge-run-budget",
		SessionID:       run.SessionID,
		AgentInstanceID: "agent-executor",
		EventType:       "run.agent.file_change",
		Payload:         `{"path":"hub-server/internal/service/agent_team.go","action":"modified","toolName":"apply_patch","status":"completed"}`,
	}))
	require.NoError(t, repository.CreateAgentRunEventWithNextSeq(db, &model.AgentRunEvent{
		TaskID:          conflictingPending.ID,
		EdgeRunID:       "edge-run-reviewer",
		SessionID:       run.SessionID,
		AgentInstanceID: "agent-reviewer",
		EventType:       "run.agent.file_change",
		Payload:         `{"path":"./hub-server/internal/service/agent_team.go","action":"modified","toolName":"review_patch","status":"completed"}`,
	}))

	state, err := svc.GetTeamRunState(context.Background(), "user-1", team.ID, run.ID)
	require.NoError(t, err)
	require.Len(t, state.Dependencies, 1)
	assert.Equal(t, child.ID, state.Dependencies[0].TaskID)
	assert.Equal(t, root.ID, state.Dependencies[0].DependsOnTaskID)
	assert.Equal(t, "parent_task", state.Dependencies[0].Kind)
	require.NotNil(t, state.Budget)
	assert.Equal(t, int64(2000), state.Budget.TotalTokensUsed)
	assert.Equal(t, int64(1200), state.Budget.InputTokens)
	assert.Equal(t, int64(800), state.Budget.OutputTokens)
	assert.Equal(t, int64(200000), state.Budget.TokenLimit)
	assert.Equal(t, int64(198000), state.Budget.RemainingTokens)
	assert.Equal(t, 86.5, state.Budget.UsagePercent)
	assert.Equal(t, 2, state.Budget.RunCount)
	assert.Equal(t, 1, state.Budget.ContextWarnings)
	require.Len(t, state.Approvals, 1)
	assert.Equal(t, pending.ID, state.Approvals[0].AgentTaskID)
	assert.Equal(t, root.ID, state.Approvals[0].TeamTaskID)
	assert.Equal(t, executor.ID, state.Approvals[0].MemberID)
	assert.Equal(t, "req-1", state.Approvals[0].RequestID)
	assert.Equal(t, "Bash", state.Approvals[0].ToolName)
	assert.Equal(t, "tool-1", state.Approvals[0].ToolUseID)
	assert.Equal(t, "allow", state.Approvals[0].Status)
	assert.Equal(t, "safe command", state.Approvals[0].Reason)
	require.NotNil(t, state.Approvals[0].DecidedAt)
	require.Len(t, state.Artifacts, 2)
	assert.Equal(t, pending.ID, state.Artifacts[0].AgentTaskID)
	assert.Equal(t, root.ID, state.Artifacts[0].TeamTaskID)
	assert.Equal(t, executor.ID, state.Artifacts[0].MemberID)
	assert.Equal(t, "hub-server/internal/service/agent_team.go", state.Artifacts[0].Path)
	assert.Equal(t, "modified", state.Artifacts[0].Action)
	assert.Equal(t, "apply_patch", state.Artifacts[0].ToolName)
	assert.Equal(t, "completed", state.Artifacts[0].Status)
	assert.Equal(t, state.Artifacts[0].ConflictID, state.Artifacts[1].ConflictID)
	require.Len(t, state.Conflicts, 1)
	assert.Equal(t, "hub-server/internal/service/agent_team.go", state.Conflicts[0].Path)
	assert.Equal(t, "pending", state.Conflicts[0].Status)
	assert.ElementsMatch(t, []string{pending.ID, conflictingPending.ID}, state.Conflicts[0].AgentTaskIDs)
	assert.ElementsMatch(t, []string{root.ID, conflictingTask.ID}, state.Conflicts[0].TeamTaskIDs)
	assert.ElementsMatch(t, []string{executor.ID, reviewer.ID}, state.Conflicts[0].MemberIDs)
	assert.ElementsMatch(t, []string{"modified"}, state.Conflicts[0].Actions)

	indexed, err := repository.ListTeamArtifactsByRun(db, run.ID)
	require.NoError(t, err)
	require.Len(t, indexed, 2)
	assert.Equal(t, run.ID, indexed[0].TeamRunID)
	require.NotNil(t, indexed[0].TeamTaskID)
	assert.Equal(t, root.ID, *indexed[0].TeamTaskID)
	require.NotNil(t, indexed[0].MemberID)
	assert.Equal(t, executor.ID, *indexed[0].MemberID)
	require.NotNil(t, indexed[0].AgentTaskID)
	assert.Equal(t, pending.ID, *indexed[0].AgentTaskID)
	require.NotNil(t, indexed[0].SourceEventID)
	assert.NotEmpty(t, *indexed[0].SourceEventID)
	assert.Equal(t, "apply_patch", indexed[0].ToolName)
	assert.Equal(t, "hub-server/internal/service/agent_team.go", indexed[0].NormalizedPath)
	assert.Equal(t, state.Artifacts[0].ConflictID, indexed[0].ConflictID)
}

func TestAgentTeamService_ListTeamEventsIsOwnerScoped(t *testing.T) {
	db := setupAgentTeamStateSQLite(t)
	svc := NewAgentTeamService(db, nil, nil)
	team, _, _, run := seedAgentTeamRun(t, db)
	require.NoError(t, repository.AppendTeamEvent(db, &model.AgentTeamEvent{
		TeamRunID: run.ID,
		Type:      model.TeamEventRouteRejected,
		Payload:   `{"reason":"invalid action"}`,
	}))

	page, err := svc.ListTeamEvents(context.Background(), "user-1", team.ID, run.ID, 0, 50)
	require.NoError(t, err)
	require.Len(t, page.Items, 1)
	assert.Equal(t, model.TeamEventRouteRejected, page.Items[0].Type)
	assert.False(t, page.HasMore)
	assert.Equal(t, 1, page.NextSeq)

	_, err = svc.ListTeamEvents(context.Background(), "other-user", team.ID, run.ID, 0, 50)
	require.Error(t, err)
	assert.Equal(t, errcode.AgentNotFound, err)
}

func TestAgentTeamService_GetTeamRunStateKeepsTerminalAssignmentOverPendingProjection(t *testing.T) {
	db := setupAgentTeamStateSQLite(t)
	svc := NewAgentTeamService(db, nil, nil)
	team, supervisor, executor, run := seedAgentTeamRun(t, db)
	pendingID := "pending-task-terminal-1"
	assignment := &model.AgentTeamAssignment{
		TeamRunID: run.ID, FromMemberID: supervisor.ID, ToMemberID: executor.ID,
		Type: model.AssignmentTypeDelegate, TaskPrompt: "already failed", Status: model.AssignmentStatusFailed,
		Result: "assignment timeout reached", RunID: &pendingID,
	}
	require.NoError(t, repository.CreateAssignment(db, assignment))
	require.NoError(t, db.Exec(
		"INSERT INTO pending_agent_tasks (id, agent_instance_id, trigger_message_id, triggered_by_user_id, status, expire_at) VALUES (?, ?, ?, ?, ?, ?)",
		pendingID, "agent-executor", "msg-1", "user-1", model.TaskStatusRunning, time.Now().Add(time.Hour),
	).Error)

	state, err := svc.GetTeamRunState(context.Background(), "user-1", team.ID, run.ID)
	require.NoError(t, err)
	require.Len(t, state.Assignments, 1)
	assert.Equal(t, model.AssignmentStatusFailed, state.Assignments[0].Status)
}
