CREATE TABLE custom_agents (
    id              uuid         PRIMARY KEY,
    owner_user_id   uuid         NOT NULL REFERENCES users(id),
    name            varchar(64)  NOT NULL,
    avatar_url      varchar(512),
    agent_type      varchar(64)  NOT NULL,
    system_prompt   text         NOT NULL,
    capability_tags jsonb,
    tool_whitelist  jsonb,
    model_params    jsonb,
    deleted_at      timestamptz,
    created_at      timestamptz  NOT NULL DEFAULT now(),
    updated_at      timestamptz  NOT NULL DEFAULT now()
);
