# Real Foundation Hardening - Module Inventory

## Summary

| Module | Responsibility | Dependencies | Files | Lines | Complexity | S.U.P.E.R Score |
|:--|:--|:--|--:|--:|:--|:--|
| Shared ChatView | Render transcript items, cards, bubbles, markdown, auto-scroll | React, shared transcript, markdown UI | 29 | 6603 | High | S🟡 U🟢 P🟡 E🟢 R🟡 |
| Shared Transcript | Normalize Hub/Edge/runtime input to `TranscriptBlock[]` | shared events, diff helpers | 20 | 5412 | High | S🟢 U🟢 P🟢 E🟢 R🟡 |
| E2E Data Contract | Validate surface/data/auth/request boundary claims | demo dataMode | 2 | 477 | Medium | S🟢 U🟢 P🟢 E🟢 R🟢 |
| Desktop Renderer | Tauri/Vite shell, platform wiring, local edge health, UI app | shared, Tauri, React Query | 346 | 62424 | High | S🟡 U🟡 P🟡 E🟡 R🟡 |
| Web Renderer | Hub-facing shell, auth/session, workbench app | shared, Hub client, React Query | 162 | 32026 | High | S🟡 U🟡 P🟡 E🟡 R🟡 |
| Desktop/Web E2E | Browser behavior checks for chat flow and data boundaries | Playwright, shared contract | 8 | 2649 | Medium | S🟡 U🟢 P🟡 E🟢 R🟡 |
| Visual QA Scripts | Screenshot + DOM geometry acceptance | Playwright, app stubs | 3+ | 1600+ | Medium | S🟡 U🟢 P🟡 E🟡 R🟡 |
| Hub Server | Auth, IM, task/event API, routing, audit | Go, DB, Redis-like stores | 426 | 405896 | Critical | S🟡 U🟡 P🟡 E🟡 R🟡 |
| Edge Server | Local projects, run lifecycle, event store, adapters | Go, filesystem, process adapters | 195 | 75154 | Critical | S🟡 U🟡 P🟡 E🟡 R🟡 |
| API Contracts | REST/OpenAPI and WS event contract | YAML/docs | 5 | 7511 | Medium | S🟢 U🟢 P🟡 E🟢 R🟡 |
| Verification Scripts | Governance/evidence/readiness checks | PowerShell, shell | 29 | 6268 | Medium | S🟡 U🟢 P🟡 E🟡 R🟡 |

## Module Details

### Shared ChatView

- **Path**: `app/shared/src/chatview/`
- **Responsibility**: Convert normalized transcript items into the visible IM timeline: user bubbles, agent groups, cards, markdown, and scroll behavior.
- **Public API**: `blocksToTranscriptItems`, `ChatViewTranscript`, `Transcript`, `AgentGroup`, `RowItem`.
- **Internal Dependencies**: `app/shared/src/transcript/`, shared UI markdown and design tokens.
- **External Dependencies**: React, `react-markdown`, `remark-gfm`, syntax/markdown helpers.
- **Complexity Rating**: High.
- **Transformation Notes**: This is the most important UI contract boundary. Implementation already has card ordering and scroll tests; tasks should tighten behavior rather than fork components.
- **S.U.P.E.R Assessment**:
  - **S**: Partial. Rendering, grouping, card stack logic, metadata, and scroll behavior are close but still intertwined.
  - **U**: Good. It consumes `TranscriptItem[]` and does not reach into Hub/Edge.
  - **P**: Partial. `TranscriptBlock`/`TranscriptItem` types are explicit; visual QA manifests are less formal.
  - **E**: Good. Browser/runtime specific work is outside shared ChatView.
  - **R**: Partial. Renderer can be reused by Desktop/Web, but replacing card behavior requires careful shared tests.

### Shared Transcript

- **Path**: `app/shared/src/transcript/`
- **Responsibility**: Normalize Hub messages, Edge events, runtime events, ordering, evidence refs, and diagnostics into `TranscriptBlock[]`.
- **Public API**: `normalizeEdgeEventsToTranscript`, `normalizeHubMessagesToTranscript`, `normalizeHubRuntimeEventsToTranscript`, `normalizeThreadItemsToTranscript`, `orderTranscriptBlocks`, transcript types.
- **Internal Dependencies**: shared event/diff types.
- **External Dependencies**: none material for the core normalizer path.
- **Complexity Rating**: High.
- **Transformation Notes**: Strong candidate for contract-first fixes. The normalizer is the correct place to filter runtime diagnostics and preserve linear order before UI rendering.
- **S.U.P.E.R Assessment**:
  - **S**: Good. Normalization and ordering are separated by file.
  - **U**: Good. Data flows raw source -> normalized blocks.
  - **P**: Good. `TranscriptBlock` is the serializable internal port.
  - **E**: Good. Pure TypeScript tests can run without services.
  - **R**: Partial. Upstream source replacement is feasible, but Hub/Edge event shape drift still needs stronger golden fixtures.

### E2E Data Contract

