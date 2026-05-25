# 分支治理

最后更新：2026-05-26（WebAgent + team 安全修复合入，worktree 清理）

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
| feat/web-desktop-parity | 早期 Web parity 本地分支，和当前 WebAgent 主线大幅分叉 | 保留待人工决策 |
| worktree-feat+web-desktop-parity | 早期 Web handoff 分支，跟踪 `origin/worktree-feat+web-desktop-parity` | 保留待人工决策 |

当前登记 worktree 只有主工作树 `D:/Code/TokenDance/AgentHub`。

## 当前远端未合入

| 远端分支 | 处理建议 |
|---|---|
| `origin/chore/oidc-handoff-save-20260526` | 已保存 OIDC handoff；本地 worktree 已清理，远端保留 |
| `origin/dev/trump` | Trump 独立开发线；用户明确要求不信其进度，不自动合入 |
| `origin/feat/team-johnny-merge` | Johnny 聚合 merge，存在 API、process executor test、migration rename 冲突；单独审，不直合 |
| `origin/worktree-feat+web-desktop-parity` | 早期 Web parity/handoff 残留；diff 会回滚当前 WebAgent 成果，保留待人工决策 |

`origin/dev/johnny` 已合入主线但受 GitHub 分支保护，删除被拒绝；保留为受保护历史分支。

## 2026-05-26 已清理

| 类别 | 结果 |
|---|---|
| WebAgent | `feat/web-agent-closeout-20260526` 已 fast-forward 合入 `dev/delicious233`，本地/远端分支已删除 |
| team authz/reliability/adapter | `feat/team-hub-authz`、`feat/team-hub-reliability`、`feat/team-adapter-compat` 已独立合入 `dev/delicious233`，远端分支已删除 |
| integration sweep | PR #197 已关闭；`feat/team-integration-sweep` 本地 worktree、本地分支、远端分支已删除 |
| OIDC handoff | 本地 worktree/分支已删除，远端保存分支保留 |
| 已合入历史 team 分支 | `team-auth-guard`、`team-data-shield`、`team-edge-*`、`team-oidc-*`、`team-security-*`、`team-session-lifecycle`、`team-tokendance-deep-integration`、`team-validation-wall` 等远端分支已删除 |

## 后续原则

- 新工作必须从 `dev/delicious233` 新建独立 worktree，不再多人共住主工作树。
- Trump/Jonny/旧 Web parity 只按单独审查结论 cherry-pick 或重做，不做大分支直合。
- 公开 PR/issue 不写本机路径、私有服务器、token、生产日志或截图中的敏感信息。
