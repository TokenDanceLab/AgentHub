//go:build integration

package integration

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/hub-server/internal/service/dispatch"
)

// #2253 — PostgreSQL-level pins for the custom-agent update path.
//
// The L0 sqlite suites (internal/repository/agent_custom_update_test.go,
// internal/service/agent/agent_custom_update_test.go) already prove the column
// list, the not-deleted guard and the not-found mapping. These two tests exist
// for what only a real PG16 can show:
//
//   - output_schema is a genuine jsonb column here, so "the column survived" is
//     proven against jsonb storage and the jsonb→[]byte driver path that
//     model.CustomAgent.OutputSchema (*json.RawMessage) actually uses in
//     production, rather than against a sqlite TEXT/BLOB stand-in;
//   - RowsAffected for an UPDATE that matches a row is a PostgreSQL server
//     behaviour, and "0 rows == not found" is what the errcode.AgentNotFound
//     mapping rests on.
//
// Both go through the HTTP surface (PUT /web/custom-agents/:id) so the handler's
// request struct, the service backfill and the repository write are exercised as
// one path.

const customAgent2253Schema = `{"type":"object","properties":{"answer":{"type":"string"}},"required":["answer"]}`

// seedCustomAgentOutputSchema sets output_schema directly: no create or update
// request can carry it, which is the whole point of #2253.
func seedCustomAgentOutputSchema(t *testing.T, id, schema string) {
	t.Helper()
	require.NoError(t, db.Exec(
		`UPDATE custom_agents SET output_schema = ?::jsonb WHERE id = ?`, schema, id,
	).Error)
}

type customAgent2253Row struct {
	ID          string
	Name        string
	OwnerUserID string
	CreatedAt   time.Time
	DeletedAt   *time.Time
}

func readCustomAgent2253Row(t *testing.T, id string) customAgent2253Row {
	t.Helper()
	var row customAgent2253Row
	require.NoError(t, db.Raw(
		`SELECT id, name, owner_user_id, created_at, deleted_at FROM custom_agents WHERE id = ?`, id,
	).Scan(&row).Error)
	require.Equal(t, id, row.ID, "custom_agents row %s must exist", id)
	return row
}

func countCustomAgents(t *testing.T) int64 {
	t.Helper()
	var n int64
	require.NoError(t, db.Raw(`SELECT COUNT(*) FROM custom_agents`).Scan(&n).Error)
	return n
}

func TestCustomAgentUpdatePreservesOutputSchema(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })
	u := register(t, "tca2253a", "pass1234", "CA2253")

	r := parse(postAuth("/web/custom-agents", u.Token, map[string]interface{}{
		"name":          "Structured Agent",
		"agent_type":    "claude-code",
		"system_prompt": "Answer in JSON.",
	}))
	mustOK(t, r, "create")
	id := extract(r.Data, "id")
	require.NotEmpty(t, id)

	seedCustomAgentOutputSchema(t, id, customAgent2253Schema)
	before := readCustomAgent2253Row(t, id)

	// A rename and nothing else — the exact request shape that used to NULL the
	// schema.
	mustOK(t, parse(put("/web/custom-agents/"+id, u.Token, map[string]interface{}{
		"name":          "Renamed Agent",
		"agent_type":    "claude-code",
		"system_prompt": "Answer in JSON.",
	})), "update")

	after := readCustomAgent2253Row(t, id)
	assert.Equal(t, "Renamed Agent", after.Name)
	assert.Nil(t, after.DeletedAt, "an update request must not touch deleted_at")
	assert.Equal(t, before.OwnerUserID, after.OwnerUserID, "ownership must not move")
	assert.True(t, after.CreatedAt.Equal(before.CreatedAt),
		"created_at is immutable: before=%s after=%s", before.CreatedAt, after.CreatedAt)

	// The live consumer: dispatch projects the row into the edge payload's
	// structured_output_schema. If output_schema were NULL this would be nil and
	// structured output would be silently off for the renamed agent.
	ca, err := repository.GetCustomAgentByID(db, id)
	require.NoError(t, err)
	fields := dispatch.CustomAgentFieldsFromModel(ca)
	_, _, _, outputSchema := dispatch.ApplyCustomAgentToPayload(id, fields)
	require.NotNil(t, outputSchema,
		"output_schema must survive a rename all the way into the dispatch payload (#2253)")
	assert.JSONEq(t, customAgent2253Schema, string(*outputSchema))

	// And the stored jsonb itself, read as text so PG's own jsonb re-serialisation
	// is visible rather than hidden by a scan.
	var stored *string
	require.NoError(t, db.Raw(
		`SELECT output_schema::text FROM custom_agents WHERE id = ?`, id).Scan(&stored).Error)
	require.NotNil(t, stored, "output_schema column must still be non-NULL jsonb")
	assert.JSONEq(t, customAgent2253Schema, *stored)
}

