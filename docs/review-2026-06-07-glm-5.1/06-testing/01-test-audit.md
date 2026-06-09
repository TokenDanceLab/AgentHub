# 06 - Test Coverage & Quality Audit

> Date: 2026-06-07 | Auditor: test-auditor (read-only) | Branch: `feat/desktop-web-v4-clean-rebuild`

---

## 1. Test Coverage Overview

### 1.1 Go Backend Test Inventory

#### hub-server (25 src + 19 test in `service/`)

| Package | Source Files | Test Files | Ratio |
|---------|-------------|-----------|-------|
| `handler/` | 24 | 28 | 1.17x (over-covered, helpers included) |
| `service/` | 25 | 19 | 0.76x |
| `middleware/` | 12 | 14 | 1.17x |
| `model/` | 24 | 8 | 0.33x |
| `repository/` | 20 | 3 | 0.15x |
| `ws/` | 2 | 2 | 1.0x |
| `router/` | 1 | 1 | 1.0x |
| `jwtutil/` | 2 | 2 | 1.0x |
| `cache/` | 2 | 1 | 0.5x |
| `config/` | 2 | 1 | 0.5x |
| `errcode/` | 1 | 1 | 1.0x |
| `log/` | 1 | 1 | 1.0x |
| `metrics/` | 1 | 1 | 1.0x |
| `app/` | 1 | 1 | 1.0x |
| Integration (`tests/`) | - | 15 | end-to-end |

**Total hub-server tests: ~125 _test.go files**

#### edge-server

| Package | Source Files | Test Files | Ratio |
|---------|-------------|-----------|-------|
| `adapters/` | 16 | 12 | 0.75x |
| `lifecycle/` | 10 | 6 | 0.60x |
| `agents/` | 2 | 2 | 1.0x |
| `api/` | 3 | 3 | 1.0x |
| `events/` | 2 | 2 | 1.0x |
| `runnerctx/` | 4 | 3 | 0.75x |
| `store/` | 2 | 2 | 1.0x |
| Other (7 pkgs) | 9 | 7 | 0.78x |
| Integration (`tests/`) | - | 2 | end-to-end |

**Total edge-server tests: ~44 _test.go files**

#### Shared packages (`pkg/`)

| Package | Test Files |
|---------|-----------|
| `pkg/debug/` | 1 |
| `pkg/errcode/` | 1 |
| `pkg/reqlog/` | 1 |

### 1.2 TypeScript/React Test Inventory

#### app/desktop (55 test files)

All located in `desktop/src/__tests__/`. Coverage areas:
- API layer: `deviceId`, `hubAuth`, `hubTokenStorage`, `hubClient`, `hubWS`, `edgeClient`, `eventClient`
- Stores: `threadStore`, `uiStore`, `modelSettingsStore`, `notificationStore`, `topMenuState`
- Components: `AgentList`, `App.v4`, `AuthPage`, `DiffReviewPanel`, `DiffViewer`, `HomeDashboard`, `IMContactList`, `LoginForm`, `MentionPopover`, `NotificationBell`, `SearchDialog`, `TeamRunDock`, `Toast`, `WelcomeScreen`
- Logic: `chatMessages`, `context-breakdown`, `errors`, `fileReadCache`, `loopDetector`, `messageActions`, `runQueries`, `runStateMachine`, `threadQueries`, `threadRuntime`, `threadSelection`, `threadTitle`, `transport`, `tree`, `useComposerCore`, `useHealth`, `useHubIntegration`, `useMention`, `useRunners`
- Integration: `edge-integration`, `edge-real`
- Settings: `SummaryCard`, `ConfigurationSection`, `KeyboardSection`

#### app/shared (32 test files)

