-- 0068_index_coverage_fixes.down.sql
-- 逆序回滚 0068：删除新建的五个索引，恢复 0040 的非唯一 prev_hash 索引
-- （保持 0061 down 的前置状态：0061.down 注释明确预期 0040 索引存在）。

DROP INDEX IF EXISTS idx_friendships_friend_status;

DROP INDEX IF EXISTS idx_custom_agents_owner;

DROP INDEX IF EXISTS idx_pending_agent_tasks_instance_created;

DROP INDEX IF EXISTS idx_agent_teams_owner_created;

DROP INDEX IF EXISTS idx_session_members_member_active;

CREATE INDEX IF NOT EXISTS idx_audit_events_prev_hash ON audit_events(prev_hash);
