# Hub Server Integration Tests

最后更新：2026-06-27

`hub-server/tests/` contains Hub integration tests that exercise API behavior against PostgreSQL and Redis. The old helper walkthrough is archived at [../../docs/archive/hub-server/tests-readme-full-2026-06-27.md](../../docs/archive/hub-server/tests-readme-full-2026-06-27.md).

## Commands

```powershell
# Fixture-only short path; skips DB/Redis startup in TestMain.
go test ./hub-server/tests/ -short -count=1

# Full integration path; requires configured PostgreSQL and Redis.
go test ./hub-server/tests/ -count=1
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
| `CreateTestUser(t, client, baseURL)` | Register and login a test user |
| `CreateTestSession(t, client, baseURL, token, targetUserID)` | Create a private chat session |
| `AssertHTTPStatus(t, resp, status)` | Assert HTTP status |
| `get`, `post`, `postAuth`, `put`, `del` | Package-level request helpers |
| `parse`, `mustOK`, `mustCode` | Response parsing/assertion helpers |

Add new helper details in code comments near the helper implementation instead of growing this README.
