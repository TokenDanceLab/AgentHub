# AgentHub Security Risk Register

Last reviewed: 2026-06-03

AgentHub is the multi-model AI coding orchestration product. This register covers Hub Server, Edge Server, Desktop (Tauri), and Web (Hub-only webapp) security boundaries. Cross-repo severity, status vocabulary, release gates, and escalation rules are defined in the root `../docs/security/security-risk.md`.

## Scope

- Hub Server: `hub-server/` — JWT/session, OIDC callback, REST/WS handlers, EventBus, profile/skill/MCP/target CRUD
- Edge Server: `edge-server/` — Local Execution Target, runtime adapters, workspace allowlist, client auth
- Desktop (Tauri): `app/desktop/` — system browser PKCE, Edge lifecycle, OS secure store, tray
- Web (Hub-only): `app/web/` — Hub boundary, sessionStorage token, WS auth
- API contract: `api/`
- CI/governance: `scripts/`, `.github/workflows/`
- Cross-repo identity docs: `../docs/identity/identity-auth.md`, `../docs/identity/authorization-model.md`, `../docs/identity/relying-party.md`

## P0 / High

| ID | Severity | Status | Risk | Evidence | Next action |
|---|---|---:|---|---|---|
| AH-SR-001 | Critical | Mitigated in repo; rotate required | JWT secret was a hard-coded default in earlier Hub config. Hub Server now reads `HUB_JWT_SECRET` from the environment and the `app.env` template uses a placeholder. Any environment where the old default was used must be rotated. | `hub-server/internal/config/config.go`, `hub-server/app.env` | Rotate JWT secret in all deployed Hub instances; verify old secret no longer validates Hub-issued tokens. |
| AH-SR-002 | High | Mitigated in repo; deploy verification required | Hub session boundary: REST and WebSocket endpoints now require a Hub-issued access token or session token. TokenDance ID bearer tokens are no longer accepted as Hub API authorization, and the WebSocket upgrade rejects bearer tokens before the Hub-local session check. | `hub-server/internal/middleware/auth.go`, `hub-server/internal/handler/ws.go`, `hub-server/internal/handler/client.go` | Deploy and smoke-test: TokenDance ID bearer token rejected on Hub REST/WS, Hub-issued session token accepted, guest/anonymous paths (health, OIDC callback) remain open. |
| AH-SR-003 | High | Mitigated and deployed | CORS middleware is locked to explicit production origins. Wildcard origins and arbitrary reflection have been removed. Hub production config must use exact `https://` origins. | `hub-server/internal/middleware/cors.go`, `hub-server/internal/config/config.go` | Keep allowed origins explicit; verify after any new client origin is added. |
| AH-SR-004 | High | Mitigated and deployed | Rate-limit middleware is deployed on Hub auth/token/API routes with per-IP bucket tracking and configurable limits. Proxy header parsing trusts only loopback reverse-proxy addresses. | `hub-server/internal/middleware/ratelimit.go`, `hub-server/internal/config/config.go` | Keep rate-limit bucket sizes in sync with actual usage patterns; add per-route differentiation if needed. |
| AH-SR-005 | High | Mitigated in repo; deploy verification required | Edge Server local auth token is optional and config-driven. When enabled, clients must present `Authorization: Bearer <edge_token>` for local Edge REST endpoints. The token is read from env, not hard-coded. | `edge-server/internal/middleware/auth.go`, `edge-server/internal/config/config.go` | Decide whether production Edge instances should enforce local auth; document the decision and verify deployment. |
| AH-SR-006 | High | Mitigated in repo; deploy verification required | Edge workspace allowlist restricts which local filesystem paths Edge can access. Unlisted paths are rejected before any file operation. | `edge-server/internal/workspace/allowlist.go`, `edge-server/internal/config/config.go` | Verify production Edge workspace config restricts to intended project roots; add regression that allowlist is never empty or `/`. |

## P1 / Medium