- **Path**: `app/shared/src/testing/e2eDataModeContract.ts`
- **Responsibility**: Classify observed requests and validate scenario claims across surface, data source, auth/execution, and phase.
- **Public API**: `createE2EDataModeScenario`, `assertE2EDataModeScenario`, `buildE2EDataModeManifest`.
- **Internal Dependencies**: `app/shared/src/demo/dataMode.ts`.
- **Complexity Rating**: Medium.
- **Transformation Notes**: This is a clean port. Future E2E should import it rather than duplicate mode switch logic.
- **S.U.P.E.R Assessment**: All five principles are currently healthy.

### Desktop Renderer

- **Path**: `app/desktop/src/`
- **Responsibility**: Desktop app shell, adapter wiring, Tauri host bridge, Local Edge preflight, and shared workbench rendering.
- **Complexity Rating**: High.
- **Transformation Notes**: Desktop Vite evidence proves renderer behavior only. Packaged Tauri sidecar/sqlite/icon/installer must be separate.
- **S.U.P.E.R Assessment**:
  - **S**: Partial. Shell, settings, host integration, and local edge concerns share a large source tree.
  - **U**: Partial. Architecture says renderer must not execute raw CLI; tasks should verify this boundary where touched.
  - **P**: Partial. Platform adapter is the intended port; some UI tests still rely on app state setup.
  - **E**: Partial. Desktop has expected local environment dependencies.
  - **R**: Partial. Shared UI is replaceable; host/runtime wiring is costlier.

### Web Renderer

- **Path**: `app/web/src/`
- **Responsibility**: Web app shell, Hub session, Hub APIs, remote target routing, and shared workbench rendering.
- **Complexity Rating**: High.
- **Transformation Notes**: Web must remain Hub-only and must not silently fall back to mock in guarded Hub flows.
- **S.U.P.E.R Assessment**:
  - **S**: Partial. Auth/session, app shell, settings, and task wiring are broad.
  - **U**: Partial. Correct direction is Web -> Hub -> shared UI; boundary tests exist and should be expanded only where useful.
  - **P**: Partial. Hub stubs exist but need clearer evidence manifests.
  - **E**: Partial. Browser-safe constraints are clear; env/session setup is still test-sensitive.
  - **R**: Partial. Shared UI is replaceable; Hub adapter behavior needs stronger contracts.

### Desktop/Web E2E

- **Path**: `app/desktop/src/__e2e__/`, `app/web/src/__e2e__/`
- **Responsibility**: Real browser validation for chat flow, routing, boundary, and optimistic send.
- **Complexity Rating**: Medium.
- **Transformation Notes**: Existing specs are valuable. Avoid adding tests that only check constants or duplicate implementation switches.
- **S.U.P.E.R Assessment**:
  - **S**: Partial. Some specs mix behavior checks, boundary assertions, and stub setup.
  - **U**: Good. Browser drives app, app produces visible behavior and request logs.
  - **P**: Partial. Uses shared contract but lacks a single acceptance manifest format.
  - **E**: Good. Runs against local Vite surfaces.
  - **R**: Partial. Stub setup is reusable but not yet a shared harness.

### Visual QA Scripts

- **Path**: `app/desktop/scripts/manual-chat-flow-check.mjs`, `app/web/scripts/manual-chat-flow-check.mjs`, `app/web/scripts/visual-qa.mjs`
- **Responsibility**: Produce screenshots plus DOM geometry metrics for visual and interaction acceptance.
- **Complexity Rating**: Medium.
- **Transformation Notes**: Desktop/Web chat-flow scripts and broader Web visual QA are aligned on the `1440x810` desktop acceptance viewport by T1.2.
- **S.U.P.E.R Assessment**:
  - **S**: Partial. Scripts combine server startup, stubbing, actions, metrics, and report output.
  - **U**: Good. Inputs are URL/stubs; outputs are screenshots/JSON.
  - **P**: Partial. Reports are JSON but schema is informal.
  - **E**: Partial. Local Vite assumptions are expected but should be explicit.
  - **R**: Partial. Shared visual harness is not yet extracted.

### Hub Server, Edge Server, API Contracts

- **Paths**: `hub-server/`, `edge-server/`, `api/`
- **Responsibility**: Hub collaboration/auth/event APIs, local execution/event store/adapters, REST and WS contracts.
- **Complexity Rating**: Critical for Hub/Edge, Medium for `api/`.
- **Transformation Notes**: This SPEC should touch backend code only where front-end E2E reveals contract mismatch. Approved-real and packaged claims need explicit gates.
- **S.U.P.E.R Assessment**: Mixed partial across S/U/P/E/R because service scope is large and environment-bound, but API/event contracts provide the correct ports.

### Verification Scripts

- **Path**: `scripts/verify/`
- **Responsibility**: Enforce doc SSOT, project skill whitelist, CI gate shape, real E2E contract, and readiness claims.
- **Complexity Rating**: Medium.
- **Transformation Notes**: Add only contract checks with real protection value. Do not create root-level script wrappers.
- **S.U.P.E.R Assessment**:
  - **S**: Partial. Some checks are broad but categorized under `scripts/verify/`.
  - **U**: Good. Read-only checkers produce pass/fail.
  - **P**: Partial. Some output is human text; manifests should be more schema-like.
  - **E**: Partial. PowerShell is Windows-first but project operates on Windows.
  - **R**: Partial. Checkers are replaceable if contracts remain stable.
