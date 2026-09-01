DROP INDEX IF EXISTS idx_refresh_tokens_user_device;
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_device
    ON refresh_tokens (user_id, device_type, device_id);
