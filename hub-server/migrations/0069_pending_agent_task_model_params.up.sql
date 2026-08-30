-- Adds model_params column to pending_agent_tasks for orphan recovery context rebuild.
ALTER TABLE pending_agent_tasks ADD COLUMN model_params JSONB NOT NULL DEFAULT '{}';
