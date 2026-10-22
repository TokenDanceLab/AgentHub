-- Stable provider-neutral identity links. The legacy tokendance_sub column is
-- preserved for history and audit; it is no longer a login key.
-- Older AgentHub databases predate primary-key enforcement on users.id. A
-- unique index is required before user_identities can reference the user.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_id_unique ON users (id);

CREATE TABLE IF NOT EXISTS user_identities (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    provider    VARCHAR(64) NOT NULL CHECK (btrim(provider) <> ''),
    issuer      VARCHAR(512) NOT NULL CHECK (btrim(issuer) <> ''),
    subject     VARCHAR(255) NOT NULL CHECK (btrim(subject) <> ''),
    status      VARCHAR(16) NOT NULL DEFAULT 'active',
    linked_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT user_identities_status_check CHECK (status IN ('active', 'retired'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_identities_issuer_subject
    ON user_identities (issuer, subject);
CREATE INDEX IF NOT EXISTS idx_user_identities_user_id
    ON user_identities (user_id);

-- Backfill legacy subjects as retired bindings. The original TokenDance ID
-- issuer is not recoverable from the old row, so a non-OIDC sentinel records
-- that uncertainty and prevents any retired row from matching a real issuer.
INSERT INTO user_identities (user_id, provider, issuer, subject, status, linked_at)
SELECT id, 'tokendance-id', 'legacy:tokendance-id', tokendance_sub, 'retired',
       COALESCE(tokendance_sub_linked_at, NOW())
FROM users
WHERE tokendance_sub IS NOT NULL AND tokendance_sub <> ''
ON CONFLICT (issuer, subject) DO NOTHING;

-- Retired TokenDance ID users must not retain refreshable Hub sessions. Access
-- tokens expire within the existing short TTL; refresh tokens are revoked now.
UPDATE refresh_tokens
SET revoked = TRUE
WHERE user_id IN (
    SELECT id FROM users
    WHERE tokendance_sub IS NOT NULL AND tokendance_sub <> ''
);
