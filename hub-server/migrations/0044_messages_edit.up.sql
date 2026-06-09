-- Add edit state for sender-owned message edits.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_messages_edited
    ON messages (session_id, edited_at)
    WHERE edited = TRUE;