| ID | Severity | Status | Risk | Evidence | Next action |
|---|---|---:|---|---|---|
| AH-SR-007 | Medium | Mitigated in repo; deploy verification required | Message pin cross-session leak: foreign-key integrity between `message_pins` and `messages` was missing. Composite foreign key has been added and 39 migrations are applied. A pin referencing a deleted or foreign-session message will now be rejected or cascade-cleaned. | `hub-server/internal/repository/message_pin_repo.go`, `hub-server/migrations/` | Verify deployed DB schema enforces the FK; attempt to insert a pin referencing a non-existent or foreign-session message and confirm rejection. |
| AH-SR-008 | Medium | Mitigated in repo; deploy verification required | OIDC PKCE + loopback callback: Desktop uses system browser PKCE flow with TokenDance ID. The OIDC client supports dynamic loopback callback ports for native/local clients. Code exchange enforces `state`, PKCE `code_verifier`, issuer, and audience validation. | `app/desktop/src-tauri/src/oidc.rs`, `app/desktop/src/lib/oidc.ts` | Verify Desktop PKCE login from cold start through Hub session acquisition; confirm loopback callback closes after code exchange and token material never reaches browser-accessible storage. |
| AH-SR-009 | Medium | Mitigated in repo; deploy verification required | Attachment access control: uploaded file access now gates on sender identity or session membership. Unauthenticated or foreign-session access returns 403. | `hub-server/internal/handler/attachment.go`, `hub-server/internal/middleware/auth.go` | Verify deployed attachment URLs are not guessable; smoke-test with a foreign-session user attempting direct attachment access. |
| AH-SR-010 | Medium | Mitigated in repo; deploy verification required | Owner boundary: Agent Profile, Skill, MCP server, and Execution Target CRUD operations now verify the authenticated user owns or is authorized to modify the resource. Cross-owner mutation or read is rejected. | `hub-server/internal/handler/profile.go`, `hub-server/internal/handler/skill.go`, `hub-server/internal/handler/mcp.go`, `hub-server/internal/handler/target.go` | Smoke-test each entity type with owner and non-owner sessions; verify 403 on cross-owner mutation. |
| AH-SR-011 | Medium | Mitigated in repo; deploy verification required | Public stats bucketed: Hub public health/stats endpoints bucket data into coarse ranges and do not expose individual user, session, or run details. | `hub-server/internal/handler/stats.go` | Verify deployed `/api/public/stats` returns only bucketed aggregates; confirm no user-identifiable fields in response. |

## P1 / Low

| ID | Severity | Status | Risk | Evidence | Next action |
|---|---|---:|---|---|---|
| AH-SR-012 | High | Open | Hub OIDC callback, JWKS validation, code exchange, and Hub session issuance have code and test coverage. 2026-06-02 production non-interactive smoke verified TokenDance ID health/discovery/JWKS, Hub health, Hub OIDC authorize URL generation, invalid callback rejection, and Desktop dev CORS with `scripts/verify-oidc-flow.ps1` (32/32). This still lacks a browser-completed authorization code flow proving live callback registration, code exchange, Hub session issuance, and user-visible login completion. | `hub-server/internal/handler/oidc.go`, `hub-server/internal/service/oidc.go`, `hub-server/internal/service/oidc_test.go`, `scripts/verify-oidc-flow.ps1` | Complete an end-to-end browser OIDC login against production or staging, confirm Hub session issuance and `/client/auth/me`, then record private evidence without copying callback codes, tokens, client secrets, or session material into this public repo. |
| AH-SR-013 | High | Open | No Desktop login/logout/reconnect deployment evidence. Desktop system-browser PKCE, Hub session acquisition, WebSocket auth, logout, and reconnect recovery have code but no production or staging deployment evidence with real TokenDance ID. This is release-blocking. | `app/desktop/src/lib/oidc.ts`, `app/desktop/src/lib/auth.ts`, `app/desktop/src-tauri/src/oidc.rs` | Deploy Desktop against a live Hub with OIDC enabled, complete full login/logout/reconnect cycle, capture evidence in private server docs. Do NOT copy tokens, callback parameters, or session secrets. |
| AH-SR-014 | High | Open | Web server-owned session posture not proven. Web app currently uses `sessionStorage` for Hub session tokens. A release-quality Web deployment should demonstrate server-owned session posture (BFF/HttpOnly cookie or accepted documented alternative) before public exposure. | `app/web/src/lib/auth.ts`, `app/web/src/stores/session.ts` | Implement or document the Web session posture decision; if BFF/HttpOnly, add backend proxy with cookie-based session; if documented alternative, record accepted risk with owner, date, reason, and compensating controls. |
| AH-SR-021 | High | Open | Mobile labels the native token layer as secure storage, but the current Tauri command writes the Hub access token as plaintext JSON under the app data directory. Mobile OIDC deep-link callback is also explicitly incomplete, so this path must not be treated as release-ready authentication. | `app/mobile/src-tauri/src/secure_store.rs`, `app/mobile/src-tauri/src/oidc.rs`, `app/mobile/src/native/mobileCommands.ts` | Before Mobile auth release, either return a clear not-implemented state for token persistence or integrate Android Keystore / iOS Keychain and route the full flow through Hub `/client/auth/oidc/*`; add native storage tests or platform QA evidence. |
| AH-SR-022 | High | Open | Legacy username/password auth surface still exists in Web client types/comments and Hub integration tests even though the active Hub router only exposes refresh, OIDC authorize/callback, logout, and profile routes. Keeping dead login/register/password paths makes it easy to reintroduce unsupported auth logic. | `app/web/src/api/hubAuth.ts`, `app/web/src/api/hubClient.ts`, `hub-server/internal/router/router.go`, `hub-server/tests/api_test.go` | Delete or quarantine legacy password client/test surfaces behind an explicit migration task; ensure OpenAPI, Web auth UI, and tests only describe TokenDance ID OIDC plus Hub refresh/logout/profile. |
| AH-SR-023 | Medium | Open | Web preview/mock surfaces are labeled, but demo fallbacks and local-preview actions still share production UI paths. Release-quality Web must not report fake execution, fake private-chat success, or local catalog mutation as Hub-backed behavior. | `app/web/src/pages/mockConvergence.test.tsx`, `app/web/src/api/agentQueries.ts`, `app/web/src/api/hubClient.ts`, `app/web/src/i18n/locales/en/*.json` | Gate demo/mock surfaces behind explicit preview mode and route production run mutations through Hub `/web/agent-tasks` or team-run APIs; keep tests that fail on mock success states in authenticated flows. |
| AH-SR-024 | Medium | Open | Runner compatibility health still leaks into Desktop/Web settings and workbench state, while the architecture has moved to Runtime adapters plus Execution Targets. This can mislead operators about what is actually dispatchable. | `edge-server/README.md`, `edge-server/internal/runners/`, `app/desktop/src/components/settings/sections/ExecutionTargetsSection.tsx`, `app/web/src/hooks/useWorkbenchProjection.ts` | Replace direct runner-centric UI assumptions with a compatibility adapter over Runtime inventory and Execution Target health; keep `/v1/runners` only as a documented legacy summary until clients stop depending on it. |

