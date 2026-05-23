CREATE TABLE devices (
    id             uuid        PRIMARY KEY,
    user_id        uuid        NOT NULL REFERENCES users(id),
    device_type    varchar(16) NOT NULL,
    app_version    varchar(32),
    capabilities   jsonb,
    last_active_at timestamptz NOT NULL DEFAULT now(),
    created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_devices_user_type ON devices (user_id, device_type);
