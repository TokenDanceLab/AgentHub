DROP INDEX IF EXISTS idx_devices_user_type;
CREATE UNIQUE INDEX idx_devices_user_type ON devices (user_id, device_type);
