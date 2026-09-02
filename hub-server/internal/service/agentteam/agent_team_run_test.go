package agentteam

import (
	"context"
	"errors"
	"reflect"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"gorm.io/gorm"

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
