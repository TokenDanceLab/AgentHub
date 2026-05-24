# AgentHub Security Risk Register

Last reviewed: 2026-05-25

This register tracks security, privacy, reliability, network, disk, and logic risks for AgentHub. It is a living queue for audit loops; update status and evidence when a finding is fixed or intentionally accepted.

## Scope

- Hub Server: `hub-server/`
- Edge Server: `edge-server/`
- Desktop/Web clients: `app/desktop/`, `app/web/`, `app/shared/`
- API and deployment docs: `api/`, `docs/`, `hub-server/deployments/`

## P0 / High

| ID | Severity | Status | Risk | Evidence | Next action |
|---|---|---:|---|---|---|
| AH-SR-001 | High | Mitigated in repo; config/deploy verification required | TokenDance ID bearer validation previously did not visibly enforce `iss` and `aud` before accepting RS256 tokens. Hub now requires configured issuer and AgentHub client audience for the TokenDance bearer compatibility path. | `hub-server/internal/jwtutil/tokendance.go:135`, `hub-server/internal/jwtutil/tokendance.go:181`, `hub-server/internal/middleware/auth.go:30`, `hub-server/internal/jwtutil/tokendance_test.go:16`, `hub-server/internal/middleware/auth_test.go:89` | Ensure `AGENTHUB_TOKENDANCE_ID_CLIENT_ID` is configured for every environment that enables TokenDance bearer compatibility; then verify wrong-audience tokens are rejected in deployment. |
| AH-SR-002 | High | Open | TokenDance ID bearer auth maps accepted users to hardcoded `device_type=desktop`, so normal OIDC identity tokens can satisfy desktop-only Edge route checks. | `hub-server/internal/middleware/auth.go:31`, `hub-server/internal/middleware/auth.go:35`, `hub-server/internal/router/router.go:130` | TokenDance bearer auth must exchange into an explicit Hub session/device class; Edge APIs require Hub-issued device proof. |
| AH-SR-003 | High | Mitigated in repo; integration/deploy verification required | Login previously wrote the device row, access-token `device_id`, and refresh-token `device_id` with divergent values, so logout could miss the refresh token. Login now uses the same stable device ID across all three surfaces, and Desktop fallback login reuses the persisted UUID device ID. | `hub-server/internal/service/auth.go:89`, `hub-server/internal/service/auth.go:107`, `hub-server/internal/service/auth_test.go:194`, `hub-server/internal/service/auth_test.go:206`, `app/desktop/src/api/deviceId.ts:1`, `app/desktop/src/api/hubAuth.ts:171`, `app/desktop/src/api/hubAuth.ts:206`, `app/desktop/src/__tests__/hubClient.test.ts:283` | Run an integration login/logout/refresh cycle against the real Postgres schema and decide whether pre-fix refresh tokens should be revoked during rollout. |
| AH-SR-004 | High | Open | Edge Server can start local agent CLI processes without authentication if bound beyond loopback. Empty `Origin` is trusted for non-browser clients, so `curl` can call state-changing endpoints if it reaches the port. | `edge-server/cmd/agenthub-edge/main.go:103`, `edge-server/internal/security/origin.go:9`, `edge-server/internal/api/handlers.go:426`, `edge-server/internal/api/handlers.go:518`, `edge-server/internal/lifecycle/process_executor.go:273` | Keep Edge loopback-only unless explicit remote mode adds bearer/API-key auth and operator acknowledgement. |
| AH-SR-005 | High | Mitigated in repo; remote-mode auth/blocking approval still open | Edge permission decisions previously accepted arbitrary `requestId` and `decision`. The endpoint now requires `runId` + `requestId`, consumes a one-shot pending permission registry populated from `run.agent.permission_requested`, rejects unknown/wrong-run/replayed decisions, and documents `runId` as required. | `edge-server/internal/api/permission_registry.go:30`, `edge-server/internal/api/handlers.go:40`, `edge-server/internal/api/handlers.go:790`, `edge-server/internal/events/bus.go:114`, `edge-server/internal/adapters/event_emitter.go:24`, `edge-server/internal/lifecycle/process_executor.go:516`, `api/openapi.yaml:831` | Add authenticated/signed Desktop decision proof before non-loopback remote Edge mode, and separately design true blocking approval before claiming human-in-the-loop permission enforcement. |
| AH-SR-006 | Medium | Open | Hub WebSocket auth does not match REST TokenDance auth. REST accepts TokenDance ID first; WS only validates Hub-local HS256 on the first frame, causing auth drift and hard diagnosis. | `hub-server/internal/router/router.go:40`, `hub-server/internal/handler/ws.go:93`, `hub-server/internal/handler/ws.go:101`, `hub-server/internal/middleware/auth.go:29` | Document WS as Hub-local JWT only, or implement identical TokenDance validation plus Hub session/device mapping. |
| AH-SR-007 | Medium | Open | Desktop stores Hub access and refresh tokens in browser `localStorage`. Any renderer XSS or compromised same-origin code can read long-lived refresh credentials. | `app/desktop/src/api/hubAuth.ts:11`, `app/desktop/src/api/hubAuth.ts:130`, `app/desktop/src/api/hubAuth.ts:156` | Move refresh tokens to Tauri secure storage or OS keychain; keep access tokens in memory where practical. |

