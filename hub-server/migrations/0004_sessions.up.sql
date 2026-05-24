CREATE TABLE sessions (
    id              uuid        PRIMARY KEY,
    type            varchar(16) NOT NULL,
    name            varchar(64),
    avatar_url      varchar(512),
    announcement    text,
    owner_user_id   uuid        REFERENCES users(id),
    next_seq        bigint      NOT NULL DEFAULT 0,
    last_message_at timestamptz,
    dissolved       boolean     NOT NULL DEFAULT false,
    created_at      timestamptz NOT NULL DEFAULT now()
);
