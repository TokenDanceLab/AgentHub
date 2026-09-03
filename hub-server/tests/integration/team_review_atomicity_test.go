//go:build integration

package integration

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"

	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/hub-server/internal/service/agentteam"
)

// ==================== #2256 E-P2-5 + migration 0074 — the agent-team review
// gate and compete mode against real PostgreSQL ====================
//
// Two things are being proven here, and neither is provable on SQLite:
//
//  1. The enum values the service writes must be legal in the database.
//     0033/0034 created CHECK constraints that never listed
//     'pending_review' (agent_team_runs.status) or 'compete'
//     (agent_team_assignments.type), so both features failed with SQLSTATE
//     23514 on PostgreSQL while every existing test passed: the agentteam unit
//     tests build their schema with GORM AutoMigrate off the model structs,
//     which carry no CHECK tags. Migration 0074 widens both predicates.
//  2. ReviewDagPlan's cancel path must be atomic. Cancelling N assignments
//     writes 2N rows (a conditional UPDATE plus an assignment_cancelled event
//     each). Those writes used to run on s.db with no transaction, so a failure
//     at step k left k-1 assignments cancelled with the k-th event permanently
//     missing — and the caller's only compensation was a best-effort status
//     write that could not undo the cancels. The team event log is the
//     projection source for review state (replayReviewEvents), so a cancelled
//     assignment without its event is an observable divergence, not a cosmetic
//     gap.
//
// Everything below runs on an ephemeral migrated PostgreSQL database
// (openTempMigratedDB), never on the shared integration database.

// errInjectedFault is the failure the callback processor injects. It is a
// package-private sentinel so the tests can assert the service surfaced the
// real write failure rather than masking it as a 400.
var errInjectedFault = errors.New("integration: injected write fault")

// Table names, resolved once from the models. They cannot be written as
// composite literals at the use site: assignmentsTable
// inside an if-condition is a parse error in Go, because the literal's brace is
// ambiguous with the condition block's.
var (
	assignmentsTable = model.AgentTeamAssignment{}.TableName()
	teamEventsTable  = model.AgentTeamEvent{}.TableName()
	teamRunsTable    = model.AgentTeamRun{}.TableName()
)

// faultTarget resolves which table a statement is about to touch.
//
// Statement.Table is normally resolved before the callback chain runs, but the
// model/dest type switch is kept as a fallback so the fault injector can never
// silently stop matching (which would turn these tests into no-ops that pass).
func faultTarget(tx *gorm.DB) string {
	if tx.Statement.Table != "" {
		return tx.Statement.Table
	}
	for _, candidate := range []any{tx.Statement.Model, tx.Statement.Dest} {
		switch candidate.(type) {
		case *model.AgentTeamAssignment, model.AgentTeamAssignment:
			return assignmentsTable
		case *model.AgentTeamEvent, model.AgentTeamEvent:
			return teamEventsTable
		case *model.AgentTeamRun, model.AgentTeamRun:
			return teamRunsTable
		}
	}
	return ""
}

// faultHandle returns a second GORM handle over the SAME PostgreSQL connection
// pool, carrying a callback processor that is private to it.
//
// gorm.Open initializes callbacks per instance (gorm.go: db.callbacks =
// initializeCallbacks(db)), and Session/With clones share that pointer while a
// fresh Open does not — so registering the fault here cannot leak into the
// package-level db or into any other test in this package. Sharing the pool
// keeps the transactions real: the fault handle's writes go to the same
// database the assertions read from.
//
// failUpdate is consulted with the 1-based index of each UPDATE about to hit
// agent_team_assignments, failCreate with each INSERT about to hit
// agent_team_events. Returning true injects errInjectedFault before the
// statement executes.
func faultHandle(t *testing.T, base *gorm.DB, failUpdate, failCreate func(n int) bool) *gorm.DB {
	t.Helper()

	sqlDB, err := base.DB()
	require.NoError(t, err, "get the underlying sql.DB pool")

	fault, err := gorm.Open(postgres.New(postgres.Config{Conn: sqlDB}), &gorm.Config{
		Logger: gormlogger.Discard,
	})
	require.NoError(t, err, "open the fault-injecting handle")

	var updates, creates int32
	require.NoError(t, fault.Callback().Update().Before("gorm:update").
		Register("fault:assignment-update", func(tx *gorm.DB) {
			if faultTarget(tx) != assignmentsTable {
				return
			}
			n := int(atomic.AddInt32(&updates, 1))
			if failUpdate != nil && failUpdate(n) {
				_ = tx.AddError(errInjectedFault)
			}
		}), "register the update fault")

	require.NoError(t, fault.Callback().Create().Before("gorm:create").
		Register("fault:event-create", func(tx *gorm.DB) {
			if faultTarget(tx) != teamEventsTable {
				return
			}
			n := int(atomic.AddInt32(&creates, 1))
			if failCreate != nil && failCreate(n) {
				_ = tx.AddError(errInjectedFault)
			}
		}), "register the create fault")

	t.Cleanup(func() {
		// Close the handle only, never the shared pool: base owns sqlDB and
		// openTempMigratedDB's cleanup closes it once.
		if s, e := fault.DB(); e == nil && s != nil {
			_ = fault.Callback().Update().Remove("fault:assignment-update")
			_ = fault.Callback().Create().Remove("fault:event-create")
		}
	})

	return fault
}

