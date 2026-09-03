-- 0074_agent_team_review_compete_enums.up.sql
-- Two enum values the service layer writes but the CHECK constraints created by
-- 0033/0034 never allowed, so both features fail on PostgreSQL while passing
-- every test that exists for them:
--
--   1. model.TeamRunStatusPendingReview ("pending_review"), written by
--      agentteam.setRunPendingReview and read back by ReviewDagPlan's CAS claim.
--      0033 created agent_team_runs_status_check over
--      ('queued','running','completed','failed','cancelled') and no later
--      migration widened it, so turning on the human review gate
--      (agent_team.human_review_enabled / its env override) makes every route
--      decision fail on a real database:
--        ERROR: new row for relation "agent_team_runs" violates check
--               constraint "agent_team_runs_status_check"   (SQLSTATE 23514)
--      reproduced against a migrated PostgreSQL 16 database.
--   2. model.AssignmentTypeCompete ("compete"), written by
--      agent_team_compete.go inside the compete transaction and reachable from
--      POST /web/agent-teams/:id/runs/:run_id/route-decisions with
--      action="compete" (route_decision.go dispatches it and "compete" is in
--      model's valid route action set). 0034 created
--      agent_team_assignments_type_check over
--      ('delegate','review','approve','notify'), so the whole compete
--      transaction rolls back and compete mode cannot run at all.
--
-- Why nothing caught it: every agentteam test drives these paths over SQLite,
-- whose schema comes from GORM AutoMigrate on the model structs. The structs
-- carry no CHECK tags, so on SQLite the constraint does not exist and both
-- writes succeed. The model's constant set and the database's CHECK predicate
-- diverged in the one place no test compared them.
--
-- Form: DROP + ADD ... NOT VALID + VALIDATE, the 0064 shape. Both new
-- predicates are strictly wider than the ones they replace, so every existing
-- row satisfies them by construction and VALIDATE cannot fail; NOT VALID is
-- still used so the ADD never takes the ACCESS EXCLUSIVE whole-table scan
-- window (the 0060 -> 0064 lesson).
--
-- Idempotent: DROP CONSTRAINT IF EXISTS plus a fixed constraint name, so
-- re-runs and down/up cycles converge on exactly one named constraint per
-- column, with the name PostgreSQL would have generated itself.

ALTER TABLE agent_team_runs DROP CONSTRAINT IF EXISTS agent_team_runs_status_check;
ALTER TABLE agent_team_runs
    ADD CONSTRAINT agent_team_runs_status_check
    CHECK (status IN ('queued', 'running', 'pending_review', 'completed', 'failed', 'cancelled')) NOT VALID;
ALTER TABLE agent_team_runs VALIDATE CONSTRAINT agent_team_runs_status_check;

ALTER TABLE agent_team_assignments DROP CONSTRAINT IF EXISTS agent_team_assignments_type_check;
ALTER TABLE agent_team_assignments
    ADD CONSTRAINT agent_team_assignments_type_check
    CHECK (type IN ('delegate', 'review', 'approve', 'notify', 'compete')) NOT VALID;
ALTER TABLE agent_team_assignments VALIDATE CONSTRAINT agent_team_assignments_type_check;
