# 分支治理

最后更新：2026-05-25（integration sweep 接手）

## 合并规则

```text
feat/* -> dev/delicious233 -> master
```

- `master` 禁止直接 push，必须通过 PR。
- `dev/delicious233` 是当前主开发基线；开始新功能前先同步该分支。
- `feat/*` 合并前需要 rebase 或 merge 最新 `dev/delicious233`，解决冲突后再开 PR 或交给 integration sweep。
- 当前 integration 分支只负责合并与文档对齐；没有 fresh 验证证据前，不在文档中写“测试通过”或“已完成”。

## 当前事实快照

| 项 | 当前事实 |
|---|---|
| 主开发分支 | `dev/delicious233`，当前主 worktree HEAD 为 `69085d5` |
| Integration 分支 | `feat/team-integration-sweep` |
| Integration worktree | 当前验证 worktree 为 `.worktrees/team-integration-verify`；分支 `feat/team-integration-sweep` 是权威，可按需重建 worktree |
| 主 worktree | dirty，仍有 UIUX、OIDC、Web 相关并行改动；不要当作干净可发布基线 |
| Worktree 数量 | 以 `git worktree list` 实时输出为准；不要复用旧的 23 个 worktree 记录 |
| Web worktree | `worktree-feat+web-desktop-parity` 分支仍保留；具体 worktree 路径需实时核验，不得写成已清理或已合入 |
| 迁移文件 | `hub-server/migrations` 当前有 28 个 `.up.sql`；latest dev + integration 已协调为 `0020`-`0028` 连续平台 migrations，仍需 schema/migration smoke |

## 当前分支状态

| 分支 | 说明 | 状态 |
|------|------|:--:|
| `dev/delicious233` | 主开发分支，当前 HEAD `69085d5` | 活跃 |
| `feat/team-integration-sweep` | 当前集成分支；具体 HEAD 以 `git log -1` 为准 | integration 中处理 |
| `master` | 稳定发布，PR only | Q2 验收后同步 |
| `dev/trump` | Trump 的 Web 前端分支 | 独立开发，不直接合并 |
| `worktree-feat+web-desktop-parity` | Web parity worktree 分支 | 仍在工作 |

旧 `feat/webui-desktop-port` 相关记录只能作为历史线索；当前 Web 状态以 `worktree-feat+web-desktop-parity` 和 integration sweep 后续验证为准。

## Candidate 分支处理状态

以下候选分支已经进入或等待进入 `feat/team-integration-sweep`。“已进入 integration”表示分支已 merge 到 integration 分支，但仍需 fresh 验证和最终 PR；“integration 中处理”表示尚未完成最终取舍。

| Worktree | 分支 | 归属面 | 状态 |
|---|---|---|---|
| `.worktrees/team-adapter-compat` | `feat/team-adapter-compat` | Edge/adapter | 已进入 integration |
| `.worktrees/team-auth` | `feat/team-auth-guard` | Auth | integration 中处理 |
| `.worktrees/team-data` | `feat/team-data-shield` | Data/security | integration 中处理 |
| `.worktrees/team-edge` | `feat/team-edge-fortress` | Edge | integration 中处理 |
| `.worktrees/team-hub-authz` | `feat/team-hub-authz` | Hub authz | 已进入 integration |
| `.worktrees/team-hub-reliability` | `feat/team-hub-reliability` | Hub reliability | 已进入 integration |
| `.worktrees/team-johnny-merge` | `feat/team-johnny-merge` | Johnny merge | 已进入 integration；Go/OpenAPI 验证通过，PR/部署前 schema smoke pending |
| `.worktrees/team-oidc-desktop` | `feat/team-oidc-desktop` | Desktop OIDC | integration 中处理 |
| `.worktrees/team-oidc-edge` | `feat/team-oidc-edge` | Edge OIDC | integration 中处理 |
| `.worktrees/team-oidc-hub` | `feat/team-oidc-hub` | Hub OIDC | integration 中处理 |
| `.worktrees/team-s3` | `feat/team-s3-storage` | S3 storage | integration 中处理 |
| `.worktrees/team-security-desktop` | `feat/team-security-desktop` | Desktop security | integration 中处理 |
| `.worktrees/team-security-edge` | `feat/team-security-edge` | Edge security | integration 中处理 |
| `.worktrees/team-security-hub` | `feat/team-security-hub` | Hub security | integration 中处理 |
| `.worktrees/team-security-router` | `feat/team-security-router` | Router/security | integration 中处理 |
| `.worktrees/team-session` | `feat/team-session-lifecycle` | Session lifecycle | integration 中处理 |
| `.worktrees/team-tokendance-deep` | `feat/team-tokendance-deep-integration` | TokenDance integration | integration 中处理 |
| `.worktrees/team-validation` | `feat/team-validation-wall` | Validation | integration 中处理 |
| 实时核验 | `worktree-feat+web-desktop-parity` | Web parity | 分支仍保留；路径不得沿用旧记录 |

Detached verification worktrees such as `.worktrees/verify-johnny` and `.worktrees/verify-merge` are evidence/inspection worktrees, not merge targets.

## 给协作者

- 不要把旧“分支大扫除后只剩 1 个 worktree”的记录当成当前事实。
- Web parity worktree 仍在工作；状态只能写为进行中。
- 不要把 candidate 分支写成已合入 `dev/delicious233`，除非 integration sweep 已完成冲突处理、diff、fresh 验证并通过 PR/merge。
- 不要在公开文档中写本机绝对路径；使用 repo-relative path，例如 `.worktrees/team-integration-verify`。