// reviewFixture is a team run sitting in pending_review with three assignments
// covering the three interesting statuses: two that the cancel path must take
// (pending, dispatched) and one it must never touch (done).
type reviewFixture struct {
	UserID     string
	TeamID     string
	RunID      string
	Pending    string
	Dispatched string
	Done       string
}

func seedReviewFixture(t *testing.T, db *gorm.DB) reviewFixture {
	t.Helper()

	tag := fmt.Sprintf("%d", time.Now().UnixNano())
	hashed := "hashed"
	user := &model.User{
		Username:     "review_atom_" + tag,
		PasswordHash: &hashed,
		Nickname:     "ReviewAtomicity",
	}
	require.NoError(t, db.Create(user).Error, "create user")

	session := &model.Session{Type: model.SessionTypePrivate}
	require.NoError(t, db.Create(session).Error, "create session")

	team := &model.AgentTeam{OwnerID: user.ID, Name: "review-atomicity-" + tag}
	require.NoError(t, db.Create(team).Error, "create team")

	supervisor := &model.AgentTeamMember{TeamID: team.ID, Role: model.TeamMemberRoleSupervisor, Position: 0}
	require.NoError(t, db.Create(supervisor).Error, "create supervisor member")
	worker := &model.AgentTeamMember{TeamID: team.ID, Role: model.TeamMemberRoleExecutor, Position: 1}
	require.NoError(t, db.Create(worker).Error, "create executor member")

	// This INSERT is itself part of the proof: 'pending_review' was rejected by
	// agent_team_runs_status_check before migration 0074.
	run := &model.AgentTeamRun{
		TeamID:        team.ID,
		SessionID:     session.ID,
		TriggerUserID: user.ID,
		Status:        model.TeamRunStatusPendingReview,
		Mode:          "supervisor",
	}
	require.NoError(t, db.Create(run).Error,
		"seed a run in pending_review (rejected by the 0033 CHECK before migration 0074)")

	seedAssignment := func(status string) string {
		a := &model.AgentTeamAssignment{
			TeamRunID:    run.ID,
			FromMemberID: supervisor.ID,
			ToMemberID:   worker.ID,
			Type:         model.AssignmentTypeDelegate,
			TaskPrompt:   "review atomicity probe (" + status + ")",
			Status:       status,
		}
		require.NoError(t, db.Create(a).Error, "create assignment "+status)
		require.NotEmpty(t, a.ID)
		return a.ID
	}

	return reviewFixture{
		UserID:     user.ID,
		TeamID:     team.ID,
		RunID:      run.ID,
		Pending:    seedAssignment(model.AssignmentStatusPending),
		Dispatched: seedAssignment(model.AssignmentStatusDispatched),
		Done:       seedAssignment(model.AssignmentStatusDone),
	}
}

// reviewService builds the service under test on the given handle.
func reviewService(handle *gorm.DB) *agentteam.AgentTeamService {
	svc := agentteam.NewAgentTeamServiceWithGuardrails(handle, &errPathMockAgentService{}, nil,
		agentteam.AgentTeamGuardrails{
			MaxDelegationDepth:       3,
			MaxActiveSubAgentsPerRun: 8,
			MaxRouteRepeats:          3,
			MaxTasksPerTeamRun:       5,
			AssignmentTimeout:        30 * time.Minute,
			MaxTeamRunBudgetTokens:   100000,
			MaxTeamRunBudgetUsagePct: 95,
		})
	svc.SetHumanReviewEnabled(true)
	return svc
}

