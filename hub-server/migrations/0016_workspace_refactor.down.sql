DROP INDEX IF EXISTS idx_workspaces_owner;

ALTER TABLE workspaces DROP COLUMN IF EXISTS name;
ALTER TABLE workspaces DROP COLUMN IF EXISTS description;
ALTER TABLE workspaces DROP COLUMN IF EXISTS owner_id;
ALTER TABLE workspaces DROP COLUMN IF EXISTS updated_at;

ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS device_id    uuid         NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000';
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS local_path   varchar(512) NOT NULL DEFAULT '';
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS display_name varchar(64);

ALTER TABLE workspaces ADD CONSTRAINT fk_workspaces_device FOREIGN KEY (device_id) REFERENCES devices(id);
