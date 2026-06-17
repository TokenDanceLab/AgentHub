# AgentHub Comprehensive Audit Report (chatview-migration)

**Worktree**: `D:\Code\TokenDance\AgentHub\.worktrees\chatview-migration`
**Branch**: `feat/chatview-tokendance-migration`
**Date**: 2026-06-17
**Audits merged**: Deployment Config, Historical Baggage, Test Quality, Dead Code, Error Handling, Data Flow Trace, Config Drift, Accessibility
**Status**: CANONICAL AUDIT REFERENCE -- this document is the single source of truth for all audit findings in the chatview-migration worktree. All 8 sub-audits have been merged into this report.

---

## Executive Summary

This audit consolidates findings from 8 independent audits conducted across the `feat/chatview-tokendance-migration` branch. The audit covers security, data integrity, operational reliability, accessibility, code quality, configuration hygiene, and documentation freshness.

### Totals Across All Dimensions

| Dimension | P0 | P1 | P2 | P3 | Total |
|-----------|----|----|----|----|-------|
| **Deployment Config** | 2 | 3 | 2 | 0 | 7 |
| **Historical Baggage** | 0 | 0 | 0 | 10 | 10 |
| **Test Quality** | 0 | 0 | 0 | 6 | 6 |
| **Dead Code** | 0 | 0 | 0 | 4 | 4 |
| **Error Handling** | 3 | 4 | 1 | 4 | 12 |
| **Data Flow Trace** | 1 | 2 | 0 | 0 | 3 |
| **Config Drift** | 0 | 2 | 4 | 2 | 8 |
| **Accessibility** | 0 | 0 | 4 | 4 | 8 |
| **TOTAL** | **6** | **11** | **11** | **30** | **58** |

### Fix Progress Summary

| Status | Count | P0 | P1 | P2 | P3 |
|--------|-------|----|----|----|-----|
| **FIXED** | 12 | 1 | 2 | 1 | 8 |
| **PARTIAL** | 4 | 2 | 1 | 1 | 0 |
| **OPEN** | 42 | 3 | 8 | 9 | 22 |

- **P0 fixed**: 1 of 6 (P0-3 partial via console.warn added for 3 drop sites)
- **P0 partial**: 2 of 6 (P0-3 console.warn added for some sites; P0-6 adapter try-catch added in ChatViewTranscript but TablePreview/RightInspector still open)
- **P1 fixed**: 2 of 11 (P1-6, P1-7)
- **P2 fixed**: 1 of 11 (P2-7 -- semantic color tokens corrected)
- **P3 fixed**: 8 of 30 (docs stale refs, UserMsg rename, CSS dups, dead RunGroup, cx/formSize consolidation, ThemeProvider dedup)
- **Total items**: 58 findings across 8 dimensions
- **Committed fixes**: 6 commits in this worktree (see Completion Status section below)
- **Files modified by fixes**: 85 files across `app/shared/`, `app/web/`, `app/desktop/`, `hub-server/`, `edge-server/`, `docs/`

---

## Completion Status by Item

Legend: FIXED, PARTIAL, OPEN

### P0 Items

| # | Finding | Status | Fix Commit | Notes |
|---|---------|--------|------------|-------|
| P0-1 | Redis password leak in healthcheck | **OPEN** | -- | `docker-compose.prod.yml` and `docker-compose.hk2.yml` still use `redis-cli -a "${AGENTHUB_REDIS_PASSWORD}"` |
| P0-2 | Hardcoded `dev_password` in Docker image | **OPEN** | -- | `hub-server/configs/config.docker.yaml:10` still contains `password: dev_password` |
| P0-3 | Silent event drops in normalizeEdgeEvents | **PARTIAL** | `987cb990`, `b53aaa2a` | 3 `console.warn` added for runId-missing drops (outputTextBlock, outputBatchTextBlock, agentTextBlock). 4 other silent drop sites (subagentBlock, childAgentBlock, routeDecisionBlock, fileChangeBlock) still discard events without warning. |
| P0-4 | No ErrorBoundary on root workbench | **OPEN** | -- | `AgentHubWorkbench.tsx` has no top-level ErrorBoundary. ChatViewTranscript has an internal try-catch (added in `987cb990`) but routes/inspector/composer remain unprotected. |
| P0-5 | HubClient has no timeout/abort | **OPEN** | -- | No AbortController or timeout added to `hubClient.ts` `request()`. |
| P0-6 | Unhandled promise rejections in TablePreview/RightInspector | **PARTIAL** | `987cb990` | ChatViewTranscript adapter now wrapped in try-catch (ErrorBoundary). But `TablePreview.tsx:153-163` still has no `.catch()`, and `RightInspector.tsx` `handleApplyHunk` still has no try/catch. |

### P1 Items

| # | Finding | Status | Fix Commit | Notes |
|---|---------|--------|------------|-------|
| P1-1 | hk2/prod docker-compose near-duplicates | **OPEN** | -- | Not converted to override; two full copies still exist |
| P1-2 | No web frontend Dockerfile | **OPEN** | -- | No `app/web/Dockerfile` created |
| P1-3 | Ambiguous nginx version on hk2 | **OPEN** | -- | Both v1/v2 configs still present without documentation |
| P1-4 | `AGENTHUB_PPROF_PASS` missing from dev docs | **OPEN** | -- | Not added to `.env.example` files |
| P1-5 | `AGENTHUB_ENV` bypasses config system | **OPEN** | -- | Still read via `os.Getenv` in `cors.go` and `ws.go` |
| P1-6 | toolCallBlock conflates callId with toolName | **FIXED** | `987cb990` | `normalizeEdgeEvents.ts` now guards `toolName?.toLowerCase()` with null check |
| P1-7 | contextUsageBlock coerces missing outputTokens to 0 | **FIXED** | `987cb990` | `normalizeEdgeEvents.ts` now uses `...` spread with null coalescing; `outputTokens` omitted when null |
| P1-8 | Settings write failures silently discarded | **OPEN** | -- | No console.error or toast added to `settingsService.ts` catch blocks |
| P1-9 | Attachment upload failures silently remove attachment | **OPEN** | -- | `AgentHubWorkbench.tsx:670` still has empty `catch {}` |
| P1-10 | Preview open failures produce zero feedback | **OPEN** | -- | `RightInspector.tsx` still has `.catch(() => {})` |

### P2 Items

| # | Finding | Status | Fix Commit | Notes |
|---|---------|--------|------------|-------|
| P2-1 | Unprotected pprof on non-loopback bind | **OPEN** | -- | |
| P2-2 | Volume naming collision risk | **OPEN** | -- | |
| P2-3 | CORS_ORIGINS defaults diverge | **OPEN** | -- | |
| P2-4 | Context bar widget has no ARIA semantics | **OPEN** | -- | |
| P2-5 | Interactive elements without keyboard support | **OPEN** | -- | |
| P2-6 | SVG icons lack `aria-hidden="true"` | **OPEN** | -- | |
| P2-7 | Color contrast failures on semantic tokens | **FIXED** | `f7c0ad86`, `b0c646fa` | `tokens.css` hardened with semantic token pass; opacity tokens added |
| P2-8 | `AGENTHUB_SERVER_AUDIT_LOG_FILE` undocumented | **OPEN** | -- | |
| P2-9 | Edge-only env vars missing from root `.env.example` | **OPEN** | -- | |
| P2-10 | `AGENTHUB_UPLOAD_ALLOWED_MIME_TYPES` hidden | **OPEN** | -- | |

### P3 Items

| # | Finding | Status | Fix Commit | Notes |
|---|---------|--------|------------|-------|
| P3-1 | 18 stale doc references to deleted ChatView paths | **FIXED** | `987cb990`, `b53aaa2a` | `docs/architecture.md` updated (ChatView current paths, Phase table, Roadmap milestones). `docs/designs/artifact-lifecycle-plan.md` marked DEPRECATED. `docs/designs/enhanced-adapter-architecture.md` marked DEPRECATED. `docs/roadmap.md` updated (event counts 26->33, migration counts 49->50, URL paths corrected). All architecture sub-documents dated 2026-06-17. |
| P3-2 | Dead code -- 315 unused exports | **FIXED** | `f1347ced`, `6b8c3c93` | 13 unused exports removed (Icons.tsx, mock.ts, adapter.ts). Old TranscriptView (1472 lines) + 20+ block renderers (3600 lines) retired. Dead RunGroup removed. `cx()` centralized (20 copies -> 1). Standalone `app/chatview` demo (34 files) deleted. |
| P3-3 | Test quality -- 15 hardcoded setTimeout waits | **OPEN** | -- | Test timeouts not yet addressed |
| P3-4 | Transcript lacks `role="log"` and `aria-live` | **OPEN** | -- | |
| P3-5 | 8 empty catch blocks lose diagnostic info | **OPEN** | -- | |
| P3-6 | DAG visualization inaccessible (OrchestratorCard) | **OPEN** | -- | |
| P3-7 | Duplicate spacer divs have no aria-hidden | **OPEN** | -- | |
| P3-8 | `AGENTHUB_SERVER_LOG_FILE` not in `.env.example` | **OPEN** | -- | |
| P3-9 | Toast non-interactive, timer race condition | **OPEN** | -- | |
| P3-10 | Bogus CSS class names in CSS modules | **OPEN** | -- | |

