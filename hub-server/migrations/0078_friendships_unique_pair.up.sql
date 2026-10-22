-- Legacy databases can retain the non-unique three-column index introduced by
-- 0051 instead of the pair uniqueness required by friendship upserts.
CREATE UNIQUE INDEX IF NOT EXISTS idx_friendships_user_friend_unique
    ON friendships (user_id, friend_id);
