DELETE FROM message_pins mp
WHERE NOT EXISTS (
    SELECT 1
    FROM messages m
    WHERE m.id = mp.message_id
      AND m.session_id = mp.session_id
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_session_id
    ON messages (session_id, id);

ALTER TABLE message_pins
    DROP CONSTRAINT IF EXISTS message_pins_message_id_fkey,
    ADD CONSTRAINT fk_message_pins_message_session
        FOREIGN KEY (session_id, message_id)
        REFERENCES messages (session_id, id);
