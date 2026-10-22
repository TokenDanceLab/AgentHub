-- Bind each refresh chain to the exact external identity that authenticated
-- it. Existing rows stay NULL and are rejected by the application, which
-- fails closed for pre-Account and legacy TokenDance sessions.
ALTER TABLE refresh_tokens
    ADD COLUMN IF NOT EXISTS user_identity_id UUID
    REFERENCES user_identities(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_identity_id
    ON refresh_tokens (user_identity_id);
