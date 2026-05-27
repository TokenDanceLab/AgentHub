CREATE TABLE agent_team_artifacts (
    id UUID PRIMARY KEY,
    team_run_id UUID NOT NULL REFERENCES agent_team_runs(id) ON DELETE CASCADE,
    team_task_id UUID REFERENCES agent_team_tasks(id) ON DELETE SET NULL,
    assignment_id UUID REFERENCES agent_team_assignments(id) ON DELETE SET NULL,
    member_id UUID REFERENCES agent_team_members(id) ON DELETE SET NULL,
    agent_task_id UUID REFERENCES pending_agent_tasks(id) ON DELETE SET NULL,
    edge_run_id VARCHAR(128),
    source_event_id UUID REFERENCES agent_run_events(id) ON DELETE CASCADE,
    event_seq BIGINT NOT NULL DEFAULT 0,
    path TEXT NOT NULL,
    normalized_path TEXT NOT NULL,
    action VARCHAR(64),
    tool_name VARCHAR(128),
    status VARCHAR(64),
    conflict_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_agent_team_artifacts_source_event ON agent_team_artifacts(source_event_id) WHERE source_event_id IS NOT NULL;
CREATE INDEX idx_agent_team_artifacts_team_run ON agent_team_artifacts(team_run_id, created_at);
CREATE INDEX idx_agent_team_artifacts_run_path ON agent_team_artifacts(team_run_id, normalized_path);
CREATE INDEX idx_agent_team_artifacts_team_task ON agent_team_artifacts(team_task_id);
CREATE INDEX idx_agent_team_artifacts_assignment ON agent_team_artifacts(assignment_id);
CREATE INDEX idx_agent_team_artifacts_member ON agent_team_artifacts(member_id);
CREATE INDEX idx_agent_team_artifacts_agent_task ON agent_team_artifacts(agent_task_id);
CREATE INDEX idx_agent_team_artifacts_conflict ON agent_team_artifacts(conflict_id);
