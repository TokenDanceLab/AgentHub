//go:build !windows

package device

import (
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestJournalControlsRequireExactTaskAndAdmittedRun(t *testing.T) {
	j, err := OpenJournal(filepath.Join(t.TempDir(), "journal.sqlite"))
	require.NoError(t, err)
	defer j.Close()
	_, _, err = j.BeginAdmission("task-1", "delivery-1", "paired-device/hub-session")
	require.NoError(t, err)
	require.NoError(t, j.Admitted("task-1", "run-1"))
	require.Error(t, j.Admitted("task-1", "run-other"))
	require.Error(t, j.Admitted("missing-task", "run-1"))
	control := Control{ID: "task-1", TaskID: "task-1", Kind: "cancel"}
	require.NoError(t, j.Record(control))
	control.RunID = "run-1"
	require.NoError(t, j.Record(control))
	require.NoError(t, j.Record(control))
	control.RunID = "run-other"
	require.Error(t, j.Record(control))
	control.ID = "../task-1"
	require.Error(t, j.Record(control))
	control.ID = "different-id"
	require.Error(t, j.Record(control))
}

func TestJournalDeliveryIdentityCannotMoveAcrossTasks(t *testing.T) {
	j, err := OpenJournal(filepath.Join(t.TempDir(), "journal.sqlite"))
	require.NoError(t, err)
	defer j.Close()
	_, _, err = j.BeginAdmission("task-1", "delivery-1", "paired-device/hub-session")
	require.NoError(t, err)
	require.NoError(t, j.Admitted("task-1", "run-1"))
	fresh, runID, err := j.BeginAdmission("task-1", "delivery-2", "paired-device/hub-session")
	require.NoError(t, err)
	require.False(t, fresh)
	require.Equal(t, "run-1", runID)
	_, _, err = j.BeginAdmission("task-2", "delivery-2", "paired-device/hub-session")
	require.Error(t, err)
}