func assignmentStatus(t *testing.T, db *gorm.DB, id string) string {
	t.Helper()
	var a model.AgentTeamAssignment
	require.NoError(t, db.First(&a, "id = ?", id).Error, "load assignment "+id)
	return a.Status
}

func runStatus(t *testing.T, db *gorm.DB, runID string) string {
	t.Helper()
	run, err := repository.GetTeamRunByID(db, runID)
	require.NoError(t, err, "load run")
	return run.Status
}

func teamEventTypes(t *testing.T, db *gorm.DB, runID string) []string {
	t.Helper()
	events, err := repository.ListTeamEventsByRun(db, runID)
	require.NoError(t, err, "list team events")
	types := make([]string, 0, len(events))
	for _, e := range events {
		types = append(types, e.Type)
	}
	return types
}

func countType(types []string, want string) int {
	n := 0
	for _, t := range types {
		if t == want {
			n++
		}
	}
	return n
}

// ── 1. the enum values the service writes are legal in PostgreSQL ───────────

func TestAgentTeamRunStatusPendingReview_RealPG_IsPersistable(t *testing.T) {
	pdb, cleanup := openTempMigratedDB(t)
	defer cleanup()

	fx := seedReviewFixture(t, pdb)
	require.Equal(t, model.TeamRunStatusPendingReview, runStatus(t, pdb, fx.RunID),
		"the seeded run must really be in pending_review")

	// The transition ReviewDagPlan's CAS performs must also be legal.
	updated, err := repository.UpdateTeamRunStatusIf(pdb, fx.RunID,
		model.TeamRunStatusPendingReview, model.TeamRunStatusRunning)
	require.NoError(t, err, "pending_review -> running CAS")
	assert.Equal(t, int64(1), updated)
	assert.Equal(t, model.TeamRunStatusRunning, runStatus(t, pdb, fx.RunID))
}

func TestCompeteAssignmentType_RealPG_IsPersistable(t *testing.T) {
	pdb, cleanup := openTempMigratedDB(t)
	defer cleanup()

	fx := seedReviewFixture(t, pdb)
	var supervisorID, workerID string
	require.NoError(t, pdb.Model(&model.AgentTeamAssignment{}).
		Select("from_member_id", "to_member_id").
		Where("id = ?", fx.Pending).
		Row().Scan(&supervisorID, &workerID), "read member ids back")

	compete := &model.AgentTeamAssignment{
		TeamRunID:    fx.RunID,
		FromMemberID: supervisorID,
		ToMemberID:   workerID,
		Type:         model.AssignmentTypeCompete,
		TaskPrompt:   "compete probe",
		Status:       model.AssignmentStatusPending,
	}
	require.NoError(t, pdb.Create(compete).Error,
		"type='compete' was rejected by agent_team_assignments_type_check before migration 0074")
}

