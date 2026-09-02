package repository

import (
	"context"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"

	"github.com/agenthub/hub-server/internal/model"
)

// #2253 — PUT /web/custom-agents/:id rebuilt a model.CustomAgent out of
// handler.updateCustomAgentReq (which carries no output_schema and no
// deleted_at) and persisted it with a whole-row `db.Save(ca)`. Two silent
// consequences, both answered HTTP 200:
//
//   - output_schema was written back as NULL on every rename, and
//     service/dispatch/payload.go feeds that column to the edge as
//     structured_output_schema, so one edit of the agent's name switched
//     structured output off;
//   - SoftDeleteCustomAgent is an independent narrow writer on the same table
//     and model.CustomAgent.DeletedAt is *time.Time (not gorm.DeletedAt, so no
//     soft-delete scope), so a delete landing between the service's read and
//     this write was undone — the row came back.
//
// These tests pin the replacement contract: the UPDATE writes exactly the
// columns the request body can change, touches nothing else, and cannot match a
// soft-deleted row.

// customAgentTestOutputSchema is a valid JSON Schema (has "type"), which is what
// model.CustomAgent.validateJSONB requires.
const customAgentTestOutputSchema = `{"type":"object","properties":{"answer":{"type":"string"}},"required":["answer"]}`

// customAgentRow is a raw view of the custom_agents row. It is deliberately not
// model.CustomAgent: reading through the model would let a GORM scanning
// difference hide a NULL that these tests exist to detect.
type customAgentRow struct {
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

func seedCustomAgentRow(t *testing.T, db *gorm.DB, id, owner, name string, ts time.Time) {
	t.Helper()
	schema := customAgentTestOutputSchema
	seedCustomAgentRowWithSchema(t, db, id, owner, name, ts, &schema)
}

// seedCustomAgentRowWithSchema inserts a custom_agents row through raw SQL so the
// test controls id, output_schema and the timestamps exactly.
//
// outputSchema == nil leaves the column NULL. That variant is not a convenience:
// the sqlite driver hands TEXT columns back as Go strings, and database/sql
// cannot store a string into *json.RawMessage, so any test that reads the row
// back through model.CustomAgent (GetCustomAgentByID, i.e. SELECT *) must seed
// output_schema as NULL. On PostgreSQL the column is jsonb and the driver
// returns []byte, which scans fine — that asymmetry is why the full-fidelity
// "schema survives the service's read-modify-write" case also exists as an
// //go:build integration test in tests/integration/.
func seedCustomAgentRowWithSchema(t *testing.T, db *gorm.DB, id, owner, name string, ts time.Time, outputSchema *string) {
	t.Helper()
	var schemaArg interface{}
	if outputSchema != nil {
		schemaArg = *outputSchema
	}
	require.NoError(t, db.Exec(
		`INSERT INTO custom_agents
			(id, owner_user_id, name, avatar_url, agent_type, system_prompt,
			 capability_tags, tool_whitelist, model_params, output_schema,
			 created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, owner, name, "https://example.invalid/old.png", "claude-code", "You are helpful.",
		`["code"]`, `["read"]`, `{"model":"claude-sonnet-4-6"}`, schemaArg,
		ts, ts,
	).Error)
}

func readCustomAgentRow(t *testing.T, db *gorm.DB, id string) customAgentRow {
	t.Helper()
	var row customAgentRow
	require.NoError(t, db.Raw(
		`SELECT id, owner_user_id, name, avatar_url, agent_type, system_prompt,
		        capability_tags, tool_whitelist, model_params, output_schema,
		        deleted_at, created_at, updated_at
		 FROM custom_agents WHERE id = ?`, id).Scan(&row).Error)
	require.Equal(t, id, row.ID, "row %s must exist", id)
	return row
}

// requestShapedCustomAgent mirrors exactly what handler.Update builds out of
// updateCustomAgentReq: the seven request fields and nothing else. OutputSchema,
// DeletedAt, CreatedAt and UpdatedAt stay at their zero values — that is the
// input the old db.Save(ca) turned into `output_schema = NULL, deleted_at =
// NULL, created_at = <zero>`.
func requestShapedCustomAgent(id, name, avatarURL, agentType, systemPrompt, capabilityTags, toolWhitelist, modelParams string) *model.CustomAgent {
	return &model.CustomAgent{
		ID:             id,
		Name:           name,
		AvatarURL:      avatarURL,
		AgentType:      agentType,
		SystemPrompt:   systemPrompt,
		CapabilityTags: capabilityTags,
		ToolWhitelist:  toolWhitelist,
		ModelParams:    modelParams,
	}
}

// sqlRecorder captures the SQL GORM executes so the UPDATE's column list can be
// asserted literally rather than inferred from row contents.
type sqlRecorder struct {
	mu      sync.Mutex
	queries []string
}

func (r *sqlRecorder) LogMode(gormlogger.LogLevel) gormlogger.Interface { return r }
func (r *sqlRecorder) Info(context.Context, string, ...interface{})     {}
func (r *sqlRecorder) Warn(context.Context, string, ...interface{})     {}
func (r *sqlRecorder) Error(context.Context, string, ...interface{})    {}

func (r *sqlRecorder) Trace(_ context.Context, _ time.Time, fc func() (string, int64), _ error) {
	sql, _ := fc()
	r.mu.Lock()
	defer r.mu.Unlock()
	r.queries = append(r.queries, sql)
}

func (r *sqlRecorder) snapshot() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]string(nil), r.queries...)
}

func (r *sqlRecorder) firstUpdate() string {
	for _, q := range r.snapshot() {
		if strings.HasPrefix(strings.ToUpper(strings.TrimSpace(q)), "UPDATE") {
			return q
		}
	}
	return ""
}

// setClauseColumns returns the sorted list of columns in an UPDATE's SET clause.
// GORM emits `col`=? placeholders, so splitting on commas cannot cut a value in
// half.
func setClauseColumns(t *testing.T, sql string) []string {
	t.Helper()
	upper := strings.ToUpper(sql)
	setAt := strings.Index(upper, " SET ")
	whereAt := strings.Index(upper, " WHERE ")
	require.GreaterOrEqual(t, setAt, 0, "not an UPDATE statement: %s", sql)
	require.Greater(t, whereAt, setAt, "UPDATE without WHERE: %s", sql)

	body := sql[setAt+len(" SET ") : whereAt]
	parts := strings.Split(body, ",")
	cols := make([]string, 0, len(parts))
	for _, p := range parts {
		eq := strings.Index(p, "=")
		require.Greater(t, eq, 0, "unparsable assignment %q in %s", p, sql)
		col := strings.TrimSpace(p[:eq])
		if dot := strings.LastIndex(col, "."); dot >= 0 {
			col = col[dot+1:]
		}
		cols = append(cols, strings.Trim(col, "`\""))
	}
	sort.Strings(cols)
	return cols
}

func TestUpdateCustomAgent_RenameKeepsOutputSchemaAndDeletedAt(t *testing.T) {
	db := setupSQLite(t)
	createdAt := time.Now().Add(-48 * time.Hour).Truncate(time.Second)
	seedCustomAgentRow(t, db, "ca-2253-schema", "user-1", "Old Name", createdAt)

	// Exactly what handler.Update hands the service for a rename.
	ca := requestShapedCustomAgent("ca-2253-schema", "New Name", "", "claude-code", "Renamed prompt.", "", "", "")
	require.NoError(t, UpdateCustomAgent(db, ca))

	row := readCustomAgentRow(t, db, "ca-2253-schema")
	assert.Equal(t, "New Name", row.Name, "the rename itself must land")

	require.NotNil(t, row.OutputSchema,
		"output_schema must survive a rename: the request body has no such field, so writing the "+
			"whole row NULLs the schema that dispatch/payload.go sends to the edge (#2253)")
	assert.JSONEq(t, customAgentTestOutputSchema, *row.OutputSchema,
		"output_schema must be byte-for-byte the pre-update value")

	assert.Nil(t, row.DeletedAt, "deleted_at is not part of an update request and must not be rewritten")
	assert.WithinDuration(t, createdAt, row.CreatedAt, time.Second, "created_at is immutable")
	assert.Equal(t, "user-1", row.OwnerUserID, "ownership is verified by the service, never reassigned by the write")
}

func TestUpdateCustomAgent_DoesNotResurrectConcurrentlySoftDeletedRow(t *testing.T) {
	db := setupSQLite(t)
	// output_schema is NULL here on purpose: this case goes through
	// GetCustomAgentByID, and the sqlite driver cannot scan a non-NULL TEXT into
	// *json.RawMessage (see seedCustomAgentRowWithSchema). The resurrect bug is
	// about deleted_at, not about the schema column.
	seedCustomAgentRowWithSchema(t, db, "ca-2253-revive", "user-1", "Old Name", time.Now().Add(-time.Hour), nil)

	// service.UpdateCustomAgent reads the row first...
	stale, err := GetCustomAgentByID(db, "ca-2253-revive")
	require.NoError(t, err)

	// ...and DELETE /web/custom-agents/:id lands before the write.
	require.NoError(t, SoftDeleteCustomAgent(db, "ca-2253-revive"))

	stale.Name = "Renamed after delete"
	stale.SystemPrompt = "Renamed prompt."
	err = UpdateCustomAgent(db, stale)
	require.ErrorIs(t, err, gorm.ErrRecordNotFound,
		"the not-deleted guard must be inside the UPDATE (WHERE id = ? AND deleted_at IS NULL) so a "+
			"row deleted after the caller's read matches zero rows; a check-then-act read cannot do this (#2253)")

	row := readCustomAgentRow(t, db, "ca-2253-revive")
	require.NotNil(t, row.DeletedAt, "the concurrently soft-deleted row must stay deleted, not come back")
	assert.Equal(t, "Old Name", row.Name, "a write that matched zero rows must not have changed anything")
}

func TestUpdateCustomAgent_SoftDeletedRowIsNotFound(t *testing.T) {
	db := setupSQLite(t)
	seedCustomAgentRowWithSchema(t, db, "ca-2253-deleted", "user-1", "Old Name", time.Now().Add(-time.Hour), nil)
	require.NoError(t, SoftDeleteCustomAgent(db, "ca-2253-deleted"))

	ca := requestShapedCustomAgent("ca-2253-deleted", "New Name", "", "claude-code", "p", "", "", "")
	err := UpdateCustomAgent(db, ca)
	require.ErrorIs(t, err, gorm.ErrRecordNotFound)

	row := readCustomAgentRow(t, db, "ca-2253-deleted")
	require.NotNil(t, row.DeletedAt)
	assert.Equal(t, "Old Name", row.Name)
}

func TestUpdateCustomAgent_UnknownIDIsNotFoundAndInsertsNothing(t *testing.T) {
	db := setupSQLite(t)

	ca := requestShapedCustomAgent("ca-2253-missing", "Ghost", "", "claude-code", "Nobody asked for me.", "", "", "")
	err := UpdateCustomAgent(db, ca)

	// Row count first, so a ghost insert is visible in the same run as the
	// missing error rather than being masked by a require abort.
	var count int64
	require.NoError(t, db.Raw(`SELECT COUNT(*) FROM custom_agents`).Scan(&count).Error)

	assert.Equal(t, int64(0), count,
		"db.Save falls back to Create-with-OnConflict when its UPDATE matches zero rows, so the old "+
			"implementation materialised a brand-new custom agent out of a failed rename (#2253)")
	assert.ErrorIs(t, err, gorm.ErrRecordNotFound,
		"updating a row that does not exist is not-found, not success")
}

func TestUpdateCustomAgent_WritesExactlyTheRequestWritableColumns(t *testing.T) {
	db := setupSQLite(t)
	seedCustomAgentRow(t, db, "ca-2253-columns", "user-1", "Old Name", time.Now().Add(-time.Hour))

	rec := &sqlRecorder{}
	ca := requestShapedCustomAgent("ca-2253-columns", "New Name", "https://example.invalid/new.png",
		"codex", "New prompt.", `["new"]`, `["exec"]`, `{"model":"gpt-5"}`)
	require.NoError(t, UpdateCustomAgent(db.Session(&gorm.Session{Logger: rec}), ca))

	sql := rec.firstUpdate()
	require.NotEmpty(t, sql, "UpdateCustomAgent must issue exactly one UPDATE; got %v", rec.snapshot())

	got := setClauseColumns(t, sql)
	want := []string{
		"agent_type", "avatar_url", "capability_tags", "model_params",
		"name", "system_prompt", "tool_whitelist", "updated_at",
	}
	assert.Equal(t, want, got,
		"the SET clause must be exactly updateCustomAgentReq's writable field set plus GORM's "+
			"autoUpdateTime updated_at. An extra entry is a column the request cannot carry being "+
			"written from a zero value (the #2253 output_schema bug); a missing entry is a column the "+
			"request CAN carry being silently dropped. SQL: %s", sql)

	assert.Contains(t, strings.ToUpper(sql), "DELETED_AT IS NULL",
		"the not-deleted guard must live in the UPDATE's WHERE so read and write are one statement. SQL: %s", sql)
}

func TestUpdateCustomAgent_RefreshesUpdatedAtAndMatchesUnchangedRows(t *testing.T) {
	db := setupSQLite(t)
	stale := time.Now().Add(-72 * time.Hour).Truncate(time.Second)
	seedCustomAgentRow(t, db, "ca-2253-updated-at", "user-1", "Same Name", stale)
	before := readCustomAgentRow(t, db, "ca-2253-updated-at")

	// Same values for every writable column: nothing about the row changes except
	// updated_at. This also pins the assumption the not-found mapping rests on —
	// "matched but changed nothing" reports one affected row on both PostgreSQL
	// and SQLite, so RowsAffected == 0 can only mean "no row matched".
	ca := requestShapedCustomAgent("ca-2253-updated-at", "Same Name", "https://example.invalid/old.png",
		"claude-code", "You are helpful.", `["code"]`, `["read"]`, `{"model":"claude-sonnet-4-6"}`)
	require.NoError(t, UpdateCustomAgent(db, ca))

	after := readCustomAgentRow(t, db, "ca-2253-updated-at")
	assert.True(t, after.UpdatedAt.After(before.UpdatedAt),
		"UpdatedAt is gorm:\"autoUpdateTime\" and GORM adds it even when it is not in Select — measured here, "+
			"not assumed: before=%s after=%s", before.UpdatedAt, after.UpdatedAt)
	assert.WithinDuration(t, time.Now(), after.UpdatedAt, time.Minute)
	assert.WithinDuration(t, stale, after.CreatedAt, time.Second, "created_at must not move")
	assert.False(t, ca.UpdatedAt.IsZero(),
		"GORM writes the autoUpdateTime back into the caller's struct; service callers must not have to re-read it")
}

func TestUpdateCustomAgent_WritesEveryRequestWritableColumn(t *testing.T) {
	db := setupSQLite(t)
	seedCustomAgentRow(t, db, "ca-2253-all-columns", "user-1", "Old Name", time.Now().Add(-time.Hour))

	ca := requestShapedCustomAgent("ca-2253-all-columns", "Brand New Name", "https://example.invalid/new.png",
		"codex", "Brand new prompt.", `["new","shiny"]`, `["exec"]`, `{"model":"gpt-5"}`)
	require.NoError(t, UpdateCustomAgent(db, ca))

	row := readCustomAgentRow(t, db, "ca-2253-all-columns")
	assert.Equal(t, "Brand New Name", row.Name)
	assert.Equal(t, "https://example.invalid/new.png", row.AvatarURL)
	assert.Equal(t, "codex", row.AgentType)
	assert.Equal(t, "Brand new prompt.", row.SystemPrompt)
	assert.JSONEq(t, `["new","shiny"]`, row.CapabilityTags)
	assert.JSONEq(t, `["exec"]`, row.ToolWhitelist)
	assert.JSONEq(t, `{"model":"gpt-5"}`, row.ModelParams)
}

func TestUpdateCustomAgent_ClearsWritableColumnWhenRequestClearsIt(t *testing.T) {
	db := setupSQLite(t)
	seedCustomAgentRow(t, db, "ca-2253-clear", "user-1", "Old Name", time.Now().Add(-time.Hour))

	// avatar_url is the one request field with no "empty means unchanged"
	// contract in the service, so an empty value is a real clear.
	ca := requestShapedCustomAgent("ca-2253-clear", "New Name", "", "claude-code", "p", "", "", "")
	require.NoError(t, UpdateCustomAgent(db, ca))

	row := readCustomAgentRow(t, db, "ca-2253-clear")
	assert.Equal(t, "", row.AvatarURL,
		"Select must force zero values through for the writable columns — a plain Updates(struct) "+
			"would skip them and make avatar_url impossible to clear")
}

func TestUpdateCustomAgent_StillRunsBeforeSaveJSONBNormalization(t *testing.T) {
	db := setupSQLite(t)
	seedCustomAgentRow(t, db, "ca-2253-normalize", "user-1", "Old Name", time.Now().Add(-time.Hour))

	ca := requestShapedCustomAgent("ca-2253-normalize", "New Name", "", "claude-code", "p",
		`[ "a" , "b" ]`, `[ "read" ]`, `{ "model" : "gpt-5" }`)
	require.NoError(t, UpdateCustomAgent(db, ca))

	row := readCustomAgentRow(t, db, "ca-2253-normalize")
	assert.Equal(t, `["a","b"]`, row.CapabilityTags,
		"model.CustomAgent.BeforeSave compacts the jsonb columns; db.Save(ca) ran that hook, so the "+
			"narrower write must run it on the caller's struct too instead of on an empty model")
	assert.Equal(t, `["read"]`, row.ToolWhitelist)
	assert.Equal(t, `{"model":"gpt-5"}`, row.ModelParams)
}

func TestUpdateCustomAgent_RejectsInvalidJSONBThroughBeforeSave(t *testing.T) {
	db := setupSQLite(t)
	seedCustomAgentRow(t, db, "ca-2253-invalid", "user-1", "Old Name", time.Now().Add(-time.Hour))

	ca := requestShapedCustomAgent("ca-2253-invalid", "New Name", "", "claude-code", "p", `not json`, "", "")
	require.Error(t, UpdateCustomAgent(db, ca), "BeforeSave's validateJSONB must still reject malformed jsonb")

	row := readCustomAgentRow(t, db, "ca-2253-invalid")
	assert.Equal(t, "Old Name", row.Name, "a rejected write must not have touched the row")
}
