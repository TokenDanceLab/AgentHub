CREATE TABLE user_settings (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key VARCHAR(128) NOT NULL,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT idx_user_settings_user_key UNIQUE (user_id, key)
);

CREATE INDEX idx_user_settings_user_id ON user_settings(user_id);
