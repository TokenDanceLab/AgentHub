# Docs Staleness & Structural Audit

> Date: 2026-06-10
> Scope: All markdown files under `docs/`
> Total files inventoried: 227 (11 active root + 13 ADR + 82 archive + 32 audit + 28 reference root + 74 reference/projects + 3 competition + 5 governance + 4 handoffs + 5 review + 12 review-2026-06-07-glm-5.1 + misc)

---

## 1. Per-File Staleness Assessment

### 1.1 Active Root Documents (docs/*.md)

| File | Lines | Last Modified | Staleness | Issues |
|---|---:|---|---|---|
| `README.md` | 82 | 2026-06-10 | **CURRENT** | Navigation hub, well-maintained. Lists 5174 as Web -- correct. |
| `architecture.md` | 512 | 2026-06-10 | **CURRENT** | Updated with v4 data flow. Port assignments correct (5173 Desktop, 5174 Web, 5177 Mobile). Adapter list in roadmap matches `registry.go` (claude-code, codex, opencode, anthropic-sdk, openai-sdk). |
| `roadmap.md` | 2057 | 2026-06-10 | **CURRENT** | Massive -- 2057 lines. Updated 16+ times on 2026-06-10 alone. Hub/Edge route table at section 1.1 matches `router.go` endpoints. |
| `design-decisions.md` | 81 | 2026-06-10 | **CURRENT** | Five key decisions, links to ADRs. Clean and well-scoped. |
| `developer-quickstart.md` | 311 | 2026-06-10 | **STALE** | Says "49 个迁移文件" but `hub-server/migrations/` now has 98 files. References `app/web/src/` API structure but doesn't mention `teamRunQueries.ts`, `documentQueries.ts`, `allowlistValidation.ts`, `schemas.ts` present in current codebase. Doesn't mention mobile-rn setup. |
| `backend-integration-governance.md` | 230 | 2026-06-09 | **CURRENT** | Well-maintained. Branch facts match current state. AH-SYNC format still valid. |
| `desktop-web-v4-clean-rebuild-plan.md` | 488 | 2026-06-08 | **STALE** | Last updated 2026-06-07. References `Tauri command 945 行` but `v4-legacy-client-inventory` says 832 lines. Section 1 fact table is 34 rows long and growing stale as implementation progresses. UI shell reference points to `agenthub-design/desktop` which is historical only now. |
| `desktop-edge-web-integration-plan.md` | 256 | 2026-06-08 | **STALE** | References `api/openapi.yaml` for Edge contract but Edge contract is actually in `edge-server/` not root `api/`. Section on "Edge workspace allowlist 已在 handler 层 fail-closed" needs verification against current code. |
| `v4-frontend-progress-2026-06-07.md` | 310 | 2026-06-08 | **STALE** | Date-stamped 2026-06-07, not updated since. References specific commit checkpoints and `.tmp/` paths that may be stale. Detailed CSS color token changes (old purple -> blue) are already implemented and should be archived. |
| `v4-design-parity-audit-2026-06-07.md` | 231 | 2026-06-08 | **STALE** | Date-stamped snapshot. References specific screenshot files in `.tmp/` directories. Playwright screenshot paths may no longer exist. Should be archived once parity is confirmed. |
| `v4-legacy-client-inventory-2026-06-07.md` | 61 | 2026-06-09 | **STALE** | References `commands.rs` as 832 lines / 20 commands. References `app/mobile` Tauri as existing -- confirmed still exists in source tree despite being deprecated. Delete/migrate list needs progress update. |
| `v4-merge-pr-readiness-2026-06-07.md` | 162 | 2026-06-08 | **STALE** | References PR #291 draft, local HEAD `9e72640b`, "31 ahead / 11 behind". These facts are likely outdated. PR #297 has since merged to master. |
| `v4-pr-draft.md` | 70 | 2026-06-08 | **STALE** | References PR #291 draft status. PR may have been superseded by #297. The `gh pr create` command template is still useful but the surrounding context is stale. |
| `v4-clean-rebuild-decision-questions.md` | 125 | 2026-06-08 | **STALE** | All 30 questions have recommended answers; "已确认拍板项" confirms 3 decisions. This is a completed decision document that should be archived or merged into ADR. Still references `dev/trump` and `dev/johnny` as branches to keep. |
| `v4-shared-i18n-design.md` | 73 | 2026-06-08 | **STALE** | Migration order listed (1-5 steps) but no indication of current progress. References `app/shared/src/i18n/workbench.ts` -- should verify this file exists. |
| `handoff-2026-06-09.md` | 168 | 2026-06-09 | **CURRENT** | References PR #297 merged state, correct open issues (#126, #64). Should be moved to `handoffs/` per the handoff rules (README says "当日 session 写 SESSION-HANDOFF"). |

