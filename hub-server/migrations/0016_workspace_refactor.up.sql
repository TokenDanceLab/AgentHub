-- Migration 0016: Refactor workspaces table to match current GORM model.
-- Drops device-centric columns (device_id, local_path, display_name) and adds
-- collaborative workspace columns (name, description, owner_id, updated_at).

ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS name        varchar(128);
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS owner_id    uuid;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS updated_at  timestamptz NOT NULL DEFAULT now();

-- Backfill existing rows: use display_name for name, zero UUID for owner_id.
UPDATE workspaces SET name     = COALESCE(display_name, 'Untitled') WHERE name IS NULL;
UPDATE workspaces SET owner_id = '00000000-0000-0000-0000-000000000000' WHERE owner_id IS NULL;

ALTER TABLE workspaces ALTER COLUMN name     SET NOT NULL;
ALTER TABLE workspaces ALTER COLUMN owner_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_workspaces_owner ON workspaces (owner_id);

-- Drop old device-centric columns.
ALTER TABLE workspaces DROP COLUMN IF EXISTS device_id    CASCADE;
ALTER TABLE workspaces DROP COLUMN IF EXISTS local_path;
ALTER TABLE workspaces DROP COLUMN IF EXISTS display_name;
