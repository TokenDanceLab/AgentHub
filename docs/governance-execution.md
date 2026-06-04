# AgentHub Governance Execution

最后更新：2026-06-02

This file maps TokenDance system governance into AgentHub execution items. AgentHub is the multi-agent collaboration platform; it is a relying party of TokenDance ID and owns Hub, Edge, Desktop, Web, and Mobile clients.

## Root Inputs

- `..\..\docs\ecosystem\ecosystem-execution-queue.md`
- `..\..\docs\governance\scorecard-evidence.md`
- `..\..\docs\identity\identity-auth.md`
- `..\..\docs\identity\authorization-model.md`
- `..\..\docs\identity\feishu-integration.md`
- `..\..\docs\security\security-risk.md`
- `..\..\docs\identity\i18n-packaging.md`
- `..\..\docs\design\design-system.md`
- `..\..\docs\design\visual-qa-matrix.md`

## AgentHub Queue Map

| Queue ID | Local owner area | Local files/docs to inspect | Minimum completion evidence |
|---|---|---|---|
| TD-P0-HUB-01 | Hub OIDC login | `hub-server/internal/handler/auth.go`, `hub-server/internal/jwtutil/tokendance.go`, `hub-server/internal/service/auth.go` | Repo-level handler/service tests for callback, invalid issuer/audience, `tokendance_sub` mapping, Hub access/refresh session, UUID device proof tests complete; before closure require release branch proof, deployment callback/client registration proof, refresh/logout smoke |
| TD-P0-CLIENT-01 | Desktop/Web login | `app/desktop/src/`, `app/web/src/`, `app/desktop/src-tauri/` | Desktop/Web token/user metadata constrained to tab-scoped `sessionStorage`; Web production code guarded as Hub-only; WS route tests accepting Hub-issued tokens and rejecting TokenDance bearer before upgrade; remaining: login/logout screenshots, release branch WS auth smoke, deployment config, Web server-owned session posture |
| TD-P0-FEISHU-01 | Feishu Integration Gateway | `hub-server/internal/`, `api/` | `/integrations/feishu/events`, `/integrations/feishu/card-actions`, `message_id` idempotency, `card.action.trigger` 3s response, no 3xx redirects — NOT STARTED |
| TD-P1-HUB-02 | Hub authorization | `hub-server/internal/service/`, `hub-server/internal/middleware/` | Resource/action checks applied to org/project/thread/run/profile/integration secrets — pending TD-P0-HUB-01 deployment |
| TD-P0-DESIGN-01 | Visual QA | `app/desktop/screenshots/`, `app/web/screenshots/`, `app/mobile/screenshots/` | Desktop 14 screenshots (missing approval/error/diff), Web 70+ screenshots (most complete), Mobile 80+ screenshots (most complete); public product sites pending |
| TD-P0-I18N-01 | i18n parity | `app/desktop/src/i18n/locales/`, `app/web/src/i18n/locales/` | Desktop flat `zh.json`/`en.json` and Web namespace JSON directories structurally matching; Mobile missing dedicated i18n files |
| TD-P0-SEC-01 | Security/risk | `docs/governance/security-risk-register.md` | Register created 2026-06-01; Critical/High findings need production deployment evidence |

## Local Dispatch Rules

1. Every login, OIDC, session, Feishu, authorization, or multi-client issue should reference the relevant root queue ID.
2. Hub-issued sessions are the product-local authority; TokenDance ID only proves identity.
3. Desktop and Mobile are independent Tauri projects (distinct `src-tauri/`, separate ports 5173/5174).
4. Edge Server is local-only; it connects to Hub for task dispatch and SSO identity.
5. Web client is Hub-only (no local Edge loopback); no direct third-party provider login.
6. Production deployment and ops evidence remains in server workspace; do not copy host/path/secret into this repo.

## Sync Checklist

- Update this file when a queue ID moves from open to partial or done.
<<<<<<< HEAD
- Update `docs/tutorials/roadmap.md` when major features or batches complete.
- Update `docs/development/handoffs/STATE.md` for deployment version and commit hash changes.
=======
- Update `docs/roadmap.md` when major features or batches complete.
- Update `docs/handoff/STATE.md` for deployment version and commit hash changes.
>>>>>>> origin/master
- Update `docs/governance/security-risk-register.md` for new findings, mitigations, or deployment verification.
- Update root `docs/identity/identity-auth.md` / `docs/identity/authorization-model.md` when Hub session or token rules change.
- Update `api/openapi.yaml` and `api/events.md` for API contract changes.
