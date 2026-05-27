CREATE TABLE IF NOT EXISTS agent_run_events (
  id UUID PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES pending_agent_tasks(id) ON DELETE CASCADE,
  edge_run_id VARCHAR(128),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  agent_instance_id UUID NOT NULL REFERENCES agent_instances(id) ON DELETE CASCADE,
  event_seq BIGINT NOT NULL,
  event_type VARCHAR(96) NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_run_events_task_seq ON agent_run_events(task_id, event_seq);
CREATE INDEX IF NOT EXISTS idx_agent_run_events_edge_run_id ON agent_run_events(edge_run_id);
CREATE INDEX IF NOT EXISTS idx_agent_run_events_session_id ON agent_run_events(session_id);
CREATE INDEX IF NOT EXISTS idx_agent_run_events_agent_instance_id ON agent_run_events(agent_instance_id);
CREATE INDEX IF NOT EXISTS idx_agent_run_events_event_type ON agent_run_events(event_type);
