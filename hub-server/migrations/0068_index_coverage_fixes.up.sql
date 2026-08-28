-- 0068_index_coverage_fixes.up.sql
-- Wave 5 lane W5-C (#2039): hub-server PG 索引覆盖审计修复。
-- 静态比对 internal/repository/ 全部查询的 WHERE/ORDER BY 列与迁移已建
-- 索引后，处置 5 个确定性缺失 + 1 个确定性冗余。每条带查询位置证据。
--
-- 1. audit_events.prev_hash 冗余索引对
--    0040:89 建了非唯一 idx_audit_events_prev_hash；0061 又建了
--    idx_audit_events_prev_hash_unique（同列、同方法，唯一索引严格更强）。
--    与 0065 清理的三个冗余同型（唯一/复合已覆盖的裸副本），保留只浪费
--    append 热表的写放大。删除裸索引。
--    证据: migrations/0040_audit_events_immutable.up.sql:89
--          migrations/0061_audit_rechain_trigger_fix.up.sql (步骤 4)
--
-- 2. session_members(member_id) WHERE left_at IS NULL
--    ListUserSessions / ListWorkspaceSessions / SearchAllMessages /
--    FindPrivateSessionBetween / CanUserAccessReferencedAttachment 全部以
--    member_id = ? AND left_at IS NULL 驱动，但现有索引前缀是
--    (member_type, member_id) 或 session_id，member_id 单列查询无法命中，
--    每次会话列表加载全表扫描。部分索引只含活跃成员，体积与写放大最小。
--    证据: internal/repository/session.go:65,80,95 (member_id = ?)
--          internal/repository/message.go:252 (SearchAllMessages)
--          internal/repository/message_attachment.go:24 (EXISTS join)
--
-- 3. agent_teams(owner_id, created_at DESC)
--    agent_teams 全表无任何二级索引（0033 只建表）。ListTeamsByOwner 按
--    owner_id 过滤并 ORDER BY created_at DESC LIMIT 200；
--    ListTeamsReadableByUser 也含 owner_id = ? 分支。
--    证据: internal/repository/agent_team_teams.go:26,33
--
-- 4. pending_agent_tasks(agent_instance_id, created_at DESC)
--    agent_instance_id 列无任何索引。FindActivePendingTaskByAgentInstance
--    是 TriggerAgentTask 的 TurnInProgress 门禁（#1430），每次任务触发都查；
--    CancelTasksByAgentInstance 同前缀。复合含 created_at DESC 直接服务
--    ORDER BY created_at DESC LIMIT 1。
--    证据: internal/repository/agent.go:227,214
--
-- 5. custom_agents(owner_user_id) WHERE deleted_at IS NULL
--    custom_agents 全表无任何二级索引（0010 只建表）。
--    ListCustomAgentsByOwner 按 owner_user_id + deleted_at IS NULL 过滤；
--    ListTeamsReadableByUser join custom_agents.owner_user_id。
--    证据: internal/repository/agent.go:74
--          internal/repository/agent_team_teams.go:36
--
-- 6. friendships(friend_id, status)
--    ListPendingRequests 按 friend_id = ? AND status = 'pending' 查「收到
--    的好友申请」，现有索引前缀全是 user_id，friend_id 方向无索引。
--    证据: internal/repository/friendship.go:76

DROP INDEX IF EXISTS idx_audit_events_prev_hash;

CREATE INDEX IF NOT EXISTS idx_session_members_member_active
    ON session_members (member_id) WHERE left_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_agent_teams_owner_created
    ON agent_teams (owner_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pending_agent_tasks_instance_created
    ON pending_agent_tasks (agent_instance_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_custom_agents_owner
    ON custom_agents (owner_user_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_friendships_friend_status
    ON friendships (friend_id, status);