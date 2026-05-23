CREATE TABLE session_members (
    id            uuid        PRIMARY KEY,
    session_id    uuid        NOT NULL REFERENCES sessions(id),
    member_type   varchar(16) NOT NULL,
    member_id     uuid        NOT NULL,
    role          varchar(16) NOT NULL,
    pinned        boolean     NOT NULL DEFAULT false,
    archived      boolean     NOT NULL DEFAULT false,
    muted         boolean     NOT NULL DEFAULT false,
    last_read_seq bigint      NOT NULL DEFAULT 0,
    joined_at     timestamptz NOT NULL DEFAULT now(),
    left_at       timestamptz
);

CREATE UNIQUE INDEX idx_session_members_unique ON session_members (session_id, member_type, member_id);
CREATE INDEX idx_session_members_member ON session_members (member_type, member_id);
