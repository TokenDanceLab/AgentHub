package agent

import (
	"context"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
)

// #2253 — Service.UpdateCustomAgent read the whole row, backfilled five of its
// fields and handed the request-shaped struct to a whole-row db.Save. Because
// updateCustomAgentReq carries no output_schema, every rename wrote NULL over
// the structured-output schema that service/dispatch/payload.go sends to the
// edge; and because model.CustomAgent.DeletedAt is *time.Time (no GORM
// soft-delete scope), a delete landing between the read and the write was
// silently undone. Both returned HTTP 200.
//
// These tests drive the service method end to end and pin the replacement
// contract: only the request-writable columns are written, and a row deleted
// after the read is reported as errcode.AgentNotFound instead of resurrected.

const customAgentUpdateTestSchema = `{"type":"object","properties":{"answer":{"type":"string"}},"required":["answer"]}`

// newCustomAgentUpdateDB builds the sqlite fixture for these tests.
//
// output_schema is declared BLOB rather than TEXT on purpose. On PostgreSQL the
// column is jsonb and the driver hands GORM []byte, which scans straight into
// *json.RawMessage; the sqlite driver returns TEXT columns as Go strings, and
// database/sql cannot store a string into *json.RawMessage — so a TEXT column
// would make GetCustomAgentByID fail on every row that actually has a schema,
// which is exactly the row this issue is about. BLOB reproduces the PostgreSQL
// driver behaviour ([]byte) and keeps the L0 test faithful.
func newCustomAgentUpdateDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: gormlogger.Default.LogMode(gormlogger.Silent),
	})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	require.NoError(t, db.Exec(`CREATE TABLE custom_agents (
		id TEXT PRIMARY KEY,
		owner_user_id TEXT NOT NULL,
		name TEXT NOT NULL,
		avatar_url TEXT DEFAULT '',
		agent_type TEXT NOT NULL,
		system_prompt TEXT NOT NULL DEFAULT '',
		capability_tags TEXT DEFAULT '[]',
		tool_whitelist TEXT DEFAULT '[]',
		model_params TEXT DEFAULT '{}',
		output_schema BLOB,
		deleted_at DATETIME,
		created_at DATETIME,
		updated_at DATETIME
	)`).Error)
	return db
}

