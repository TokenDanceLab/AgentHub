-- Migration 0053: Add scan efficiency indexes for delivery_outbox.
-- ScanRetryableDeliveries queries pending records by (status, created_at)
-- and sent records by (status, updated_at). The existing index
-- idx_delivery_outbox_status_nr on (status, next_retry_at) only covers
-- the retrying scan (status='retrying' AND next_retry_at <= now).
-- These two indexes complete coverage for all three scan paths.

CREATE INDEX IF NOT EXISTS idx_delivery_outbox_status_created
    ON delivery_outbox (status, created_at);

CREATE INDEX IF NOT EXISTS idx_delivery_outbox_status_updated
    ON delivery_outbox (status, updated_at);

-- Add index for cleanup scan (status IN delivered|dead, updated_at).
-- CleanupOldDeliveries uses: WHERE status IN (...) AND updated_at <= ?
-- This can also be served by the (status, updated_at) index above,
-- but only if the planner chooses to scan each status separately. The
-- status_created index may also be useful for the pending-timeout scan
-- path which filters on created_at.