### 1.2 ADR Directory (docs/adr/)

| File | Lines | Last Modified | Staleness | Issues |
|---|---:|---|---|---|
| `README.md` | 43 | 2026-06-05 | **STALE - BROKEN LINKS** | References `docs/architecture/system-architecture.md` and `docs/architecture/implementation-guide.md` -- **neither file exists**. These were removed during the 2026-06-05 doc restructuring. Should reference `docs/architecture.md` instead. |
| ADR-001 through ADR-011 | 29-151 | 2026-06-05 | **ACCEPTABLE** | All ADRs reorganized on 2026-06-05. Content is decision records, so age is expected. Early terminology (Runner) is noted in README. |

### 1.3 Handoffs Directory (docs/handoffs/)

| File | Lines | Last Modified | Staleness | Issues |
|---|---:|---|---|---|
| `README.md` | 12 | 2026-06-05 | **CURRENT** | Rules are clear. |
| `STATE.md` | 95 | 2026-06-06 | **STALE** | **Port table says 5174 is "Mobile Vite dev"** but it is actually Web frontend. Architecture.md and README.md both say 5174 is Web. STATE.md also says 5175 is not listed. Subagent rules reference `gpt-5.5` + `xhigh` which may be outdated model names. Last updated 2026-06-06, now 4 days behind. |
| `SESSION-HANDOFF-2026-06-05.md` | 204 | 2026-06-05 | **STALE - SHOULD ARCHIVE** | README rules say "超过3天的交接文档移入 archive/handoffs/". This is 5 days old. |
| `claude-session-20260605.md` | 149 | 2026-06-05 | **STALE - SHOULD ARCHIVE** | Same as above -- 5 days old, should be in archive. |

### 1.4 Audit Directory (docs/audit/)

32 files, ranging from 28-460 lines. These are gate/evidence documents tied to specific development phases.

| Category | Count | Staleness | Issues |
|---|---:|---|---|
| `p0-*` | 6 | Most updated 2026-06-09 | **ACCEPTABLE** | Readiness gates for P0 features. Some may be completed. |
| `p1-*` | 13 | Updated 2026-06-09 | **ACCEPTABLE** | P1 readiness evidence. Large number of p1-localhost-* files (5) could be merged. |
| `p2-*` | 1 | Updated 2026-06-08 | **ACCEPTABLE** | Single P2 gate. |
| `*-audit-*` | 1 | Updated 2026-06-10 | **CURRENT** | `performance-audit-2026-06-10.md` |
| `*-audit-*` | 1 | Updated 2026-06-10 | **CURRENT** | `security-audit-2026-06-10.md` |
| `release-gate-*` | 1 | Updated 2026-06-09 | **ACCEPTABLE** | `release-gate-2026-06-09.md` |
| Other | 10 | Mixed | **STALE** | `web-build-visual-smoke.md`, `tauri-unsigned-build-smoke.md` etc. are one-time smoke tests that should be archived after use. |

### 1.5 Competition Directory (docs/competition/)

| File | Lines | Last Modified | Staleness | Issues |
|---|---:|---|---|---|
| `competitive-positioning.md` | 69 | 2026-06-10 | **CURRENT** | But links to `../../../docs/competitors/COMPETITOR-DEEP-COMPARISON-2026-06-10.md` -- path goes outside the AgentHub repo entirely. This is a broken link for repo-local navigation. |
| `competitive-analysis-2026-06-10.md` | 584 | 2026-06-10 | **CURRENT** | Well-maintained architectural analysis. |
| `teamrun-e2e-evidence.md` | 275 | 2026-06-09 | **CURRENT** | References PR #270 merged state. Code chain table is verified against router.go. |

