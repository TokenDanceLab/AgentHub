CREATE TABLE workspaces (
    id           uuid         PRIMARY KEY,
    device_id    uuid         NOT NULL REFERENCES devices(id),
    local_path   varchar(512) NOT NULL,
    display_name varchar(64),
    created_at   timestamptz  NOT NULL DEFAULT now()
);
