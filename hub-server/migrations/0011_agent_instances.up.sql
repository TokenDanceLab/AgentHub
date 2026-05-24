CREATE TABLE agent_instances (
    id              uuid        PRIMARY KEY,
    agent_type      varchar(64) NOT NULL,
    custom_agent_id uuid        REFERENCES custom_agents(id),
    session_id      uuid        NOT NULL REFERENCES sessions(id),
    inviter_user_id uuid        NOT NULL REFERENCES users(id),
    workspace_id    uuid        REFERENCES workspaces(id),
    display_name    varchar(64) NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_agent_instances_session ON agent_instances (session_id);
CREATE INDEX idx_agent_instances_inviter ON agent_instances (inviter_user_id);