### 1.6 Governance Directory (docs/governance/)

| File | Lines | Last Modified | Staleness | Issues |
|---|---:|---|---|---|
| `branch-governance.md` | 98 | 2026-06-09 | **CURRENT** | Branch facts and worktree registry match current state. |
| `document-standards.md` | 41 | 2026-06-08 | **CURRENT** | Rules are still valid. |
| `governance-execution.md` | 47 | 2026-06-09 | **STALE** | Line 35 says "Desktop and Mobile are independent Tauri projects (distinct `src-tauri/`, separate ports 5173/5174)" -- **incorrect**: 5174 is Web, not Mobile. Mobile uses Expo/RN, not Tauri. Also references `..\..\docs\ecosystem\ecosystem-execution-queue.md` and 8 other root docs paths that may not exist in this repo. |
| `security-risk-register.md` | 279 | 2026-06-09 | **CURRENT** | Actively maintained risk register. |
| `threat-model.md` | 113 | 2026-06-10 | **CURRENT** | Updated alongside competitive positioning. |

### 1.7 Designs Directory (docs/designs/)

| File | Lines | Last Modified | Staleness | Issues |
|---|---:|---|---|---|
| `artifact-lifecycle-plan.md` | 127 | 2026-06-05 | **STALE** | No update since initial creation. References artifact types that may have changed. |
| `client-reference-patterns.md` | 155 | 2026-06-05 | **STALE** | No update since initial creation. |
| `enhanced-adapter-architecture.md` | 1026 | 2026-06-05 | **STALE** | 1026-line design doc from 2026-06-05. Adapter architecture has evolved since then (added anthropic-sdk and openai-sdk per registry.go). Needs reconciliation with current adapter list. |
| `unified-error-logging-debug.md` | 461 | 2026-06-05 | **STALE** | No update since initial creation. |

### 1.8 Reference Directory (docs/reference/)

74 project files + 28 root reference files. Total: ~2.1 MB of reference content.

| Category | Count | Staleness | Issues |
|---|---:|---|---|
| `projects/` | 74 | All dated 2026-06-05 | **ACCEPTABLE** | These are research/reference docs about competitor projects. Staleness is expected and acceptable for research material. |
| Root `*.md` | 28 | All dated 2026-06-05 | **ACCEPTABLE** | Research syntheses and competitor analyses. Same as above. |
| `sdk-agent-strategy.md` | 339 | 2026-06-09 | **CURRENT** | Updated with SDK fixture evidence. |

### 1.9 Review Directories

| Directory | Count | Last Modified | Staleness | Issues |
|---|---:|---|---|---|
| `review/` | 2 active + 18 archive | 2026-06-06 | **STALE** | Active review docs from 2026-06-06. Round 6 submission gap analysis references `PRODUCT-DESIGN-SUMMARY.md` and `system-architecture.md` paths that may not exist. |
| `review-2026-06-07-glm-5.1/` | 22 files | 2026-06-10 | **CURRENT** | GLM-5.1 review from 2026-06-07. Contains its own handoff files. Cross-review files found and flagged the ADR README broken links. Should be archived after review is consumed. |

### 1.10 Deployment Directory (docs/deployment/)

| File | Lines | Last Modified | Staleness | Issues |
|---|---:|---|---|---|
| `hk2-deployment-runbook.md` | 384 | 2026-06-10 | **CURRENT** | References host alias "hk2" which per AGENTS.md should not appear in repo files. However, this is a deployment runbook so the reference is operationally necessary. |

### 1.11 Archive Directory (docs/archive/)

82 files, ~2.1 MB. All dated 2026-05-25 to 2026-06-05.