- `ui/`: 30 component tests (`Button`, `Card`, `Modal`, `Select`, `Tooltip`, `DeployCard`, etc.)
- `transcript/`: 5 normalizer tests (`normalizeEdgeEvents`, `normalizeHubMessages`, `normalizeHubRuntimeEvents`, `normalizeThreadItems`, `transcriptEvidence`)
- `composer/`: 3 tests (`attachments`, `composerReducer`, `mentions`)
- `workbench/`: 1 test (`AgentHubWorkbench`)
- Other: `apiClient`, `designTokens`, `diff`, `eventClient`, `hubClient`, `inspectorEvidence`, `surfaceMetadata`, `workbenchDataMode`, `workbenchState`, `createMockPlatform`, `chat.test`

#### app/web (17 test files)

- `api/`: `agentQueries`, `deviceId`, `executionTargetQueries`, `hubAuth`, `hubClient`, `hubTokenStorage`
- `platform/`: `useWebWorkbenchModel`, `webHubRealtime`, `webPlatform`
- `stores/`: `hubStore`
- `utils/`: `hubAdapters`
- Components: `App`, `CodeBlock`, `DiffViewer`, `MentionPopover`, `NotificationBell`, `WelcomeScreen`

#### app/mobile (5 test files)

- `App`, `BottomNav`, `ChatView`, `MobileRecoveryPanel`, `RunListView`, `ThreadListView`

---

## 2. Critical Path Gaps

### 2.1 hub-server service/ Untested Files

| File | Risk |
|------|------|
| `agent_custom.go` | Agent custom config -- medium |
| `agent_dispatch.go` | Agent task routing -- HIGH |
| `agent_edge_callback.go` | Edge callback processing -- HIGH |
| `audit.go` | Audit logging -- medium |
| `mcp_server.go` | MCP server management -- medium |
| `notification.go` | Push notification -- medium |
| `provider_binding.go` | Provider credentials -- medium |
| `relay.go` | Edge relay -- medium |
| `s3_client.go` | S3 storage -- medium |
| `skill.go` | Skill management -- low |

### 2.2 hub-server repository/ -- Nearly Untested

20 source files, only 3 test files (`repository_test.go`, `agent_team_test.go`, `agent_team_extra_test.go`).

**Untested repositories (all RED):**
- `agent.go`, `agent_profile.go`, `attachment.go`, `audit.go`, `db.go`, `device.go`, `execution_target.go`, `friendship.go`, `mcp_server.go`, `message.go`, `message_attachment.go`, `migrate.go`, `notification.go`, `provider_binding.go`, `refresh_token.go`, `session.go`, `session_member.go`, `skill.go`, `user.go`

**Assessment:** The repository layer is the thinnest abstraction over raw SQL and is the single biggest test gap. Since `repository_test.go` uses in-memory SQLite, the SQL itself is only partially validated (PostgreSQL-specific features like `RETURNING`, `ON CONFLICT` are not tested). The integration tests in `hub-server/tests/` exercise repositories through the full stack, but do not systematically cover edge cases.

### 2.3 hub-server model/ -- 16/24 Untested

Only `agent_profile`, `custom_agent`, `execution_target`, `mcp_server`, `model_test`, `provider_binding`, `skill` have tests. Core domain models like `message`, `session`, `user`, `device`, `workspace` lack validation tests.

### 2.4 New Workbench Components -- ZERO Tests

| Directory | TSX Files | Test Files | Status |
|-----------|----------|-----------|--------|
| `workbench/blocks/` | 16 | 0 | RED |
| `workbench/floating/` | 6 | 0 | RED |
| `workbench/inspector/` | 4 | 0 | RED |
| `workbench/pages/` | 7 | 0 | RED |

**33 new component files with zero tests.** These are the core v4 UI components including `AgentMessage`, `AgentTimeline`, `ThinkingBlock`, `ToolCardBlock`, `DiffCard`, `ContextMenu`, `PersonPanel`, `OverviewPanel`, `AgentsPage`, `ProjectsPage`, `SettingsPage`, etc.

### 2.5 Platform Adapter Coverage

