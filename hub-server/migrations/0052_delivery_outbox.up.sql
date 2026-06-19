CREATE TABLE delivery_outbox (
    id UUID PRIMARY KEY,
    task_id UUID NOT NULL,
    delivery_id VARCHAR(128) NOT NULL UNIQUE,
    payload TEXT NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'pending',
    attempt_count SMALLINT NOT NULL DEFAULT 0,
    max_attempts SMALLINT NOT NULL DEFAULT 3,
    next_retry_at TIMESTAMPTZ,
    last_error TEXT DEFAULT '',
    edge_device_id UUID DEFAULT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    delivered_at TIMESTAMPTZ
);

CREATE INDEX idx_delivery_outbox_status_nr ON delivery_outbox(status, next_retry_at);
CREATE INDEX idx_delivery_outbox_task_id ON delivery_outbox(task_id);
CREATE INDEX idx_delivery_outbox_delivery_id ON delivery_outbox(delivery_id);
