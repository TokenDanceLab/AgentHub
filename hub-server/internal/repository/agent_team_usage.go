package repository

import (
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/model"
)

// IncrementTeamRunTokenUsage atomically adds delta to the team run's
// token_usage_total counter. COALESCE maps a NULL column (run not yet
// incremented or not backfilled) to 0 so the first increment is a clean seed.
// Used by the edge stream callback to maintain the O(1) budget-guard fast
// path. Safe to call inside an enclosing transaction by passing tx as db.
//
// Uses raw db.Exec instead of gorm UpdateColumn because the model field is
// tagged read-only (->) so GORM omits it from INSERT/UPDATE column lists for
// backward compatibility with test fixtures that predate migration 0066. The
// raw UPDATE bypasses the struct field-permission check while still running
// inside the caller's transaction when tx is passed.
func IncrementTeamRunTokenUsage(db *gorm.DB, teamRunID string, delta int64) error {
	if delta <= 0 {
		return nil
	}
	return db.Exec(
		"UPDATE agent_team_runs SET token_usage_total = COALESCE(token_usage_total, 0) + ? WHERE id = ?",
		delta, teamRunID,
	).Error
}

// CountTeamRouteDecisionsByActionWorkerInstructions counts prior accepted
// route decisions (event type team.route.decided) whose payload matches the
// given action / next_worker / instructions triple using the SAME
// normalization as routeDecisionMatches:
//   - action:     case-insensitive, whitespace-trimmed
//   - next_worker: case-sensitive, whitespace-trimmed (missing key → "")
//   - instructions: case-sensitive, whitespace-trimmed (missing key → "")
//
// This is the SQL-aggregated counterpart of countMatchingRouteDecisionsInEvents
// (route_helpers.go). It replaces the previous countMatchingRouteDecisionsDB
// path which loaded up to maxTeamEventsPerRun (10000) rows via
// ListTeamEventsByRun and filtered in Go — the SQL aggregation pushes the
// filter into the DB so only the matching count crosses the wire.
//
// Dialect branches:
//   - PostgreSQL: JSONB payload->>'field' + BTRIM + LOWER.
//   - SQLite:     json_extract(payload, '$.field') + TRIM + LOWER (unit tests).
//
// COALESCE(...,”) maps a missing JSON key to ” so the match mirrors Go's
// zero-value unmarshal semantics (missing next_worker → "").
func CountTeamRouteDecisionsByActionWorkerInstructions(db *gorm.DB, teamRunID, action, worker, instructions string) (int, error) {
	const eventType = model.TeamEventRouteDecided
	var count int

	if db.Name() == "postgres" {
		// JSONB payload->>'field' returns TEXT; BTRIM trims both-side
		// whitespace; LOWER folds action case for the case-insensitive arm.
		// COALESCE maps NULL (missing key) to '' so a finish decision
		// (no next_worker) matches another finish decision.
		err := db.Raw(`SELECT COUNT(*) FROM agent_team_events
WHERE team_run_id = ?
  AND type = ?
  AND LOWER(BTRIM(COALESCE(payload->>'action',''))       ) = LOWER(BTRIM(?))
  AND       BTRIM(COALESCE(payload->>'next_worker',''))   =        BTRIM(?)
  AND       BTRIM(COALESCE(payload->>'instructions',''))  =        BTRIM(?)`,
			teamRunID, eventType, action, worker, instructions,
		).Scan(&count).Error
		return count, err
	}

	// SQLite (unit tests): json_extract + TRIM + LOWER, same semantics.
	err := db.Raw(`SELECT COUNT(*) FROM agent_team_events
WHERE team_run_id = ?
  AND type = ?
  AND LOWER(TRIM(COALESCE(json_extract(payload,'$.action'),''))       ) = LOWER(TRIM(?))
  AND       TRIM(COALESCE(json_extract(payload,'$.next_worker'),''))   =        TRIM(?)
  AND       TRIM(COALESCE(json_extract(payload,'$.instructions'),''))  =        TRIM(?)`,
		teamRunID, eventType, action, worker, instructions,
	).Scan(&count).Error
	return count, err
}
