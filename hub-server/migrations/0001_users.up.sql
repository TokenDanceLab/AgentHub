CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE users (
    id            uuid        PRIMARY KEY,
    username      varchar(64) NOT NULL,
    password_hash varchar(128) NOT NULL,
    nickname      varchar(64) NOT NULL,
    avatar_url    varchar(512),
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_users_username ON users (username);
