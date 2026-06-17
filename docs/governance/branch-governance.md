# 分支治理

最后更新：2026-06-17（worktree 列表与 live system 一致性验证通过）

## 合并规则

```text
feat/* -> dev/delicious233 -> master
```

- `dev/delicious233` 是当前唯一开发事实源，主工作树已回到该分支。
- `master` 禁止直接 push，必须通过 PR。
- `feat/*` 合入前先同步最新 `dev/delicious233`，解决冲突并跑对应验证。
- 完成后删除已合入的 `feat/*` 分支和对应 worktree。
- `dev/trump`、Johnny 聚合分支和 Web parity 残留分支不作为自动合入来源。
- 后端进入主线前按 `docs/roadmap/` 中的管线门禁执行。

## 当前本地状态

| 分支 | 说明 | 状态 |
|------|------|:--:|
| **feat/chatview-tokendance-migration** | ChatView 迁移 + TokenDance 品牌化（当前 worktree） | 活跃 |
| **feat/restructure-cleanup** | 仓库重组清理 worktree | 活跃 |
| **dev/delicious233** | 主开发事实源；Desktop/Web v4 已合入 | 活跃 |
| **dev/delicious223** | v0.4.0 开发分支（从 dev/delicious233 fork） | 活跃 |
| **master** | 稳定快照 | 保留 |

当前登记 worktree：

| Worktree | HEAD/分支 | 用途 | 规则 |
|---|---|---|---|
| 主工作树 | `dev/delicious233` | 当前主线、Desktop/Web v4 已合入 | 直接开发前先确认 dirty paths |
| `.worktrees/chatview-migration` | `feat/chatview-tokendance-migration` | ChatView 迁移 + TokenDance 品牌化 | ChatView 模块写入 |
| `.worktrees/restructure-cleanup` | `feat/restructure-cleanup` | 仓库重组清理 | 结构变更写入 |

已验证（2026-06-17）：worktree 列表与 live system 一致，`.worktrees/chatview-migration` 和 `.worktrees/restructure-cleanup` 均活跃且 HEAD 匹配。

已归档/已删除 worktree：旧 `.worktrees/doc-governance`、`.worktrees/.trash/codex-trump-fork-archived-20260526` 等已清理或移至 trash。

## 当前远端未合入

| 远端分支 | 相对 `origin/dev/delicious233` | 处理建议 |
|---|---|---:|
| `origin/feat/chatview-tokendance-migration` | ChatView 迁移 + TokenDance 品牌化主线 | 当前活跃，完成后合入 `dev/delicious233` |
| `origin/feat/restructure-cleanup` | 仓库重组清理 | 当前活跃，完成后合入 `dev/delicious233` |
| `origin/dev/trump` | 主线 ahead 大量 / 分支 ahead 0 | Trump 线当前无独有提交但落后主线；保留，不作为本轮 UI 来源 |
| `origin/dev/johnny` | 主线 ahead 大量 / 分支 ahead 少量 | Johnny 线仍有少量独有提交但大幅落后；只单独审，不直合 |
| `upstream/main` | 上游主分支 | 上游参考，通过 fork sync 合并 |
| 历史 codex 切片（已清理） | 已从远端删除 | 不再作为活跃远端引用 |

当前 origin 活跃 heads 以 live `git branch -r` 为准。已删除的过时 `feat/*`、`fix/*`、`phase-*`、`integration/*`、`codex/backend-*`、`codex/mobile-*`、`codex/p0-*`、`codex/p1-*`、`codex/web-*`、`dev/release-*` 不得在 AGENTS/roadmap 中重新引用为活跃远端。


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
- 历史 `feat/backend-edge-hub` 并行线已清理，不再直接引用。
- Trump/Johnny/旧 Web parity 只按单独审查结论 cherry-pick 或重做，不做大分支直合。
- 公开 PR/issue 不写本机路径、私有服务器、token、生产日志或截图中的敏感信息。

## 2026-06-17 当前主干清理状态

- `feat/chatview-tokendance-migration` — 当前活跃 worktree，ChatView 迁移 + TokenDance 品牌化
- `feat/restructure-cleanup` — 仓库重组清理 worktree
- 历史后端切片分支（`codex/backend-*`）已从远端清理，不再作为活跃引用
- 历史前端切片（`codex/p0-*`、`codex/p1-*`、`codex/web-*`、`codex/mobile-*`）已从远端清理
- `origin/feat/backend-edge-hub` 已从远端清理
- 旧 `docs/backend-integration-governance.md` 引用已移除（文件不存在）
