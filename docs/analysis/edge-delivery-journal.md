# Edge DeliveryJournal (#437)

最后更新：2026-07-16

## Landed
- `edge-server/internal/hub/delivery_journal.go` — seq + Snapshot + bounded memory
- `CallbackClient` records ack/stream/done/fail outcomes
- unit test `TestDeliveryJournal_RecordsAndSnapshots`
- Hub side: retry loop already wired (#437 partial earlier)

## Remaining for full close
- durable journal (sqlite/file) across restarts
- Hub idempotent ack/replay contract
- reconciliation API/worker
- E2E offline/replay evidence