| Issue | Details |
|---|---|
| `INDEX.md` references `docs/architecture/system-architecture.md` | **BROKEN LINK** -- line 44 says "当前以 `docs/architecture/system-architecture.md` 的 Hub/Edge/Desktop + AgentAdapter 为准" but that file was removed during restructuring. Should say `docs/architecture.md`. |
| `archive/handoffs/` should absorb `handoffs/SESSION-HANDOFF-2026-06-05.md` | 5 days old, exceeds the 3-day rule stated in `handoffs/README.md`. |
| `archive/client-handoff.md` references non-existent paths | References `docs/architecture/system-architecture.md`, `docs/architecture/implementation-guide.md`, `docs/roadmaps/client.md`. All removed. Acceptable for archive but noted. |

---

## 2. Duplication Map

### 2.1 High-Priority Duplications

| Duplication | Files Involved | Severity |
|---|---|---|
| **Architecture overview repeated** | `architecture.md` (sections 1-3), `design-decisions.md` (decisions 1-4), `competitive-positioning.md` (architecture table), `desktop-web-v4-clean-rebuild-plan.md` (section 1 facts), `desktop-edge-web-integration-plan.md` (target architecture), `roadmap.md` (section 1.1) | **HIGH** -- Hub-Edge split, Go+CLI rationale, and WS choice are each explained 3-6 times. |
| **Port assignments repeated** | `architecture.md` line 24, `STATE.md` lines 26-29, `README.md` line 40, `roadmap.md` section 1.1, `developer-quickstart.md`, `governance-execution.md` line 35 | **HIGH** -- But **STATE.md has the wrong value** (5174 = Mobile) while all others correctly say 5174 = Web. |
| **Platform adapter list duplicated** | `roadmap.md` lines 62-74 (Web/Desktop adapter tables), `desktop-edge-web-integration-plan.md` section "当前链路", `architecture.md` section on adapters | **MEDIUM** -- The actual adapter files in `app/web/src/api/` (22 files) and `app/desktop/src/api/` (32 files) differ from what's documented in roadmap (which lists only ~12 each). |
| **v4 decision questions vs. other v4 docs** | `v4-clean-rebuild-decision-questions.md` has 30 Q&As that are partially restated in `desktop-web-v4-clean-rebuild-plan.md` facts table and `architecture.md` decisions section | **MEDIUM** -- Same content in 3 places. |
| **ADR content vs. design-decisions.md** | Each of the 5 decisions in `design-decisions.md` links to specific ADRs, but the summaries are nearly complete restatements | **LOW** -- Intentional for review audience. Acceptable. |
| **Competitive analysis** | `competition/competitive-positioning.md`, `competition/competitive-analysis-2026-06-10.md`, `reference/competitive-master-report.md`, `reference/competitor-*.md` (6 files), `archive/competitor-master-report.md` | **MEDIUM** -- At least 3 overlapping competitor analysis documents across active/reference/archive. |

### 2.2 Low-Priority / Acceptable Duplications

- ADR cross-references to architecture decisions (intentional).
- Archive duplicates of current docs (expected).
- Reference project docs that summarize overlapping competitor features (research material).

---

## 3. Structural Issues

### 3.1 Orphan Documents (no links from other files)

| File | Evidence of Orphan Status |
|---|---|
| `v4-shared-i18n-design.md` | Not linked from `docs/README.md`. Only discoverable by browsing. |
| `designs/artifact-lifecycle-plan.md` | Not linked from README or roadmap. |
| `designs/client-reference-patterns.md` | Not linked from README or roadmap. |
| `designs/enhanced-adapter-architecture.md` | Not linked from README. 1026 lines, significant content invisible to navigation. |
| `designs/unified-error-logging-debug.md` | Not linked from README. |
| `audit/p1-localhost-observed-loop.md` | One of 5 `p1-localhost-*` files that overlap heavily. |
| Multiple `audit/p1-*` files | 13 P1 readiness files with no index or cross-link. |
| All `reference/projects/` files | Only discoverable via `reference/README.md` which lists none by name. |

### 3.2 Files in Wrong Location

