# Module Inventory

> Phase 1 inventory for `docs/repo-governance-real-e2e`, captured 2026-06-27.

## Summary

| Module | Responsibility | Dependencies | Files | Lines | Complexity | S.U.P.E.R Score |
|:--|:--|:--|--:|--:|:--|:--|
| `api` | OpenAPI and event contracts | Hub, Edge, shared clients | 5 | 8,355 | Medium | S🟢 U🟢 P🟢 E🟢 R🟡 |
| `app/shared` | Shared UI, transcript, workbench contracts, clients, mock/demo data | React, i18n, markdown, DOMPurify, consumers Desktop/Web/Mobile | 368 | 78,721 | High | S🟡 U🟡 P🟡 E🟢 R🟡 |
| `app/desktop` | Desktop renderer, Tauri host bridge, Local Edge/Hub adapters, Desktop E2E | Shared UI, Tauri, Edge, Hub | 437 | 95,657 | High | S🟡 U🟡 P🟡 E🟡 R🟡 |
| `app/web` | Web renderer, Hub-only adapter, Web E2E/Visual QA | Shared UI, Hub, browser storage | 181 | 38,545 | Medium | S🟡 U🟡 P🟡 E🟢 R🟡 |
| `app/mobile-rn` | Expo/React Native mobile client and QA scripts | RN-safe shared contracts, Expo, mock Hub | 105 | 22,703 | Medium | S🟡 U🟡 P🟡 E🟡 R🟡 |
| `edge-server` | Local execution server, runtime adapters, local persistence, Hub callbacks | Go stdlib, adapters, local store, optional Hub | 199 | 84,760 | High | S🟡 U🟢 P🟢 E🟡 R🟡 |
| `hub-server` | Cloud Hub, auth/session/IM/project/document/team/relay/audit | Go, Gin, GORM, PostgreSQL, Redis, WS | 432 | 429,328 | Critical | S🔴 U🟡 P🟡 E🟡 R🔴 |
| `scripts` | Verification, release, smoke, package, governance helpers | PowerShell, Bash, Go/Node toolchains | 80 | 22,305 | High | S🟡 U🟡 P🟡 E🟡 R🟡 |
| `docs` | Architecture, roadmap, governance, audits, archives | All modules | 171 | 54,543 | Critical | S🔴 U🟡 P🟡 E🟡 R🔴 |
| `.agents` | Project-level reusable skills | AGENTS whitelist | 9 | 651 | Low | S🟢 U🟢 P🟡 E🟢 R🟢 |
| `.github` | CI, release, readiness workflows | GitHub Actions, scripts | 12 | 2,155 | Medium | S🟢 U🟡 P🟡 E🟢 R🟡 |

## Module Details

### `api`

- **Responsibility**: Source-level OpenAPI/event contract surface.
- **Public API**: `openapi.yaml`, `events.md`, API README/conventions.
- **Internal Dependencies**: Consumed by Hub, Edge, Desktop/Web clients, tests.
- **External Dependencies**: YAML parser and client/tooling only.
- **Complexity Rating**: Medium.
- **Transformation Notes**: Keep as contract SSOT. Avoid duplicating route truth in roadmap tables unless links point back here.
- **S.U.P.E.R Assessment**:
  - **S**: Clear contract responsibility.
  - **U**: Downstream consumers depend on API, not vice versa.
  - **P**: Strongest port surface in the repo.
  - **E**: Environment-agnostic.
  - **R**: Replaceable if generated clients remain contract-compatible; current duplicate docs increase replacement cost.

### `app/shared`

- **Responsibility**: Shared UI, transcript normalization/rendering, workbench contracts, shared clients, i18n, mock/demo data.
- **Public API**: package exports in `app/shared/package.json`, including `./transcript`, `./workbench`, `./ui`, `./hubClient`, `./mock`.
- **Internal Dependencies**: Desktop/Web import it directly; Mobile imports RN-safe contracts.
- **External Dependencies**: React, react-markdown, remark-gfm, syntax highlighter, DOMPurify, xlsx/doc preview libraries.
- **Complexity Rating**: High.
- **Transformation Notes**: Chat flow defects should be fixed here when they are shared behavior. Debug/demo metadata must not leak into transcript components.
- **S.U.P.E.R Assessment**:
  - **S**: Partial. UI, contracts, mock/demo, clients, and document preview capabilities are broad.
  - **U**: Partial. Shared should be inward/pure, but app-specific assumptions can creep in.
  - **P**: Partial. Transcript/workbench ports exist, but data-mode/auth/execution axes need clearer contracts.
  - **E**: Good for renderer code; Mobile/RN safety still needs explicit checks.
  - **R**: Partial. Desktop/Web depend heavily on shared contracts, so breaking changes ripple.

