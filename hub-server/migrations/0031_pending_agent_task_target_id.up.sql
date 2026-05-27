ALTER TABLE pending_agent_tasks
    ADD COLUMN IF NOT EXISTS target_id UUID;

CREATE INDEX IF NOT EXISTS idx_pending_tasks_target_id
    ON pending_agent_tasks(target_id)
    WHERE target_id IS NOT NULL;
