-- Message reactions (short symbolic responses to messages).
-- Each user can add each reaction once per message.
CREATE TABLE IF NOT EXISTS message_reactions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id  UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    message_id  UUID NOT NULL,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reaction    VARCHAR(64) NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_message_reactions_message_session
        FOREIGN KEY (session_id, message_id)
        REFERENCES messages (session_id, id)
        ON DELETE CASCADE,
    CONSTRAINT uq_message_reaction UNIQUE (session_id, message_id, user_id, reaction)
);

CREATE INDEX IF NOT EXISTS idx_message_reactions_message
    ON message_reactions (session_id, message_id);
CREATE INDEX IF NOT EXISTS idx_message_reactions_user
    ON message_reactions (user_id);
