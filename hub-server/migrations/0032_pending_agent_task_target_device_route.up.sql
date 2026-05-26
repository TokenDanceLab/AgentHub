CREATE INDEX IF NOT EXISTS idx_pending_agent_tasks_target_device_status
  ON pending_agent_tasks(target_id, edge_device_id, status)
  WHERE target_id IS NOT NULL AND edge_device_id IS NOT NULL;
