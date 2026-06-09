CREATE INDEX IF NOT EXISTS idx_messages_content_text_tsvector
    ON messages
    USING GIN (to_tsvector('simple', COALESCE(content->>'text', '')))
    WHERE recalled = false;
