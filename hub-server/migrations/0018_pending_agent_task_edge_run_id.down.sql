DROP INDEX IF EXISTS idx_pending_tasks_edge_run_id;

ALTER TABLE pending_agent_tasks
    DROP COLUMN IF EXISTS edge_run_id;
