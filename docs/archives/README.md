# AgentHub 归档索引

| 项目 | 描述 | 时间 | 归档路径 |
|---|---|---|---|
| branch-hygiene | 分支混乱清理：删除 fork/* 48 个历史分支 + origin/dev/* 3 个早期 dev 分支，保留分支曾存在的痕迹；PR [#1501](https://github.com/TokenDanceLab/AgentHub/pull/1501) | 2026-08-02 | [branch-hygiene.md](./branch-hygiene.md) |
| scripts-archive | 孤儿 verify 脚本处置：approved-real 老批次（已被 real-e2e-acceptance skill 取代）、edge-cli/runtime/loginfixture/teamrun 过时项、live-chain-topology（源码重构后断言失效）、login/OIDC 需真实服务或凭据的 approval-gate 共 14 个 .ps1 + 1 个 .sh 归档；PowerShell 为 SSOT，Bash launcher 同命运 | 2026-08-02 | [scripts/](./scripts/) |
| docs-hygiene | 历史 analysis/plan 收拢：post-polish 双轨、一次性 inventory、rescore 系列移入 archives | 2026-08-02 | [analysis/](./analysis/) · [plan/](./plan/) |
| cleanup-baseline | knowledge-first strangler cleanup + SDD closeout；Issues #424–#445 closed；Phase 7 residual #447–#451；Project [cleanup-baseline](https://github.com/users/DeliciousBuding/projects/6)；PR [#446](https://github.com/TokenDanceLab/AgentHub/pull/446) | 2026-07-16 | [cleanup-baseline/](./cleanup-baseline/) |
| wiki-consolidation | wiki 孤儿知识面处置：14 个文件（pages/ 10 + 根 4）；module-hub 鉴权增量并入 01-hub-server、module-edge lifecycle/store 增量并入 02-edge-server，其余为重复/过时编译层归档；`wiki/` 目录移除 | 2026-08-02 | [wiki/](./wiki/) |

## scripts-archive

Archive of orphan `scripts/verify/` verifiers, moved 2026-08-02 as-is (git mv, unmodified).

- Date: 2026-08-02
- Branch / worktree: `chore/rule-enforcement`
- Disposition: 15 files archived as-is
- Archived because obsolete / approval-gate by design / needs live services:
  - approved-real 老批次（`verify-approved-real-{demo-readiness,edge-cli-evidence,preflight}.ps1`、`verify-p0-approved-real-gold-path.ps1`）— 流程已被 `.agents/skills/real-e2e-acceptance/` 取代
  - edge-cli / runtime / fixture 过时项（`verify-edge-cli-{dispatch-evidence,json-readiness,real-readiness}.ps1`、`verify-runtime-readiness.{ps1,sh}`、`verify-login-fixture-topology.ps1`、`verify-teamrun-demo-readiness.ps1`）
  - `verify-live-chain-topology.ps1` — 源码重构（agent_team 拆分、useHubIntegration 拆分、handlers 拆分）后 28/88 断言失效；Web Hub-only 边界由活门禁 `verify-web-hub-boundary.ps1` 覆盖
  - 登录/OIDC approval-gate（`verify-login-e2e-readiness.ps1`、`verify-token-dance-id-login-readiness.ps1` 需人工批准元数据/凭据，`verify-oidc-flow.ps1` 需真实 TokenDance ID + Hub 服务）— 非 CI 静态门禁；OIDC 配置形状由活门禁 `verify-oidc-readiness.ps1`（validate job）覆盖
- 归档后 `scripts/verify/` 剩余脚本全部挂载 CI（checks.yml / release-readiness.yml），无孤儿

## wiki-consolidation

Archive of the orphan `wiki/` compiled-knowledge tree (cleanup-baseline Phase 2 llmwiki), removed 2026-08-02 after merging the two incremental pages into `docs/architecture/` and archiving the rest.

- Date: 2026-08-02
- Branch / worktree: `chore/wiki-consolidation`
- Disposition: 14 files archived as-is（原样移动，未改内容）; PR link in commit message
- Incremental content merged:
  - `wiki/pages/module-hub.md` → `docs/architecture/01-hub-server.md`（Auth 中间件链与路由分组）
  - `wiki/pages/module-edge.md` → `docs/architecture/02-edge-server.md`（Run Lifecycle 状态机 + Store/EventBus 持久化细节）
- Everything else (module-frontend / architecture-seams / flow-control-event / hotspots / risks-open / overview / ops-hk3 / cleanup-playbook + 4 root files) was duplicate of or stale against `docs/architecture*`, `api/events.md`, `docs/governance/*`, `docs/analysis/*` and archived unmodified.

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
