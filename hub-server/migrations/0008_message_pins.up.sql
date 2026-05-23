CREATE TABLE message_pins (
    session_id        uuid        NOT NULL REFERENCES sessions(id),
    message_id        uuid        NOT NULL REFERENCES messages(id),
    pinned_by_user_id uuid        NOT NULL REFERENCES users(id),
    pinned_at         timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (session_id, message_id)
);