### `app/desktop`

- **Responsibility**: Desktop renderer, Desktop platform adapter, Tauri host integration, Local Edge interaction, Desktop-specific tests.
- **Public API**: Tauri commands, Desktop app entry, package scripts, Playwright specs.
- **Internal Dependencies**: `app/shared`, `edge-server`, Hub client APIs, Tauri host.
- **External Dependencies**: Tauri, OS keyring, WebView2/Edge runtime, Playwright/Vitest.
- **Complexity Rating**: High.
- **Transformation Notes**: Separate renderer evidence from packaged Desktop evidence. Entry preflight health checks must not be counted as Demo workbench backend traffic.
- **S.U.P.E.R Assessment**:
  - **S**: Partial. Renderer, platform adapter, auth, Local Edge, and Tauri capabilities are bundled in one app.
  - **U**: Partial. Intended flow is UI -> adapter -> Edge/Hub/Tauri; this needs ongoing guard tests.
  - **P**: Partial. Tauri IPC and API schemas exist, but package/sidecar/icon acceptance is not one unified port.
  - **E**: Partial. Desktop is necessarily platform-aware; tests must name renderer vs package level.
  - **R**: Partial. Tauri host and Local Edge are replaceable only with explicit adapter boundaries.

### `app/web`

- **Responsibility**: Browser Hub workspace, Hub-only data access, Web E2E/Visual QA.
- **Public API**: Web app routes, Hub client, package scripts.
- **Internal Dependencies**: `app/shared`, Hub APIs.
- **External Dependencies**: Browser storage/session, Playwright/Vitest.
- **Complexity Rating**: Medium.
- **Transformation Notes**: Web must stay Hub-only; no Local Edge loopback in production path. Stubbed-Hub replay must stay honest.
- **S.U.P.E.R Assessment**:
  - **S**: Partial. Web shell, Hub client, preview fallback, and QA scripts coexist.
  - **U**: Partial. Boundary docs are clear, but tests must enforce no direct Edge calls.
  - **P**: Partial. Hub envelope handling is documented; mock contracts should remain production-shaped.
  - **E**: Good if Hub URL/session config is injected.
  - **R**: Partial. Shared dependency is healthy, but Web-only copies of route/surface metadata would regress replaceability.

### `app/mobile-rn`

- **Responsibility**: Mobile client, native readiness, visual QA, mock Hub validation.
- **Public API**: Expo app entry, verify scripts.
- **Internal Dependencies**: `@agenthub/shared` RN-safe contracts.
- **External Dependencies**: Expo, React Native, SecureStore, Playwright web preview.
- **Complexity Rating**: Medium.
- **Transformation Notes**: Version appears lower than repo/Desktop/Web (`0.4.1` vs `0.5.0`); check whether this is intentional before release docs claim unified version.
- **S.U.P.E.R Assessment**:
  - **S**: Partial. Mobile app and QA harness share the package.
  - **U**: Partial. Mobile should consume shared contracts without pulling web-only UI.
  - **P**: Partial. Deep link/auth/session contracts exist but should remain explicit.
  - **E**: Partial. Native platform assumptions are unavoidable; readiness scripts help.
  - **R**: Partial. Expo/RN replacement cost remains medium.

### `edge-server`

- **Responsibility**: Local execution, runtime adapters, local project/thread/run/artifact state, Hub callbacks.
- **Public API**: REST `/v1/*`, WebSocket events, runtime adapter interfaces, sidecar binary.
- **Internal Dependencies**: API contract, runtime adapters, local store, optional Hub sync.
- **External Dependencies**: Agent CLI binaries, SDK HTTP APIs, SQLite/file/memory storage, OS process APIs.
- **Complexity Rating**: High.
- **Transformation Notes**: Strong port shape around adapters and `RunEvent`; performance/leak acceptance should target lifecycle, store, adapter streaming, and callback goroutines.
- **S.U.P.E.R Assessment**:
  - **S**: Partial. Execution, storage, adapters, and Hub sync are large but internally layered.
  - **U**: Good. Runtime -> adapter -> EventStore -> UI is well documented.
  - **P**: Good. Adapter and event contracts are explicit.
  - **E**: Partial. CLI paths, environment variables, and local storage need strict config discipline.
  - **R**: Partial. Individual adapters are replaceable; the server as a whole is not cheap to swap.

### `hub-server`

