# AgentHub Progress Tracker

> **Task**: continuous product polish (architecture / UIUX / design system / hygiene)
> **Started**: 2026-07-16
> **Last Updated**: 2026-07-19
> **Mode**: `GITHUB_FULL`
> **Repo**: `TokenDanceLab/AgentHub`
> **Merged program PRs**: [#446](https://github.com/TokenDanceLab/AgentHub/pull/446)–[#1170](https://github.com/TokenDanceLab/AgentHub/pull/1170) Phases 1–70 · [#1176](https://github.com/TokenDanceLab/AgentHub/pull/1176)–[#1180](https://github.com/TokenDanceLab/AgentHub/pull/1180) Phase 71

## Two task surfaces (do not mix)

| Surface | Role | NOT for |
|---|---|---|
| **GitHub Project + Issues** | **程序唯一任务清单 / 进度 SSOT** | 会话临时想法 |
| **Claude TaskList** | 仅本会话微编排 | 程序 backlog、跨会话进度 |

规则：跨会话可交付工作只进 GitHub Issue；Workflow/PR 必须绑定 Issue。

## Management model

1. **SPEC in-repo**：`docs/analysis/*` + historical `docs/plan/*` + 本文件
2. **GitHub Project board**：活状态 / WIP
3. **Milestones = Phases** · **Issues = 原子任务**
4. **PR closes Issue**；Workflow 只执行已建 Issue
5. wiki 是编译知识层，**不覆盖** AGENTS / architecture / api / risk register

## GitHub Resources

- **Project Board**: https://github.com/users/DeliciousBuding/projects/6
- **Phase 72 open Issues**: `gh issue list -R TokenDanceLab/AgentHub --milestone 93 --state open`
- **Labels**: `spec-driven` · `phase:72`

## References

- Analysis: [engineering-loop-capability-map](../analysis/engineering-loop-capability-map.md) · [project-overview](../analysis/project-overview.md) · [hub-service-boundary-map](../analysis/hub-service-boundary-map.md)
- Architecture: [architecture.md](../architecture.md) · [04-frontend-data-flow](../architecture/04-frontend-data-flow.md)
- Platform: `app/shared/src/platform/types.ts` · auxPanel · terminal · `edge-server/internal/sessionindex`

## Milestones

| Phase | Name | Milestone | Status |
|:------|:-----|:----------|:-------|
| 1–70 | Baseline + residual peels | #22–#91 | closed |
| 71 | Engineering loop + local workspace surface | #92 | closed (PRs #1176–#1180; 5/5) |
| 72 | Engineering loop Desktop wiring | #93 | active (open #1181–#1184) |

## Issue Mapping (summary)

| Range | Status |
|:------|:-------|
| #424–#1170 Phase 1–70 | closed |
| #1171–#1175 Phase 71 | closed (PRs #1176–#1180) |
| #1181–#1184 Phase 72 | open Desktop wiring + hygiene |

## Quick Status Commands

```bash
gh issue list -R TokenDanceLab/AgentHub --milestone 93 --state open
git worktree list
git rev-parse --short origin/master
```

## Phase Checklist

- [x] Phase 0–71
- [ ] Phase 72 Desktop wiring (ms 93)

## Current Status

**Active Phase**: Phase 72 — Engineering loop Desktop wiring (milestone 93; open=4)
**Active Tasks**: #1181 AuxPanel wire · #1182 TerminalPanel wire · #1183 session import list · #1184 MASTER hygiene
**Blockers**: None
**Stability note**: Phase 71 landed capability map, aux panel shell, sessionindex, terminal host port/panel
**Product tip**: last product code = #1171–#1174 (PRs #1177–#1180); latest: `git rev-parse --short origin/master`
**Red lines**: Web no Local Edge; renderer no raw process; product language only in public git
**Governance**: `AGENTS.md` only · Claude native project memory

## Next Steps

1. Wire AuxPanel into Desktop workbench frame (#1181)
2. Wire TerminalPanel capability-gated (#1182)
3. Desktop session import list via Edge sessionindex (#1183)
4. MASTER hygiene #1184
5. Keep `super-governance-baseline` held

## Session Log

| Date | Session | Summary |
|:-----|:--------|:--------|
| 2026-07-16–19 | lead | Phases 1–71 closed; P72 open (engineering-loop Desktop wiring) |

## Completion notes

- Phase 71 closed: capability map · aux panel · sessionindex · terminal host (PRs #1176–#1180).
