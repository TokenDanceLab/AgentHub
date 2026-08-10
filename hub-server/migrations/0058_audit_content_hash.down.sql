-- 0058_audit_content_hash.down.sql
-- 回退：移除唯一 prev_hash 索引，重链回 v1 算法（hash = SHA256(prev_id || prev_hash)）。
-- 注：本 down 自 0058 引入以来从未成功执行，原因与 0061 修复的 0058.up
-- 同源 —— 0040 在 0058 之前应用，audit_events 上挂着 trg_audit_events_no_update
-- 等 BEFORE UPDATE 触发器，本 down 的 DO 块也用 UPDATE 重链，会被 0040 拒绝。
-- 迁移回滚路径同样是一个 deploy 炸弹。按迁移不可变原则不改 0058.up（仍保持
-- 原始 INSERT 阶段语义），此处对 down 加 DISABLE/ENABLE TRIGGER USER 外包，
-- 镜像 0061.up 的修复模式：禁用 0040 的用户触发器 → 重链 → 恢复。down 从未
-- 在任何已应用状态上成功跑过，所以本变更没有 "已应用的旧 down" 会受影响。
-- 同事务全包：golang-migrate 把每个 .down.sql 作为单个事务，DISABLE/ENABLE
-- 在同一事务内，commit 时触发器必然恢复，或整事务回滚保持原状。

DROP INDEX IF EXISTS idx_audit_events_prev_hash_unique;

-- 暂停 0040 的 append-only 触发器，使本 down 的重链 UPDATE 可以执行。
ALTER TABLE audit_events DISABLE TRIGGER USER;

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

-- 恢复 0040 的 append-only 触发器。
ALTER TABLE audit_events ENABLE TRIGGER USER;
