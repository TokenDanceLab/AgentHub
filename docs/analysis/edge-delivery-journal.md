# Edge DeliveryJournal (#437 / #445)

最后更新：2026-07-16

## Landed
- `edge-server/internal/hub/delivery_journal.go` — seq + Snapshot + bounded memory
- `CallbackClient` records ack/stream/done/fail outcomes
- unit test `TestDeliveryJournal_RecordsAndSnapshots`
- Hub side: retry loop already wired (#437 partial earlier)
- **#445 durable SQLite journal**
  - `delivery_journal_sqlite.go` + `TestSQLiteDeliveryJournal_PersistsAcrossOpen`
  - `CallbackClient.EnableSQLiteJournal(path)` dual-writes memory + sqlite (best-effort)
  - Runtime opt-in: `AGENTHUB_DELIVERY_JOURNAL_DB=/path/to/journal.db` in `httpserver` wiring
  - Open failure keeps memory journal; never blocks callback path

## Remaining for full close
- Hub idempotent ack/replay contract
- reconciliation API/worker
- E2E offline/replay evidence