// seedCustomAgent inserts a row with a non-empty output_schema, mirroring a
// custom agent that a user configured for structured output.
func seedCustomAgent(t *testing.T, db *gorm.DB, id, owner, name string, ts time.Time) {
	t.Helper()
	require.NoError(t, db.Exec(
		`INSERT INTO custom_agents
			(id, owner_user_id, name, avatar_url, agent_type, system_prompt,
			 capability_tags, tool_whitelist, model_params, output_schema,
			 created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, owner, name, "https://example.invalid/old.png", "claude-code", "You are helpful.",
		`["code"]`, `["read"]`, `{"model":"claude-sonnet-4-6"}`, []byte(customAgentUpdateTestSchema),
		ts, ts,
	).Error)
}

type customAgentUpdateRow struct {
	ID             string
	OwnerUserID    string
	Name           string
	AvatarURL      string
	AgentType      string
	SystemPrompt   string
	CapabilityTags string
	ToolWhitelist  string
	ModelParams    string
	OutputSchema   *string
	DeletedAt      *time.Time
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

func readCustomAgentUpdateRow(t *testing.T, db *gorm.DB, id string) customAgentUpdateRow {
	t.Helper()
	var row customAgentUpdateRow
	require.NoError(t, db.Raw(
		`SELECT id, owner_user_id, name, avatar_url, agent_type, system_prompt,
		        capability_tags, tool_whitelist, model_params, output_schema,
		        deleted_at, created_at, updated_at
		 FROM custom_agents WHERE id = ?`, id).Scan(&row).Error)
	require.Equal(t, id, row.ID)
	return row
}

// requestShapedCustomAgent is what handler.Update builds from
// updateCustomAgentReq: seven fields, nothing else.
func requestShapedCustomAgent(id, name string) *model.CustomAgent {
	return &model.CustomAgent{
		ID:           id,
		Name:         name,
		AgentType:    "claude-code",
		SystemPrompt: "Renamed prompt.",
	}
}

// armConcurrentSoftDelete makes the next GetCustomAgentByID inside this db
// followed immediately by a soft delete, i.e. DELETE /web/custom-agents/:id
// landing in the window between the service's read and its write.
func armConcurrentSoftDelete(t *testing.T, db *gorm.DB, id string) {
	t.Helper()
	var fired atomic.Bool
	require.NoError(t, db.Callback().Query().After("gorm:query").Register(
		"test:concurrent_soft_delete",
		func(tx *gorm.DB) {
			if !fired.CompareAndSwap(false, true) {
				return
			}
			if err := tx.Session(&gorm.Session{NewDB: true}).Exec(
				`UPDATE custom_agents SET deleted_at = ? WHERE id = ?`, time.Now(), id,
			).Error; err != nil {
				tx.AddError(err)
			}
		},
	))
}

// customAgentSQLRecorder captures executed SQL so the service's write can be
// asserted column by column.
type customAgentSQLRecorder struct {
	mu      sync.Mutex
	queries []string
}

func (r *customAgentSQLRecorder) LogMode(gormlogger.LogLevel) gormlogger.Interface { return r }
func (r *customAgentSQLRecorder) Info(context.Context, string, ...interface{})     {}
func (r *customAgentSQLRecorder) Warn(context.Context, string, ...interface{})     {}
func (r *customAgentSQLRecorder) Error(context.Context, string, ...interface{})    {}

func (r *customAgentSQLRecorder) Trace(_ context.Context, _ time.Time, fc func() (string, int64), _ error) {
	sql, _ := fc()
	r.mu.Lock()
	defer r.mu.Unlock()
	r.queries = append(r.queries, sql)
}

func (r *customAgentSQLRecorder) firstUpdate() string {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, q := range r.queries {
		if strings.HasPrefix(strings.ToUpper(strings.TrimSpace(q)), "UPDATE") {
			return q
		}
	}
	return ""
}

func updateSetColumns(t *testing.T, sql string) []string {
	t.Helper()
	upper := strings.ToUpper(sql)
	setAt := strings.Index(upper, " SET ")
	whereAt := strings.Index(upper, " WHERE ")
	require.GreaterOrEqual(t, setAt, 0, "not an UPDATE statement: %s", sql)
	require.Greater(t, whereAt, setAt, "UPDATE without WHERE: %s", sql)

	assignments := strings.Split(sql[setAt+len(" SET "):whereAt], ",")
	cols := make([]string, 0, len(assignments))
	for _, part := range assignments {
		eq := strings.Index(part, "=")
		require.Greater(t, eq, 0, "unparsable assignment %q in %s", part, sql)
		col := strings.TrimSpace(part[:eq])
		if dot := strings.LastIndex(col, "."); dot >= 0 {
			col = col[dot+1:]
		}
		cols = append(cols, strings.Trim(col, "`\""))
	}
	sort.Strings(cols)
	return cols
}

func TestServiceUpdateCustomAgent_RenameKeepsOutputSchema(t *testing.T) {
	db := newCustomAgentUpdateDB(t)
	createdAt := time.Now().Add(-48 * time.Hour).Truncate(time.Second)
	seedCustomAgent(t, db, "ca-svc-schema", "user-1", "Old Name", createdAt)
	svc := &Service{db: db}

	require.NoError(t, svc.UpdateCustomAgent(context.Background(), "user-1", requestShapedCustomAgent("ca-svc-schema", "New Name")))

	row := readCustomAgentUpdateRow(t, db, "ca-svc-schema")
	assert.Equal(t, "New Name", row.Name)
	assert.Equal(t, "Renamed prompt.", row.SystemPrompt)

	require.NotNil(t, row.OutputSchema,
		"renaming an agent must not destroy its structured-output schema: dispatch/payload.go copies "+
			"this column into the edge payload as structured_output_schema (#2253)")
	assert.JSONEq(t, customAgentUpdateTestSchema, *row.OutputSchema)

	assert.Nil(t, row.DeletedAt)
	assert.WithinDuration(t, createdAt, row.CreatedAt, time.Second, "created_at is immutable")
	assert.Equal(t, "user-1", row.OwnerUserID, "ownership is verified, never reassigned by the write")
}

