-- 0061_audit_rechain_trigger_fix.down.sql
-- Reverse of 0061: drop the fork-defense unique index and the canonical
-- content function. The audit_events row data (prev_hash values) is NOT
-- reverted — the content-based hashes are the correct end state per #1541,
-- and reverting them to the old id-only algorithm would re-introduce the
-- tamper vulnerability. Dropping the index restores the pre-0058 non-unique
-- prev_hash index (created by 0040 idx_audit_events_prev_hash) which remains.
-- This mirrors the 0058.down.sql non-revert policy for content hashes.
DROP INDEX IF EXISTS idx_audit_events_prev_hash_unique;
DROP FUNCTION IF EXISTS audit_canonical_content;
