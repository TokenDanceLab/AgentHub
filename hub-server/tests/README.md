# Hub Server Integration Tests

最后更新：2026-10-19

`hub-server/tests/integration/` contains Hub integration tests that exercise API behavior against PostgreSQL and Redis.

## Commands

The lane is `//go:build integration` (mechanical lane manifest): the default `-short` lanes never compile it, so the suite cannot silently vanish. Run it explicitly:

```powershell
# Integration lane; requires configured PostgreSQL and Redis.
cd hub-server
go test -tags integration ./tests/integration/ -count=1
```

Full mode reads `hub-server/configs/config.yaml`.

## Isolation Rules

- Every top-level `TestXxx` must call `t.Cleanup(func() { CleanDB(t, db) })`.
- Subtests under the same `TestXxx` may share setup data.
- Test usernames must be unique per top-level test.
- Do not mutate global `ts`, `client`, `db`, `mgr`, or `bus` outside the helper contract.
- `CleanDB` clears PostgreSQL tables; Redis cache is cleared from `TestMain` startup helpers.

## Common Helpers

| Helper | Purpose |
|---|---|
| `CleanDB(t, db)` | Clear all tables in dependency order |
| `get`, `post`, `postAuth`, `put`, `del` | Package-level request helpers |
| `parse`, `mustOK`, `mustCode` | Response parsing/assertion helpers |

Add new helper details in code comments near the helper implementation instead of growing this README.
