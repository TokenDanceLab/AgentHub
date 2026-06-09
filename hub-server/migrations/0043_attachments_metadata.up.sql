ALTER TABLE attachments
    ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
