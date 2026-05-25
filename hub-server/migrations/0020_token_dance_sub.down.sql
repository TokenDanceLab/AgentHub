-- Remove TokenDance ID sub mapping
DROP INDEX IF EXISTS idx_users_tokendance_sub;
ALTER TABLE users DROP COLUMN IF EXISTS tokendance_sub_linked_at;
ALTER TABLE users DROP COLUMN IF EXISTS tokendance_sub;
