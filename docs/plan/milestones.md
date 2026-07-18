# Milestones

> **HISTORICAL — cleanup-baseline freeze (closed 2026-07-16 / PR #446).**
> Not live backlog. Live phases and open issues: [../progress/MASTER.md](../progress/MASTER.md) (Phase 58 / milestone 79).
> Snapshot also under [../archives/cleanup-baseline/plan/](../archives/cleanup-baseline/plan/).

| # | Milestone | Target Phase | Criteria | Status |
|:--|:----------|:-------------|:---------|:-------|
| 1 | Phase 1: Governance Lock | After Phase 1 | GitHub Project + Issues + MASTER=GITHUB_FULL；禁止无 Issue 实现 | Complete (#424–#426) |
| 2 | Phase 2: Hygiene Residual | After Phase 2 | dirty 树政策、旧 deploy banner、stale memory 指针完成 | Complete (#427–#429) |
| 3 | Phase 3: Frontend Strangler | After Phase 3 | shared hubClient SSOT；desktop/web thin；AH-SR-043 门禁 | Complete (#430–#433) |
| 4 | Phase 4: Edge Seams + Security | After Phase 4 | handlers/executor 可维护；046/049 闭环前进有测试 | Complete (#434–#437) |
| 5 | Phase 5: Closure Decisions | After Phase 5 | 037 决策；orphan UI owner；可归档或继续下一 SPEC | Complete (#438–#440) |
| 6 | Phase 6: Baseline Hardening | After Phase 6 | desktop/web tsc；SectionId；purpose=run-start；SQLite DeliveryJournal | Complete (#441–#445 / milestone 27) |
| 7 | Phase 7: Baseline CI Green + SDD Closeout | After Phase 7 | PR #446 CI 绿；plan 文档同步；SDD 归档 | Complete (#447–#451 / milestone 28 / PR #446) |

## Release / acceptance spine
- `git diff --check`
- touched Go: `go test ./... -short -count=1`
- touched frontend: package typecheck + focused vitest
- UI claims: Playwright + evidence grade
- security: risk register 与代码同态；不假关风险

## Management model (locked)
1. **SPEC docs** in-repo: `docs/analysis/*`, historical `docs/plan/*`, `docs/progress/MASTER.md`
2. **GitHub Project board** for live status / WIP
3. **Milestones** = phases
4. **Issues** = atomic tasks with acceptance criteria
5. **PR closes Issue**; no freestyle multi-workflow implementation without Issue binding
6. Workflows/subagents are **executors of Issues**, not a second backlog

## Reality sync (2026-07-18)
- Cleanup-baseline program Phases 1–7 closed: issues `#424`–`#451` via PR #446 (2026-07-16).
- Live tracker SSOT: `docs/progress/MASTER.md` + Project board (Phase 58 / milestone 79).
- Do not reopen `#447`–`#451` as open work.