| Adapter | Files | Tests |
|---------|-------|-------|
| Desktop `desktopPlatform.ts` (13KB) | 5 | 0 |
| Desktop `useDesktopWorkbenchModel.ts` | 1 | 0 |
| Desktop `desktopAttachments.ts` | 1 | 0 |
| Desktop `desktopPreview.ts` | 1 | 0 |
| Desktop `useDesktopEdgeEvents.ts` | 1 | 0 |
| Web `webPlatform.ts` (13KB) | 1 | 1 |
| Web `useWebWorkbenchModel.ts` | 1 | 1 |
| Web `webHubRealtime.ts` | 1 | 1 |
| Web `webPreview.ts` | 1 | 0 |

**Desktop platform layer is completely untested.** The 13KB `desktopPlatform.ts` is the core Tauri bridge -- zero test coverage.

---

## 3. Test Quality Assessment

### 3.1 Go Test Quality (5-file sample)

#### `service/agent_logic_test.go` -- GREEN

- Table-driven tests with named cases
- Tests both normal paths and edge cases (empty, whitespace, mixed case, unparseable JSON)
- Uses `assert.Equal` for clear failure messages
- Covers: `normalizeRuntimeAgentType`, `mapSenderType`, `extractMessageText`, `validateRunEventType`

#### `middleware/auth_test.go` -- GREEN

- Tests authentication middleware thoroughly: no header, wrong prefix, invalid token, expired token, TokenDance token without audience
- Uses real JWT generation (`jwtutil.GenerateAccessToken`) rather than hardcoded tokens
- Tests both success and failure paths
- Well-structured helper functions (`ginRequest`, `makeToken`, `makeExpiredToken`)

#### `handler/session_test.go` -- GREEN

- Uses function-field-based mock struct (`mockSessionService`) -- clean pattern
- Tests success, bad request, and error (not-friend) paths
- Asserts both HTTP status codes and response body structure
- Good use of `newGinCtx` helper for constructing test requests

#### `service/auth_test.go` -- YELLOW

- Uses `go-sqlmock` with `QueryMatcherFunc` using `strings.Contains` -- this is a loose SQL matcher that can match unintended queries, creating false positives
- Properly tests: invalid refresh token, revoked token, successful rotation
- Uses `miniredis` for real Redis behavior -- good
- **Risk:** The substring-based SQL matching (`strings.Contains`) may mask query regressions

#### `lifecycle/decision_loop_test.go` -- GREEN

- Tests step counting, phase transitions, max step enforcement, zero/negative config defaults
- Uses concrete test helpers (`captureEmitter`, `nopWriteCloser`, `makeRun`)
- Good coverage of state machine transitions

**Go quality summary:** Tests are generally well-structured with table-driven patterns, proper assertions, and both happy/sad path coverage. The main quality concern is the loose SQL matching in `go-sqlmock` usage.

### 3.2 TypeScript Test Quality (5-file sample)

#### `shared/ui/DeployCard.test.tsx` -- YELLOW

- Tests rendering for all states (pending, deployed, failed, building)
- Tests URL rendering, action buttons, default behavior
- **Limitation:** Uses `toBeDefined()` instead of more specific assertions like `toBeInTheDocument()`. Does not test click handlers or state transitions. Pure snapshot-style testing.

#### `shared/transcript/normalizeHubMessages.test.ts` -- GREEN

- Tests normal message projection with `toEqual` deep comparison
- Tests edge cases: recalled messages, empty content, system messages
- Good assertion quality -- verifies exact output structure

#### `desktop/__tests__/threadStore.test.ts` -- GREEN

- Tests state transitions: selectAgentThread, selectThread, pruneMissingThreads
- Tests persistence to localStorage
- Tests cleanup of stale bindings
- Good coverage of the Zustand store behavior

#### `shared/workbenchDataMode.test.ts` -- GREEN

