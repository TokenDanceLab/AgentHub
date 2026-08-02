-- 0058_audit_content_hash.up.sql
-- 内容认证哈希链（#1541）：链接哈希覆盖前驱事件的完整内容字段。
-- 旧算法 hash = SHA256(prev_id || prev_hash) 不覆盖内容，篡改任意字段
-- （保持 id/prev_hash 不变）链仍验证通过。本 migration：
--   1. audit_canonical_content() — 与 Go 侧 model.canonicalContent 逐字节
--      一致的规范化编码（长度前缀拼接，created_at 用 UnixNano 十进制）
--   2. 按创建顺序重链全部既有事件（内容入哈希）
--   3. prev_hash 唯一索引 — 并发写入分叉（两个事件共享同一前驱）被拒绝

CREATE OR REPLACE FUNCTION audit_canonical_content(
  p_user_id text, p_profile_id text, p_target_id text, p_event_type text,
  p_severity text, p_summary text, p_details text, p_client_ip text,
  p_created_at timestamptz
) RETURNS text AS $$
DECLARE
  created_nano text;
BEGIN
  -- timestamptz 精度为微秒：epoch*1e9 是整数，::bigint 无舍入误差，
  -- 与 Go 的 CreatedAt.UnixNano() 完全一致。
  created_nano := (EXTRACT(EPOCH FROM p_created_at) * 1000000000)::bigint::text;
  RETURN
    length(p_user_id)::text || ':' || p_user_id ||
    length(coalesce(p_profile_id, ''))::text || ':' || coalesce(p_profile_id, '') ||
    length(coalesce(p_target_id, ''))::text || ':' || coalesce(p_target_id, '') ||
    length(p_event_type)::text || ':' || p_event_type ||
    length(p_severity)::text || ':' || p_severity ||
    length(p_summary)::text || ':' || p_summary ||
    length(p_details)::text || ':' || p_details ||
    length(p_client_ip)::text || ':' || p_client_ip ||
    length(created_nano)::text || ':' || created_nano;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 重链：按创建顺序逐行重算 prev_hash = SHA256(prev_id || prev_hash || canonical(prev 内容))
DO $$
DECLARE
  rec RECORD;
  prev_hash_val varchar(64) := '';
  prev_id_val uuid;
  prev_user_id text := '';
  prev_profile_id text := '';
  prev_target_id text := '';
  prev_event_type text := '';
  prev_severity text := '';
  prev_summary text := '';
  prev_details text := '';
  prev_client_ip text := '';
  prev_created_at timestamptz;
  new_hash text;
BEGIN
  FOR rec IN
    SELECT id, user_id, profile_id, target_id, event_type, severity, summary,
           details, client_ip, created_at
    FROM audit_events
    ORDER BY created_at ASC, id ASC
  LOOP
    IF prev_id_val IS NOT NULL THEN
      new_hash := encode(
        digest(
          prev_id_val::text || prev_hash_val ||
          audit_canonical_content(
            prev_user_id, prev_profile_id, prev_target_id,
            prev_event_type, prev_severity, prev_summary, prev_details,
            prev_client_ip, prev_created_at),
          'sha256'),
        'hex');
    ELSE
      new_hash := '';
    END IF;
    UPDATE audit_events SET prev_hash = new_hash WHERE id = rec.id;
    prev_hash_val := new_hash;
    prev_id_val := rec.id;
    prev_user_id := rec.user_id;
    prev_profile_id := rec.profile_id;
    prev_target_id := rec.target_id;
    prev_event_type := rec.event_type;
    prev_severity := rec.severity;
    prev_summary := rec.summary;
    prev_details := rec.details::text;
    prev_client_ip := rec.client_ip;
    prev_created_at := rec.created_at;
  END LOOP;
END $$;

-- 分叉防线：prev_hash 唯一 — 两个事件共享同一前驱（并发分叉）写入即失败。
CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_events_prev_hash_unique ON audit_events(prev_hash);
