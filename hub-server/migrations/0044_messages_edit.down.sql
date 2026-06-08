DROP INDEX IF EXISTS idx_messages_edited;
ALTER TABLE messages DROP COLUMN IF EXISTS edited_at;
ALTER TABLE messages DROP COLUMN IF EXISTS edited;
