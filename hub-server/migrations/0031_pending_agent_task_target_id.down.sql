DROP INDEX IF EXISTS idx_pending_tasks_target_id;

ALTER TABLE pending_agent_tasks
    DROP COLUMN IF EXISTS target_id;
