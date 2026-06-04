# AgentHub Governance Execution

最后更新：2026-05-25

This file maps TokenDance system-level governance work into AgentHub-owned execution items. It does not replace `docs/roadmap.md`, `docs/architecture/product-requirements.md`, or `docs/architecture/system-architecture.md`; it tells agents which root queue IDs apply before they edit Hub, Edge, Desktop, Web, Feishu, or auth code.

## Root Inputs

Read these first when the work crosses identity, authorization, Feishu/Lark, Gateway, design, i18n, security, or packaging boundaries.

（跨仓库引用 — 文件位于 `D:\Code\TokenDance\docs\`）

- `../../docs/ecosystem/ecosystem-execution-queue.md`
- `../../docs/governance/scorecard-evidence.md`
- `../../docs/identity/identity-auth.md`
- `../../docs/identity/authorization-model.md`
- `../../docs/identity/feishu-integration.md`
- `../../docs/security/security-risk.md`
- `../../docs/design/design-playbook.md`
- `../../docs/design/visual-qa-matrix.md`

## AgentHub Queue Map

| Queue ID | Local owner area | Local files/docs to inspect | Minimum completion evidence |
|---|---|---|---|
| TD-P0-HUB-01 | Hub Server | `hub-server/`, `api/openapi.yaml`, `docs/architecture/system-architecture.md`, `docs/architecture/implementation-guide.md` | Hub-owned TokenDance ID callback/code exchange; issuer/audience/JWKS tests; `tokendance_sub` user mapping; Hub-local access/refresh session tests |
| TD-P0-CLIENT-01 | Desktop/Web client | `app/desktop/`, `app/web/`, shared auth/client state | Desktop/Web login UX screenshots; Hub session storage/logout/reconnect tests or documented checks; no provider token stored client-side |
| TD-P0-FEISHU-01 | Hub integration | `hub-server/`, `api/openapi.yaml`, `api/events.md`, future integration docs | `/integrations/feishu/events` and `/integrations/feishu/card-actions`; signature/decrypt path; `message_id` idempotency; 3 second card callback behavior; async queue evidence |
| TD-P1-HUB-02 | Hub authorization | Hub handler/service layers, Agent/Profile/Run/Thread/Integration code | Resource/action allow/deny tests for org/project/thread/run/profile/integration secrets after TokenDance ID identity mapping |
| TD-P0-DESIGN-01 | Desktop/Web surfaces | `app/desktop/`, `app/web/`, shared UI stories/tests | Screenshots for changed real work surfaces from `../../docs/design/visual-qa-matrix.md`; token usage or layout evidence; mobile/narrow check where applicable |
| TD-P0-I18N-01 | Desktop/Web public/user copy | Desktop flat locale JSON, Web namespace locale JSON, or user-visible strings | zh/en copy parity for login, errors, Feishu, Gateway, Agent terms; focused tests or review notes for changed strings |
| TD-P0-SEC-01 | Security/risk | `docs/security-risk-register.md`, auth/session/Edge execution/integration code | Risk finding updated with severity/status/evidence; Critical/High fixed, verified, or explicitly accepted before release-ready claims |

Current TD-P0-HUB-01 status: Hub Server has repo-level implementation and tests for TokenDance ID authorize/callback exchange, configured JWKS validation, `tokendance_sub` mapping, Hub-local access/refresh token issuance, and UUID device proof. Remaining evidence before product-level closure is Desktop/Web callback UX, Hub session storage/logout/reconnect behavior, deployment config proof, and screenshots.

## Local Dispatch Rules

1. Every repo issue, roadmap row, or PR for the queue items above should reference the relevant `TD-P0-*` / `TD-P1-*` ID.
2. Hub login work must keep TokenDance ID as identity provider and Hub Server as product session issuer.
3. Feishu/Lark work must treat Feishu as collaboration context, not AgentHub login.
4. Gateway calls must use TokenDance API keys only on trusted server/local runtime planes; browser UI and Feishu cards must not expose them.
5. Visible UI claims need screenshot evidence, not only CSS/token diffs.
6. Private server evidence belongs in `(部署服务器路径)`, not in AgentHub docs.

## Sync Checklist

- Update root docs when the system rule changes.
- Update `docs/security-risk-register.md` when the work changes risk posture.
- Update `api/openapi.yaml` / `api/events.md` when routes or events change.
- Update this file when a queue ID is added, completed, superseded, or its evidence changes.
- Update `../../docs/governance/scorecard-evidence.md` only when the proof source or missing proof changes.
