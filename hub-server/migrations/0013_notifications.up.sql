CREATE TABLE notifications (
    id         uuid         PRIMARY KEY,
    user_id    uuid         NOT NULL REFERENCES users(id),
    type       varchar(32)  NOT NULL,
    payload    jsonb        NOT NULL,
    read       boolean      NOT NULL DEFAULT false,
    created_at timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user_read_created ON notifications (user_id, read, created_at DESC);
