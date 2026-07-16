# Milestones

| # | Milestone | Target Phase | Criteria | Status |
|:--|:----------|:-------------|:---------|:-------|
| 1 | Phase 1: Governance Lock | After Phase 1 | GitHub Project + 14 Issues + MASTER=GITHUB_FULL；禁止无 Issue 实现 | Pending |
| 2 | Phase 2: Hygiene Residual | After Phase 2 | dirty 树政策、旧 deploy banner、stale memory 指针完成 | Pending |
| 3 | Phase 3: Frontend Strangler | After Phase 3 | shared hubClient SSOT；desktop/web thin；AH-SR-043 门禁 | Pending |
| 4 | Phase 4: Edge Seams + Security | After Phase 4 | handlers/executor 可维护；046/049 闭环前进有测试 | Pending |
| 5 | Phase 5: Closure Decisions | After Phase 5 | 037 决策；orphan UI owner；可归档或继续下一 SPEC | Pending |

## Release / acceptance spine
- `git diff --check`
- touched Go: `go test ./... -short -count=1`
- touched frontend: package typecheck + focused vitest
- UI claims: Playwright + evidence grade
- security: risk register 与代码同态；不假关风险

## Management model (locked)
1. **SPEC docs** in-repo: `docs/analysis/*`, `docs/plan/*`, `docs/progress/MASTER.md`
2. **GitHub Project board** for live status / WIP
3. **Milestones** = phases
4. **Issues** = atomic tasks with acceptance criteria
5. **PR closes Issue**; no freestyle multi-workflow implementation without Issue binding
6. Workflows/subagents are **executors of Issues**, not a second backlog
