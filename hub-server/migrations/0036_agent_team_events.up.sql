CREATE TABLE agent_team_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_run_id UUID NOT NULL REFERENCES agent_team_runs(id) ON DELETE CASCADE,
    seq INT NOT NULL,
    type VARCHAR(50) NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_agent_team_events_run_id ON agent_team_events(team_run_id);
CREATE INDEX idx_agent_team_events_run_seq ON agent_team_events(team_run_id, seq);