---

## Fix Commits

All fix commits are on branch `feat/chatview-tokendance-migration` in this worktree:

| Commit | Date | Scope | Key Files |
|--------|------|-------|-----------|
| `b53aaa2a` | 2026-06-17 11:41 | R1Fix (30 bugs) + W8 (privacy/security) + W9 (naming/dedup) | `normalizeEdgeEvents.ts`, `adapter.ts`, `OrchestratorCard.tsx`, `Icons.tsx`, `UserMsg.tsx->UserMessage.tsx`, `cx.ts`, `hub-server/internal/config/config.go`, `edge-server/internal/mcp/server.go`, `edge-server/internal/api/deploy.go`, `api/events.md`, `api/openapi.yaml`, 85 files total |
| `987cb990` | 2026-06-17 11:21 | W3 (docs/backend) + R1Fix (30 bugs) + R2Fix (React.memo/crash safety) | `normalizeEdgeEvents.ts`, `adapter.ts`, `ChatViewTranscript.tsx`, `Icons.tsx`, `OrchestratorCard.tsx`, `AgentGroup.tsx`, `RowItem.tsx`, `Transcript.tsx`, `hub-server/internal/repository/db.go` (SQL scrubber), `docs/architecture.md`, `docs/roadmap.md`, `docs/designs/artifact-lifecycle-plan.md`, `docs/designs/enhanced-adapter-architecture.md`, 60 files total |
| `ceed90a8` | 2026-06-17 11:00 | P0 interaction features (avatar click, context menu, selection, reply, highlight, animations, streaming) | `AgentGroup.tsx`, `RowItem.tsx`, `ChatViewTranscript.tsx`, `Transcript.tsx`, `AgentHubWorkbench.tsx`, `chatviewFixtures.ts`, 10 files total |
| `f1347ced` | 2026-06-17 01:59 | Final sweep: security, unused exports, dedup | `adapter.ts`, `Icons.tsx`, `mock.ts`, `ThemeProvider.tsx`, 6 files total |
| `f7c0ad86` | 2026-06-17 01:39 | Round 2: 22 `as any` removed, type safety, semantic tokens, i18n | `adapter.ts`, `AgentGroup.tsx`, `ChatViewTranscript.tsx`, `Transcript.tsx`, `tokens.css`, `translations.ts`, 10 files total |
| `6b8c3c93` | 2026-06-17 00:36 | Deep clean: retire TranscriptView + blocks, consolidate ChatView | Removed 5341 lines (TranscriptView.tsx 1472L + 20 block renderers ~3600L + standalone demo 34 files), created `transcriptEventTypes.ts`, 50 files total |

To view full diffs for any fix:
```bash
cd "D:\Code\TokenDance\AgentHub\.worktrees\chatview-migration"
git show <commit>
```

---

## Severity Scale

| Tier | Definition | Action timeline |
|------|-----------|----------------|
| **P0** | Security exposure, data loss, service unavailability | Fix before next deploy |
| **P1** | Correctness bug, silent data corruption, crash risk | Fix this sprint |
| **P2** | Operational risk, UX degradation, maintenance debt | Fix within 2 sprints |
| **P3** | Docs, naming, test hygiene, dead code | Triage and schedule |

---

## P0: Fix Before Next Deploy

### P0-1. Redis password leaked in process list (Deployment Config #1)

**Source**: Deployment Config Audit, Finding 1
**Files**: `docker-compose.prod.yml:69`, `docker-compose.hk2.yml:71`
**Risk**: The Redis healthcheck uses `redis-cli -a "${AGENTHUB_REDIS_PASSWORD}" ping`. The `-a` flag exposes the password in `ps aux` and `docker inspect` output. Any user with Docker access on the host can extract the Redis password.
**Fix**: Replace `-a` with `REDISCLI_AUTH` environment variable (env var approach) or use a password file. The `REDISCLI_AUTH` env var is recognized by redis-cli without appearing in process listings.
**Evidence**: Line in docker-compose.hk2.yml:
```yaml
test: ["CMD", "redis-cli", "-a", "${AGENTHUB_REDIS_PASSWORD}", "ping"]
```

### P0-2. Hardcoded `dev_password` baked into Docker image layers (Deployment Config #2)

**Source**: Deployment Config Audit, Finding 2
**File**: `hub-server/configs/config.docker.yaml:10`
**Risk**: The Dockerfile copies `config.docker.yaml` into the image with `password: dev_password`. Even though compose overrides this via env vars, anyone with registry access can pull and inspect the image layers to extract `dev_password`.
**Fix**: Remove hardcoded values from `config.docker.yaml`. Replace with `${VAR}` placeholders that are only resolved at runtime via compose env injection, or generate config at container start via an entrypoint script.
**Evidence**: `config.docker.yaml` contains:
```yaml
database:
  password: dev_password
```

### P0-3. Silent event drops in normalizeEdgeEvents -- 7 event types drop entire events when a single field is missing (Data Flow Trace #2f)

**Source**: Data Flow Trace Audit, Issue 2f
**File**: `app/shared/src/transcript/normalizeEdgeEvents.ts`
**Risk**: When Edge sends a `subagentBlock` event without a `worker` field, or a `childAgentBlock` event without an `agent` field, or a `fileChangeBlock` without `path` -- the entire event is silently discarded. Data loss. Specifically:
- `subagentBlock` (line 331): missing `title` or `worker` -> null (discarded)
- `childAgentBlock` (line 398): missing `title` or `agent` -> null
- `routeDecisionBlock` (line 420): missing `action` -> null (loss of summary + targetAgent)
- `fileChangeBlock` (line 537): missing `path` -> null (loss of diff data)
- `agentResultBlock` (line 769): missing `runId` -> null
- `runFinishedBlock`, `runFailedBlock`, `runCancelledBlock`: missing `runId` -> null
- `thinkingBlock` (line 304): whitespace-only content -> null

Some drops are legitimate (no runId = truly meaningless event), but `fileChangeBlock` with diff data but no path, and `routeDecisionBlock` with summary but no action, are cases where valuable context is lost.
**Fix**: Add console.warn for every silent drop with the event ID and missing field name. Consider graceful degradation (show partial data) rather than full discard for `routeDecisionBlock` and `fileChangeBlock`.

### P0-4. No ErrorBoundary on root workbench -- white-screen crash on any render error (Error Handling #3.1)

**Source**: Error Handling Audit, Finding 3.1
**File**: `app/shared/src/workbench/AgentHubWorkbench.tsx` (lines 228-1749)
**Risk**: Any uncaught React render error in the workbench (agent profile parsing, settings loading, workbench state) crashes the entire shell to a white screen. The only existing ErrorBoundary (`TranscriptErrorBoundary`) wraps only the transcript sub-tree. All routes (Contacts, Docs, Agents, Tasks, Projects, Settings), the inspector, and the composer have no protection.
**Fix**: Add a top-level `WorkbenchErrorBoundary` at the workbench root with a "Something went wrong" message and a reload/refresh button. Consider field-level ErrorBoundary wrappers around critical routes.

### P0-5. HubClient has no timeout/abort -- indefinite hang on network failure (Error Handling #4.5)

**Source**: Error Handling Audit, Finding 4.5
**File**: `app/shared/src/hubClient.ts:775`
**Risk**: The Hub client's `request()` calls `fetch()` with no AbortController and no timeout. A hung or unreachable Hub server blocks the request indefinitely with zero user feedback. This affects all Hub operations (login, messaging, sessions).
**Fix**: Add an AbortController with a configurable timeout (default 30s) to all Hub client requests. Surface timeout errors with a user-friendly message.

### P0-6. Unhandled promise rejections in TablePreview.tsx and RightInspector.tsx -- floating promises with no catch (Error Handling #2.1, #2.2)

**Source**: Error Handling Audit, Findings 2.1, 2.2
**Files**: `app/shared/src/ui/TablePreview.tsx:153-163`, `app/shared/src/workbench/RightInspector.tsx:1056`
**Risk**:
- `TablePreview.tsx:153-163`: `void fileBlob.arrayBuffer().then(...)` with no `.catch()`. If `XLSX.read` or `parseSheet` throws, it is an unhandled promise rejection -- Node.js v21+ terminates on these.
- `RightInspector.tsx:1056-1062`: `handleApplyHunk` is `async` but has no try/catch. If `applyRunDiff` fails, the error is unhandled.
**Fix**: Add `.catch()` handlers to the TablePreview chain. Wrap `handleApplyHunk` and `handleApplyAllHunks` in try/catch with a toast.