- **Responsibility**: Cloud Hub API, auth/session, IM, contacts, documents, projects, teams, relay, audit, settings, devices.
- **Public API**: `/client/*`, `/web/*`, `/edge/*`, `/cloud/*`, WebSocket frame/event contracts.
- **Internal Dependencies**: PostgreSQL, Redis, TokenDance ID, Edge callbacks, shared event constants.
- **External Dependencies**: Gin, GORM, Redis, OAuth/OIDC, deployment stack.
- **Complexity Rating**: Critical.
- **Transformation Notes**: Largest module. Current roadmap lists critical/high findings around outbox goroutines, EventBus blocking, Redis TTL, scheduler cancellation, token storage, pprof, and ownership checks. Plan must avoid treating docs claims as fixed without current test evidence.
- **S.U.P.E.R Assessment**:
  - **S**: Violation. Many product domains in one server.
  - **U**: Partial. Handler/service/repository layers exist, but async/event/backpressure risks remain.
  - **P**: Partial. REST/WS contracts exist; route/status truth is duplicated in docs.
  - **E**: Partial. Strong env config surface, but deployment/live evidence must stay out of public docs.
  - **R**: Violation. Replacing subdomains can ripple through handlers, services, repositories, and docs.

### `scripts`

- **Responsibility**: Local/CI verification, package/readiness checks, smoke matrix, release gate, helper automation.
- **Public API**: `verify-*.ps1`, `load-test.sh`, package scripts invoking them.
- **Internal Dependencies**: Repo layout, workflows, package scripts, docs.
- **External Dependencies**: PowerShell, Bash, gh, Go, Node, Docker/Tauri toolchains.
- **Complexity Rating**: High.
- **Transformation Notes**: Useful gates exist, but some tests inspect implementation-like workflow strings. Keep only gates that protect real behavior or policy contracts.
- **S.U.P.E.R Assessment**:
  - **S**: Partial. Some scripts are focused; aggregate gates mix policy, release, and smoke concerns.
  - **U**: Partial. Scripts read workflows/docs; scripts should not become the primary truth source.
  - **P**: Partial. JSON manifests are good; ad hoc stdout parsing should not expand.
  - **E**: Partial. Windows-first commands are expected, but cross-platform CI exists.
  - **R**: Partial. Script replacement cost depends on how many docs/workflows hardcode it.

### `docs`

- **Responsibility**: Architecture, roadmap, governance, audits, references, archives.
- **Public API**: Developer/operator guidance.
- **Internal Dependencies**: All modules and workflows.
- **External Dependencies**: Cross-repo TokenDance docs and server SSOT.
- **Complexity Rating**: Critical.
- **Transformation Notes**: Docs currently mix active route facts, old ChatView phase state, audit findings, release checklists, implementation plans, and archives. This is the main governance cleanup target.
- **S.U.P.E.R Assessment**:
  - **S**: Violation. `docs/roadmap.md` is roadmap + current state + architecture + release checklist + verification appendix.
  - **U**: Partial. `AGENTS.md` says roadmap/architecture are current roots, but archive/process docs also carry active-looking instructions.
  - **P**: Partial. No single doc contract for evidence levels beyond the new skill.
  - **E**: Partial. Some docs include old phase dates/branch facts and possibly local/live assumptions.
  - **R**: Violation. Updating one fact often requires multiple docs.

### `.agents`

- **Responsibility**: Project-level SOP skills.
- **Public API**: `SKILL.md` files loaded by agents under `AGENTS.md` whitelist.
- **Internal Dependencies**: `AGENTS.md`, docs/workflows.
- **External Dependencies**: None required for archived skills.
- **Complexity Rating**: Low.
- **Transformation Notes**: Current active skill set is clean. Archived `ui-screenshot`, `dev-team`, `dev-team-codex` should remain read-only.
- **S.U.P.E.R Assessment**:
  - **S**: Good. Each active skill has a bounded purpose.
  - **U**: Good. AGENTS points to skills, skills do not override AGENTS.
  - **P**: Partial. Skill triggers are textual; governance still needs active/archived scan.
  - **E**: Good. No active skill should depend on private local paths.
  - **R**: Good. Stale skills can be archived without breaking active workflow.

### `.github`

- **Responsibility**: CI, release, package readiness, validation.
- **Public API**: GitHub Actions workflows.
- **Internal Dependencies**: scripts, package scripts, Go/Node modules.
- **External Dependencies**: GitHub Actions, pnpm, Go, Docker, Tauri toolchain.
- **Complexity Rating**: Medium.
- **Transformation Notes**: CI already has useful layered gates. It needs clearer mapping to acceptance claims and no silent downgrade of warning-only checks into release-ready claims.
- **S.U.P.E.R Assessment**:
  - **S**: Good at job level.
  - **U**: Partial. Workflows call scripts that inspect workflows; keep this policy loop narrow.
  - **P**: Partial. Artifacts/manifests exist but not every gate emits structured evidence.
  - **E**: Good for CI runners.
  - **R**: Partial. Workflow replacement cost is medium due to script/doc references.
