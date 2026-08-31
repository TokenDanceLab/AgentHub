-- 0070_agent_team_events_run_type_index.up.sql
-- Lane lane-zz-jsonb-count (#2102 F14): CountTeamRouteDecisionsByActionWorkerInstructions
-- does COUNT(*) WHERE team_run_id=? AND type=? AND JSONB payload filters.
-- Baseline EXPLAIN on dev DB (5000 events/run, no matching rows) shows a full
-- Seq Scan removing all 5000 rows — the type predicate is not in any index
-- prefix and the JSONB expressions cannot be indexed portably. Adding a
-- composite btree on (team_run_id, type) lets PG satisfy both equality
-- predicates via an Index Only Scan candidate; the remaining JSONB filters
-- then run against only the type-matched subset of the run's events.
--
-- Dialect safety: plain btree, no GIN/jsonb_path_ops (repo has zero GIN
-- precedent per grep), so this applies unchanged to SQLite test runs
-- (CREATE INDEX IF NOT EXISTS is accepted; SQLite ignores the column-type
-- distinction). No service-layer or query-shape change required.
--
-- Evidence: internal/repository/agent_team_usage.go:73-98 (PG branch),
--           migrations/0036_agent_team_events.up.sql (only run_id + run_seq indexes),
--           dev EXPLAIN baseline recorded in lanes/lane-zz-jsonb-count/PROGRESS.md.

CREATE INDEX IF NOT EXISTS idx_agent_team_events_run_type
    ON agent_team_events (team_run_id, type);