- Uses `it.each` for parameterized testing
- Tests all connection states: loading, connected, disconnected, error, unavailable
- Tests catalog state derivation with `toMatchObject`
- Good coverage of data mode state machine

#### `shared/ui/Modal.test.tsx` -- GREEN

- Tests open/close, Escape key, backdrop click, content click propagation
- Uses both `fireEvent` and `userEvent` appropriately
- Tests body overflow side effects
- Good interaction testing beyond just rendering

**TS quality summary:** About 60% of tests are meaningful (assert behavior, state transitions, edge cases). About 40% are render-only tests that verify the component mounts without crashing but don't test interactions. The shared `ui/` component tests lean towards the weaker side (render-only), while the logic/state tests are strong.

---

## 4. Mock Strategy Analysis

### 4.1 Go Mock Patterns

| Pattern | Usage | Quality |
|---------|-------|---------|
| Function-field struct mocks | `handler/*_test.go` (21 instances) | GREEN -- clean, type-safe, per-test customization |
| `go-sqlmock` (SQL mocking) | `service/auth_test.go`, `service/agent_team_test.go`, etc. | YELLOW -- loose substring matching risks false positives |
| `miniredis` (in-memory Redis) | `service/auth_test.go`, `service/agent_control_test.go`, `service/oidc_test.go` | GREEN -- real Redis behavior without infrastructure |
| SQLite in-memory | `repository/repository_test.go` | YELLOW -- PostgreSQL SQL not fully validated on SQLite |
| Real DB (Postgres) | `tests/setup_test.go` (integration) | GREEN -- tests against real schema |

**Handler tests** use a clean pattern: define a mock struct with function fields that implement the service interface. Each test can customize mock behavior inline. This is the best mock pattern in the codebase.

**Service tests** use `go-sqlmock` with `strings.Contains` matching. This is weaker than exact matching because:
1. A query containing `"FROM users WHERE id ="` will match any query that happens to include that substring
2. If the code adds extra WHERE clauses, the test still passes even though behavior changed

**False positive risk in `agent_test.go`:** Multiple tests use `WillReturnResult(sqlmock.NewResult(0, 0))` which means "0 rows affected." If the code path changes to not execute the SQL at all, the mock expectation is still satisfied because it was never consumed.

### 4.2 TypeScript Mock Patterns

| Pattern | Usage | Quality |
|---------|-------|---------|
| `vi.fn()` (Vitest) | Desktop tests (27 usages) | GREEN -- standard, explicit |
| `globalThis.fetch = vi.fn()` | `shared/__tests__/setup.ts` | YELLOW -- global mock affects all tests |
| `createMockPlatform()` | `shared/platform/createMockPlatform.ts` | GREEN -- well-typed, captures calls |
| Zero `vi.mock()` in shared | 0 usages | GREEN -- shared tests use real implementations |
| `vi.mock()` in desktop | 27 usages across ~55 test files | YELLOW -- moderate, module-level mocking |

**`createMockPlatform`** is a well-designed test utility. It implements the full `AgentHubPlatform` interface, captures calls (`submittedIntents`, `openedEvidence`), and allows per-test seeding. This is the gold standard for the TS mock strategy.

**Desktop tests** use module-level `vi.mock()` calls which can be fragile if module paths change. However, at 27 mock calls across 55 test files, the ratio is reasonable.

**Shared tests** have zero `vi.mock()` usage, which means they test real implementations with real dependencies (except the global `fetch` mock). This is a strength -- shared logic tests are not coupled to mock setup.

---

## 5. E2E Testing

### 5.1 Coverage

| Suite | Files | Scope |
|-------|-------|-------|
| `app/e2e/` | `smoke.spec.ts` (3 tests) | Web app loads, title, no Vite error |
| `app/desktop/e2e/` | `health.spec.ts`, `events.spec.ts`, `runners.spec.ts` | Desktop status bar, edge online/offline |
| `app/web/` | `playwright.config.ts` (no test files found) | Config exists but no tests |
| `app/desktop/.tmp/` | 2 experimental configs | Agent scheduling, screenshots |

