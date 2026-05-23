CREATE TABLE pending_agent_tasks (
    id                   uuid         PRIMARY KEY,
    agent_instance_id    uuid         NOT NULL REFERENCES agent_instances(id),
    triggered_by_user_id uuid         NOT NULL REFERENCES users(id),
    trigger_message_id   uuid         NOT NULL REFERENCES messages(id),
    status               varchar(16)  NOT NULL,
    error_message        text,
    created_at           timestamptz  NOT NULL DEFAULT now(),
    dispatched_at        timestamptz,
    finished_at          timestamptz,
    expire_at            timestamptz  NOT NULL
);

CREATE INDEX idx_pending_tasks_user_status ON pending_agent_tasks (triggered_by_user_id, status);
CREATE INDEX idx_pending_tasks_expire ON pending_agent_tasks (expire_at);
