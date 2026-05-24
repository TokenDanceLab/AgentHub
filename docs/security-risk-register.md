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
| AH-SR-003 | High | Open | Logout may fail to revoke refresh tokens because access-token device ID and stored refresh-token device UUID can diverge. A stolen refresh token may survive logout. | `hub-server/internal/service/auth.go:89`, `hub-server/internal/service/auth.go:96`, `hub-server/internal/service/auth.go:109`, `hub-server/internal/handler/auth.go:105`, `hub-server/internal/repository/refresh_token.go:33` | Use one stable refresh session ID; revoke by refresh-token hash/session ID or the same validated device ID. |
| AH-SR-004 | High | Open | Edge Server can start local agent CLI processes without authentication if bound beyond loopback. Empty `Origin` is trusted for non-browser clients, so `curl` can call state-changing endpoints if it reaches the port. | `edge-server/cmd/agenthub-edge/main.go:103`, `edge-server/internal/security/origin.go:9`, `edge-server/internal/api/handlers.go:426`, `edge-server/internal/api/handlers.go:518`, `edge-server/internal/lifecycle/process_executor.go:273` | Keep Edge loopback-only unless explicit remote mode adds bearer/API-key auth and operator acknowledgement. |
| AH-SR-005 | High | Open | Edge permission decisions can be spoofed locally: unauthenticated `POST /v1/permissions/decide` accepts arbitrary `requestId` and `decision`. | `edge-server/internal/api/handlers.go:747`, `edge-server/internal/api/handlers.go:750`, `edge-server/internal/api/handlers.go:779`, `edge-server/internal/api/handlers.go:934` | Bind decisions to a pending request registry with nonce/session validation and reject unknown run/request pairs. |
| AH-SR-006 | Medium | Open | Hub WebSocket auth does not match REST TokenDance auth. REST accepts TokenDance ID first; WS only validates Hub-local HS256 on the first frame, causing auth drift and hard diagnosis. | `hub-server/internal/router/router.go:40`, `hub-server/internal/handler/ws.go:93`, `hub-server/internal/handler/ws.go:101`, `hub-server/internal/middleware/auth.go:29` | Document WS as Hub-local JWT only, or implement identical TokenDance validation plus Hub session/device mapping. |
| AH-SR-007 | Medium | Open | Desktop stores Hub access and refresh tokens in browser `localStorage`. Any renderer XSS or compromised same-origin code can read long-lived refresh credentials. | `app/desktop/src/api/hubAuth.ts:11`, `app/desktop/src/api/hubAuth.ts:130`, `app/desktop/src/api/hubAuth.ts:156` | Move refresh tokens to Tauri secure storage or OS keychain; keep access tokens in memory where practical. |

## P1 / Medium

| ID | Severity | Status | Risk | Evidence | Next action |
|---|---|---:|---|---|---|
| AH-SR-008 | Medium | Open | Dev Docker compose exposes DB, Redis, Hub, and admin ports with default credentials/ports. Accidental remote use would expose dev credentials and admin/metrics surfaces. | `docker-compose.yml:31`, `docker-compose.yml:59`, `docker-compose.yml:93`, `docker-compose.yml:98`, `docker-compose.yml:108`, `hub-server/deployments/docker-compose.prod.yml:118` | Bind dev services to `127.0.0.1` or document production compose as the only deployable profile. |
| AH-SR-009 | Medium | Open | Attachment upload path derivation trusts hash shape and download headers trust stored MIME/name. Short hashes can panic or return 500; unsafe MIME/filename can create risky downloads. | `hub-server/internal/handler/attachment.go:64`, `hub-server/internal/service/attachment.go:61`, `hub-server/internal/handler/attachment.go:115`, `hub-server/internal/handler/attachment.go:146` | Validate hash as 64-char lowercase hex, sniff/allowlist MIME, and format `Content-Disposition` safely. |
| AH-SR-010 | Medium | Open | Redis/cache nil behavior is inconsistent. Some services receive cache clients and call them directly, while tests instantiate nil cache paths. | `hub-server/internal/app/app.go:132`, `hub-server/internal/service/auth.go:176`, `hub-server/internal/service/auth.go:203`, `hub-server/internal/service/session.go:90`, `hub-server/internal/service/message.go:39`, `hub-server/internal/service/auth_test.go:100` | Either fail fast on nil cache in constructors or provide a no-op cache implementation for tests/offline mode. |
| AH-SR-011 | Low | Verify | Public stats route is unauthenticated and exposes user/agent/message counts plus uptime. This may be intentional marketing data, but should be explicit. | `hub-server/internal/router/router.go:32`, `hub-server/internal/handler/public.go:14`, `hub-server/internal/handler/public.go:39` | Decide if public stats are intentional. Otherwise aggregate, round, cache, or require auth. |
| AH-SR-012 | Low | Open | Tracked build analyzer output leaks local absolute paths and dependency inventory. | `app/desktop/stats.html:4933` | Do not commit bundle analyzer output unless sanitized; add stats artifacts to ignore rules and remove tracked generated output. |
| AH-SR-013 | Medium | Local-only | Local untracked `.env` files contain secret-looking values. They are ignored, but this remains a workstation leakage risk if zipped, pasted, or force-added. | `.env:34`, `.env:41`, `.env:45` from local scan; not tracked | Keep `.env` ignored, add secret scanning to hooks/CI, and rotate any value ever exposed outside the workstation. |
| AH-SR-014 | Medium | Verify | Edge is intended loopback-only and origin-gated, but allows no-Origin requests. This is useful for CLI clients but means any local process can call the API if it reaches the port. | `edge-server/internal/httpserver/server.go:35`, `edge-server/internal/httpserver/server.go:164`, `edge-server/internal/httpserver/server.go:166` | Add a local bearer/session token or signed desktop handshake before sensitive workspace operations. |
| AH-SR-015 | Medium | Open | Edge HTTP server leaves `WriteTimeout` at zero for WebSocket support, which also applies to short REST responses unless route-level deadlines cover them. | `edge-server/internal/httpserver/server.go:50`, `edge-server/internal/httpserver/server.go:52` | Split WS and REST timeout handling or add per-handler response deadlines for REST endpoints. |
| AH-SR-016 | Low | Verify | Production env example includes localhost origins for CORS. Compose defaults are stricter, but copying the example as-is could leave local dev origins allowed. | `hub-server/deployments/.env.production.example:37`, `hub-server/deployments/docker-compose.prod.yml:116` | Add a production preflight check that rejects localhost CORS origins. |
| AH-SR-017 | Low | Verify | Admin pprof/metrics is protected by Basic Auth and loopback publishing in compose, but runtime exposure depends on bind/publish correctness. | `hub-server/internal/app/app.go:471`, `hub-server/internal/app/app.go:477`, `hub-server/deployments/docker-compose.prod.yml:119` | Verify externally that `/debug/pprof/` and `/metrics` are unreachable except through intended local/admin access. |

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