**Total E2E tests: ~8-10 across 4 spec files.**

### 5.2 E2E Quality Assessment

`app/e2e/smoke.spec.ts`: GREEN -- basic smoke tests (page load, title, root mount). Good as a CI gate.

`app/desktop/e2e/health.spec.ts`: YELLOW -- Uses conditional test skipping (`test.skip` based on Edge availability). This means:
- Tests are skipped unless Edge server is running
- In CI, these tests may always be skipped
- Good design for local development, poor for CI reliability

`app/desktop/e2e/test-utils.ts`: Simple utility with `isEdgeOnline()` check.

### 5.3 Playwright Configuration

`app/e2e/playwright.config.ts`:
- GREEN: Multi-browser (Chromium, Firefox)
- GREEN: CI-aware (retries: 2 in CI, trace on first retry)
- GREEN: Auto-starts dev server via `webServer` config
- YELLOW: No WebKit/Safari project
- YELLOW: No mobile viewport testing

`app/desktop/playwright.config.ts`: Separate config for desktop (Tauri) E2E.

---

## 6. Test Infrastructure

### 6.1 Go Test Utilities

| Utility | Location | Purpose |
|---------|----------|---------|
| `setupSQLite()` | `repository/repository_test.go` | In-memory SQLite for repository tests |
| `newMockDB()` | `service/auth_test.go` | go-sqlmock + GORM setup |
| `testCacheClient()` | `service/auth_test.go` | miniredis-backed cache |
| `newExecutorTestRun()` | `lifecycle/testutil_test.go` | Creates test project/thread/run in store |
| `nextEvent()` / `nextEventWithin()` | `lifecycle/testutil_test.go` | Channel read with timeout |
| `TestMain` setup | `hub-server/tests/setup_test.go` | Full server bootstrap with real Postgres |
| `CleanDB()` | `hub-server/tests/setup_test.go` | FK-safe table truncation |
| `CreateTestUser()` / `CreateTestSession()` | `hub-server/tests/helpers_test.go` | Test data factories |
| HTTP helpers | `hub-server/tests/setup_test.go` | `post`, `get`, `put`, `del`, `parse`, `extract` |

**hub-server integration tests** have excellent infrastructure:
- Full `TestMain` bootstrap with real Postgres + Redis
- FK-safe `cleanDBTables()` for isolation
- Helper functions for common operations (register, login, create session)
- API response parser with envelope support

**Missing:** No shared test fixtures or factories for unit tests. Each service test file sets up its own `newMockDB()` and `testCacheClient()`. The `newMockDB()` function is duplicated across test files.

### 6.2 TypeScript Test Utilities

| Utility | Location | Purpose |
|---------|----------|---------|
| `shared/__tests__/setup.ts` | Global `fetch` mock, re-exports RTL | jsdom environment setup |
| `createMockPlatform()` | `shared/platform/createMockPlatform.ts` | Full platform mock with call capture |
| `shared/mock.ts` | Shared mock data | Mock data seed |
| `shared/vitest.config.ts` | Coverage thresholds (60% lines/branches/functions) | Configuration |
| `desktop/e2e/test-utils.ts` | `isEdgeOnline()` check | E2E helper |

**Shared vitest config** sets 60% coverage thresholds. This is a reasonable floor but may not catch gaps in new code if the baseline includes well-tested utilities.

**Missing:** No shared component render helpers (e.g., `renderWithProviders`), no test factories for generating mock workbench state, no shared fixture files.

### 6.3 Test Database Strategy

| Layer | Strategy | Assessment |
|-------|----------|-----------|
| Repository unit tests | SQLite in-memory | YELLOW -- PostgreSQL-specific SQL not validated |
| Service unit tests | go-sqlmock (mock DB) | YELLOW -- loose matching, no real SQL execution |
| Integration tests | Real PostgreSQL + Redis | GREEN -- full stack with cleanDB isolation |