## P1 / Medium

| ID | Severity | Status | Risk | Evidence | Next action |
|---|---|---:|---|---|---|
| AH-SR-008 | Medium | Open | Dev Docker compose exposes DB, Redis, Hub, and admin ports with default credentials/ports. Accidental remote use would expose dev credentials and admin/metrics surfaces. | `docker-compose.yml:31`, `docker-compose.yml:59`, `docker-compose.yml:93`, `docker-compose.yml:98`, `docker-compose.yml:108`, `hub-server/deployments/docker-compose.prod.yml:118` | Bind dev services to `127.0.0.1` or document production compose as the only deployable profile. |
| AH-SR-009 | Medium | Partially mitigated in repo; MIME/header hardening open | Attachment hash shape is now validated as 64-char lowercase hex before probe/upload/download path derivation, and invalid persisted hashes no longer reach `PathFromHash`. Remaining risk is MIME sniffing/allowlist and safer `Content-Disposition` formatting. | `hub-server/internal/handler/attachment.go:44`, `hub-server/internal/handler/attachment.go:69`, `hub-server/internal/handler/attachment.go:142`, `hub-server/internal/service/attachment.go:62`, `hub-server/internal/service/attachment.go:77`, `hub-server/internal/service/attachment_test.go:8`, `hub-server/internal/handler/attachment_test.go:41` | Sniff/allowlist MIME and format `Content-Disposition` safely; verify download behavior for unsafe filenames. |
| AH-SR-010 | Medium | Open | Redis/cache nil behavior is inconsistent. Some services receive cache clients and call them directly, while tests instantiate nil cache paths. | `hub-server/internal/app/app.go:132`, `hub-server/internal/service/auth.go:176`, `hub-server/internal/service/auth.go:203`, `hub-server/internal/service/session.go:90`, `hub-server/internal/service/message.go:39`, `hub-server/internal/service/auth_test.go:100` | Either fail fast on nil cache in constructors or provide a no-op cache implementation for tests/offline mode. |
| AH-SR-011 | Low | Verify | Public stats route is unauthenticated and exposes user/agent/message counts plus uptime. This may be intentional marketing data, but should be explicit. | `hub-server/internal/router/router.go:32`, `hub-server/internal/handler/public.go:14`, `hub-server/internal/handler/public.go:39` | Decide if public stats are intentional. Otherwise aggregate, round, cache, or require auth. |
| AH-SR-012 | Low | Open | Tracked build analyzer output leaks local absolute paths and dependency inventory. | `app/desktop/stats.html:4933` | Do not commit bundle analyzer output unless sanitized; add stats artifacts to ignore rules and remove tracked generated output. |
| AH-SR-013 | Medium | Local-only | Local untracked `.env` files contain secret-looking values. They are ignored, but this remains a workstation leakage risk if zipped, pasted, or force-added. | `.env:34`, `.env:41`, `.env:45` from local scan; not tracked | Keep `.env` ignored, add secret scanning to hooks/CI, and rotate any value ever exposed outside the workstation. |
| AH-SR-014 | Medium | Verify | Edge is intended loopback-only and origin-gated, but allows no-Origin requests. This is useful for CLI clients but means any local process can call the API if it reaches the port. | `edge-server/internal/httpserver/server.go:35`, `edge-server/internal/httpserver/server.go:164`, `edge-server/internal/httpserver/server.go:166` | Add a local bearer/session token or signed desktop handshake before sensitive workspace operations. |
| AH-SR-015 | Medium | Open | Edge HTTP server leaves `WriteTimeout` at zero for WebSocket support, which also applies to short REST responses unless route-level deadlines cover them. | `edge-server/internal/httpserver/server.go:50`, `edge-server/internal/httpserver/server.go:52` | Split WS and REST timeout handling or add per-handler response deadlines for REST endpoints. |
| AH-SR-016 | Low | Verify | Production env example includes localhost origins for CORS. Compose defaults are stricter, but copying the example as-is could leave local dev origins allowed. | `hub-server/deployments/.env.production.example:37`, `hub-server/deployments/docker-compose.prod.yml:116` | Add a production preflight check that rejects localhost CORS origins. |
| AH-SR-017 | Low | Verify | Admin pprof/metrics is protected by Basic Auth and loopback publishing in compose, but runtime exposure depends on bind/publish correctness. | `hub-server/internal/app/app.go:471`, `hub-server/internal/app/app.go:477`, `hub-server/deployments/docker-compose.prod.yml:119` | Verify externally that `/debug/pprof/` and `/metrics` are unreachable except through intended local/admin access. |
| AH-SR-018 | Medium | Open | Edge run output is copied to temp files and published to subscribers without a visible per-run byte cap. A noisy or malicious runtime can exhaust disk or flood event subscribers within the run window. | `edge-server/internal/runnerctx/run_output.go:23`, `edge-server/internal/runnerctx/run_output.go:39`, `edge-server/internal/lifecycle/process_executor.go:326`, `edge-server/internal/lifecycle/process_executor.go:374`, `edge-server/internal/lifecycle/process_executor.go:384` | Add a per-run output byte budget that truncates persisted output and emitted batches, records truncation, and leaves run lifecycle stable. |
| AH-SR-019 | Medium | Open | Auth and device-registration handlers only require `device_id` to be present, while Hub tables model device IDs as UUIDs. Non-UUID client values can turn login/register into database errors and make auth/device behavior drift across clients. | `hub-server/internal/handler/auth.go:60`, `hub-server/internal/handler/device.go:24`, `hub-server/internal/model/device.go:6`, `hub-server/internal/model/refresh_token.go:15`, `app/desktop/src/api/deviceId.ts:1` | Validate `device_id` as UUID at auth/device boundaries, return `BAD_REQUEST` for malformed values, and update API docs/tests to state the UUID contract. |

