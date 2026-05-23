CREATE TABLE attachments (
    id               uuid          PRIMARY KEY,
    hash             varchar(64)   NOT NULL,
    size             bigint        NOT NULL,
    mime_type        varchar(128)  NOT NULL,
    original_name    varchar(255),
    uploader_user_id uuid          NOT NULL REFERENCES users(id),
    created_at       timestamptz   NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_attachments_hash ON attachments (hash);
