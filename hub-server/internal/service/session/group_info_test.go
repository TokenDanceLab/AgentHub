package session

import (
	"sync"
	"testing"

	"github.com/stretchr/testify/require"
	"gorm.io/gorm/schema"

	"github.com/agenthub/hub-server/internal/model"
)

// TestApplyGroupInfoChanges_KeysAreSessionColumns pins a coupling that
// UpdateGroupInfo depends on: the map ApplyGroupInfoChanges returns is both the
// published event payload *and* the column allowlist handed to
// repository.UpdateSessionColumns. If a key ever stops being a real sessions
// column, the narrow update silently writes one column fewer — the group rename
// or announcement edit just stops persisting, with no error anywhere.
func TestApplyGroupInfoChanges_KeysAreSessionColumns(t *testing.T) {
	parsed, err := schema.Parse(&model.Session{}, &sync.Map{}, schema.NamingStrategy{})
	require.NoError(t, err)
	dbNames := make(map[string]bool, len(parsed.DBNames))
	for _, name := range parsed.DBNames {
		dbNames[name] = true
	}

	name, avatarURL, announcement := "renamed", "avatar.png", "hello"
	changes := ApplyGroupInfoChanges(&model.Session{}, &name, &avatarURL, &announcement)
	require.Len(t, changes, 3, "all three provided claims must be reported as changes")
	for key := range changes {
		require.True(t, dbNames[key],
			"ApplyGroupInfoChanges key %q is not a sessions column; UpdateGroupInfo passes these keys straight to repository.UpdateSessionColumns as the write allowlist", key)
	}

	// Untouched claims are absent, so the allowlist stays empty and no write
	// happens at all.
	require.Empty(t, ApplyGroupInfoChanges(&model.Session{}, nil, nil, nil))
}