func TestServiceUpdateCustomAgent_WritesExactlyTheRequestWritableColumns(t *testing.T) {
	db := newCustomAgentUpdateDB(t)
	seedCustomAgent(t, db, "ca-svc-columns", "user-1", "Old Name", time.Now().Add(-time.Hour))

	rec := &customAgentSQLRecorder{}
	svc := &Service{db: db.Session(&gorm.Session{Logger: rec})}

	ca := &model.CustomAgent{
		ID:             "ca-svc-columns",
		Name:           "New Name",
		AvatarURL:      "https://example.invalid/new.png",
		AgentType:      "codex",
		SystemPrompt:   "New prompt.",
		CapabilityTags: `["new"]`,
		ToolWhitelist:  `["exec"]`,
		ModelParams:    `{"model":"gpt-5"}`,
	}
	require.NoError(t, svc.UpdateCustomAgent(context.Background(), "user-1", ca))

	sql := rec.firstUpdate()
	require.NotEmpty(t, sql, "the service must issue an UPDATE; got %v", rec.queries)

	got := updateSetColumns(t, sql)
	want := []string{
		"agent_type", "avatar_url", "capability_tags", "model_params",
		"name", "system_prompt", "tool_whitelist", "updated_at",
	}
	assert.Equal(t, want, got,
		"service backfill and repository Select must agree on one column set: updateCustomAgentReq's "+
			"writable fields plus GORM's autoUpdateTime updated_at. Anything more is a column the "+
			"request cannot carry written from a zero value (#2253); anything less is a request field "+
			"silently dropped. SQL: %s", sql)
	assert.Contains(t, strings.ToUpper(sql), "DELETED_AT IS NULL",
		"the not-deleted guard must be inside the UPDATE. SQL: %s", sql)
}

func TestServiceUpdateCustomAgent_ConcurrentSoftDeleteReturnsNotFound(t *testing.T) {
	db := newCustomAgentUpdateDB(t)
	seedCustomAgent(t, db, "ca-svc-revive", "user-1", "Old Name", time.Now().Add(-time.Hour))
	armConcurrentSoftDelete(t, db, "ca-svc-revive")
	svc := &Service{db: db}

	err := svc.UpdateCustomAgent(context.Background(), "user-1", requestShapedCustomAgent("ca-svc-revive", "New Name"))

	require.ErrorIs(t, err, errcode.AgentNotFound,
		"a row soft-deleted between the service's read and its write must be reported as not-found, "+
			"which requires the guard to be part of the UPDATE itself — a check-then-act read cannot "+
			"see it (#2253); got %v", err)

	row := readCustomAgentUpdateRow(t, db, "ca-svc-revive")
	require.NotNil(t, row.DeletedAt, "the deleted agent must stay deleted, not come back")
	assert.Equal(t, "Old Name", row.Name, "the rejected write must not have renamed a deleted agent")
}

func TestServiceUpdateCustomAgent_SoftDeletedRowReturnsNotFound(t *testing.T) {
	db := newCustomAgentUpdateDB(t)
	seedCustomAgent(t, db, "ca-svc-deleted", "user-1", "Old Name", time.Now().Add(-time.Hour))
	require.NoError(t, db.Exec(`UPDATE custom_agents SET deleted_at = ? WHERE id = ?`, time.Now(), "ca-svc-deleted").Error)
	svc := &Service{db: db}

	err := svc.UpdateCustomAgent(context.Background(), "user-1", requestShapedCustomAgent("ca-svc-deleted", "New Name"))
	require.ErrorIs(t, err, errcode.AgentNotFound)

	row := readCustomAgentUpdateRow(t, db, "ca-svc-deleted")
	require.NotNil(t, row.DeletedAt)
	assert.Equal(t, "Old Name", row.Name)
}

