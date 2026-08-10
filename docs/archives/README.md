# AgentHub 归档索引

| 项目 | 描述 | 时间 | 归档路径 |
|---|---|---|---|
| branch-hygiene | 分支混乱清理：删除 fork/* 48 个历史分支 + origin/dev/* 3 个早期 dev 分支，保留分支曾存在的痕迹；PR [#1501](https://github.com/TokenDanceLab/AgentHub/pull/1501) | 2026-08-02 | [branch-hygiene.md](./branch-hygiene.md) |
| docs-hygiene | 历史 analysis/plan 收拢：post-polish 双轨、一次性 inventory、rescore 系列移入 archives | 2026-08-02 | [analysis/](./analysis/) · [plan/](./plan/) |
| cleanup-baseline | knowledge-first strangler cleanup + SDD closeout；Issues #424–#445 closed；Phase 7 residual #447–#451；Project [cleanup-baseline](https://github.com/users/DeliciousBuding/projects/6)；PR [#446](https://github.com/TokenDanceLab/AgentHub/pull/446) | 2026-07-16 | [cleanup-baseline/](./cleanup-baseline/) |
| wiki-consolidation | wiki 孤儿知识面处置：14 个文件（pages/ 10 + 根 4）；module-hub 鉴权增量并入 01-hub-server、module-edge lifecycle/store 增量并入 02-edge-server，其余为重复/过时编译层归档；`wiki/` 目录移除 | 2026-08-02 | 详见 commit message（wiki/ 已删除，无独立归档目录） |

## 15-verifier disposition

`scripts/verify/` 评估记录（2026-08-02 `chore/rule-enforcement`，#1515）：

- 评估后撤销归档 — 均有活跃执行引用，git mv 未执行，脚本仍保留在 `scripts/verify/`。
- OIDC 配置形状门禁 `verify-oidc-readiness.py` 已退役（#1653）；OIDC 真实流验证非 CI 静态门禁，见 `docs/governance/security-risk-register.md` AH-SR-035。
- `verify-edge-cli-json-readiness.ps1` 于 2026-08-04 #1610 零引用清理时删除。
- `.ps1` verifier 已统一迁为 `.py`；当前 `scripts/verify/` 列表以 `verify-doc-ssot.py` §9.5 映射表为准。

## cleanup-baseline

Snapshot of in-repo SDD artifacts for the cleanup-baseline program (do **not** delete live `docs/progress/MASTER.md`).

- Date: 2026-07-16
- Branch / worktree: `chore/cleanup-baseline` @ `.worktrees/cleanup-baseline`
- Project: https://github.com/users/DeliciousBuding/projects/6
- Closed issues: #424–#445 (Phases 1–6)
- Phase 7 residual: #447–#451
- PR: https://github.com/TokenDanceLab/AgentHub/pull/446
- Snapshot paths:
  - `docs/archives/cleanup-baseline/analysis/` ← copy of `docs/analysis/**`
  - `docs/archives/cleanup-baseline/plan/` ← copy of `docs/plan/**`
  - `docs/archives/cleanup-baseline/progress/` ← copy of `docs/progress/**` (includes MASTER snapshot)
- Live tracker remains authoritative at `docs/progress/MASTER.md`

## Live SSOT（勿混）

| 面 | 路径 |
|---|---|
| 当前进度 | `docs/progress/MASTER.md` |
| 当前分析 | `docs/analysis/*`（可与本快照内容漂移） |
| 规则 | `AGENTS.md` |
| 外部历史 | `docs/history.md` → TokenDanceLab/docs |

本目录只是 cleanup-baseline **冻结快照**；改活事实不要改这里。
