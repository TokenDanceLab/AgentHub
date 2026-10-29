-- Preserve device ownership and cancellation evidence across downgrade. Older
-- application code cannot safely resume paired-device delivery after rollback.
-- Retain outbox transport/credential binding columns for the same reason.
DROP TABLE IF EXISTS edge_enrollments;
-- Revoke credentials without erasing the paired-device routing marker.
UPDATE edge_device_credentials SET revoked_at = COALESCE(revoked_at, now());
-- Historical schema-only down tests may continue through the referenced tables.
-- Keep the revoked marker without constraining those older schema migrations.
ALTER TABLE edge_device_credentials DROP CONSTRAINT IF EXISTS edge_device_credentials_device_id_fkey;
ALTER TABLE edge_device_credentials DROP CONSTRAINT IF EXISTS edge_device_credentials_target_id_fkey;
ALTER TABLE edge_device_credentials DROP CONSTRAINT IF EXISTS edge_device_credentials_user_id_fkey;
ALTER TABLE edge_device_credentials DROP CONSTRAINT IF EXISTS edge_device_credentials_user_identity_id_fkey;
