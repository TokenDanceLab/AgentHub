CREATE TABLE messages (
    id                  uuid        PRIMARY KEY,
    session_id          uuid        NOT NULL REFERENCES sessions(id),
    seq_id              bigint      NOT NULL,
    client_msg_id       uuid        NOT NULL,
    sender_type         varchar(16) NOT NULL,
    sender_id           uuid        NOT NULL,
    content_type        varchar(32) NOT NULL,
    content             jsonb       NOT NULL,
    reply_to_message_id uuid,
    recalled            boolean     NOT NULL DEFAULT false,
    created_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE messages
    ADD CONSTRAINT fk_messages_reply_to
    FOREIGN KEY (reply_to_message_id) REFERENCES messages(id);

CREATE UNIQUE INDEX idx_messages_session_seq ON messages (session_id, seq_id);
CREATE UNIQUE INDEX idx_messages_session_client_msg ON messages (session_id, client_msg_id);
CREATE INDEX idx_messages_session_created ON messages (session_id, created_at DESC);
