-- Add TokenDance ID sub mapping to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS tokendance_sub VARCHAR(255);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_tokendance_sub ON users(tokendance_sub) WHERE tokendance_sub IS NOT NULL AND tokendance_sub != '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS tokendance_sub_linked_at TIMESTAMPTZ;
