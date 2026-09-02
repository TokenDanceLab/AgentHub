package agentteam

import (
	"context"
	"reflect"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// Panic safety for the parallel read fan-out in GetTeamRunState (#2154).
//
// Before the fan-out these six reads ran on the request goroutine, where gin's
// recovery middleware turned any panic into a 500. errgroup.Group.Go launches a
// *new* goroutine and recovers nothing, so the same panic became a process
// crash on the endpoint the team-run UI polls every 1-3 s. Each closure must
// therefore carry its own guard, and the guard must report the panic as that
// read's error — not swallow it and let the projection return half-populated
// data as if the read had simply come back empty.
//
// The guard primitive itself (log line, panic counter, never overwriting an
// error that was already set) is unit-tested in pkg/safego; what is locked here
// is the wiring: all six reads, each attributed to its own label, each yielding
// an error instead of a projection.

// panicReadOn registers a gorm Query hook that panics inside every read whose
// destination matches dest. The hook runs inside the repository call, so the
// panic surfaces on the same goroutine as the production read — i.e. inside the
// errgroup closure — which is what makes this a faithful injection.
func panicReadOn(t *testing.T, db *gorm.DB, dest reflect.Type, value string) {
	t.Helper()
	require.NoError(t, db.Callback().Query().Before("gorm:query").Register(
		"test:panic_read",
		func(tx *gorm.DB) {
			if reflect.TypeOf(tx.Statement.Dest) == dest {
				panic(value)
			}
		},
	))
}

func TestGetTeamRunState_PanicInAnyParallelReadBecomesThatReadsError(t *testing.T) {
	cases := []struct {
		name  string
		dest  reflect.Type
		label string
	}{
		{"members", destTeamMembers, teamRunReadMembers},
		{"assignments", destAssignments, teamRunReadAssignments},
		{"tasks", destTeamTasks, teamRunReadTasks},
		{"teamEvents", destTeamEvents, teamRunReadTeamEvents},
		{"pendingTasks", destPendingTasks, teamRunReadPendingTask},
		{"runEvents", destAgentRunEvent, teamRunReadRunEvents},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			db := setupAgentTeamStateSQLite(t)
			teamID, runID := seedTeamRunStateFixture(t, db)
			svc := NewAgentTeamService(db, nil, nil)
			panicReadOn(t, db, tc.dest, "injected panic in the "+tc.name+" read")

			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()

			// Without a guard in the closure this panics the test binary, which
			// is the production symptom: a fatal process, not a 500.
			state, err := svc.GetTeamRunState(ctx, "user-1", teamID, runID)
			require.Error(t, err, "a panic in one parallel read must surface as an error")
			require.Nil(t, state, "a panicked read must not yield a half-populated projection")
			require.Contains(t, err.Error(), tc.label,
				"the error must name the read that panicked, not whichever slot happened to be checked first")
			require.Contains(t, err.Error(), "injected panic")
		})
	}
}
