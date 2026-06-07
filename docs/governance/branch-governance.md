# 分支治理

最后更新：2026-06-07（Desktop/Web v4 clean rebuild 主工作树）

## 合并规则

```text
feat/* -> dev/delicious233 -> master
```

- `dev/delicious233` 是当前唯一开发事实源。
- `master` 禁止直接 push，必须通过 PR。
- `feat/*` 合入前先同步最新 `dev/delicious233`，解决冲突并跑对应验证。
- 完成后删除已合入的 `feat/*` 分支和对应 worktree。
- `dev/trump`、Johnny 聚合分支和 Web parity 残留分支不作为自动合入来源。

## 当前本地状态

| 分支 | 说明 | 状态 |
|------|------|:--:|
| **feat/desktop-web-v4-clean-rebuild** | 当前 Desktop/Web v4 clean rebuild 主工作树分支，承载 shared UI、端口、设计系统和文档同步 | 当前工作 |
| **dev/delicious233** | 主开发事实源；当前 v4 分支最终应回到该线 | 活跃 |
| master | 稳定发布，PR only | 保留 |
| feat/web-desktop-parity | 早期 Web parity 本地分支，唯一提交 `797983e`；已导出 patch 后删除本地分支 | 已归档 |
| worktree-feat+web-desktop-parity | 早期 Web parity 本地/远端分支已删除；本地 patch 归档只作参考 | 已归档 |

当前登记 worktree：

| Worktree | HEAD/分支 | 用途 | 规则 |
|---|---|---|---|
| `D:/Code/TokenDance/AgentHub` | `feat/desktop-web-v4-clean-rebuild` | Desktop/Web v4 shared UI 主工作树 | 当前只推进前端 shared UI、设计系统、端口、文档；backend 暂不碰 |
| `D:/Code/TokenDance/AgentHub/.worktrees/backend` | `feat/backend-edge-hub` | 后端/Edge-Hub 并行线 | 不作为本轮 UI 事实源，不从主工作树清理或重写 |
| `D:/Code/TokenDance/AgentHub/.worktrees/johnny-dev` | detached HEAD | 协作者 Johnny 状态检查线 | 只读/隔离，不能自动合并 |

旧残留目录 `.worktrees/codex-trump-fork` 已移动到 `.worktrees/.trash/codex-trump-fork-archived-20260526`，未直接删除。

当前 stash 为空。旧 Web parity 相关 stash 已先导出 patch，再从本地 stash 删除：

| Patch | 来源 | 处理建议 |
|---|---|---|
| `.worktrees/.trash/feat-web-desktop-parity-archive-20260526/0001-feat-web-Desktop-API.patch` | `feat/web-desktop-parity` 唯一提交 `797983e` | 只作 patch-review 参考，禁止直合 |
| `.worktrees/.trash/feat-web-desktop-parity-archive-20260526/stash0-feat-web-desktop-parity.patch` | 旧 `feat/web-desktop-parity` stash | 只作 patch-review 参考，禁止自动应用 |
| `.worktrees/.trash/feat-web-desktop-parity-archive-20260526/stash1-dev-delicious233.patch` | 旧 `dev/delicious233` stash | 只作 UI 回捞参考，禁止自动应用 |

## 当前远端未合入

| 远端分支 | 相对 `origin/dev/delicious233` | 处理建议 |
|---|---:|---|
| `origin/feat/desktop-web-v4-clean-rebuild` | 主线 ahead 0 / 分支 ahead 28 | 当前 Desktop/Web v4 主线远端；只合回 `dev/delicious233`，不反向把旧 UI 分支合入 |
| `origin/feat/backend-edge-hub` | 主线 ahead 104 / 分支 ahead 15 | backend 并行线；本轮 Desktop/Web shared UI 暂不合并、不清理 |
| `origin/dev/trump` | 主线 ahead 3 / 分支 ahead 0 | Trump 线当前无独有提交但落后主线；保留，不作为本轮 UI 来源 |
| `origin/dev/johnny` | 主线 ahead 320 / 分支 ahead 11 | Johnny 线仍有少量独有提交但大幅落后；只单独审，不直合 |

当前 `origin` 活跃 heads 包含 `dev/delicious233`、`master`、`dev/trump`、`dev/johnny`、`feat/desktop-web-v4-clean-rebuild`、`feat/backend-edge-hub`。已删除的过时 `feat/*`、`fix/*`、`phase-*`、`integration/*` 不得在 AGENTS/roadmap 中重新引用为活跃远端。

