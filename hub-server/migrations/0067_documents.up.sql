-- 0067_documents.up.sql
-- Create the documents table for the cloud document library
-- (web workbench Documents page: list/create/get/delete + artifact projection).
--
-- The Document model (internal/model/document.go) and the full
-- repository/service/handler stack shipped without this table, so every
-- /web/documents call failed with Postgres 42P01 "relation documents does
-- not exist" (surfaced as a 500). This migration restores the schema the
-- model already assumes.
CREATE TABLE IF NOT EXISTS documents (
    id           uuid PRIMARY KEY,
    owner_id     uuid NOT NULL,
    project_id   uuid,
    title        varchar(500) NOT NULL,
    type         varchar(32) NOT NULL DEFAULT 'md',
    source       varchar(32) NOT NULL,
    source_ref   varchar(256),
    tag          varchar(64),
    location     varchar(128) NOT NULL DEFAULT '我的文档库',
    content      text,
    status       varchar(32) NOT NULL DEFAULT 'active',
    metadata     jsonb NOT NULL DEFAULT '{}',
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_documents_owner ON documents (owner_id);
CREATE INDEX IF NOT EXISTS idx_documents_status_created ON documents (status, created_at DESC);
