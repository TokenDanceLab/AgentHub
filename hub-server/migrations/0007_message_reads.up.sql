CREATE TABLE message_reads (
    message_id uuid        NOT NULL REFERENCES messages(id),
    user_id    uuid        NOT NULL REFERENCES users(id),
    read_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (message_id, user_id)
);
