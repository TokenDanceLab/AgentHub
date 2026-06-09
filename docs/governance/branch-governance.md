# 分支治理

最后更新：2026-06-08（dev/delicious233 主线 + backend 受控切片合并）

## 合并规则

```text
feat/* -> dev/delicious233 -> master
```

- `dev/delicious233` 是当前唯一开发事实源，主工作树已回到该分支。
- `master` 禁止直接 push，必须通过 PR。
- `feat/*` 合入前先同步最新 `dev/delicious233`，解决冲突并跑对应验证。
- 完成后删除已合入的 `feat/*` 分支和对应 worktree。
- `dev/trump`、Johnny 聚合分支和 Web parity 残留分支不作为自动合入来源。
- 后端进入主线前按 [backend-integration-governance.md](../backend-integration-governance.md) 的 AH-SYNC 和切片门禁执行。

## 当前本地状态

| 分支 | 说明 | 状态 |
|------|------|:--:|
| **dev/delicious233** | 主开发事实源；Desktop/Web v4 PR #291 已合入该线 | 活跃 |
| **master** | 稳定快照；PR #292 已同步到 `dev/delicious233` 对应状态 | 保留 |
| feat/backend-edge-hub | 后端/Edge-Hub 并行线；只能按切片 ready-for-review 后由主负责人合并 | 受控推进 |
| codex/backend-*-0607 | 后端临时切片分支；先登记审查，再合入/归档/删除 | 待清理 |
| feat/web-desktop-parity | 早期 Web parity 本地分支，唯一提交 `797983e`；已导出 patch 后删除本地分支 | 已归档 |
| worktree-feat+web-desktop-parity | 早期 Web parity 本地/远端分支已删除；本地 patch 归档只作参考 | 已归档 |

当前登记 worktree：

| Worktree | HEAD/分支 | 用途 | 规则 |
|---|---|---|---|
| 主工作树 | `dev/delicious233` | 当前主线、Desktop/Web v4 已合入 | 直接开发前先确认 dirty paths，禁止 `git add .` |
| `.worktrees/backend` | `feat/backend-edge-hub` | 后端/Edge-Hub 并行线 | 按 AH-SYNC 推进，不自行合并 |
| `.worktrees/backend-*-0607` | `codex/backend-*-0607` | 后端历史切片和 review worktree | 登记后按重复/已合入/待审分类清理 |
| `.worktrees/johnny-dev` | detached HEAD | 协作者 Johnny 状态检查线 | 只读/隔离，不能自动合并 |

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
| `origin/feat/backend-edge-hub` | backend 并行线 | 按切片 review 后合入 `dev/delicious233`，不整包直合 |
| `origin/dev/trump` | 主线 ahead 3 / 分支 ahead 0 | Trump 线当前无独有提交但落后主线；保留，不作为本轮 UI 来源 |
| `origin/dev/johnny` | 主线 ahead 320 / 分支 ahead 11 | Johnny 线仍有少量独有提交但大幅落后；只单独审，不直合 |

当前 `origin` 活跃 heads 以 live `git branch -r` 为准。已删除的过时 `feat/*`、`fix/*`、`phase-*`、`integration/*` 不得在 AGENTS/roadmap 中重新引用为活跃远端。

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
- 后端现有 `feat/backend-edge-hub` 是历史并行线例外；后续只按切片进入主线，不再继续叠加无边界大包。
- Trump/Johnny/旧 Web parity 只按单独审查结论 cherry-pick 或重做，不做大分支直合。
- 公开 PR/issue 不写本机路径、私有服务器、token、生产日志或截图中的敏感信息。

## 2026-06-08 Backend 清理结果

后端临时分支先按 [backend-integration-governance.md](../backend-integration-governance.md) 分类处理。当前原则：

- `feat/backend-edge-hub` 保留为后端整合主线，先拆切片 review。
- `codex/backend-api-contract-0607`、`codex/backend-cli-e2e-0607`、`codex/backend-oidc-log-0607`、`codex/backend-release-artifact-0607`、`codex/backend-docs-governance`、`codex/backend-johnny-pick`、`codex/backend-openapi-contract` 属 patch-unique 待审，不能直接删。
- 已删除本地干净重复 worktree 和本地分支：`codex/backend-docs-sync-*`、`codex/backend-review-readonly`、`codex/backend-gate-fixes`、`codex/backend-sync-at4`、`codex/backend-ci-e2e-0607`、`codex/backend-db-migration-0607`、`codex/backend-env-sanitizer-0607`、`codex/backend-health-ready-0607`、`codex/backend-hub-edge-e2e-0607`、`codex/backend-remote-cors-0607`、`codex/backend-target-credential-0607`、`codex/backend-ws-delivery-0607`。
- `codex/backend-edge-split` 和 `codex/backend-test-coverage` 当前 worktree 有未提交改动，先保留，等待 owner 或主负责人审查后再处理。
- `.worktrees/johnny-dev` 是协作者检查线，不纳入 backend/codex 清理。