func TestServiceUpdateCustomAgent_UnknownIDReturnsNotFound(t *testing.T) {
	db := newCustomAgentUpdateDB(t)
	svc := &Service{db: db}

	err := svc.UpdateCustomAgent(context.Background(), "user-1", requestShapedCustomAgent("ca-svc-missing", "Ghost"))
	require.ErrorIs(t, err, errcode.AgentNotFound)

	var count int64
	require.NoError(t, db.Raw(`SELECT COUNT(*) FROM custom_agents`).Scan(&count).Error)
	assert.Equal(t, int64(0), count, "a failed update must not insert a row")
}

func TestServiceUpdateCustomAgent_OwnerMismatchReturnsNotFound(t *testing.T) {
	db := newCustomAgentUpdateDB(t)
	seedCustomAgent(t, db, "ca-svc-owner", "user-1", "Old Name", time.Now().Add(-time.Hour))
	svc := &Service{db: db}

	err := svc.UpdateCustomAgent(context.Background(), "user-2", requestShapedCustomAgent("ca-svc-owner", "Stolen Name"))
	require.ErrorIs(t, err, errcode.AgentNotFound)

	row := readCustomAgentUpdateRow(t, db, "ca-svc-owner")
	assert.Equal(t, "Old Name", row.Name)
	assert.Equal(t, "user-1", row.OwnerUserID)
}

func TestServiceUpdateCustomAgent_EmptyJSONBColumnsKeepExistingValues(t *testing.T) {
	db := newCustomAgentUpdateDB(t)
	seedCustomAgent(t, db, "ca-svc-backfill", "user-1", "Old Name", time.Now().Add(-time.Hour))
	svc := &Service{db: db}

	// handler.updateCustomAgentReq binds these three with omitempty, so an
	// omitted value means "unchanged" — the narrow write must not flatten it
	// to an empty string.
	require.NoError(t, svc.UpdateCustomAgent(context.Background(), "user-1", requestShapedCustomAgent("ca-svc-backfill", "New Name")))

	row := readCustomAgentUpdateRow(t, db, "ca-svc-backfill")
	assert.Equal(t, "New Name", row.Name)
	assert.JSONEq(t, `["code"]`, row.CapabilityTags, "an omitted capability_tags must keep the stored value")
	assert.JSONEq(t, `["read"]`, row.ToolWhitelist, "an omitted tool_whitelist must keep the stored value")
	assert.JSONEq(t, `{"model":"claude-sonnet-4-6"}`, row.ModelParams, "an omitted model_params must keep the stored value")
}

func TestServiceUpdateCustomAgent_RefreshesUpdatedAt(t *testing.T) {
	db := newCustomAgentUpdateDB(t)
	stale := time.Now().Add(-72 * time.Hour).Truncate(time.Second)
	seedCustomAgent(t, db, "ca-svc-updated-at", "user-1", "Old Name", stale)
	svc := &Service{db: db}
	before := readCustomAgentUpdateRow(t, db, "ca-svc-updated-at")

	require.NoError(t, svc.UpdateCustomAgent(context.Background(), "user-1", requestShapedCustomAgent("ca-svc-updated-at", "New Name")))

	after := readCustomAgentUpdateRow(t, db, "ca-svc-updated-at")
	assert.True(t, after.UpdatedAt.After(before.UpdatedAt),
		"UpdatedAt is gorm:\"autoUpdateTime\"; a Select-narrowed Updates still writes it — measured, "+
			"not assumed. before=%s after=%s", before.UpdatedAt, after.UpdatedAt)
	assert.WithinDuration(t, stale, after.CreatedAt, time.Second)
}