## Recent Mitigation Evidence

- 2026-05-25: `AH-SR-003` was mitigated in repo by making Hub login persist the caller device ID consistently in `devices`, access-token claims, and refresh-token rows; Desktop legacy login now uses the persisted `agenthub_device_id` UUID instead of generating a one-off `desktop_*` string; `getState()` now returns a copy of the auth snapshot to avoid external state mutation.
- Fresh focused checks passed:
  - `cd hub-server; go test ./internal/service -run "TestLogin_Success|TestLogout|TestRefreshToken_Success" -count=1`
  - `cd app/desktop; pnpm test -- src/__tests__/hubClient.test.ts`
- 2026-05-25: `AH-SR-009` hash panic path was partially mitigated by adding 64-char lowercase hex validation before attachment probe/upload/download path derivation and making `PathFromHash` return an empty path for malformed hashes.
- Fresh focused checks passed:
  - `cd hub-server; go test ./internal/service -run TestPathFromHashValidatesHashShape -count=1`
  - `cd hub-server; go test ./internal/handler -run "TestAttachment(UploadRejectsMalformedHashBeforePathDerivation|ProbeRejectsMalformedHashBeforeServiceLookup)" -count=1`
  - `cd hub-server; go test ./internal/service ./internal/handler -run "Test(PathFromHashValidatesHashShape|Attachment|AttachmentErrors)" -count=1`
- 2026-05-25: `AH-SR-005` arbitrary permission-decision spoofing was mitigated by wiring an Edge pending permission registry to the event bus before WebSocket fanout, scoping adapter permission events with run/project/thread IDs, and making `POST /v1/permissions/decide` one-shot against a known run/request pair.
- Fresh focused checks passed:
  - `cd edge-server; go test ./internal/api ./internal/events ./internal/adapters ./internal/lifecycle -run "TestPermission|TestPostPermission|TestMuxPermission|TestAddObserver|TestScopedEventEmitter|TestBusEventEmitter|TestBudgetAwareEmitter" -count=1 -v`
  - `python -c "import yaml, pathlib; yaml.safe_load(pathlib.Path('api/openapi.yaml').read_text(encoding='utf-8')); print('yaml ok')"`

## Verification Queue

Run these from `D:\Code\TokenDance\AgentHub`:

```powershell
git status --short --branch
git ls-files -- app/desktop/stats.html 'edge-server/$covPath' edge-server/cov_full 'hub-server/tests/uploads/**'
go test ./hub-server/internal/jwtutil ./hub-server/internal/middleware ./hub-server/internal/handler ./hub-server/internal/service
go test ./hub-server/internal/jwtutil ./hub-server/internal/middleware -run "TestParseTokenDanceJWTRequiresExpectedIssuerAndAudience|TestAuthMiddlewareRejectsTokenDanceTokenWithoutExpectedAudience" -count=1
go test ./edge-server/internal/httpserver ./edge-server/internal/api ./edge-server/internal/security
rg -n "ParseTokenDanceJWT|Issuer|Audience|ValidMethods|token.Valid" hub-server/internal/jwtutil hub-server/internal/middleware
rg -n 'device_type", "desktop"|DeviceTypeCheck\("desktop"\)' hub-server/internal
rg -n "AGENTHUB_ADDR|IsTrustedLocalOrigin|permissions/decide|PostRuns|exec.CommandContext" edge-server
rg -n "dev_password|6379:6379|5432:5432|6060:6060|AGENTHUB_JWT_SECRET|127.0.0.1" docker-compose.yml hub-server/deployments/docker-compose.prod.yml
rg -n 'PostForm\("hash"\)|PathFromHash|Content-Disposition|Content-Type' hub-server/internal/handler/attachment.go hub-server/internal/service/attachment.go
```

## Loop Notes

- Keep this file focused on active risks and verification decisions.
- When a finding becomes a design decision, link the ADR or architecture section and mark it `Accepted`.
- When a code fix lands, include the test command and commit/PR in the status note.