| File | Current Location | Should Be |
|---|---|---|
| `handoff-2026-06-09.md` | `docs/handoff-2026-06-09.md` | `docs/handoffs/SESSION-HANDOFF-2026-06-09.md` (per handoffs rules) |
| `handoffs/SESSION-HANDOFF-2026-06-05.md` | `docs/handoffs/` | `docs/archive/handoffs/` (exceeds 3-day rule) |
| `handoffs/claude-session-20260605.md` | `docs/handoffs/` | `docs/archive/handoffs/` (exceeds 3-day rule) |

### 3.3 Flat Root Directory

The `docs/` root currently has **18 files** directly under it. Per `document-standards.md` rule 3 ("阶段性实施计划直接放在 docs/，并由 roadmap 链接"), most of these v4-* files should be in a subdirectory or archived now that the v4 rebuild is progressing past the planning phase.

### 3.4 Overly Large Files

| File | Lines | Issue |
|---|---:|---|
| `roadmap.md` | 2057 | Extremely large. Has been edited 16+ times in a single day. Should be split into current-sprint and backlog sections. |
| `reference/projects/claude-code-sdk/02-tool-security.md` | 1659 | Largest reference file. Acceptable as research material. |
| `archive/build-specs-backend-02-go-services.md` | 2395 | Largest archive file. Acceptable. |

---

## 4. Staleness Summary by Priority

### P0 -- Immediate Updates Needed (broken/wrong content)

1. **`docs/adr/README.md`** -- Broken links to `system-architecture.md` and `implementation-guide.md`. Should reference `docs/architecture.md`.
2. **`docs/handoffs/STATE.md`** -- Wrong port table (5174 = Mobile should be 5174 = Web). 4 days stale.
3. **`docs/archive/INDEX.md`** -- Line 44 references non-existent `docs/architecture/system-architecture.md`. Should say `docs/architecture.md`.
4. **`docs/governance/governance-execution.md`** -- Line 35 incorrectly says "separate ports 5173/5174" for Desktop/Mobile. Mobile is Expo/RN, not Tauri. Root input paths (`..\..\docs\...`) reference files outside this repo.
5. **`docs/developer-quickstart.md`** -- Says "49 个迁移文件" but actual count is 98.

### P1 -- Should Update This Sprint

6. **`docs/desktop-web-v4-clean-rebuild-plan.md`** -- Tauri command line count mismatch. Fact table growing stale.
7. **`docs/v4-merge-pr-readiness-2026-06-07.md`** -- PR #291 context likely outdated after PR #297 merge.
8. **`docs/v4-pr-draft.md`** -- Same PR #291 context issue.
9. **`docs/v4-frontend-progress-2026-06-07.md`** -- Implementation progress checkpoint from 3 days ago. Should be archived or updated.
10. **`docs/v4-design-parity-audit-2026-06-07.md`** -- Snapshot audit from 3 days ago. Should be archived once parity is confirmed.
11. **`docs/competition/competitive-positioning.md`** -- Links to `../../../docs/competitors/COMPETITOR-DEEP-COMPARISON-2026-06-10.md` outside the repo.

### P2 -- Can Archive Safely

12. **`docs/v4-clean-rebuild-decision-questions.md`** -- All 30 questions answered and 3 decisions confirmed. Completed document.
13. **`docs/handoffs/SESSION-HANDOFF-2026-06-05.md`** -- Exceeds 3-day rule.
14. **`docs/handoffs/claude-session-20260605.md`** -- Exceeds 3-day rule.
15. **`docs/v4-legacy-client-inventory-2026-06-07.md`** -- Inventory snapshot, should be updated or archived as items are migrated.
16. **`docs/review-2026-06-07-glm-5.1/`** (22 files) -- Complete review package. Should be moved to `review/archive/` after findings are consumed.

---

## 5. Proposed Restructuring Plan

### Phase 1 -- Fix Broken Links and Wrong Facts (Immediate)

