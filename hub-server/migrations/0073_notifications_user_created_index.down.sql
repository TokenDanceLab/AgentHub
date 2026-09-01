-- Reverts 0073: drop the notifications full-list ordering index.
DROP INDEX IF EXISTS idx_notifications_user_created;
