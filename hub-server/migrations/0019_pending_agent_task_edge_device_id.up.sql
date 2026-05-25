ALTER TABLE pending_agent_tasks
    ADD COLUMN edge_device_id uuid;

CREATE INDEX idx_pending_tasks_edge_device_id ON pending_agent_tasks (edge_device_id);
