ALTER TABLE message_pins
    DROP CONSTRAINT IF EXISTS fk_message_pins_message_session,
    ADD CONSTRAINT message_pins_message_id_fkey
        FOREIGN KEY (message_id)
        REFERENCES messages (id);

DROP INDEX IF EXISTS idx_messages_session_id;
