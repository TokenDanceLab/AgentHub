-- Down migration for 0035: Restore NOT NULL on password_hash.
-- NOTE: This only restores the schema constraint. If rows with NULL password_hash exist,
-- this will fail unless those rows are first updated or deleted.

ALTER TABLE users ALTER COLUMN password_hash SET NOT NULL;
