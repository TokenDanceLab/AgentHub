CREATE TABLE refresh_tokens (
    id          uuid         PRIMARY KEY,
    user_id     uuid         NOT NULL REFERENCES users(id),
    device_type varchar(16)  NOT NULL,
    device_id   uuid         NOT NULL REFERENCES devices(id),
    token_hash  varchar(128) NOT NULL,
    expires_at  timestamptz  NOT NULL,
    revoked     boolean      NOT NULL DEFAULT false,
    created_at  timestamptz  NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_refresh_tokens_hash ON refresh_tokens (token_hash);
CREATE INDEX idx_refresh_tokens_user_device ON refresh_tokens (user_id, device_type, device_id);
