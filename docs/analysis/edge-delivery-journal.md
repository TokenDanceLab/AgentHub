# Edge DeliveryJournal (#437 / #445 / #462)

最后更新：2026-07-17

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
- **Reconciliation read path**
  - `CallbackClient.DurableSnapshot(afterSeq)` prefers SQLite
  - `GET /v1/delivery-journal?afterSeq=` on Edge API
  - `HasSuccessful(task, run, action)` for idempotent skip of already-acked deliveries
  - unit tests: HasSuccessful + DurableSnapshot + GetDeliveryJournal
- **#462 offline/replay reconciliation fixture (AH-SR-049 residual)**
  - `TestCallbackClient_OfflineReplayReconciliation`: enable SQLite → record success/fail → close/reopen → `HasSuccessful` true → `DurableSnapshot(afterSeq)` cursor window
  - `RedeliveryCandidates(entries, afterSeq)` pure helper (+ unit test) selects failed entries without a later success; **not** a production worker
  - Automatic redelivery worker **explicitly deferred** (no background loop in this residual)

## Deferred / optional
- Automatic redelivery worker driven by DurableSnapshot cursor (deferred; helper only)
- Live Hub outbox cross-service offline/replay probe (optional; in-repo reopen fixture covers Edge journal reconciliation path)
