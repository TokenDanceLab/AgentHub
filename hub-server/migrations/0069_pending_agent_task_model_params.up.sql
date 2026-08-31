-- Adds model_params column to pending_agent_tasks for orphan recovery context rebuild.
ALTER TABLE pending_agent_tasks ADD COLUMN IF NOT EXISTS model_params JSONB NOT NULL DEFAULT '{}';
