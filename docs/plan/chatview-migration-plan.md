# Phase 3 — Task Decomposition: ChatView Migration → Merge

> **Date**: 2026-06-17
> **Phase 2 Decisions Confirmed**:
> 1. Monorepo 单版本 (unified version across all packages)
> 2. 现在生成 OpenAPI (swaggo from Go handler tags)
> 3. 现在拆分 AgentHubWorkbench (1500+ → 4 components)
> 4. Squash merge into dev

---

## Execution Plan

### Phase 3A — Complete Running Audits (no new work, just wait + commit)

| Lane | Task | Workflow | Status |
|------|------|----------|--------|
| A1 | Docs finalization + stale archive | W19 | 🔄 |
| A2 | Desktop Tauri acceptance report | W20 | 🔄 |
| A3 | API contract verification (frontend↔backend) | W25 | 🔄 |
| A4 | Hub Server deep audit (handlers + infra) | W26 | 🔄 |
| A5 | CSS dead code elimination | W27 | 🔄 |

**S.U.P.E.R compliance**: All are analysis tasks (read-only except cleanup) — no architectural risk.

---

### Phase 3B — P0 Blocker Resolution (new, parallel lanes)

| Lane | Task | S.U.P.E.R | Design Driver | Est. Agents |
|------|------|-----------|---------------|-------------|
| B1 | **Version alignment** — bump all package.json + tauri.conf.json to 0.4.1, verify consistency | **E**nvironment-Agnostic | Must pass `verify-tauri-package-readiness.ps1` | 2 |
| B2 | **OpenAPI generation** — add swaggo annotations to Hub handlers, generate `openapi.yaml`, verify frontend types match | **P**orts over Implementation | Schema-defined I/O for every endpoint | 4 |
| B3 | **AgentHubWorkbench split** — extract into: `WorkbenchShell`, `ConversationHost`, `ChatViewBridge`, `useWorkbenchCallbacks` | **S**ingle Purpose | Each <200 lines, single responsibility | 3 |
| B4 | **Full test suite retry** — re-run all vitest, fix failures, verify 100% pass | **R**eplaceable Parts | All components must have passing tests | 3 |

**S.U.P.E.R Code Review Checklist** (each task must pass before marking complete):
- [ ] S1: Does each new file have ONE clear purpose?
- [ ] S2: Are there any god objects (>500 lines)?
- [ ] U1: Any circular imports introduced?
- [ ] U2: Data flows one direction (no bidirectional coupling)?
- [ ] P1: Are all module boundaries defined by types/interfaces?
- [ ] P2: Is the API contract explicit (OpenAPI / TypeScript types)?
- [ ] E1: Any hardcoded paths, ports, or environment assumptions?
- [ ] E2: Does it work in both web and desktop contexts?
- [ ] R1: Can each module be tested in isolation?
- [ ] R2: Can each dependency be mocked/swapped?

---

### Phase 3C — Pre-Merge Finalization

| Lane | Task | Driver |
|------|------|--------|
| C1 | Production build verification (web + desktop) | Both must pass |
| C2 | Final privacy re-scan (zero leaks) | `grep -rn "C:\\\\Users\\\\Ding\|Delicious233\|user-ding"` |
| C3 | Git history squash prep (single commit message) | Summary of all changes |
| C4 | AGENTS.md / CLAUDE.md update | Reflect new module structure |

---

## Adaptive Control Baseline

| Metric | Baseline | Target | Drift Budget |
|--------|----------|--------|--------------|
| Commits on branch | 67 | Squash to 1 | — |
| Test pass rate | Unknown | 100% | 0 failures allowed |
| Build (web) | ❌ Failed | ✅ Pass | Must pass |
| Build (desktop) | ❌ Failed | ✅ Pass | Must pass |
| Privacy leaks | 0 remaining | 0 | No new leaks |
| S.U.P.E.R avg | 15/25 | 18/25 | +3 improvement |

**Drift threshold**: If any P0 task introduces >2 new files without matching tests → MILD (annotate). If build still fails after B1-B4 → SIGNIFICANT (halt, re-decompose).

---

## GitHub-Native Tracking

Branch: `feat/chatview-tokendance-migration`
Base: `origin/dev/delicious233`
Mode: LOCAL_ONLY (no `gh` Issue creation — manual task tracking)

**Merge target**: Squash merge into `dev/delicious233`
**Squash commit message template**:
```
feat: ChatView migration + comprehensive hardening

ChatView Design System:
- 25 TranscriptBlock kinds → 10 RowItem cards via adapter.ts
- DAG Orchestrator visualization with topological sort
- Tool call/result FIFO merge, agent group/direct message layout
- react-i18next unified (90+ keys zh/en), CSS tokens scoped to .chatview

Performance: React.memo all components, lazy-loaded pages, dynamic imports
Security: JWT 32-char minimum, gin.SetTrustedProxies, GORM SQL scrubber
         MCP Bearer auth, exec.Command args, CSP headers, DOMPurify
Privacy: 18+ leaks fixed — all real paths/names replaced with placeholders
Architecture: 54 pipeline tests, 694 total tests, dead code removal
Documentation: 30+ docs updated, CHANGELOG, release notes, audit reports
```

---

## Phase Gates

```
Phase 3A (Audits) ──┐
                    ├──▶ Gate 1: All audit reports written, no critical findings left
Phase 3B (P0 Fix) ──┤
                    ├──▶ Gate 2: Builds pass, tests pass, versions aligned
Phase 3C (Finalize)─┘
                         ▶ Gate 3: Merge to dev/delicious233
```