| Action | Files |
|---|---|
| Fix ADR README broken links | `docs/adr/README.md` -- replace `docs/architecture/system-architecture.md` with `docs/architecture.md`, remove `implementation-guide.md` reference |
| Fix STATE.md port table | `docs/handoffs/STATE.md` -- change 5174 from "Mobile Vite dev" to "Web Vite dev", add 5177 "Mobile RN Expo" |
| Fix archive INDEX | `docs/archive/INDEX.md` line 44 -- replace `system-architecture.md` with `docs/architecture.md` |
| Fix governance-execution | `docs/governance/governance-execution.md` line 35 -- correct Mobile description, verify root input paths |
| Fix migration count | `docs/developer-quickstart.md` -- update from 49 to 98 |
| Move handoff to correct location | `docs/handoff-2026-06-09.md` -> `docs/handoffs/SESSION-HANDOFF-2026-06-09.md` |

### Phase 2 -- Archive Completed/Superseded Documents (This Sprint)

| Action | Files |
|---|---|
| Move completed decision doc | `docs/v4-clean-rebuild-decision-questions.md` -> `docs/archive/` |
| Move stale handoffs | `docs/handoffs/SESSION-HANDOFF-2026-06-05.md`, `docs/handoffs/claude-session-20260605.md` -> `docs/archive/handoffs/` |
| Move completed audit snapshots | `docs/v4-design-parity-audit-2026-06-07.md`, `docs/v4-frontend-progress-2026-06-07.md` -> `docs/archive/` |
| Archive GLM-5.1 review | `docs/review-2026-06-07-glm-5.1/` -> `docs/review/archive/glm-5.1-2026-06-07/` |
| Archive one-time smoke tests | `docs/audit/tauri-unsigned-build-smoke.md`, `docs/audit/web-build-visual-smoke.md` -> `docs/archive/audit/` |

### Phase 3 -- Consolidate Active v4 Documents

| Action | Details |
|---|---|
| Create `docs/v4/` subdirectory | Move all `v4-*` prefixed files into a dedicated `docs/v4/` directory. This cleans up the flat root from 18 to ~10 files. |
| Merge PR readiness into v4 plan | `v4-merge-pr-readiness-2026-06-07.md` and `v4-pr-draft.md` are both about PR #291 preparation. Merge into a single `docs/v4/merge-readiness.md`. |
| Update legacy inventory | `v4-legacy-client-inventory-2026-06-07.md` needs a progress pass: mark completed items, update current file counts. |

### Phase 4 -- Reduce Roadmap Bloat

| Action | Details |
|---|---|
| Split `roadmap.md` (2057 lines) | Extract "Section 16 master checklist" (112+ items) and historical progress into `docs/roadmap-checklist.md` or `docs/archive/roadmap-checklist-history.md`. Keep `roadmap.md` focused on current sprint goals and next priorities. Target: under 500 lines. |

### Phase 5 -- Consolidate Audit Evidence

| Action | Details |
|---|---|
| Create `docs/audit/README.md` | Index the 32 audit files by priority (p0/p1/p2) and status. |
| Merge p1-localhost-* files | 5 files (`p1-localhost-observed-loop.md`, `p1-localhost-real-services.md`, `p1-localhost-real-stack-smoke.md`, `p1-local-stack-e2e-runner.md`, `p1-observed-localhost-dispatch.md`) should be consolidated into 1-2 files. |

---

## 6. Statistics Summary

| Metric | Value |
|---|---|
| Total docs files | 227 |
| Total docs size | ~5.5 MB |
| Active root docs (not in archive/audit/review) | 18 |
| Files with broken links | 3 (`adr/README.md`, `archive/INDEX.md`, `competition/competitive-positioning.md`) |
| Files with wrong facts | 3 (`handoffs/STATE.md`, `governance/governance-execution.md`, `developer-quickstart.md`) |
| Files that should be archived | 8 |
| Files that should be merged | 4 |
| Duplicate content clusters | 6 |
| Orphan files (no nav link) | 7+ |
| Largest file | `roadmap.md` (2057 lines) |
| Newest file | `audit/performance-audit-2026-06-10.md` (2026-06-10) |
| Oldest active (non-archive) file | `adr/README.md` content dates to 2026-06-03 but paths reference pre-restructuring structure |