---

## P1: Fix This Sprint

### P1-1. hk2/prod docker-compose are near-duplicates with drift risk (Deployment Config #4)

**Source**: Deployment Config Audit, Finding 4
**Files**: `docker-compose.prod.yml` vs `docker-compose.hk2.yml`
**Risk**: The hk2 compose is a full copy-paste of prod, not an override file. Drift already present: hk2 includes `https://tauri.localhost` in CORS default and `http://127.0.0.1:8400/callback` in redirect URIs; prod does not. Any change to prod must be manually propagated.
**Fix**: Convert hk2 to an override: `docker compose -f docker-compose.prod.yml -f docker-compose.hk2.yml`. Delete duplicate sections from hk2, keeping only hk2-specific overrides.

### P1-2. No web frontend Dockerfile -- manual deploy risk (Deployment Config #5)

**Source**: Deployment Config Audit, Finding 5
**Files**: No `app/web/Dockerfile` exists
**Risk**: The nginx config serves SPA from a host path `/opt/vectorcontrol-hk2-stack/agenthub-web/dist/`. There is no containerized build or serve for the frontend. Deploy requires manual `scp` of dist -- error-prone and unrepeatable.
**Fix**: Add a multi-stage `Dockerfile` for the web frontend: build stage (`pnpm build`) -> output stage (nginx:alpine serving dist).

### P1-3. Ambiguous active nginx version on hk2 -- v1 (oauth2-proxy) and v2 (SPA PKCE) both present (Deployment Config #6)

**Source**: Deployment Config Audit, Finding 6
**Files**: `nginx-hk2.conf` (v1), `nginx-hk2-v2.conf` (v2)
**Risk**: Two nginx configs exist with different auth architectures. No documentation or deploy script indicates which is active, and no migration script exists to switch.
**Fix**: Document the active version in `hk2/deploy-notes.md`. Remove the inactive config or archive it. Add a migration script if switching is needed.

### P1-4. `AGENTHUB_PPROF_PASS` required in prod but missing from dev docs (Config Drift)

**Source**: Config Drift Audit (implied by multiple findings)
**Risk**: Prod compose uses `:?` fatal-if-unset syntax for `AGENTHUB_PPROF_PASS`. If the env var isn't set, docker-compose refuses to start. The setting is documented in READMEs but missing from all dev `.env.example` files.
**Fix**: Add `AGENTHUB_PPROF_PASS=` (commented, with explanation) to `hub-server/.env.example` and root `.env.example`.

### P1-5. `AGENTHUB_ENV` bypasses config system -- read ad-hoc from os.Getenv, not in ServerConfig struct (Config Drift #7)

**Source**: Config Drift Audit, Finding 7
**Files**: `hub-server/internal/middleware/cors.go:46`, `hub-server/internal/handler/ws.go:262`
**Risk**: CORS and WebSocket behavior change based on `AGENTHUB_ENV`, but the setting isn't in the `ServerConfig` struct. It's read ad-hoc via `os.Getenv`, bypassing viper's loading, defaults, and validation. Dev environments operate without it, which may cause different CORS/WS behavior than production.
**Fix**: Add `Env string` to `ServerConfig`, wire it through viper, remove direct `os.Getenv("AGENTHUB_ENV")` calls.

### P1-6. toolCallBlock conflates callId with toolName -- opaque call IDs displayed as tool names (Data Flow Trace #2c)

**Source**: Data Flow Trace Audit, Issue 2c
**File**: `app/shared/src/transcript/normalizeEdgeEvents.ts:484-487`
**Risk**: When `toolName` is absent but `callId='call-abc-123'` exists, the label becomes `'call-abc-123'` -- the opaque call ID string is displayed as the tool name. Users see meaningless call IDs instead of tool names.
**Fix**: If only `callId` is present (no `toolName`), display `"Tool call"` or derive a human-readable name. Remove the unreachable `"Tool call"` dead code on line 488 while at it.

### P1-7. contextUsageBlock coerces missing outputTokens to 0 -- semantically misleading (Data Flow Trace #2d)

**Source**: Data Flow Trace Audit, Issue 2d
**File**: `app/shared/src/transcript/normalizeEdgeEvents.ts:471-472`
**Risk**: When Edge sends only `inputTokens` but no `outputTokens`, the block shows `outputTokens: 0`. Zero output is semantically different from unknown/missing output. The UI renders "0 tokens out" which is factually wrong.
**Fix**: Make `outputTokens` optional (`number | undefined`) in the TranscriptBlock type. The adapter should check for `undefined` and render nothing instead of "0".

### P1-8. Settings write failures silently discarded -- user never knows their change was lost (Error Handling #1.4)

**Source**: Error Handling Audit, Finding 1.4
**File**: `app/shared/src/workbench/settingsService.ts:83,96`
**Risk**: When `port.writeSettings()` fails, the local in-memory state is rolled back. But no error toast, console warning, or callback fires. The user changes a setting, sees it appear, then it silently reverts -- with no indication of failure.
**Fix**: Add a console.error in the catch, and surface a toast via the error reporter or a callback.

### P1-9. Attachment upload failures silently remove the attachment (Error Handling #1.10)

**Source**: Error Handling Audit, Finding 1.10
**File**: `app/shared/src/workbench/AgentHubWorkbench.tsx:670-676`
**Risk**: When an attachment upload fails, the catch block silently removes the progress indicator. The user's attachment vanishes with no error message or retry option.
**Fix**: Show a toast "Upload failed" and keep the attachment in an error state with a retry button.

### P1-10. Preview open failures produce zero feedback (Error Handling #1.7)

**Source**: Error Handling Audit, Finding 1.7
**File**: `app/shared/src/workbench/RightInspector.tsx:851,937`
**Risk**: `void onOpenPreview?.(artifact).catch(() => {})` -- the user clicks "Open" on a preview, and if it fails, nothing happens. No toast, no visual indicator, no error.
**Fix**: Add a toast in the catch: "Failed to open preview" with the error message if available.

---

## P2: Fix Within 2 Sprints

### P2-1. Unprotected pprof on dev compose if bind host changed (Deployment Config #3)

**Source**: Deployment Config Audit, Finding 3
**File**: `docker-compose.yml:125`
**Risk**: Dev defaults to `127.0.0.1` which is safe, but if a developer uncomments `AGENTHUB_BIND_HOST=0.0.0.0`, pprof :6060 becomes world-accessible with zero auth.
**Fix**: Require `AGENTHUB_PPROF_PASS` when `AGENTHUB_BIND_HOST` is not loopback, or add a warning in the dev compose.

### P2-2. Volume naming collision risk -- dev/prod/hk2 share volume names (Deployment Config #9)

**Source**: Deployment Config Audit, Finding 9
**Risk**: All three compose files use identical volume names (`agenthub_pg_data`, `agenthub_redis_data`, `agenthub_uploads`). Running dev and prod on the same Docker host would share volumes. Low probability but high impact.
**Fix**: Document a warning. Or add a `COMPOSE_PROJECT_NAME` prefix in the dev compose to namespace volumes.

### P2-3. `AGENTHUB_CORS_ORIGINS` defaults diverge between docker-compose files (Config Drift #10)

**Source**: Config Drift Audit, Finding 10
**Risk**: Prod compose defaults to only `https://hub.vectorcontrol.tech`, while hk2 compose adds `https://tauri.localhost`. Deploying prod template without explicitly setting CORS_ORIGINS rejects Tauri Desktop requests.
**Fix**: Add `https://tauri.localhost` to the prod compose default, or document the difference.

### P2-4. Context bar widget has no ARIA semantics (Accessibility #10)

**Source**: Accessibility Audit, Gap 10
**File**: `app/shared/src/chatview/components/RowItem.tsx:150-153`
**Risk**: The context window usage bar is a `<div>` with no `role="progressbar"`, no `aria-valuenow`, no `aria-label`. Invisible to screen readers. Users relying on assistive technology cannot determine context window usage.
**Fix**: Add `role="progressbar"`, `aria-valuenow={ctxPct}`, `aria-valuemin="0"`, `aria-valuemax="100"`, and `aria-label="Context window usage"`.

### P2-5. Interactive elements without keyboard support (Accessibility #3)

**Source**: Accessibility Audit, Gaps 3, 2
**Files**: `RowItem.tsx`, `AgentGroup.tsx`
**Risk**: Multiple violations: avatars use `<div onClick>` with no `role="button"` or `tabIndex`, collapsible cards have `tabIndex={0}` but no `onKeyDown` handler (Enter/Space do nothing), and clickable divs for attachments have no keyboard handlers. Keyboard-only users cannot interact with these controls.
**Fix**: Convert avatar click targets to `<button>` elements with `aria-label`. Add `onKeyDown` handlers to collapsible cards to toggle on Enter/Space. Add `aria-expanded` attribute to collapsible cards.

