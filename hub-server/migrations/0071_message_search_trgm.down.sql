-- Drop only the index: the extension may be shared with other objects and
-- CREATE EXTENSION is cluster-scoped state, not owned by this migration.
DROP INDEX IF EXISTS idx_messages_content_text_trgm;
