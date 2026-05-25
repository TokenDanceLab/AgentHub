# 分支治理

最后更新：2026-05-26（Runtime live smoke / Web typed runtime payload 合入，旧远端保存分支清理）

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
| **dev/delicious233** | 主开发分支，当前已推送到 origin | 活跃 |
| master | 稳定发布，PR only | 保留 |
| feat/web-desktop-parity | 早期 Web parity 本地分支，唯一提交 `797983e`；已导出 patch 后删除本地分支 | 已归档 |
| worktree-feat+web-desktop-parity | 早期 Web handoff 本地/远端分支已删除；本地 patch 归档只作参考 | 已归档 |

当前登记 worktree 只有主工作树 `D:/Code/TokenDance/AgentHub`。旧残留目录 `.worktrees/codex-trump-fork` 已移动到 `.worktrees/.trash/codex-trump-fork-archived-20260526`，未直接删除。

当前 stash 为空。旧 Web parity 相关 stash 已先导出 patch，再从本地 stash 删除：

| Patch | 来源 | 处理建议 |
|---|---|---|
| `.worktrees/.trash/feat-web-desktop-parity-archive-20260526/0001-feat-web-Desktop-API.patch` | `feat/web-desktop-parity` 唯一提交 `797983e` | 只作 patch-review 参考，禁止直合 |
| `.worktrees/.trash/feat-web-desktop-parity-archive-20260526/stash0-feat-web-desktop-parity.patch` | 旧 `feat/web-desktop-parity` stash | 只作 patch-review 参考，禁止自动应用 |
| `.worktrees/.trash/feat-web-desktop-parity-archive-20260526/stash1-dev-delicious233.patch` | 旧 `dev/delicious233` stash | 只作 UI 回捞参考，禁止自动应用 |

## 当前远端未合入

| 远端分支 | 处理建议 |
|---|---|
| `origin/dev/trump` | Trump 独立开发线；用户明确要求不信其进度。当前仍在持续新增 pass 分支，不能作为稳定进度来源；只允许逐提交 cherry-pick 并重新验证 |
| `origin/feat/trump-desktop-button-*` / `origin/feat/trump-desktop-right-panel-tabs` / `origin/feat/trump-desktop-settings-button-pass2` | Trump button/UI pass 分支仍在远端增长（截至本轮已看到 pass1、pass3-pass9 等）；不直合、不按其状态更新 roadmap，只能按单 patch 审查后重做或 cherry-pick |
| `origin/feat/team-johnny-merge` | Johnny 聚合 merge；merge-base `7600452`，相对当前 dev 为 `96/1` 分叉，包含 migrations/API/process-executor-test 等冲突；只单独审，不直合 |

`origin/dev/johnny` 已合入主线但受 GitHub 分支保护，删除被拒绝；保留为受保护历史分支。

## 2026-05-26 已清理

| 类别 | 结果 |
|---|---|
| WebAgent | `feat/web-agent-closeout-20260526` 已 fast-forward 合入 `dev/delicious233`，本地/远端分支已删除 |
| TokenDance ID / Web token 收口 | `feat/td-id-runtime-integration` 已 fast-forward 合入 `dev/delicious233` 并推送；临时 worktree、本地分支和远端分支均已删除 |
| Agent Runtime 架构收口 | `0f1f9c1 docs(architecture): 固化 Agent Runtime 实体模型` 已推送到 `dev/delicious233`，明确 `AgentRuntime -> AgentProfile -> ExecutionTarget -> Thread -> Run -> RunEvent -> Approval/Artifact` 主线 |
| Web parity 本地残留 | 本地 `feat/web-desktop-parity`、`worktree-feat+web-desktop-parity` 已删除；相关 commit/stash 已导出到 `.worktrees/.trash/feat-web-desktop-parity-archive-20260526/`；远端 `origin/worktree-feat+web-desktop-parity` 已删除 |
| team authz/reliability/adapter | `feat/team-hub-authz`、`feat/team-hub-reliability`、`feat/team-adapter-compat` 已独立合入 `dev/delicious233`，远端分支已删除 |
| integration sweep | PR #197 已关闭；`feat/team-integration-sweep` 本地 worktree、本地分支、远端分支已删除 |
| OIDC handoff | 本地 worktree/分支和远端保存分支均已删除；当前状态以 `dev/delicious233`、STATE 和 root governance docs 为准 |
| 已合入历史 team 分支 | `team-auth-guard`、`team-data-shield`、`team-edge-*`、`team-oidc-*`、`team-security-*`、`team-session-lifecycle`、`team-tokendance-deep-integration`、`team-validation-wall` 等远端分支已删除 |
| Runtime live smoke | `test(runtime): 验证真实 Runtime smoke` 已合入并推送；`chore/runtime-live-smoke` worktree/本地分支已删除 |
| Web typed runtime payload | `feat(web): 展示 Hub Runtime 结构化消息` 已合入并推送；`feat/web-typed-hub-events` worktree/本地分支已删除 |
| 旧远端保存/备份 | `origin/chore/oidc-handoff-save-20260526` 与 `origin/worktree-feat+web-desktop-parity` 已删除；前者内容被当前 handoff/root docs 覆盖且包含本地 artifact 路径，不再保留为公开远端分支 |

## 后续原则

- 新工作必须从 `dev/delicious233` 新建独立 worktree，不再多人共住主工作树。
- Trump/Jonny/旧 Web parity 只按单独审查结论 cherry-pick 或重做，不做大分支直合。
- 公开 PR/issue 不写本机路径、私有服务器、token、生产日志或截图中的敏感信息。