The three-tier approach is sound but has gaps:
1. SQLite cannot validate PostgreSQL-specific features (`RETURNING`, `ON CONFLICT`, JSONB operators)
2. go-sqlmock tests verify "did we call SQL?" but not "did the SQL work?"
3. Only the integration tests in `hub-server/tests/` exercise real SQL

---

## 7. Summary Matrix

| Area | Grade | Key Finding |
|------|-------|-------------|
| hub-server handler tests | GREEN | 24/24 handlers have tests, clean mock pattern |
| hub-server service tests | YELLOW | 15/25 services tested, critical gaps in dispatch/edge callback |
| hub-server repository tests | RED | 3/20 source files tested, 85% untested |
| hub-server model tests | YELLOW | 8/24 models tested |
| hub-server integration tests | GREEN | 15 test files, full stack with real DB |
| edge-server tests | GREEN | Well-distributed coverage across packages |
| Desktop platform tests | RED | 5/5 files untested, zero coverage |
| Web platform tests | GREEN | 3/5 files tested |
| Shared UI tests | YELLOW | 30 component tests, many render-only |
| Shared logic tests | GREEN | Strong assertion quality in state/normalizer tests |
| New workbench components | RED | 33 files, zero tests |
| E2E tests | YELLOW | Basic smoke coverage, no critical path E2E |
| Mock strategy (Go) | YELLOW | Clean handler mocks, loose SQL mocks |
| Mock strategy (TS) | GREEN | Well-typed createMockPlatform, moderate vi.mock usage |
| Test infrastructure | GREEN | Good integration setup, factories, helpers |
| Coverage thresholds | YELLOW | 60% floor exists but no enforcement for new code |

---

## 8. Recommendations

### Priority 1 -- Critical Path Tests

1. **Add tests for `workbench/blocks/`, `floating/`, `inspector/`, `pages/`** -- 33 new component files with zero tests. Start with `AgentMessage`, `ToolCardBlock`, `DiffCard`, `ContextMenu` as they are the most complex.

2. **Add tests for `service/agent_dispatch.go` and `service/agent_edge_callback.go`** -- These are core agent orchestration paths. Dispatching to the wrong agent or mishandling edge callbacks are high-severity bugs.

3. **Add desktop platform adapter tests** -- `desktopPlatform.ts` (13KB) is the Tauri bridge with zero tests. Use `createMockPlatform()` pattern or mock Tauri APIs.

### Priority 2 -- Repository Layer

4. **Expand repository test coverage** -- 17/20 repositories are untested. Consider:
   - Using `testcontainers-go` for real PostgreSQL in CI
   - Or expanding the SQLite approach with PostgreSQL-compatible SQL generation
   - At minimum, add tests for `message.go`, `session.go`, `user.go`

5. **Tighten go-sqlmock matchers** -- Replace `strings.Contains` matching with exact or regex-based matching in `service/auth_test.go` and `service/agent_team_test.go`.

6. **Extract shared test helpers** -- `newMockDB()` and `testCacheClient()` are duplicated across service test files. Extract to `internal/testutil/` package.

### Priority 3 -- Test Quality

7. **Upgrade render-only TS tests** -- Replace `toBeDefined()` assertions with `toBeInTheDocument()`, add interaction tests (click, keyboard), test state transitions.

8. **Add critical path E2E tests** -- Cover: login flow, create session, send message, agent dispatch. Current E2E only tests "app loads."

9. **Add E2E CI reliability** -- Desktop E2E tests skip when Edge is offline. Add a Docker-based Edge server for CI or mark these as a separate CI job.

10. **Enforce coverage gates for new code** -- Configure vitest/Go coverage to fail if new files have < 80% coverage (vs. the current 60% baseline for all code).
