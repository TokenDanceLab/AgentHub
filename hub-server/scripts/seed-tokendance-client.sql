-- Seed: Register AgentHub Desktop as OAuth client in TokenDance ID
-- Run this against the TokenDance ID SQLite database:
--   sqlite3 ../tokendance-id/data/tokendance.db < scripts/seed-tokendance-client.sql
--
-- WARNING: This seed uses a DEV-ONLY secret. For production use,
-- run the API client registration flow or use scripts/generate_client_secret.go
-- to generate a strong secret and bcrypt hash.
--
-- Default credentials (DEV ONLY, DO NOT USE IN PRODUCTION):
--   client_id:     agenthub-desktop
--   client_secret: agenthub-dev-secret-change-me

INSERT OR IGNORE INTO oauth_clients (
  id,
  client_id,
  secret_hash,
  name,
  redirect_uris,
  grant_types,
  scopes,
  user_id,
  is_trusted,
  created_at,
  updated_at
) VALUES (
  'agent-hub-desktop-001',
  'agenthub-desktop',
  '$2a$10$kHt48nZd9zTvhrnYGkHLqeOgtWatj0oM2dPOYjV9lngjMC2mf.vmu',  -- bcrypt of: agenthub-dev-secret-change-me
  'AgentHub Desktop',
  '["http://127.0.0.1:PORT_IDX/callback","agenthub://callback"]',
  '["authorization_code"]',
  '["openid","profile","email"]',
  '144650a1-f72b-4d98-b34a-399507a1f32a',  -- alice@test.com (existing user from seed-admin-data.sql)
  1,                                          -- trusted (skip consent screen for dev)
  datetime('now'),
  datetime('now')
);
