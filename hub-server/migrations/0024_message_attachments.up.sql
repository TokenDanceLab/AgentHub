CREATE TABLE message_attachments (
    session_id    uuid        NOT NULL REFERENCES sessions(id),
    message_id    uuid        NOT NULL REFERENCES messages(id),
    attachment_id uuid        NOT NULL REFERENCES attachments(id),
    created_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (message_id, attachment_id)
);

CREATE INDEX idx_message_attachments_attachment_id ON message_attachments (attachment_id);
CREATE INDEX idx_message_attachments_session_attachment ON message_attachments (session_id, attachment_id);