## 2026-05-27 已清理

| 类别 | 结果 |
|---|---|
| Fork 远端分支清理 | `fork/codex/johnny-fork`、`fork/codex/trump-ui-fork`、`fork/feat/web-validation-foundation`、`fork/dev/trump`、`fork/dev/johnny`、`fork/dependabot/go_modules/hub-server/github.com/jackc/pgx/v5-5.9.2`、`fork/feat/team-johnny-desktop` 共 7 个已从 fork 远端删除。`fork` 当前仅保留 `dev/delicious233` 和 `master` |
| 文档治理 | 根级重复文档（`docs/branch-governance.md`、`docs/governance-execution.md`、`docs/security-risk-register.md`）已删除，权威版本统一在 `docs/governance/`；收件箱移交文档已归档；README 公开路径已修正 |

## 2026-05-26 已清理

| 类别 | 结果 |
|---|---|
| WebAgent | `feat/web-agent-closeout-20260526` 已 fast-forward 合入 `dev/delicious233`，本地/远端分支已删除 |
| Execution Target UI inventory | `feat/execution-target-ui` 已 fast-forward 合入 `dev/delicious233` 并推送；临时 worktree、本地分支和远端分支均已删除 |
| Execution Target workspace policy | `feat/target-workspace-allowlist` 已 fast-forward 合入 `dev/delicious233`，本地 worktree、本地分支和远端分支均已删除 |
| TokenDance ID / Web token 收口 | `feat/td-id-runtime-integration` 已 fast-forward 合入 `dev/delicious233` 并推送；临时 worktree、本地分支和远端分支均已删除 |
| Agent Runtime 架构收口 | `0f1f9c1 docs(architecture): 固化 Agent Runtime 实体模型` 已推送到 `dev/delicious233`，明确 `AgentRuntime -> AgentProfile -> ExecutionTarget -> Thread -> Run -> RunEvent -> Approval/Artifact` 主线 |
| Web parity 本地残留 | 本地 `feat/web-desktop-parity`、`worktree-feat+web-desktop-parity` 已删除；相关 commit/stash 已导出到 `.worktrees/.trash/feat-web-desktop-parity-archive-20260526/`；远端 `origin/worktree-feat+web-desktop-parity` 已删除 |
| team authz/reliability/adapter | `feat/team-hub-authz`、`feat/team-hub-reliability`、`feat/team-adapter-compat` 已独立合入 `dev/delicious233`，远端分支已删除 |
| integration sweep | PR #197 已关闭；`feat/team-integration-sweep` 本地 worktree、本地分支、远端分支已删除 |
| OIDC 旧保存点 | 本地 worktree/分支和远端保存分支均已删除；当前状态以 `dev/delicious233`、roadmap 和 root governance docs 为准 |
| 已合入历史 team 分支 | `team-auth-guard`、`team-data-shield`、`team-edge-*`、`team-oidc-*`、`team-security-*`、`team-session-lifecycle`、`team-tokendance-deep-integration`、`team-validation-wall` 等远端分支已删除 |
| Runtime live smoke | `test(runtime): 验证真实 Runtime smoke` 已合入并推送；`chore/runtime-live-smoke` worktree/本地分支已删除 |
| Web typed runtime payload | `feat(web): 展示 Hub Runtime 结构化消息` 已合入并推送；`feat/web-typed-hub-events` worktree/本地分支已删除 |
| 旧远端保存/备份 | OIDC 旧保存分支与 `origin/worktree-feat+web-desktop-parity` 已删除；前者内容被当前主文档/root docs 覆盖且包含本地 artifact 路径，不再保留为公开远端分支 |

## 后续原则

- 新工作必须从 `dev/delicious233` 新建独立分支；多人并行或大范围实现优先使用独立 worktree。
- 当前 v4 主线例外：`feat/desktop-web-v4-clean-rebuild` 已作为主工作树推进；后续子代理只在明确互不重叠的路径范围内进入该分支，或从它派生临时 worktree。
- Trump/Johnny/旧 Web parity 只按单独审查结论 cherry-pick 或重做，不做大分支直合。
- 公开 PR/issue 不写本机路径、私有服务器、token、生产日志或截图中的敏感信息。
