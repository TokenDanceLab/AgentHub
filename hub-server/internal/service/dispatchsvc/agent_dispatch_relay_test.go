package dispatchsvc

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/model"
)

// ── Relay port mock ────────────────────────────────────────────────────────

type recordingRelayPort struct {
	pushReached bool
	err         error
	calls       int
	targetIDs   []string
}

func (r *recordingRelayPort) CreateCommand(ctx context.Context, targetEdgeID, commandType string, payload json.RawMessage, createdBy string) (bool, error) {
	r.calls++
	r.targetIDs = append(r.targetIDs, targetEdgeID)
	return r.pushReached, r.err
}

// newTestDB creates an in-memory SQLite DB for tests that hit repository functions.
func newTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.PendingAgentTask{}))
	return db
}

// ── dispatchRouteHubRelay tests (#2073 honest state) ───────────────────────

func TestDispatchRouteHubRelay_PushReached_MarksSentAndDispatched(t *testing.T) {
	relay := &recordingRelayPort{pushReached: true}
	outbox := &recordingDispatchOutbox{}
	cache := &recordingDispatchCache{routes: map[string]string{}}
	wsMgr := &recordingDispatchWS{}
	db := newTestDB(t)

	ds := NewDispatchService(db, nil, wsMgr, cache, relay, outbox, config.EdgeDispatchConfig{}, nil, "")

	task := &model.PendingAgentTask{ID: "task-1", EdgeDeviceID: "dev-1"}
	// Pre-create the task row so UpdatePendingTaskDispatched doesn't fail.
	require.NoError(t, db.Create(task).Error)
	ai := &model.AgentInstance{InviterUserID: "user-1"}
	payload := []byte(`{"task_id":"task-1"}`)

	ds.dispatchRouteHubRelay(context.Background(), task, ai, payload, "deliv-1", cache)

	assert.Equal(t, 1, relay.calls)
	require.Len(t, relay.targetIDs, 1)
	assert.Equal(t, "dev-1", relay.targetIDs[0], "relay push must target the bound device id, not the inviter user id (#2154 F15)")
	assert.Equal(t, 1, outbox.marked, "live push must mark delivery sent")
}

// Legacy unbound rows (empty EdgeDeviceID) keep the old inviter-user fallback
// instead of pushing to an empty device key.
func TestDispatchRouteHubRelay_UnboundFallsBackToInviterID(t *testing.T) {
	relay := &recordingRelayPort{pushReached: true}
	outbox := &recordingDispatchOutbox{}
	cache := &recordingDispatchCache{routes: map[string]string{}}
	wsMgr := &recordingDispatchWS{}
	db := newTestDB(t)

	ds := NewDispatchService(db, nil, wsMgr, cache, relay, outbox, config.EdgeDispatchConfig{}, nil, "")

	task := &model.PendingAgentTask{ID: "task-9", EdgeDeviceID: ""}
	require.NoError(t, db.Create(task).Error)
	ai := &model.AgentInstance{InviterUserID: "user-9"}
	payload := []byte(`{"task_id":"task-9"}`)

	ds.dispatchRouteHubRelay(context.Background(), task, ai, payload, "deliv-9", cache)

	require.Len(t, relay.targetIDs, 1)
	assert.Equal(t, "user-9", relay.targetIDs[0], "unbound relay row must fall back to the inviter user id")
}

func TestDispatchRouteHubRelay_PushNotReached_DoesNotMarkSentOrDispatched(t *testing.T) {
	relay := &recordingRelayPort{pushReached: false}
	outbox := &recordingDispatchOutbox{}
	cache := &recordingDispatchCache{routes: map[string]string{}}
	wsMgr := &recordingDispatchWS{}
	// No DB needed: push-not-reached path returns before any DB call.

	ds := NewDispatchService(nil, nil, wsMgr, cache, relay, outbox, config.EdgeDispatchConfig{}, nil, "")

	task := &model.PendingAgentTask{ID: "task-2", EdgeDeviceID: "dev-2"}
	ai := &model.AgentInstance{InviterUserID: "user-2"}
	payload := []byte(`{"task_id":"task-2"}`)

	ds.dispatchRouteHubRelay(context.Background(), task, ai, payload, "deliv-2", cache)

	assert.Equal(t, 1, relay.calls)
	assert.Equal(t, 0, outbox.marked, "no-active-conn push must NOT mark delivery sent")
	// Negative constraint: outbox retry loop will pick up the pending delivery.
}

func TestDispatchRouteHubRelay_CreateError_FallsBackToOfflineQueue(t *testing.T) {
	relay := &recordingRelayPort{err: assert.AnError}
	outbox := &recordingDispatchOutbox{}
	cache := &recordingDispatchCache{routes: map[string]string{}}
	wsMgr := &recordingDispatchWS{}

	ds := NewDispatchService(nil, nil, wsMgr, cache, relay, outbox, config.EdgeDispatchConfig{}, nil, "")

	task := &model.PendingAgentTask{ID: "task-3", EdgeDeviceID: "dev-3"}
	ai := &model.AgentInstance{InviterUserID: "user-3"}
	payload := []byte(`{"task_id":"task-3"}`)

	ds.dispatchRouteHubRelay(context.Background(), task, ai, payload, "deliv-3", cache)

	assert.Equal(t, 1, relay.calls)
	assert.Equal(t, 0, outbox.marked, "create failure must not mark delivery sent")
	require.Len(t, cache.pushed, 1, "create failure must push to offline target queue")
}
