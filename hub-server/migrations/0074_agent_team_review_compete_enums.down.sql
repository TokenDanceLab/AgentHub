-- 0074_agent_team_review_compete_enums.down.sql
-- Down for 0074: restore the narrower 0033/0034 predicates.
--
-- This one cannot use a plain ADD CONSTRAINT. Once 0074 has been applied, rows
-- may legitimately hold 'pending_review' / 'compete', and a validated ADD scans
-- the table at commit and fails the deploy on the first such row — the exact
-- 0060 deploy-bomb shape 0064 exists to warn about. So the predicates are
-- re-installed NOT VALID (enforced on new writes immediately, no re-scan) and
-- validated only when a violation count says it is safe; otherwise they are
-- left NOT VALID with a NOTICE and the operator has to decide whether to
-- migrate those rows off the two values before tightening.
--
-- Idempotent: DROP CONSTRAINT IF EXISTS on both, so a half-applied down can be
-- re-run.

ALTER TABLE agent_team_runs DROP CONSTRAINT IF EXISTS agent_team_runs_status_check;
ALTER TABLE agent_team_runs
    ADD CONSTRAINT agent_team_runs_status_check
    CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')) NOT VALID;

ALTER TABLE agent_team_assignments DROP CONSTRAINT IF EXISTS agent_team_assignments_type_check;
ALTER TABLE agent_team_assignments
    ADD CONSTRAINT agent_team_assignments_type_check
    CHECK (type IN ('delegate', 'review', 'approve', 'notify')) NOT VALID;

DO $$
DECLARE
    run_violations        integer;
    assignment_violations integer;
BEGIN
    SELECT count(*) INTO run_violations FROM agent_team_runs
     WHERE status NOT IN ('queued', 'running', 'completed', 'failed', 'cancelled');
    SELECT count(*) INTO assignment_violations FROM agent_team_assignments
     WHERE type NOT IN ('delegate', 'review', 'approve', 'notify');

    RAISE NOTICE '0074 down violation scan: agent_team_runs.status=%, agent_team_assignments.type=%',
        run_violations, assignment_violations;

    IF run_violations = 0 THEN
        ALTER TABLE agent_team_runs VALIDATE CONSTRAINT agent_team_runs_status_check;
        RAISE NOTICE '0074 down: agent_team_runs_status_check VALIDATED';
    ELSE
        RAISE NOTICE '0074 down: agent_team_runs_status_check left NOT VALID (% rows still hold pending_review)', run_violations;
    END IF;

    IF assignment_violations = 0 THEN
        ALTER TABLE agent_team_assignments VALIDATE CONSTRAINT agent_team_assignments_type_check;
        RAISE NOTICE '0074 down: agent_team_assignments_type_check VALIDATED';
    ELSE
        RAISE NOTICE '0074 down: agent_team_assignments_type_check left NOT VALID (% rows still hold compete)', assignment_violations;
    END IF;
END $$;
