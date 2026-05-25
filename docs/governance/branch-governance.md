# 分支治理

最后更新：2026-05-26（TokenDance ID/Web token 收口合入，旧 Web/Johnny/Trump 分支审查）

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
| worktree-feat+web-desktop-parity | 早期 Web handoff 本地分支；本地分支已删除，远端 `origin/worktree-feat+web-desktop-parity` 仅作公共备份 | 已归档 |

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
| `origin/chore/oidc-handoff-save-20260526` | 单提交 `e8cb573` 只保存 `docs/handoff/codex-session-2026-05-25-backend.md`，但基于旧大工作树；当前 TokenDance ID loopback / AgentHub OIDC 状态已由 `dev/delicious233` 和 root docs 覆盖。可保留短期备查，不能 merge |
| `origin/dev/trump` | Trump 独立开发线；用户明确要求不信其进度。merge-base `e19ddfa`，相对当前 dev 为 `89/49` 分叉，merge-tree 大量冲突；只允许逐提交 cherry-pick 并重新验证 |
| `origin/feat/team-johnny-merge` | Johnny 聚合 merge；merge-base `7600452`，相对当前 dev 为 `96/1` 分叉，包含 migrations/API/process-executor-test 等冲突；只单独审，不直合 |
| `origin/worktree-feat+web-desktop-parity` | 早期 Web parity/handoff 残留；diff 会回滚当前 WebAgent 与 Web Hub token sessionStorage 成果，merge-tree 大量冲突；只保留 patch 参考，不直合 |

`origin/dev/johnny` 已合入主线但受 GitHub 分支保护，删除被拒绝；保留为受保护历史分支。

## 2026-05-26 已清理

| 类别 | 结果 |
|---|---|
| WebAgent | `feat/web-agent-closeout-20260526` 已 fast-forward 合入 `dev/delicious233`，本地/远端分支已删除 |
| TokenDance ID / Web token 收口 | `feat/td-id-runtime-integration` 已 fast-forward 合入 `dev/delicious233` 并推送；临时 worktree、本地分支和远端分支均已删除 |
| Agent Runtime 架构收口 | `0f1f9c1 docs(architecture): 固化 Agent Runtime 实体模型` 已推送到 `dev/delicious233`，明确 `AgentRuntime -> AgentProfile -> ExecutionTarget -> Thread -> Run -> RunEvent -> Approval/Artifact` 主线 |
| Web parity 本地残留 | 本地 `feat/web-desktop-parity`、`worktree-feat+web-desktop-parity` 已删除；相关 commit/stash 已导出到 `.worktrees/.trash/feat-web-desktop-parity-archive-20260526/`；远端 `origin/worktree-feat+web-desktop-parity` 仅作公共备份，不作为合入来源 |
| team authz/reliability/adapter | `feat/team-hub-authz`、`feat/team-hub-reliability`、`feat/team-adapter-compat` 已独立合入 `dev/delicious233`，远端分支已删除 |
| integration sweep | PR #197 已关闭；`feat/team-integration-sweep` 本地 worktree、本地分支、远端分支已删除 |
| OIDC handoff | 本地 worktree/分支已删除，远端保存分支保留 |
| 已合入历史 team 分支 | `team-auth-guard`、`team-data-shield`、`team-edge-*`、`team-oidc-*`、`team-security-*`、`team-session-lifecycle`、`team-tokendance-deep-integration`、`team-validation-wall` 等远端分支已删除 |

## 后续原则

- 新工作必须从 `dev/delicious233` 新建独立 worktree，不再多人共住主工作树。
- Trump/Jonny/旧 Web parity 只按单独审查结论 cherry-pick 或重做，不做大分支直合。
- 公开 PR/issue 不写本机路径、私有服务器、token、生产日志或截图中的敏感信息。