## Observability / Hygiene

| ID | Severity | Status | Risk | Evidence | Next action |
|---|---|---:|---|---|---|
| AH-SR-015 | Low | Mitigated | pprof debug endpoint is bound to localhost only, preventing remote profiling exposure. | `hub-server/internal/config/config.go` | Keep pprof loopback-only; add CI check if pprof binding is ever made configurable. |
| AH-SR-016 | Low | Mitigated | EventBus panic recovery: Hub EventBus subscribers have `defer/recover` wrappers. A panic in one subscriber does not crash the Hub or block other subscribers. | `hub-server/internal/eventbus/eventbus.go` | Keep recovery wrappers; add focused test for subscriber panic isolation. |
| AH-SR-017 | Low | Mitigated | Edge race condition: concurrent workspace file access previously had a read/write race. The lifecycle manager now uses proper locking. | `edge-server/internal/lifecycle/lifecycle.go` | Keep lock ordering documented; add regression that concurrent run triggers do not race. |
| AH-SR-018 | Low | Mitigated | Prometheus `/metrics` endpoint is wired on Edge Server for operational monitoring. | `edge-server/internal/middleware/metrics.go` | Keep metrics endpoint optionally auth-gated if Edge is exposed beyond localhost. |
| AH-SR-019 | Low | Mitigated | Message/device/task/run payloads are capped at 1 MiB with UUID format validation before processing. | `hub-server/internal/middleware/bodylimit.go`, `hub-server/internal/validator/uuid.go` | Keep body limits; bump only with explicit design review for new upload/streaming endpoints. |
| AH-SR-020 | Low | Mitigated | CI enforces `govulncheck` as a hard block and `gosec` as warning-only. No known-vulnerable Go dependency can enter the build. | `.github/workflows/ci.yml`, `scripts/` | Keep CI gates; promote `gosec` to hard block after clearing current warnings. |

## Verification Queue

Run these from `D:\Code\TokenDance\AgentHub`:

```powershell
# Backend tests
cd hub-server; go test ./... -short -count=1
cd ..\edge-server; go test ./... -short -count=1

# Frontend tests
cd app\desktop; pnpm test; pnpm typecheck
cd ..\web; corepack.cmd pnpm typecheck

# Git diff check
git diff --check
```

## Loop Notes

- Hub session/auth, OIDC, Edge auth, or workspace boundary changes must update this register.
- Critical/High risks in `Open` state block public release; see `../docs/security/security-risk.md` for release gates.
- Production live endpoint, callback URL, client secret, session token, host path, backup path, and rotation evidence belong only in `C:\Users\Ding\server` or private ops docs.
- Cross-repo identity/auth changes must also update `../docs/identity/identity-auth.md`, `../docs/identity/authorization-model.md`, and `../docs/identity/relying-party.md`.
- Feishu/Lark Gateway security items should be added here when the integration skeleton lands.
