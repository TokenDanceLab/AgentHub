-- TokenDance ID OAuth Client Seed
-- ================================
-- Inserts the "AgentHub Desktop" OAuth client into TokenDance ID.
--
-- IMPORTANT: Run the setup script instead of this file directly:
--   bash scripts/setup-tokendance-oidc.sh
--
-- This SQL file is auto-generated. If you need to regenerate:
--   go run scripts/bcrypt-hash.go "your-secret" > /tmp/hash.txt
--   Then replace the bcrypt_hash value below.
--
-- Client Details:
--   client_id:     agenthub-desktop
--   client_secret: agenthub-dev-secret-change-me
--   redirect_uris: http://127.0.0.1/callback
--                  http://localhost:5174/auth/tokendance/callback
--                  http://127.0.0.1:5174/auth/tokendance/callback
--   grant_types:   authorization_code, refresh_token
--   scopes:        openid, profile, email
--
-- Usage (standalone):
--   sqlite3 ../tokendance-id/data/tokendance.db < scripts/seed-tokendance-client.sql
-- ================================

-- Ensure at least one user exists (owner of the OAuth client)
INSERT OR IGNORE INTO users (id, username, email, display_name, email_verified, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000001', 'dev-test', 'dev@test.local', 'Dev Test User', 1, datetime('now'), datetime('now'));

-- Remove existing client if present
DELETE FROM oauth_clients WHERE client_id = 'agenthub-desktop';

-- Insert the AgentHub Desktop OAuth client
INSERT INTO oauth_clients (id, client_id, secret_hash, name, redirect_uris, grant_types, scopes, user_id, enabled, is_trusted, created_at, updated_at)
VALUES (
    '11111111-1111-1111-1111-111111111111',
    'agenthub-desktop',
    '$2a$10$CFRzH1R6MEUVU88nLzRSo.1qX7DtG6sPTqOrZ5HNfp1awu0ei0XpS',  -- bcrypt("agenthub-dev-secret-change-me")
    'AgentHub Desktop',
    '["http://127.0.0.1/callback","http://localhost:5174/auth/tokendance/callback","http://127.0.0.1:5174/auth/tokendance/callback"]',
    '["authorization_code","refresh_token"]',
    '["openid","profile","email"]',
    '00000000-0000-0000-0000-000000000001',
    1,
    0,
    datetime('now'),
    datetime('now')
);
