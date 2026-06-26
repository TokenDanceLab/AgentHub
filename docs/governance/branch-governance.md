# 分支治理

最后更新：2026-06-27

## 合并规则

```text
task/* 或 feat/* -> dev/delicious233 -> master
```

- `dev/delicious233` 是当前开发集成基线。
- `master` 禁止直接 push，必须通过 PR。
- 新工作从最新 `dev/delicious233` 新建短分支；多人并行或大范围实现优先使用独立 worktree。
- 合入前同步最新 `dev/delicious233`，解决冲突并运行任务卡要求的验证。
- 合并后删除已合入的短分支和对应 worktree。

## Live State 规则

本文件不维护“当前活跃分支/worktree”表。分支和 worktree 状态会快速变化，写成表格会误导后续 Agent。

需要当前状态时运行：

```powershell
git status --short --branch
git worktree list
git branch -r --no-merged origin/dev/delicious233
```

只有 live 命令输出、GitHub issue/milestone、PR 状态能作为当前分支事实。历史审计、归档专项、旧 handoff 中的分支名不能作为自动合入来源。

## Worktree 规则

- 项目级 worktree 固定放在 `.worktrees/`，该目录已在 `.gitignore` 中忽略。
- 一个 worktree 对应一个短分支、一个任务卡或一个 PR；不要多个 Agent 共用同一 worktree。
- 创建前先确认根工作树干净或明确隔离写入范围，再从最新 `dev/delicious233` 创建。
- 每个 worktree 必须绑定任务卡、允许改动路径、禁改范围和验证命令。
- worktree 内禁止保存密钥、真实服务器配置、私有日志和本机 Agent 状态。

示例：

```powershell
git checkout dev/delicious233
git pull --ff-only
git worktree add .worktrees/task-322-governance -b task/322-governance-baseline
```

## 历史分支处理

- `dev/delicious223` 是历史集成线，不再作为当前开发基线。
- `dev/trump`、`dev/johnny`、旧 Web parity 和旧 ChatView 迁移分支不作为自动合入来源。
- 历史切片只按单独审查结论 cherry-pick 或重做，不能因为旧文档提到就直接合入。
- 公开 PR、issue 和文档不写本机路径、私有服务器、token、生产日志或截图中的敏感信息。
