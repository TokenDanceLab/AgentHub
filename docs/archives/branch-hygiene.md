# 分支清理归档：fork/* 48 个 + origin/dev/* 3 个

> pending external archive — see docs/history.md

删除日期：2026-08-02
执行分支：`chore/branch-hygiene`（PR 见 README 索引）

## 背景

`fork/` 远程（DeliciousBuding/AgentHub）挂载了 48 个历史分支（2026 年 6-7 月初的波次分支，
内容已全部 squash 进 `origin/master`），`origin/` 上还有 3 个 5-6 月初的 `dev/*` 早期开发分支
（已被后续 master 取代）。`git branch -r` 一片混乱，新人无法判断哪些分支仍存活。

管理方判定：以上分支全部为历史残留，直接删除。本页保留"这些分支曾存在"的痕迹。

## 判定依据

- `fork/*` 48 个：ahead=1-2（squash merge 后原 commit 不保留，属正常现象），内容已全部进 master。
- `origin/dev/johnny`：2026-05-21 起（init: 搭建 AgentHub monorepo），领先 master 1056；
  最晚提交含 "Merge remote-tracking branch 'origin/master' into dev/johnny"——早期开发分支。
- `origin/dev/trump`：同期，领先 1362。
- `origin/dev/delicious233`：早期分支（fork/master 曾有 "Merge pull request #57 from TokenDanceLab/dev/delicious233"）。

删除前抽查（均无 master 上不存在的实质功能 commit，仅 squash 残留）：

| 分支 | 抽查所见 |
|---|---|
| `fork/chore/694-master-p29` | `cc4c7dd6 docs(progress): MASTER Phase 28 complete / Phase 29 active (#694)` — squash 残留 |
| `fork/refactor/1152-openai-sdk-peel` | `0f6d3972 refactor(edge): openai_sdk residual pure-helper peel continue (#1152)` — squash 残留 |
| `fork/chore/467-workbench-strangler` | `2392a4dd refactor(workbench): extract cohesive slices from AgentHubWorkbench (#467)` — squash 残留 |
| `fork/dev/delicious233` | 领先 5 个 feat(desktop) commit，全部在 master 有同标题 squash commit（bd7cba79 等） |
| `fork/master` | 旧镜像（早期 merge #57 + 旧 master 历史），内容已进 master |

## 删除清单（按远程分组）

### fork/（DeliciousBuding/AgentHub，48 个 + 旧默认分支 master）

```
chore/467-workbench-strangler        chore/481-workbench-slice2
chore/482-welcome-glass              chore/493-hub-boundary
chore/515-workbench-slice5           chore/529-agents-error
chore/561-contacts-slice1            chore/606-hub-residual
chore/607-design-residual            chore/617-dispatch-residual
chore/694-master-p29                 chore/705-master-p30
chore/708-session-pkg                chore/717-master-p31
chore/718-unified-composer           chore/720-message-pkg
chore/729-master-p32                 chore/730-agents-route
chore/731-inspector-mode-panels      chore/741-master-p33
chore/743-profile-popover            chore/754-design-icons
chore/811-agent-dispatch             chore/823-agent-dispatch
chore/825-session-service            chore/835-process-executor
chore/841-edge-handlers              chore/852-master-p42
chore/853-jwt-product-gate           chore/855-artifact-sandbox
chore/856-process-executor           dev/delicious233
docs/1046-root-layout-adr            fix/1031-outbox-offline-dual-redelivery
fix/1181-aux-column-chrome           master
refactor/1033-agent-dispatch-residual-peel
refactor/1043-process-executor-pure-continue
refactor/1044-hubclient-pure-continue
refactor/1045-store-query-residual-peel
refactor/1103-codex-peel             refactor/1112-surfacing-peel
refactor/1124-edge-event-mappers-peel
refactor/1133-model-catalog-peel     refactor/1134-hub-config-peel
refactor/1141-context-budget-peel    refactor/1142-anthropic-sdk-peel
refactor/1152-openai-sdk-peel
```

### origin/（TokenDanceLab/AgentHub，3 个）

```
dev/delicious233
dev/johnny
dev/trump
```

### 本地引用（worktree / 主树）

- `git remote prune fork`、`git remote prune origin` 清掉全部已删远程的跟踪引用。
- 删除本地跟踪副本分支：`dev/johnny`、`dev/delicious233`（内容与已删远程 dev 分支一致，已核验）。

## 执行特殊情况记录

1. **fork 仓库已归档**（DeliciousBuding/AgentHub archived=true）。执行时临时解除归档 → 删除 48 分支 →
   删除旧默认分支 master → 重新归档（archived=true，已恢复）。归档状态本身未改变。
2. **fork/master 是 fork 的默认分支**，直接删除被 GitHub 拒绝；且仓库必须有默认分支。
   处理：创建占位默认分支 `chore/branch-hygiene-placeholder`（指向原 master 同一 commit）→ 切换默认分支 →
   删除 master。该占位分支保留作为默认分支（GitHub 平台约束，fork 已归档、只读）。
3. **origin/dev/* 三个分支各有独立 branch protection**（allow_deletions=false，含 validate status check）。
   删除前需移除保护规则，删除后保护规则随之消失（传统分支保护绑定具体分支，分支删除后无法恢复）。
   如需重建同等保护，建议以 ruleset（通配 `dev/*`）方式配置。原规则摘要：
   `required_status_checks: validate (app 15368, strict=false)`、`enforce_admins: false`、
   `allow_deletions: false`（dev/delicious233 无 status check，其余字段相同）。

## 保留未动

- `fork/` remote 配置本身（保留 fork remote 条目）
- `origin/master`、`origin/archive/super-governance-baseline-2026-06`、`origin/chore/dep-brace-expansion`（#1453 CLOSED 未 merge，保留）

## 如何找回旧分支内容

GitHub 保留已删除分支引用 90 天（至 2026-10-31 前后）。需要时：

```bash
git fetch fork <old-branch-name>   # 例如 git fetch fork chore/694-master-p29
git fetch origin dev/johnny        # 例如 git fetch origin dev/trump
```
