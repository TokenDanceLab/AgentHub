-- Migration 0035: Make password_hash nullable (unify auth to TokenDance ID OIDC only).
-- Local email/password registration and login are removed.
-- Existing local users will be migrated to TokenDance ID in a future step.

ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- Add a comment for future migration of local users
COMMENT ON COLUMN users.password_hash IS 'Deprecated. NULL for TokenDance ID users. Existing hashes for legacy local users pending TokenDance ID migration.';
