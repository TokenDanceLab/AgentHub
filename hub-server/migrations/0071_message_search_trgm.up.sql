-- P2 message-search performance (#2154 perf lane).
--
-- messageSearchCondition builds `to_tsvector(...) @@ plainto_tsquery(...) OR
-- content->>'text' ILIKE '%q%'` on PostgreSQL. The tsvector GIN index (0042)
-- only serves the first branch; the leading-wildcard ILIKE branch has no
-- usable index, so every message search degrades to a scan of the session's
-- rows regardless of the GIN index.
--
-- pg_trgm gives the ILIKE branch a trigram GIN index so the planner can
-- BitmapOr both indexes. Substring recall is preserved (important for CJK
-- text, where the 'simple' tsvector tokenization yields whole whitespace
-- runs and word search alone is not enough).
--
-- Guarded and idempotent: when pg_trgm is unavailable the block is skipped
-- and search keeps its current (scan-based) behavior — no deploy failure.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_trgm') THEN
        CREATE EXTENSION IF NOT EXISTS pg_trgm;
        CREATE INDEX IF NOT EXISTS idx_messages_content_text_trgm
            ON messages
            USING GIN ((content->>'text') gin_trgm_ops)
            WHERE recalled = false;
    END IF;
END
$$;