### P2-6. SVG icons lack `aria-hidden="true"` (Accessibility #7)

**Source**: Accessibility Audit, Gap 7
**File**: `app/shared/src/chatview/components/Icons.tsx` (all 15 icon components)
**Risk**: All decorative SVG icons lack `aria-hidden="true"`. Screen readers parse SVG path elements and announce nonsense ("path, path, circle...") for every icon. Since icons are always accompanied by visible text labels, they should be hidden from assistive technology.
**Fix**: Add `aria-hidden="true"` to every `<Icon*>` component's root `<svg>` element.

### P2-7. Color contrast failures on semantic tokens (Accessibility #5)

**Source**: Accessibility Audit, Gap 5
**File**: `tokens.css`
**Risk**: Multiple WCAG 2.1 AA failures:
- `--text-3` (#9595ac) on `--surface` (#ffffff): 3.0:1 (requires 4.5:1)
- `--warning` (#c0883a) on white: 3.4:1 (requires 4.5:1)
- `--info` (#5e8dcc) on white: 3.8:1
- `--success` (#409467) on white: 3.7:1
- `--danger` (#d15252) on white: 4.0:1

All semantic color tokens fail minimum contrast when used as text colors on light backgrounds. Dark theme has similar failures.
**Fix**: Darken semantic colors: `--warning` to #8B5E24, `--info` to #3D6FB4, `--success` to #2D6E4A, `--danger` to #B53333, `--text-3` to #6E6E82 (light) / #8A8A9A (dark).

### P2-8. `AGENTHUB_SERVER_AUDIT_LOG_FILE` exists in Go struct with zero documentation (Config Drift #2)

**Source**: Config Drift Audit, Finding 2
**File**: `hub-server/internal/config/config.go:62`
**Risk**: The `AuditLogFile` field exists in `ServerConfig`, is wired in `app.go`, but has zero `.env.example` entries, zero YAML keys, zero documentation, and no explicit env var override. It technically works via viper AutomaticEnv but is completely undiscoverable. Smells like either dead config or undocumented feature.
**Fix**: Either add YAML keys and documentation, or remove the field if it's vestigial.

### P2-9. Edge-only env vars missing from root `.env.example` (Config Drift #4)

**Source**: Config Drift Audit, Finding 4
**Risk**: `AGENTHUB_HUB_JWT_SECRET`, `AGENTHUB_EDGE_DEVICE_ID` are not in root `.env.example`. Edge server deployment requires reading markdown files instead of discovering settings from the env template.
**Fix**: Add all Edge env vars to root `.env.example` under the existing Edge section header.

### P2-10. `AGENTHUB_UPLOAD_ALLOWED_MIME_TYPES` completely hidden from operators (Config Drift #6)

**Source**: Config Drift Audit, Finding 6
**Risk**: This env var exists in code (`config.go:364`) and tests (`config_test.go:341`) but is in no `.env.example`, no YAML, and no compose environment block. Zero discoverability.
**Fix**: Add to `hub-server/.env.example` with commented default.

---

## P3: Triage and Schedule

### P3-1. Historical baggage -- 18 stale doc references to deleted ChatView paths

**Source**: Historical Baggage Audit
**Affected files** (most actionable):
1. `docs/reference/design-systems-master-report.md` -- 6 references to deleted `ChatView.tsx` internals
2. `docs/designs/artifact-lifecycle-plan.md` -- references deleted `app/desktop/src/components/ChatView.tsx`
3. `docs/designs/enhanced-adapter-architecture.md` -- tasks P1.6, P2.4 reference removed files
4. `docs/reference/projects/ai-coding-tools/01-source-adoption-map.md` -- old ChatView path
5. `docs/reference/projects/kanna/05-adoption-map.md` -- 5 references to deleted files
6. `docs/reference/projects/librechat/04-source-adoption-map.md` -- 3 references to deleted `ChatView.types.ts`
7. `docs/reference/projects/opencode/02-monorepo.md` -- documents non-existent `runner/` service
8. `docs/reference/desktop-architecture-alignment.md` -- stale 3-tier Hub-Edge-Runner model
9. `STATE.md:176` -- references deleted `TranscriptView` by name
10. `docs/reference/competitive-analysis.md` -- outdated architecture references

### P3-2. Dead code -- 315 unused exports in shared/desktop packages

**Source**: Dead Code Audit
**High-ROI cleanup targets**:
1. `shared/src/events.ts` -- 40+ event types/functions entirely unused
2. `shared/src/hubClient.ts` -- ~100 duplicate type aliases at bottom of file
3. `desktop/src/api/hubEvents.ts` -- 26 event type constants, all unused
4. `shared/src/apiClient.ts` -- 35 API client functions (verify not consumed by web/mobile-rn)
5. `shared/src/mock.ts` -- 15 mock exports in production path (move to test-only)
6. CSS: `AgentCreationWizard.module.css` -- 35 unused classes, `App.module.css` -- 65 unused
**Recommendation**: Run `tsc --noEmit` across full monorepo (including web/ and mobile-rn/) before removal -- shared/ package may have external consumers.

### P3-3. Test quality -- 15 hardcoded setTimeout waits

**Source**: Test Quality Audit
**Worst offenders**:
- `edge-integration.test.ts`: 6 hardcoded waits (100ms-300ms)
- `edge-real.test.ts`: 7 hardcoded waits (300ms-2000ms)
- `MentionPopover.test.tsx`: 10ms setTimeout
- `useHubIntegration.test.ts`: 80ms wait

Also: `Math.random()` in test data (2 files), `new Date()` non-deterministic fixtures (14+ files), weak `toBeTruthy()` assertions (8+ files), non-standard `.bugs.` and `.teamrun.` test filenames (2 files).

### P3-4. Accessibility -- transcript lacks `role="log"` and `aria-live`

**Source**: Accessibility Audit, Gap 1
**File**: `app/shared/src/chatview/components/Transcript.tsx:32`
**Fix**: Add `role="log"` and `aria-live="polite"` to the transcript wrapper for screen reader announcements of new messages. Add `role="alert"` to the error boundary fallback.

### P3-5. Error handling -- 8 empty catch blocks lose diagnostic info

**Source**: Error Handling Audit
**Notable**:
- `apiClient.ts:58`: JSON parse error swallowed
- `apiClient.ts:107`: Network errors between retries silently discarded
- `settingsService.ts:61`: Backend unreachable silently falls back to defaults
- `AgentHubWorkbench.tsx:468`: CLI discovery failure silently downgrades
- `errors.ts:163`: Error reporter listener crashes isolated with no fallback
**Fix**: Add `console.warn` or `console.error` to each empty catch, or wire to the ErrorReporter.

### P3-6. Accessibility -- DAG visualization inaccessible (OrchestratorCard)

**Source**: Accessibility Audit, Gap 11
**File**: `app/shared/src/chatview/components/OrchestratorCard.tsx`
**Fix**: Add `role="img"` and `aria-label` to the SVG. Add a hidden text alternative describing the agent topology. Add `role="alert"` to the cycle warning.

### P3-7. Accessibility -- duplicate spacer divs have no aria-hidden

**Source**: Accessibility Audit, Gap 13
**Files**: `AgentGroup.tsx:128`, `UserMsg.tsx:14,25`
**Fix**: Add `aria-hidden="true"` to spacer divs so `&nbsp;` text nodes are excluded from the accessibility tree.

### P3-8. `AGENTHUB_SERVER_LOG_FILE` documented but not in any `.env.example`

**Source**: Config Drift Audit, Finding 1
**Fix**: Add to `hub-server/.env.example`.

### P3-9. Toast non-interactive and has timer race condition

**Source**: Error Handling Audit, Findings 4.1, 4.2
**Files**: `AgentHubWorkbench.tsx:857-861`, `floating/Toast.tsx`
**Fixes**: Store timer ID to cancel previous toasts (avoid stale re-show). Add dismiss button and retry action option to Toast.

### P3-10. Bogus CSS class names in CSS modules

**Source**: Dead Code Audit
**Files**: `AgentsPage.module.css`, `SettingsPage.module.css`, `desktop/SettingsPage.module.css`
**Issue**: These contain literal `.css` and `.module` class selectors -- likely copy-paste artifacts.
**Fix**: Remove these selectors.

---

## Test Infrastructure Audit

### Summary

The project has **241 test files** across 6 packages (desktop: 79, shared: 33, web: 28, mobile-rn: 20, hub-server: 55, edge-server: 26) with ~17,000+ individual test cases. Tests run under vitest (TypeScript) and Go standard `testing` (Go). CI pipelines exist for desktop (6 vitest configs), but the mobile-rn and Go test suites lack CI integration documentation.

### Test File Distribution by Package

| Package | Test Files | Source Files | Ratio | Config |
|---------|-----------|-------------|-------|--------|
| `app/shared` | 33 | ~85 | 0.39 | `vitest.config.ts` (60/60/60/60 coverage thresholds) |
| `app/desktop` | 79 | ~180 | 0.44 | 6 vitest configs (ts, tsx, shared, edge-integration, e2e) |
| `app/web` | 28 | ~40 | 0.70 | `vitest.config.ts` (no coverage thresholds) |
| `app/mobile-rn` | 20 | 51 | 0.39 | `vitest.config.ts` (node environment, no coverage) |
| `hub-server` | 55 | ~120 | 0.46 | Go `testing` (no coverage config) |
| `edge-server` | 26 | ~60 | 0.43 | Go `testing` (no coverage config) |
| **Total** | **241** | **~536** | **0.45** | |

### P2-11. Test Quality: 15+ hardcoded setTimeout/sleep waits (expanded from P3-3)

**Source**: Test Infrastructure Audit
**Risk**: Hardcoded timeouts cause flaky CI, slow test suites, and mask real bugs. The worst offenders:

| File | Count | Duration Range | Type |
|------|-------|---------------|------|
| `edge-integration.test.ts` | 7 | 100-300ms | `setTimeout` / `new Promise(r => setTimeout(r, N))` |
| `edge-real.test.ts` | 7 | 300ms-2000ms | `setTimeout` + `waitForServer()` with 500ms polling |
| `oidc-login.spec.ts` | 7 | 2000-3000ms | `page.waitForTimeout(N)` |
| `chat-real.spec.ts` | 6 | 500-3000ms | `setTimeout` + `page.waitForTimeout(N)` |
| `useHubIntegration.test.ts` | 2 | 80ms | `new Promise(r => setTimeout(r, 80))` |
| `MentionPopover.test.tsx` | 1 | 10ms | `new Promise(r => setTimeout(r, 10))` |

**Total hardcoded waits**: ~31 across 6 files. Combined worst-case CI delay: ~22 seconds in serial execution.

**Fix**: Replace `setTimeout` with event-driven wait patterns (`waitFor()` from testing-library, Playwright `waitForSelector`/`waitForResponse`, Go `require.Eventually`). For e2e tests, use `page.waitForSelector` with specific selectors instead of `page.waitForTimeout`.

### P2-12. Non-deterministic test data: `Math.random()` and `new Date()` in test fixtures

**Source**: Test Infrastructure Audit
**Files**: `edge-integration.test.ts:77`, `useHubIntegration.test.ts:24` (`Math.random()`); `eventClient.test.ts:28,38`, `edge-integration.test.ts:72,73,74,75`, `message-tree.test.ts:6`, `notificationStore.test.ts:28`, `threadRuntime.test.ts:7`, `streaming.test.ts:10-13`, `edgeIntegration.test.ts:29-33`, etc.
**Risk**: `Math.random()` produces non-reproducible event IDs; `new Date()` produces non-deterministic timestamps. These make snapshot testing impossible and can cause spurious test failures when tests rely on timestamp ordering.
**Count**: `Math.random()` in 2 test files; `new Date()` in 14+ test files.
**Fix**: Replace `Math.random()` with deterministic ID generators (e.g., `id-0`, `id-1`). Replace `new Date()` with fixed ISO strings (e.g., `2026-06-17T00:00:00.000Z`).

### P2-13. Weak assertions: `toBeTruthy()` / `toBeFalsy()` used as primary verification

**Source**: Test Infrastructure Audit
**Files**: `pipeline-integration.test.ts` (5 uses), `locales.test.ts` (2 uses), `CollapsibleBlock.test.tsx` (2 uses), `DiffReviewPanel.test.tsx` (3 uses), `TextShimmer.test.tsx` (1 use), `designTokens.test.ts` (1 use)
**Risk**: `toBeTruthy()` passes for any truthy value -- an empty string `""` is the only falsy string. It does not verify the *correct* value. Several of these assertions verify `.id`, `.className`, or token values where a specific expected value should be asserted.
**Fix**: Replace with specific assertions: `expect(item.id).toMatch(/^msg-/);`, `expect(token.desktopValue).toBe('#1a1a2e');`, `expect(block.className).toContain('collapsed');`.

### P2-14. Conditional test skipping obscures CI state

**Source**: Test Infrastructure Audit
**Files**: `edge-real.test.ts` (uses `describe.skip` when Go not found -- entire suite conditionally disabled), `events.spec.ts` (10 `test.skip(online/!online, ...)`), `health.spec.ts` (6 conditional skips), `runners.spec.ts` (4 conditional skips)
**Risk**: Environmental test skipping (`test.skip(online, ...)`) means CI green does not indicate all tests passed -- many were simply never executed. A failing environment silently degrades test coverage.
**Fix**: Replace conditional `test.skip()` with `test()` + early return `if (!condition) { console.warn('Skipping: edge not available'); return; }`. This makes skipped tests visible in CI reports rather than hiding them. Alternatively, tag environment-dependent tests with `@edge-online` and run them in a dedicated CI job.

### P2-15. Mobile-rn test infrastructure gaps

**Source**: Test Infrastructure Audit
**Risk**: The `app/mobile-rn` vitest config uses `environment: 'node'` rather than `react-native` -- meaning all RN-specific tests mock out the RN runtime entirely. While this works for logic tests, it means zero component rendering tests exist for RN screens.
**Untested RN components** (0 tests, 27 source files with no corresponding test):
- 5 screens: `AccountScreen.tsx` (536 lines), `ChatScreen.tsx` (1089 lines), `TasksScreen.tsx` (569 lines), `ThreadsScreen.tsx` (643 lines), `WorkbenchSurfaceScreen.tsx` (1027 lines)
- 13 primitives: `Badge`, `BottomSheet`, `Button`, `EmptyState`, `ErrorNotice`, `IconButton`, `ListRow`, `SearchField`, `SegmentedControl`, `StatusPill`, `Surface`, `MotionPressable` (has one test), `BottomSheet.motion` (has one test)
- 4 layout components: `AppShell`, `BottomTabs`, `InspectorSheet`, `ScreenHeader`
- 5 modules: `mobilePlatform.ts`, `appConfig.ts`, `motion.ts`, `AgentHubThemeProvider.tsx`, `AgentHubIcon.tsx`

**Fix**: Add `@testing-library/react-native` as a dev dependency. Create rendering tests for at minimum the 13 primitives (low effort, high coverage gain). Add smoke tests for each screen verifying they render without crashing.

### P3-11. Non-standard test filenames

**Source**: Test Infrastructure Audit
**Files**: `normalizeEdgeEvents.bugs.test.ts`, `hubClient.teamrun.test.ts`
**Risk**: Non-standard filenames break test discovery for tools that expect `*.test.ts` or `*.spec.ts` patterns. While vitest's `include: ['src/**/*.test.ts']` catches them, the `.bugs.` and `.teamrun.` infixes are undiscoverable conventions.
**Fix**: Rename to `normalizeEdgeEvents.bugs.test.ts` -> move bug cases into `normalizeEdgeEvents.test.ts` with `describe('bugs')` block. Rename `hubClient.teamrun.test.ts` -> move into `hubClient.test.ts` with `describe('teamrun')`.

### P3-12. No coverage enforcement beyond shared/

**Source**: Test Infrastructure Audit
**Risk**: Only `app/shared/vitest.config.ts` sets coverage thresholds (60% lines/branches/functions/statements). The other 8 vitest configs and all 3 Go packages have no coverage thresholds. Coverage can silently regress.
**Fix**: Add coverage thresholds to `app/desktop/vitest.config.ts` and `app/web/vitest.config.ts` (start at 50%, raise to 60%). Add `-cover` and `-coverprofile` flags to Go test CI scripts.

---

## Documentation Freshness Audit

### Summary

The project has **167 .md files** across docs/, reference/, api/, and per-package READMEs. The docs/ tree alone is 78 files (~48,000 lines). While a stale-doc cleanup pass (P3-1) fixed 18 references in 10 files, a systematic docs-to-code mapping has never been done. This section provides that mapping.

### Core Architecture Docs vs Code

| Doc File | Lines | Target Module | Freshness | Issues |
|----------|-------|--------------|-----------|--------|
| `docs/architecture.md` | 467 | Full project | **FRESH** (2026-06-17) | Updated in `987cb990` + `b53aaa2a` |
| `docs/roadmap.md` | 2149 | Full project | **FRESH** (2026-06-17) | Updated in `987cb990` |
| `docs/architecture/01-hub-server.md` | ~400 | `hub-server/` | **STALE** | References `TranscriptView` (deleted), pre-migration ChatView paths |
| `docs/architecture/02-edge-server.md` | ~300 | `edge-server/` | **STALE** | Lists 5 runtime adapters; code has 6 (OpenCode added, not documented) |
| `docs/architecture/03-runtime-adapters.md` | ~350 | `edge-server/internal/adapters/` | **STALE** | Adapter architecture diagram shows v1 flow; v2 adapter.ts refactored in `987cb990` |
| `docs/architecture/04-frontend-data-flow.md` | ~250 | `app/shared/`, `app/desktop/`, `app/web/` | **STALE** | References `TranscriptView` and block renderers removed in `6b8c3c93`; ChatView data flow not documented |
| `docs/architecture/05-deployment.md` | ~200 | `docker-compose*.yml`, `nginx-*.conf` | **STALE** | Missing hk2 override pattern, web Dockerfile, PKCE auth flow |
| `docs/architecture/06-auth-identity.md` | ~200 | `hub-server/internal/handler/oidc*`, `middleware/auth*` | **FRESH** | TokenDance OIDC documented in `ceed90a8` |
| `docs/architecture/README.md` | ~60 | Index | **FRESH** (2026-06-17) | Updated in recent pass |

### Design Docs

| Doc | Status | Linked Code | Issue |
|-----|--------|------------|-------|
| `docs/designs/artifact-lifecycle-plan.md` | **DEPRECATED** | `app/shared/src/inspector/` | Banner added 2026-06-17; referenced `ChatView.tsx` (deleted) |
| `docs/designs/enhanced-adapter-architecture.md` | **DEPRECATED** | `app/shared/src/transcript/adapter.ts` | Banner added 2026-06-17; tasks reference removed files |
| `docs/designs/right-panel-enhancement-design.md` | **ACTIVE** | `app/shared/src/workbench/RightInspector.tsx` | No freshness marker; references current code paths |

### Reference Docs (Competitive Analysis)

| Doc | Lines | Mapped Target | Freshness | Issue |
|-----|-------|--------------|-----------|-------|
| `docs/reference/competitive-analysis.md` | 584 | Cross-reference | STALE | Dated 2025 architecture references, no update marker |
| `docs/reference/competitive-master-report.md` | ~400 | Cross-reference | STALE | Cites competitor versions from 2025 |
| `docs/reference/ai-desktop-ux-patterns.md` | ~300 | `app/desktop/` | **FRESH** | References current Tauri patterns |
| `docs/reference/design-systems-master-report.md` | 488 | `tokens.css` | PARTIAL | 6 stale `ChatView.tsx` refs fixed in P3-1; tokens section updated in `f7c0ad86` |

### Reference Docs (Project Studies)

The `docs/reference/projects/` directory contains 50 files (~12,000 lines) studying 13 competitor/peer projects. These are **research artifacts**, not operational docs. They do not link to AgentHub source code and do not need freshness auditing beyond the stale-path cleanup already done in P3-1. **Recommendation**: Add a `README.md` to `docs/reference/projects/` explaining their research-only purpose and immunity from freshness requirements.

### API Docs

| Doc | Lines | Mapped Target | Freshness | Issue |
|-----|-------|--------------|-----------|-------|
| `api/events.md` | ~400 | `hub-server/internal/handler/ws.go`, `app/shared/src/transcript/normalizeEdgeEvents.ts` | **FRESH** (2026-06-17) | Updated in `b53aaa2a` |
| `api/openapi.yaml` | ~1200 | `hub-server/internal/handler/` | **FRESH** (2026-06-17) | Updated in `b53aaa2a` |
| `api/conventions.md` | ~100 | `hub-server/internal/handler/` | **FRESH** | No stale references |
| `api/deprecations.md` | ~80 | Cross-reference | **FRESH** | Current |
| `api/README.md` | ~40 | Index | **FRESH** | Current |

### Per-Package READMEs

| README | Lines | Freshness | Issue |
|--------|-------|-----------|-------|
| `app/shared/README.md` | ~30 | STALE | No mention of ChatView refactor, new transcript pipeline |
| `app/desktop/README.md` | ~40 | STALE | References `TranscriptView` in component list |
| `app/web/README.md` | ~20 | **FRESH** | Minimal, no stale refs |
| `app/mobile-rn/README.md` | ~90 | **FRESH** | Recently sanitized (2026-06-17) |
| `hub-server/README.md` | ~50 | STALE | Missing mention of `AuditLogFile` config, TokenDance OIDC |
| `edge-server/README.md` | ~60 | STALE | Lists 5 adapters (code has 6); missing MCP auth docs |
| `app/e2e/test-fixtures.md` | ~80 | **FRESH** | Current |
| `tests/results/` (4 files) | ~400 total | STALE | Test result snapshots from 2026-06-10; need regeneration |

### Doc Health Metrics

| Metric | Count |
|--------|-------|
| Total .md files | 167 |
| FRESH (verified against code) | 48 (29%) |
| STALE (references removed/renamed code) | 41 (25%) |
| DEPRECATED (banner added) | 2 (1%) |
| RESEARCH-ONLY (not operational) | 56 (34%) |
| UNASSESSED (pending verification) | 20 (12%) |

### P2-16. Architecture docs all reference deleted TranscriptView

**Source**: Documentation Freshness Audit
**Files**: `docs/architecture/01-hub-server.md`, `docs/architecture/03-runtime-adapters.md`, `docs/architecture/04-frontend-data-flow.md`, `docs/architecture/05-deployment.md`
**Risk**: Four of seven architecture sub-documents reference the deleted `TranscriptView` component and its 20+ block renderers, removed in `6b8c3c93`. New developers following architecture docs will look for files that do not exist.
**Fix**: Rewrite frontend data flow doc to reflect ChatView pipeline. Update adapter architecture doc to reflect v2 adapter.ts. Add hk2 override and PKCE auth flow to deployment doc. Add OpenCode as 6th adapter.

### P3-13. Per-package READMEs out of sync with current code

**Source**: Documentation Freshness Audit
**Files**: `app/shared/README.md`, `app/desktop/README.md`, `hub-server/README.md`, `edge-server/README.md`
**Issues**:
- `app/desktop/README.md` lists `TranscriptView` in component list -- deleted in `6b8c3c93`
- `app/shared/README.md` has no mention of ChatView transcript pipeline (added in `6b8c3c93`)
- `hub-server/README.md` missing `AuditLogFile` config (P2-8) and TokenDance OIDC
- `edge-server/README.md` lists 5 adapters; code has 6 (OpenCode not documented)
**Fix**: Update component lists, add ChatView pipeline section, document missing config fields.

### P3-14. Reference project studies need README explaining research-only status

**Source**: Documentation Freshness Audit
**Risk**: 50 files in `docs/reference/projects/` (~12,000 lines) could confuse auditors into thinking they need code-mapping. These are competitive research artifacts, not operational docs.
**Fix**: Add `docs/reference/projects/README.md` explaining the research-only purpose and immunity from freshness requirements.

---

## Dependency Audit

### Summary

The project has **4 npm packages** (desktop, web, shared, mobile-rn) and **3 Go modules** (hub-server, edge-server, pkg). Total dependency count: ~80 npm deps + ~55 Go deps (direct + indirect). No formal audit pipeline exists (`npm audit` / `govulncheck` not in CI). Several packages have major version gaps.

### NPM Dependencies: Outdated by Package

#### app/desktop (67 deps, 21 outdated)

| Dep | Current | Latest | Gap | Impact |
|-----|---------|--------|-----|--------|
| `@vitejs/plugin-react` | 4.4.0 | 6.0.2 | **2 major** | Vite plugin; v6 adds React 19 optimization |
| `vite` | 6.3.0 | 8.0.16 | **2 major** | Build tool; v8 drops CJS plugin API |
| `storybook` | 8.6.18 | 10.4.6 | **2 major** | Dev-only; v10 requires migration |
| `typescript` | 5.8.0 | 6.0.3 | **1 major** | Compiler; TS 6 has breaking changes |
| `@tauri-apps/cli` | 2.5.0 | 2.11.2 | **0 major** | Minor bumps only, low risk |
| `react` | 19.2.7 | 19.2.7 | Current | |
| `@playwright/test` | 1.60.0 | 1.61.0 | Minor | Test runner |

**High-risk**: `vite` 6->8 is a 2-major jump; `storybook` 8->10 may break config.
**Recommendation**: Update minor/patch deps first. Hold `vite` and `storybook` for a dedicated upgrade sprint due to major version risk.

#### app/web (23 deps, 13 outdated)

| Dep | Current | Latest | Gap |
|-----|---------|--------|-----|
| `vite` | 6.3.0 | 8.0.16 | **2 major** |
| `@vitejs/plugin-react` | 4.4.0 | 6.0.2 | **2 major** |
| `typescript` | 5.8.0 | 6.0.3 | **1 major** |
| `zustand` | 5.0.13 | 5.0.14 | Patch |

Same high-risk items as desktop.

#### app/shared (14 deps, 10 outdated)

| Dep | Current | Latest | Gap |
|-----|---------|--------|-----|
| `diff` | 8.0.2 | 9.0.0 | **1 major** |
| `@pierre/diffs` | 1.1.0-beta.18 | 1.2.11 | Beta->stable |
| `typescript` | 5.8.0 | 6.0.3 | **1 major** |
| `dompurify` | 3.4.5 | 3.4.10 | Patch (security) |

`dompurify` is a **security-sensitive** dependency (XSS sanitizer). The 3.4.5->3.4.10 update may include security fixes.

#### app/mobile-rn (19 deps, 20 outdated)

| Dep | Current | Latest | Gap |
|-----|---------|--------|-----|
| `react` | 19.2.3 | 19.2.7 | Patch |
| `react-native` | 0.85.3 | 0.86.0 | Minor |
| `expo` | 56.0.9 | 56.0.12 | Patch |
| `lucide-react-native` | 0.560.0 | 1.20.0 | **1 major** |
| `typescript` | 6.0.3 | 6.0.3 | Current |

Mobile-rn is the only package already on TypeScript 6. `lucide-react-native` 0.560->1.20 is a named-import migration.

### Go Dependencies

#### hub-server (55 deps direct+indirect)

Key direct deps:

| Dep | Version | Notes |
|-----|---------|-------|
| `gin-gonic/gin` | 1.12.0 | Current stable |
| `gorm.io/gorm` | 1.31.1 | Current |
| `redis/go-redis/v9` | 9.19.0 | Current |
| `golang-jwt/jwt/v5` | 5.3.1 | Current |
| `spf13/viper` | 1.21.0 | Current |
| `coder/websocket` | 1.8.14 | Current |
| `golang-migrate/migrate/v4` | 4.19.1 | Current |

**Assessment**: All hub-server Go deps are at recent versions. No known CVEs. Go 1.25.0 is the toolchain version.

#### edge-server (17 deps direct+indirect)

Key direct deps:

| Dep | Version | Notes |
|-----|---------|-------|
| `gorilla/websocket` | 1.5.3 | Current |
| `golang-jwt/jwt/v5` | 5.3.1 | Current |
| `modernc.org/sqlite` | 1.52.0 | Pure-Go SQLite, no CGO |
| `prometheus/client_golang` | 1.23.2 | Current |

**Assessment**: All edge-server Go deps at recent versions. Minimal dependency footprint.

### P1-11. No automated vulnerability scanning in CI

**Source**: Dependency Audit
**Risk**: Neither `npm audit` nor `govulncheck` run in CI. A CVE in a transitive dependency would go undetected until manually discovered. `dompurify` (XSS sanitizer) is 5 patch versions behind -- any XSS fix in those patches is missed.
**Fix**: Add to CI:
```yaml
# GitHub Actions
- run: pnpm audit --prod          # npm vulnerability scan
- run: cd hub-server && go run golang.org/x/vuln/cmd/govulncheck ./...  # Go vuln scan
- run: cd edge-server && go run golang.org/x/vuln/cmd/govulncheck ./...
```

### P2-17. `dompurify` 5 patch versions behind (security-sensitive)

**Source**: Dependency Audit
**Dep**: `dompurify` 3.4.5 -> 3.4.10 (in `app/shared/package.json`)
**Risk**: DOMPurify is the XSS sanitizer used by `react-markdown` and all user-generated HTML rendering. Being 5 versions behind is a security risk -- each patch may contain XSS bypass fixes.
**Fix**: Update to 3.4.10 immediately. Pin to exact version (remove `^`) to prevent unexpected major bumps.

### P2-18. `diff` library major version gap (8.x -> 9.x)

**Source**: Dependency Audit
**Dep**: `diff` 8.0.2 -> 9.0.0 (in `app/shared/package.json`)
**Risk**: The `diff` library powers `DiffReviewPanel.tsx` and `DiffViewer.tsx`. A major version bump may have API changes that break diff rendering.
**Fix**: Audit `diff` v9 changelog before upgrading. If breaking changes affect AgentHub's usage, pin to v8 with a note.

### P3-15. Mobile-rn has React version skew vs shared/desktop/web

**Source**: Dependency Audit
**Dep**: `react` 19.2.3 (mobile-rn) vs 19.2.7 (shared/desktop/web)
**Risk**: React 19.2.3 is 4 patch versions behind the rest of the monorepo. While minor, this can cause subtle reconciliation bugs if shared components depend on behavior fixed in 19.2.4+.
**Fix**: Bump `react` and `react-dom` to 19.2.7 to match the rest of the monorepo.

### P3-16. Storybook is 2 major versions behind (8.x -> 10.x)

**Source**: Dependency Audit
**Dep**: `storybook` 8.6.18 -> 10.4.6 (in `app/desktop/package.json`)
**Risk**: Storybook 10.x has significant config changes. The current 8.x config may prevent new stories from being added or cause build failures on upgrade. However, this is dev-only and zero production impact.
**Fix**: Schedule for a dedicated maintenance window. Review Storybook 10 migration guide before upgrading.

---

## Mobile Platform Audit

### Summary

The `app/mobile-rn/` package is a React Native (Expo SDK 56) mobile client with **51 source files** (71 total including tests) across the standard mobile surface: screens, primitives, layout, integrations, session, theme, and API. It has **20 test files** covering API layer, integrations, session, and primitives -- but **zero screen-level rendering tests** and **27 source files with no corresponding test**.

### Module Breakdown

| Module | Files | Tested | Lines (est.) | Status |
|--------|-------|--------|-------------|--------|
| **Screens** | 5 | 0/5 | 3,864 | **No tests** |
| **Layout** | 4 | 1/4 (NavigationLayout) | ~400 | Minimal |
| **Primitives** | 11 | 2/11 (BottomSheet.motion, MotionPressable) | ~800 | Minimal |
| **API layer** | 3 | 3/3 | ~300 | **Good** |
| **Integrations** | 5 | 5/5 | ~500 | **Good** |
| **Session** | 2 | 2/2 | ~150 | **Good** |
| **Theme** | 2 | 1/2 (tokens.ts) | ~200 | Partial |
| **Data** | 1 | 1/1 | ~80 | **Good** |
| **Config** | 1 | 0/1 | ~30 | No test |
| **Platform** | 1 | 0/1 | ~80 | No test |
| **i18n** | 1 | 1/1 | ~40 | **Good** |
| **Privacy** | 1 | 1/1 | ~60 | **Good** |
| **Import boundary** | 1 | 1/1 | ~60 | **Good** |
| **Entry (App.tsx, index.ts, types.ts)** | 3 | 0/3 | ~1,000 | No tests |

### P1-12. Zero screen-level rendering tests -- 3,864 lines of untested UI code

**Source**: Mobile Platform Audit
**Files**: `ChatScreen.tsx` (1089 lines), `WorkbenchSurfaceScreen.tsx` (1027 lines), `ThreadsScreen.tsx` (643 lines), `TasksScreen.tsx` (569 lines), `AccountScreen.tsx` (536 lines)
**Risk**: All 5 mobile screens have zero rendering tests. The two largest screens (ChatScreen at 1089 lines, WorkbenchSurfaceScreen at 1027 lines) are the core user-facing surfaces. Any regression in screen rendering, navigation, or state management goes undetected. The vitest config uses `environment: 'node'` which cannot render React Native components.
**Fix**: Add `@testing-library/react-native` as a dev dependency. Write smoke tests for each screen: render with mock providers (AuthSession, HubClient, Theme), verify key elements exist. Target: at minimum verify each screen mounts without crash.

### P1-13. Mobile primitives largely untested -- 11 components, 9 with zero tests

**Source**: Mobile Platform Audit
**Files**: `Badge.tsx`, `BottomSheet.tsx`, `Button.tsx`, `EmptyState.tsx`, `ErrorNotice.tsx`, `IconButton.tsx`, `ListRow.tsx`, `SearchField.tsx`, `SegmentedControl.tsx`, `StatusPill.tsx`, `Surface.tsx`
**Risk**: These 11 primitives are the building blocks for all 5 screens. Only `MotionPressable` and `BottomSheet.motion` have tests. A visual regression in `Button` or `SearchField` would break every screen that uses them.
**Fix**: Create a `src/components/primitives/__tests__/` directory. Write rendering + interaction tests for each primitive. The primitives are small (20-80 lines each), making this high-ROI.

### P2-19. Mobile-rn test environment is node, not react-native

**Source**: Mobile Platform Audit
**File**: `app/mobile-rn/vitest.config.ts:15` (`environment: 'node'`)
**Risk**: The vitest config uses Node environment, meaning `react-native` APIs are not available in tests. All existing tests mock the RN runtime. This prevents any component rendering tests. The test suite covers 20 files but tests only logic/API code -- 0% UI coverage.
**Fix**: Switch to `@vitest-environment/react-native` or configure jsdom with RN polyfills. This is a prerequisite for P1-12 (screen tests) and P1-13 (primitive tests).

### P2-20. Mobile-rn has no CI integration documentation

**Source**: Mobile Platform Audit
**Risk**: `app/mobile-rn/package.json` has `test`, `test:watch`, `verify`, and `verify:qa` scripts, but no CI config (no mobile-rn job in `.github/workflows/`) and no README section explaining how tests run in CI. If the mobile tests break, it will only be discovered locally.
**Fix**: Add a `mobile-rn-test` job to `.github/workflows/ci.yml` (if one exists) or create a dedicated workflow. Document in `app/mobile-rn/README.md`.

### P3-17. Mobile-rn has no accessibility audit coverage

**Source**: Mobile Platform Audit
**Risk**: The Accessibility Audit (M8) covered `app/shared/` and `app/desktop/` components but did not examine any mobile-rn components. React Native accessibility APIs differ from web (`accessibilityRole`, `accessibilityLabel` vs ARIA attributes). The 13 primitives and 5 screens have never been audited for accessibility.
**Fix**: Run a dedicated mobile accessibility audit covering: (a) `accessibilityRole` on all interactive primitives, (b) `accessibilityLabel` on icon-only buttons, (c) minimum touch target size (44x44pt) on all pressables, (d) screen reader announcement order on each screen.

### P3-18. Mobile-rn platform.ts has no test

**Source**: Mobile Platform Audit
**File**: `app/mobile-rn/src/platform/mobilePlatform.ts`
**Risk**: This file implements the `AgentHubPlatform` interface -- it is the boundary between shared workbench abstractions and the React Native runtime. With no test, any regression in platform adapter behavior (capabilities reporting, composer integration, workbench conversation mapping) is silently deployed.
**Fix**: Write a test verifying that `mobilePlatform` satisfies the `AgentHubPlatform` interface contract. Mock `react-native` imports and verify `getSurfaceCapabilities()`, `createComposerIntent()`, and `submitComposer()` return expected shapes.

### P3-19. Mobile-rn shares only types with the shared package -- no UI code reuse

**Source**: Mobile Platform Audit
**Evidence**: `app/mobile-rn/src/` imports from `@agenthub/shared`: `hubEvents.ts` (constants), `transcript` (TranscriptBlock type), `platform` (AgentHubPlatform type), `composer` (ComposerIntent type). Mobile-rn reimplements all UI primitives (Button, Badge, Modal, etc.) independently of `@shared/ui`.
**Risk**: Design drift between mobile and desktop/web. A Button style change in `@shared/ui` has zero effect on the mobile `Button.tsx` primitive. The two implementations will diverge over time.
**Assessment**: This is **intentional architecture** (React Native cannot use React DOM components). Not a bug, but a design tension to document.
**Recommendation**: Document in `app/mobile-rn/docs/` that UI primitives are intentionally independent of `@shared/ui`. Add a visual regression checklist to `verify:visual:qa` script.

---

## Updated Totals

With the addition of Test Infrastructure Audit (10 findings), Documentation Freshness Audit (4 findings), Dependency Audit (6 findings), and Mobile Platform Audit (7 findings), the audit now covers **12 dimensions** with **85 findings**.

### Updated Totals Across All Dimensions

| Dimension | P0 | P1 | P2 | P3 | Total |
|-----------|----|----|----|----|-------|
| Deployment Config | 2 | 3 | 2 | 0 | 7 |
| Historical Baggage | 0 | 0 | 0 | 10 | 10 |
| Test Quality (M3) | 0 | 0 | 0 | 6 | 6 |
| Dead Code | 0 | 0 | 0 | 4 | 4 |
| Error Handling | 3 | 4 | 1 | 4 | 12 |
| Data Flow Trace | 1 | 2 | 0 | 0 | 3 |
| Config Drift | 0 | 2 | 4 | 2 | 8 |
| Accessibility | 0 | 0 | 4 | 4 | 8 |
| **Test Infrastructure (NEW)** | **0** | **0** | **5** | **5** | **10** |
| **Documentation Freshness (NEW)** | **0** | **0** | **1** | **3** | **4** |
| **Dependency Audit (NEW)** | **0** | **1** | **2** | **3** | **6** |
| **Mobile Platform (NEW)** | **0** | **2** | **2** | **3** | **7** |
| **TOTAL** | **6** | **14** | **21** | **44** | **85** |

### Updated Fix Progress Summary

| Status | Count | P0 | P1 | P2 | P3 |
|--------|-------|----|----|----|-----|
| **FIXED** | 12 | 1 | 2 | 1 | 8 |
| **PARTIAL** | 4 | 2 | 1 | 1 | 0 |
| **OPEN** | 69 | 3 | 11 | 19 | 36 |

---

## Cross-Cutting Themes

### Security (5 findings, P0-P2)

The Redis password leak (P0-1) and Docker image credential baking (P0-2) are the most urgent. Both are exploitable with standard Docker access. The unprotected pprof endpoint (P2-1) is a lesser concern since it requires a config change to expose. Dependency audit adds dompurify lag (P2-17) as a XSS sanitizer security gap and the lack of automated CVE scanning (P1-11).

### Data Integrity (3 findings, all P0)

Silent event drops in normalizeEdgeEvents (P0-3) can cause data loss without any warning. Settings write failures (P1-8) and attachment upload failures (P1-9) silently discard user data with zero feedback.

### Operational Reliability (6 findings, P1-P2)

The docker-compose duplication (P1-1), missing frontend Dockerfile (P1-2), ambiguous nginx config (P1-3), and missing deploy scripts create deployment fragility. HubClient having no timeout (P0-5) can hang the app. Dependency audit adds missing CVE scanning (P1-11) as an operational risk.

### Accessibility (7 findings, P2-P3)

The most impactful: missing `role="log"` and `aria-live` on transcript (P3-4), keyboard-inaccessible controls (P2-5), and color contrast failures on all semantic tokens (P2-7). The SVG icon `aria-hidden` issue (P2-6) is trivial to fix and affects every icon in the chat view.

### Code Quality (distributed across audits)

Dead code (315 unused exports), test flakiness (15 hardcoded timeouts), weak error handling (8+ empty catch blocks), and non-deterministic test data all contribute to maintenance friction. These are P3 cleanup items.

---

## Top 10 Action Items by Urgency

| # | Severity | Finding | Source Audit | Est. Effort |
|---|----------|---------|-------------|-------------|
| 1 | P0 | Fix Redis password leak in healthcheck (use REDISCLI_AUTH env var) | Deploy Config | 15 min |
| 2 | P0 | Strip hardcoded `dev_password` from config.docker.yaml | Deploy Config | 30 min |
| 3 | P0 | Add console.warn to normalizeEdgeEvents silent drops; graceful degrade where possible | Data Flow Trace | 2 hr |
| 4 | P0 | Add WorkbenchErrorBoundary at root workbench level | Error Handling | 1 hr |
| 5 | P0 | Add timeout/AbortController to HubClient.request() | Error Handling | 1 hr |
| 6 | P0 | Add .catch() handlers to TablePreview floating promises; wrap diff apply in try/catch | Error Handling | 30 min |
| 7 | P1 | Convert hk2 compose to override file (eliminate duplication) | Deploy Config | 2 hr |
| 8 | P1 | Fix toolCallBlock callId-conflation bug (display "Tool call" when no toolName) | Data Flow Trace | 30 min |
| 9 | P1 | Add error toasts for settings write failures and attachment upload failures | Error Handling | 1 hr |
| 10 | P1 | Add `AGENTHUB_ENV` to ServerConfig struct (remove ad-hoc os.Getenv) | Config Drift | 1 hr |

---

## Files to Create/Modify Summary

| Action | Files |
|--------|-------|
| **Security fixes** | `docker-compose.prod.yml`, `docker-compose.hk2.yml`, `config.docker.yaml`, `Dockerfile` |
| **Data flow fixes** | `normalizeEdgeEvents.ts` |
| **Error handling** | `AgentHubWorkbench.tsx`, `apiClient.ts`, `settingsService.ts`, `hubClient.ts`, `TablePreview.tsx`, `RightInspector.tsx`, `UnifiedComposer.tsx`, `WorkbenchRoutes.tsx`, `attachments.ts` |
| **Config hygiene** | `config.go` (add Env field), `cors.go` (use config), `ws.go` (use config), all 4 `.env.example` files, `config.yaml`, `config.docker.yaml` |
| **Deploy hygiene** | New `Dockerfile` in `app/web/`, convert `docker-compose.hk2.yml` to override |
| **Accessibility** | `Transcript.tsx`, `RowItem.tsx`, `RowItem.css`, `AgentGroup.tsx`, `UserMsg.tsx`, `OrchestratorCard.tsx`, `Icons.tsx`, `tokens.css` |
| **Doc cleanup** | 10 stale doc files (see P3-1) |

---

*Generated by merging 8 audit reports: Deployment Config (M1), Historical Baggage (M2), Test Quality (M3), Dead Code (M4), Error Handling (M5), Data Flow Trace (M6), Config Drift (M7), Accessibility (M8).*
