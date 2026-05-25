# 分支治理

最后更新：2026-05-25（分支大扫除 + Desktop P1 完成）

## 合并规则

```
feat/* → dev/maintainer → master
```

- `master` 禁止直接 push，必须通过 PR
- `dev/maintainer` 合并前本地验证：`go test ./...` + `pnpm test` + `pnpm build`
- 合并前先 rebase 到最新 `dev/maintainer`

## 当前分支状态

| 分支 | 说明 | 状态 |
|------|------|:--:|
| **dev/maintainer** | 主开发分支，唯一事实源 | ★ 活跃 |
| master | 稳定发布，PR only | Q2 验收后同步 |
| dev/contributor-b | contributor-b 的 Web 前端 | 独立开发，不合并 |

## 已清理（2026-05-25 大扫除）

| 资源 | 清理前 | 清理后 |
|------|--------|--------|
| 本地分支 | 9 个 | **2 个**（dev/maintainer + dev/contributor-b） |
| Worktrees | 5 个 | **1 个**（主 worktree） |
| Stashes | 9 个 | **0 个** |

已删除分支：`dev/contributor-a`、`codex/contributor-a-fork`、`codex/contributor-b-ui-fork`、`codex/contributor-b-ui-fork-repair`、`feat/agent-runtime-expansion`、`feat/webui-desktop-port`、`worktree-adapt-contributor-b-ui`

## 给 contributor-b

- 活跃分支：`dev/contributor-b`
- 不要合并到 dev/maintainer
- 最终由 contributor-b 自行决定是否 PR

## 给 maintainer（自己）

- 始终从 `dev/maintainer` 开始工作
- 新功能：`feat/<name>` → PR → `dev/maintainer`
- 完成后删除 feat 分支和对应 worktree
- remote fork 分支由 fork 所有者自行管理