// TestAgentTeamEnumChecks_RealPG_WidenedNotRemoved pins the other half of the
// migration: widening a CHECK must not become dropping it. Every value the
// model can write has to be allowed, and a value outside the model's set still
// has to be rejected.
func TestAgentTeamEnumChecks_RealPG_WidenedNotRemoved(t *testing.T) {
	pdb, cleanup := openTempMigratedDB(t)
	defer cleanup()

	checkDef := func(table, name string) string {
		var def string
		require.NoError(t, pdb.Raw(
			"SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = ?::regclass AND conname = ?",
			table, name).Row().Scan(&def), "read the CHECK definition for "+table)
		return def
	}

	runDef := checkDef("agent_team_runs", "agent_team_runs_status_check")
	for _, status := range []string{
		model.TeamRunStatusQueued, model.TeamRunStatusRunning, model.TeamRunStatusPendingReview,
		model.TeamRunStatusCompleted, model.TeamRunStatusFailed, model.TeamRunStatusCancelled,
	} {
		assert.Contains(t, runDef, "'"+status+"'",
			"agent_team_runs_status_check must allow every model.TeamRunStatus*")
	}

	typeDef := checkDef("agent_team_assignments", "agent_team_assignments_type_check")
	for _, typ := range []string{
		model.AssignmentTypeDelegate, model.AssignmentTypeReview, model.AssignmentTypeApprove,
		model.AssignmentTypeNotify, model.AssignmentTypeCompete,
	} {
		assert.Contains(t, typeDef, "'"+typ+"'",
			"agent_team_assignments_type_check must allow every model.AssignmentType*")
	}

	// Negative half: the constraints still reject values outside the model's
	// sets, so this migration widened them instead of removing them.
	assert.True(t, strings.Contains(runDef, "CHECK"), "run status check must still be a CHECK constraint")
	fx := seedReviewFixture(t, pdb)
	bogusRun := &model.AgentTeamRun{
		TeamID: fx.TeamID, SessionID: fx.RunID, TriggerUserID: fx.UserID, Status: "not_a_status",
	}
	assert.Error(t, pdb.Create(bogusRun).Error, "an unknown run status must still be rejected")

	bogusAssignment := &model.AgentTeamAssignment{
		TeamRunID: fx.RunID, FromMemberID: fx.Pending, ToMemberID: fx.Pending,
		Type: "not_a_type", TaskPrompt: "x", Status: model.AssignmentStatusPending,
	}
	assert.Error(t, pdb.Create(bogusAssignment).Error, "an unknown assignment type must still be rejected")
}

// ── 2. the cancel path is atomic ────────────────────────────────────────────

func TestReviewDagPlanDiscuss_RealPG_CancelsPendingAndDispatchedAtomically(t *testing.T) {
	pdb, cleanup := openTempMigratedDB(t)
	defer cleanup()

	fx := seedReviewFixture(t, pdb)
	svc := reviewService(pdb)

	state, err := svc.ReviewDagPlan(context.Background(), fx.UserID, fx.RunID, model.HumanReviewDecision{
		Action:  model.ReviewActionDiscuss,
		Comment: "rework the plan",
	})
	require.NoError(t, err, "a clean discuss decision must succeed")
	require.NotNil(t, state)
	assert.Equal(t, model.ReviewActionDiscuss, state.Action)

	assert.Equal(t, model.TeamRunStatusRunning, runStatus(t, pdb, fx.RunID),
		"the claim moves the run out of the review gate")
	assert.Equal(t, model.AssignmentStatusCancelled, assignmentStatus(t, pdb, fx.Pending))
	assert.Equal(t, model.AssignmentStatusCancelled, assignmentStatus(t, pdb, fx.Dispatched))
	assert.Equal(t, model.AssignmentStatusDone, assignmentStatus(t, pdb, fx.Done),
		"a terminal assignment must never be touched by the cancel path")

	types := teamEventTypes(t, pdb, fx.RunID)
	assert.Equal(t, 2, countType(types, model.TeamEventAssignmentCancelled),
		"one assignment_cancelled event per cancelled assignment")
	assert.Equal(t, 1, countType(types, model.TeamEventReviewDecided),
		"exactly one review_decided event")

	// The invariant the half-success broke: cancellations and their audit trail
	// agree, because replayReviewEvents projects review state from these events.
	var cancelled int64
	require.NoError(t, pdb.Model(&model.AgentTeamAssignment{}).
		Where("team_run_id = ? AND status = ?", fx.RunID, model.AssignmentStatusCancelled).
		Count(&cancelled).Error)
	assert.Equal(t, int64(countType(types, model.TeamEventAssignmentCancelled)), cancelled,
		"cancelled assignments and assignment_cancelled events must be equal in number")

	// The cancellation reason must survive on the row.
	var reason string
	require.NoError(t, pdb.Model(&model.AgentTeamAssignment{}).Select("result").
		Where("id = ?", fx.Pending).Row().Scan(&reason))
	assert.Equal(t, "rework the plan", reason)
}

