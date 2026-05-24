ALTER TABLE pending_agent_tasks
    ADD COLUMN edge_run_id varchar(128);

CREATE INDEX idx_pending_tasks_edge_run_id ON pending_agent_tasks (edge_run_id);
