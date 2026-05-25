# 分支治理

最后更新：2026-05-25（分支大扫除 + Desktop P1 完成）

## 合并规则

```
feat/* → dev/delicious233 → master
```

- `master` 禁止直接 push，必须通过 PR
- `dev/delicious233` 合并前本地验证：`go test ./...` + `pnpm test` + `pnpm build`
- 合并前先 rebase 到最新 `dev/delicious233`

## 当前分支状态

| 分支 | 说明 | 状态 |
|------|------|:--:|
| **dev/delicious233** | 主开发分支，唯一事实源 | ★ 活跃 |
| master | 稳定发布，PR only | Q2 验收后同步 |
| dev/trump | Trump 的 Web 前端 | 独立开发，不合并 |

## 已清理（2026-05-25 大扫除）

| 资源 | 清理前 | 清理后 |
|------|--------|--------|
| 本地分支 | 9 个 | **2 个**（dev/delicious233 + dev/trump） |
| Worktrees | 5 个 | **1 个**（主 worktree） |
| Stashes | 9 个 | **0 个** |

已删除分支：`dev/johnny`、`codex/johnny-fork`、`codex/trump-ui-fork`、`codex/trump-ui-fork-repair`、`feat/agent-runtime-expansion`、`feat/webui-desktop-port`、`worktree-adapt-trump-ui`

## 给 Trump

- 活跃分支：`dev/trump`
- 不要合并到 dev/delicious233
- 最终由 Trump 自行决定是否 PR

## 给 Delicious233（自己）

- 始终从 `dev/delicious233` 开始工作
- 新功能：`feat/<name>` → PR → `dev/delicious233`
- 完成后删除 feat 分支和对应 worktree
- remote fork 分支由 fork 所有者自行管理
