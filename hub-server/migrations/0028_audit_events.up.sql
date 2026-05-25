CREATE TABLE audit_events (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID REFERENCES users(id),
    profile_id    UUID,
    target_id     UUID,
    event_type    VARCHAR(64) NOT NULL,
    severity      VARCHAR(16) NOT NULL DEFAULT 'info',
    summary       TEXT NOT NULL,
    details       JSONB DEFAULT '{}',
    client_ip     VARCHAR(45) DEFAULT '',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_audit_events_user ON audit_events(user_id, created_at DESC);
CREATE INDEX idx_audit_events_type ON audit_events(event_type, created_at DESC);
CREATE INDEX idx_audit_events_severity ON audit_events(severity, created_at DESC);
CREATE INDEX idx_audit_events_created ON audit_events(created_at DESC);
