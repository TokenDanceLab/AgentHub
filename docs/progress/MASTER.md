# AgentHub Progress Tracker

> **Task**: continuous product polish (architecture / UIUX / design system / hygiene)
> **Started**: 2026-07-16
> **Last Updated**: 2026-07-19
> **Mode**: `GITHUB_FULL`
> **Repo**: `TokenDanceLab/AgentHub`
> **Merged program PRs**: Phases 1–70 · [#1176](https://github.com/TokenDanceLab/AgentHub/pull/1176)–[#1180](https://github.com/TokenDanceLab/AgentHub/pull/1180) Phase 71 · [#1185](https://github.com/TokenDanceLab/AgentHub/pull/1185)–[#1190](https://github.com/TokenDanceLab/AgentHub/pull/1190) Phase 72

## Two task surfaces (do not mix)

| Surface | Role | NOT for |
|---|---|---|
| **GitHub Project + Issues** | **程序唯一任务清单 / 进度 SSOT** | 会话临时想法 |
| **Claude TaskList** | 仅本会话微编排 | 程序 backlog、跨会话进度 |

规则：跨会话可交付工作只进 GitHub Issue；Workflow/PR 必须绑定 Issue。

## Management model

1. **SPEC in-repo**：`docs/analysis/*` + 本文件
2. **GitHub Project board**：活状态 / WIP
3. **Milestones = Phases** · **Issues = 原子任务**
4. **PR closes Issue**
5. wiki 非第二 SSOT

## GitHub Resources

- **Project Board**: https://github.com/users/DeliciousBuding/projects/6
- **Phase 73 open Issues**: `gh issue list -R TokenDanceLab/AgentHub --milestone 94 --state open`
- **Labels**: `spec-driven` · `phase:73`

## References

- [engineering-loop-capability-map](../analysis/engineering-loop-capability-map.md)
- Platform · auxPanel · terminal · sessionImport · `edge-server/internal/sessionindex`

## Milestones

| Phase | Name | Milestone | Status |
|:------|:-----|:----------|:-------|
| 1–71 | Baseline + residual + loop foundations | #22–#92 | closed |
| 72 | Engineering loop Desktop wiring | #93 | closed (PRs #1185–#1190; 4/4) |
| 73 | Host ports + import entry | #94 | active (open #1191–#1194) |

## Issue Mapping (summary)

| Range | Status |
|:------|:-------|
| #1171–#1175 Phase 71 | closed |
| #1181–#1184 Phase 72 | closed |
| #1191–#1194 Phase 73 | open |

## Quick Status Commands

```bash
gh issue list -R TokenDanceLab/AgentHub --milestone 94 --state open
git rev-parse --short origin/master
```

## Phase Checklist

- [x] Phase 0–72
- [ ] Phase 73 host ports + import entry (ms 94)

## Current Status

**Active Phase**: Phase 73 — Host ports + import entry (milestone 94; open=4)
**Active Tasks**: #1191 FS/Git ports · #1192 session import entry · #1193 mock TerminalPort host · #1194 MASTER hygiene
**Blockers**: None
**Stability note**: P72 wired AuxPanel column, Terminal dock, SessionImportList, runtime-sessions API
**Product tip**: last product = P72 wiring; latest: `git rev-parse --short origin/master`
**Red lines**: Web no Local Edge; renderer no raw process; product language only in public git

## Next Steps

1. Workspace FS/Git host ports + AuxPanel slot data (#1191)
2. Desktop session import entry (#1192)
3. Desktop mock TerminalPort host (#1193)
4. Hygiene #1194
5. Keep `super-governance-baseline` held

## Session Log

| Date | Session | Summary |
|:-----|:--------|:--------|
| 2026-07-16–19 | lead | Phases 1–72 closed; P73 open (host ports + import entry) |

## Completion notes

- Phase 72 closed: AuxPanel wire · Terminal dock (+harden) · session import UI · runtime-sessions.
