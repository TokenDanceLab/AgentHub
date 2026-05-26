CREATE TABLE agent_team_tasks (
    id UUID PRIMARY KEY,
    team_run_id UUID NOT NULL REFERENCES agent_team_runs(id) ON DELETE CASCADE,
    assignment_id UUID REFERENCES agent_team_assignments(id) ON DELETE SET NULL,
    assignee_member_id UUID NOT NULL REFERENCES agent_team_members(id),
    parent_task_id UUID REFERENCES agent_team_tasks(id) ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    objective TEXT NOT NULL,
    input_refs JSONB NOT NULL DEFAULT '{}'::jsonb,
    run_id VARCHAR(128),
    attempt INTEGER NOT NULL DEFAULT 1,
    risk_level VARCHAR(20) NOT NULL DEFAULT 'normal',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_agent_team_tasks_team_run_id ON agent_team_tasks(team_run_id);
CREATE INDEX idx_agent_team_tasks_assignment_id ON agent_team_tasks(assignment_id);
CREATE INDEX idx_agent_team_tasks_assignee_member_id ON agent_team_tasks(assignee_member_id);
CREATE INDEX idx_agent_team_tasks_parent_task_id ON agent_team_tasks(parent_task_id);
CREATE INDEX idx_agent_team_tasks_status ON agent_team_tasks(status);
