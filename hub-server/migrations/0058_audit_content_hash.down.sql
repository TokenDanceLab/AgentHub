-- 0058_audit_content_hash.down.sql
-- 回退：移除唯一 prev_hash 索引，重链回 v1 算法（hash = SHA256(prev_id || prev_hash)）。

DROP INDEX IF EXISTS idx_audit_events_prev_hash_unique;

DO $$
DECLARE
  rec RECORD;
  prev_hash_val varchar(64) := '';
  prev_id_val uuid;
  new_hash text;
BEGIN
  FOR rec IN
    SELECT id FROM audit_events ORDER BY created_at ASC, id ASC
  LOOP
    IF prev_id_val IS NOT NULL THEN
      new_hash := encode(digest(prev_id_val::text || prev_hash_val, 'sha256'), 'hex');
    ELSE
      new_hash := '';
    END IF;
    UPDATE audit_events SET prev_hash = new_hash WHERE id = rec.id;
    prev_hash_val := new_hash;
    prev_id_val := rec.id;
  END LOOP;
END $$;
