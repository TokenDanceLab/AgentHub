# AgentHub Sync Core

Shared Go domain models for local event sync.

Owns:

- EdgeEvent.
- event sequence and replay cursor.
- sync ack.
- outbox status.
- idempotency keys.

Does not own:

- Hub relay WebSocket implementation.
- UI state stores.
- raw workspace file transfer.