func TestCustomAgentUpdateDoesNotResurrectSoftDeletedRow(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })
	u := register(t, "tca2253b", "pass1234", "CA2253B")

	r := parse(postAuth("/web/custom-agents", u.Token, map[string]interface{}{
		"name":          "Doomed Agent",
		"agent_type":    "claude-code",
		"system_prompt": "Going away.",
	}))
	mustOK(t, r, "create")
	id := extract(r.Data, "id")
	require.NotEmpty(t, id)

	rowsBefore := countCustomAgents(t)

	// The interleaving the service cannot see: it has already read the row, then
	// DELETE /web/custom-agents/:id lands, then the write runs against the stale
	// struct. Only the guard inside the UPDATE can catch this.
	stale, err := repository.GetCustomAgentByID(db, id)
	require.NoError(t, err)
	require.NoError(t, repository.SoftDeleteCustomAgent(db, id))

	stale.Name = "Renamed after delete"
	err = repository.UpdateCustomAgent(db, stale)
	require.ErrorIs(t, err, gorm.ErrRecordNotFound,
		"a row soft-deleted after the caller's read must match zero rows (#2253)")

	row := readCustomAgent2253Row(t, id)
	require.NotNil(t, row.DeletedAt, "the deleted agent must stay deleted, not come back")
	assert.Equal(t, "Doomed Agent", row.Name, "a zero-row write must not have renamed anything")
	assert.Equal(t, rowsBefore, countCustomAgents(t),
		"db.Save fell back to Create-with-OnConflict when its UPDATE matched nothing, materialising a ghost agent")

	// The same row over HTTP: the read path already filters deleted rows, so the
	// API answer is the ordinary 404 rather than a resurrected 200.
	mustCode(t, parse(put("/web/custom-agents/"+id, u.Token, map[string]interface{}{
		"name":          "Renamed over HTTP",
		"agent_type":    "claude-code",
		"system_prompt": "Going away.",
	})), errcode.AgentNotFound.Code, "PUT on a soft-deleted custom agent")

	row = readCustomAgent2253Row(t, id)
	require.NotNil(t, row.DeletedAt)
	assert.Equal(t, "Doomed Agent", row.Name)
	assert.Equal(t, rowsBefore, countCustomAgents(t))
}

func TestCustomAgentUpdateNeverWritesColumnsTheRequestCannotCarry(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })
	u := register(t, "tca2253c", "pass1234", "CA2253C")

	r := parse(postAuth("/web/custom-agents", u.Token, map[string]interface{}{
		"name":            "Column Agent",
		"agent_type":      "claude-code",
		"system_prompt":   "Original prompt.",
		"capability_tags": []string{"code"},
		"tool_whitelist":  []string{"read"},
		"model_params":    map[string]string{"model": "claude-sonnet-4-6"},
	}))
	mustOK(t, r, "create")
	id := extract(r.Data, "id")
	require.NotEmpty(t, id)
	seedCustomAgentOutputSchema(t, id, customAgent2253Schema)

	mustOK(t, parse(put("/web/custom-agents/"+id, u.Token, map[string]interface{}{
		"name":            "Renamed Column Agent",
		"agent_type":      "codex",
		"system_prompt":   "Renamed prompt.",
		"capability_tags": []string{"code", "review"},
		"tool_whitelist":  []string{"read", "exec"},
		"model_params":    map[string]string{"model": "gpt-5"},
	})), "update")

	// Every request-writable column did change — the narrow write must not be so
	// narrow that it drops a field the request CAN carry.
	var ca model.CustomAgent
	require.NoError(t, db.Raw(
		`SELECT id, owner_user_id, name, agent_type, system_prompt,
		        capability_tags::text AS capability_tags,
		        tool_whitelist::text AS tool_whitelist,
		        model_params::text AS model_params,
		        output_schema::text AS output_schema
		 FROM custom_agents WHERE id = ?`, id).Scan(&ca).Error)
	assert.Equal(t, "Renamed Column Agent", ca.Name)
	assert.Equal(t, "codex", ca.AgentType)
	assert.Equal(t, "Renamed prompt.", ca.SystemPrompt)
	assert.JSONEq(t, `["code","review"]`, ca.CapabilityTags)
	assert.JSONEq(t, `["read","exec"]`, ca.ToolWhitelist)
	assert.JSONEq(t, `{"model":"gpt-5"}`, ca.ModelParams)
	assert.Equal(t, u.ID, ca.OwnerUserID)

	// And the column the request cannot carry is untouched.
	require.NotNil(t, ca.OutputSchema)
	assert.JSONEq(t, customAgent2253Schema, string(*ca.OutputSchema))

	var raw json.RawMessage
	require.NoError(t, db.Raw(`SELECT output_schema FROM custom_agents WHERE id = ?`, id).Scan(&raw).Error)
	require.NotNil(t, raw)
	assert.JSONEq(t, customAgent2253Schema, string(raw))
}
