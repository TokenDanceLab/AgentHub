CREATE UNIQUE INDEX IF NOT EXISTS idx_execution_targets_active_local_edge_device_unique
ON execution_targets (owner_id, target_type, device_id)
WHERE deleted_at IS NULL
  AND target_type = 'local_edge'
  AND device_id IS NOT NULL;
