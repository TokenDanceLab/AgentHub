CREATE TABLE friendships (
    id              uuid        PRIMARY KEY,
    user_id         uuid        NOT NULL REFERENCES users(id),
    friend_id       uuid        NOT NULL REFERENCES users(id),
    status          varchar(16) NOT NULL,
    remark          varchar(64),
    request_message varchar(255),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_friendships_user_friend ON friendships (user_id, friend_id);
CREATE INDEX idx_friendships_user_status ON friendships (user_id, status);
