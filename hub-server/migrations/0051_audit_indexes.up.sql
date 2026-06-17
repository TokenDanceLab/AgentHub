-- Composite index for team member listing ordered by position
CREATE INDEX IF NOT EXISTS idx_team_members_team_pos ON agent_team_members(team_id, position);

-- Composite index for friendship lookups by user+friend+status
CREATE INDEX IF NOT EXISTS idx_friendships_user_friend ON friendships(user_id, friend_id, status);

-- Composite index for session message listing ordered by seq_id
CREATE INDEX IF NOT EXISTS idx_messages_session_seq ON messages(session_id, seq_id);

-- Unique constraint to prevent duplicate client message IDs per session
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_session_client_msg ON messages(session_id, client_msg_id);

-- Index for listing pending tasks triggered by a user
CREATE INDEX IF NOT EXISTS idx_pending_agent_tasks_user ON pending_agent_tasks(triggered_by_user_id);

-- Composite index for scanning expired tasks by status
CREATE INDEX IF NOT EXISTS idx_pending_agent_tasks_status_expire ON pending_agent_tasks(status, expire_at);

-- Composite index for active session member lookups
CREATE INDEX IF NOT EXISTS idx_session_members_session_left ON session_members(session_id, left_at);