func TestReviewDagPlanCancel_RealPG_FaultLeavesNoPartialState(t *testing.T) {
	cases := []struct {
		name       string
		failUpdate func(n int) bool
		failCreate func(n int) bool
		why        string
	}{
		{
			name:       "second assignment update fails",
			failUpdate: func(n int) bool { return n == 2 },
			why: "the first assignment was already UPDATEd inside the loop; before the " +
				"transaction it stayed cancelled after the second one failed",
		},
		{
			name:       "first cancellation event insert fails",
			failCreate: func(n int) bool { return n == 1 },
			why: "the first assignment's UPDATE had already executed; before the " +
				"transaction this left a cancelled assignment with no event — the " +
				"permanently missing audit trail from #2256 E-P2-5",
		},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			pdb, cleanup := openTempMigratedDB(t)
			defer cleanup()

			fx := seedReviewFixture(t, pdb)
			svc := reviewService(faultHandle(t, pdb, tc.failUpdate, tc.failCreate))

			_, err := svc.ReviewDagPlan(context.Background(), fx.UserID, fx.RunID, model.HumanReviewDecision{
				Action:  model.ReviewActionModify,
				Comment: "modify with an injected fault",
			})
			require.Error(t, err, "the injected write fault must surface to the caller")
			assert.True(t, errors.Is(err, errInjectedFault),
				"the caller must see the real write failure, got %v", err)

			// Assertions read through the clean handle, so they observe committed
			// state only.
			assert.Equal(t, model.TeamRunStatusPendingReview, runStatus(t, pdb, fx.RunID),
				"the claim must roll back with the side effects it authorized")
			assert.Equal(t, model.AssignmentStatusPending, assignmentStatus(t, pdb, fx.Pending),
				"no assignment may be left cancelled: "+tc.why)
			assert.Equal(t, model.AssignmentStatusDispatched, assignmentStatus(t, pdb, fx.Dispatched),
				"no assignment may be left cancelled: "+tc.why)
			assert.Equal(t, model.AssignmentStatusDone, assignmentStatus(t, pdb, fx.Done))

			types := teamEventTypes(t, pdb, fx.RunID)
			assert.Empty(t, types, "a rolled-back decision must leave no team events at all")

			var cancelled int64
			require.NoError(t, pdb.Model(&model.AgentTeamAssignment{}).
				Where("team_run_id = ? AND status = ?", fx.RunID, model.AssignmentStatusCancelled).
				Count(&cancelled).Error)
			assert.Zero(t, cancelled, "zero cancelled assignments after a failed decision")
		})
	}
}

// TestReviewDagPlan_RealPG_RetryAfterRolledBackFaultSucceeds is the reason the
// compensating status write could be deleted: rollback alone leaves the run
// retryable. Under the old shape retryability depended on a second best-effort
// write (running -> pending_review) that could itself fail and strand the run in
// 'running' with cancelled assignments.
func TestReviewDagPlan_RealPG_RetryAfterRolledBackFaultSucceeds(t *testing.T) {
	pdb, cleanup := openTempMigratedDB(t)
	defer cleanup()

	fx := seedReviewFixture(t, pdb)

	// First attempt: fault on the very first cancellation event.
	failed := reviewService(faultHandle(t, pdb, nil, func(n int) bool { return n == 1 }))
	_, err := failed.ReviewDagPlan(context.Background(), fx.UserID, fx.RunID, model.HumanReviewDecision{
		Action:  model.ReviewActionDiscuss,
		Comment: "first attempt",
	})
	require.Error(t, err, "the first attempt must fail")
	require.Equal(t, model.TeamRunStatusPendingReview, runStatus(t, pdb, fx.RunID),
		"the run must still be claimable")

	// Second attempt: clean handle, same run, same decision.
	state, err := reviewService(pdb).ReviewDagPlan(context.Background(), fx.UserID, fx.RunID,
		model.HumanReviewDecision{Action: model.ReviewActionDiscuss, Comment: "retry after rollback"})
	require.NoError(t, err, "the retry must succeed without any compensating write")
	require.NotNil(t, state)

	assert.Equal(t, model.TeamRunStatusRunning, runStatus(t, pdb, fx.RunID))
	assert.Equal(t, model.AssignmentStatusCancelled, assignmentStatus(t, pdb, fx.Pending))
	assert.Equal(t, model.AssignmentStatusCancelled, assignmentStatus(t, pdb, fx.Dispatched))

	types := teamEventTypes(t, pdb, fx.RunID)
	assert.Equal(t, 2, countType(types, model.TeamEventAssignmentCancelled),
		"the retry produces exactly the events the failed attempt did not")
	assert.Equal(t, 1, countType(types, model.TeamEventReviewDecided),
		"the failed attempt must not have left a review_decided event behind")
}
