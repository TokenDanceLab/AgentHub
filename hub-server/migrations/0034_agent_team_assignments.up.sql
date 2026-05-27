CREATE TABLE agent_team_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_run_id UUID NOT NULL REFERENCES agent_team_runs(id),
    from_member_id UUID NOT NULL REFERENCES agent_team_members(id),
    to_member_id UUID NOT NULL REFERENCES agent_team_members(id),
    type VARCHAR(20) NOT NULL DEFAULT 'delegate' CHECK (type IN ('delegate', 'review', 'approve', 'notify')),
    task_prompt TEXT NOT NULL,
    context TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'dispatched', 'running', 'done', 'failed', 'cancelled')),
    run_id UUID,
    result TEXT,
    depth INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_agent_team_assignments_team_run_id ON agent_team_assignments(team_run_id);
CREATE INDEX idx_agent_team_assignments_from_member_id ON agent_team_assignments(from_member_id);
CREATE INDEX idx_agent_team_assignments_to_member_id ON agent_team_assignments(to_member_id);
CREATE INDEX idx_agent_team_assignments_status ON agent_team_assignments(status);
