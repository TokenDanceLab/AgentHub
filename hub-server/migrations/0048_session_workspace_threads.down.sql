DROP INDEX IF EXISTS idx_sessions_workspace_id;

ALTER TABLE sessions DROP COLUMN IF EXISTS workspace_id;
