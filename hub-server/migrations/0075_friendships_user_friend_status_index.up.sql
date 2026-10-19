-- Repairs the friendship lookup index that 0051 could not create: 0002 already
-- owns idx_friendships_user_friend, and PostgreSQL's IF NOT EXISTS matches by
-- relation name, so databases that ran the original 0051 never got the
-- three-column index. Idempotent.
CREATE INDEX IF NOT EXISTS idx_friendships_user_friend_status
    ON friendships (user_id, friend_id, status);
