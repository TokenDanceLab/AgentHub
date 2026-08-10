-- 注：本 down 自 0016 引入以来从未成功执行 —— 重建 device_id NOT NULL
-- DEFAULT 零 UUID 后立即 ADD CONSTRAINT fk_workspaces_device 引用 devices(id)，
-- 若 devices 表里没有零 UUID 那一行（典型情况：全新库或 devices 表保留状态
-- 由 0016 之前的迁移掌控但零 UUID 行从未插入）FK 校验直接失败，down 卡死。
-- 迁移不可变原则：不改 0016.up（已发布）。此处对 down 在 ADD CONSTRAINT
-- 前插一行 ON CONFLICT DO NOTHING 的零 UUID devices 占位，确保外键引用合法。
-- down 从未在已应用状态成功跑过，故本变更没有 "已应用的旧 down" 会受影响。

DROP INDEX IF EXISTS idx_workspaces_owner;

ALTER TABLE workspaces DROP COLUMN IF EXISTS name;
ALTER TABLE workspaces DROP COLUMN IF EXISTS description;
ALTER TABLE workspaces DROP COLUMN IF EXISTS owner_id;
ALTER TABLE workspaces DROP COLUMN IF EXISTS updated_at;

ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS device_id    uuid         NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000';
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS local_path   varchar(512) NOT NULL DEFAULT '';
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS display_name varchar(64);

-- 确保被引用的零 UUID devices 行存在，否则下面的 FK 校验会失败。ON CONFLICT
-- DO NOTHING 让本 down 在 devices 表里已经有该行的库上仍然是幂等无副作用。
INSERT INTO devices(id) VALUES ('00000000-0000-0000-0000-000000000000')
    ON CONFLICT (id) DO NOTHING;

ALTER TABLE workspaces ADD CONSTRAINT fk_workspaces_device FOREIGN KEY (device_id) REFERENCES devices(id);
