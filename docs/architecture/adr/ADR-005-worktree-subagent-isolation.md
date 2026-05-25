# ADR-005: Git Worktree 隔离 + Subagent 模式

**日期**: 2026-05-24
**状态**: 已采纳
**决策者**: Delicious233, Johnny, Trump

## 背景

项目有 3 个开发者（客户端、后端、前端），每个开发者都使用 AI Agent（Claude Code、Codex 等）辅助开发。多人在不同功能分支上并行工作时，如果共用同一工作目录，会出现文件冲突、Agent 互相干扰、上下文污染等问题。

## 决策

采用 **Git worktree 隔离 + subagent 路径约束** 模式：

- 每个功能分支使用独立的 Git worktree，存放在 `.worktrees/` 目录（已 `.gitignore`）。
- 一个 worktree = 一个短分支 = 一个 PR。不同 Agent 永远不会共享同一个 worktree。
- 创建前必须同步 master：`git switch master && git pull --ff-only`。
- Subagent 只能在当前 worktree 的指定路径内工作，不能访问其他 worktree 或项目外路径。
- Dev Loop 引擎定义了模型分配策略（Opus 负责设计/审查，Sonnet 负责机械工作，Haiku 负责编码实现）。
- 完成后执行验收命令、push 分支、开 PR，合并后删除 worktree。

## 后果

- 需要 `.worktrees/` 在 `.gitignore` 中排除，防止 worktree 目录被提交。
- 分支清理规程必须严格执行：合并后 `git worktree remove .worktrees/<name>` + 删除远程分支，否则磁盘空间随时间增长。
- Subagent 范围约束：主 Agent 分发任务时必须明确写入范围（允许修改的路径），subagent 发现范围不够必须停下交回。
- 新建 worktree 前需同步 master，否则 worktree 基线过旧会导致大量冲突。
- 合并方向固定：`feat/* -> dev/delicious233 -> master`，确保各方向改动最终汇入主 dev 分支。

## 备选方案

- **共享分支直接开发**：多人共用同一个 dev 分支。被否决——Agent 会同时修改同一批文件，Git 冲突频繁，且 Agent 的 stash/checkout 操作容易互相干扰。
- **Docker 开发环境**：每个开发者/Agent 在容器中工作。被否决——桌面 GUI（Tauri）在容器中调试困难，且本地 workspace 文件绑定需要复杂卷挂载配置，整体太重。
- **全远程开发**：所有 Agent 在云端工作，本地只做终端。被否决——本地 CLI 执行延迟和文件系统访问是桌面场景的核心优势，全远程会丧失这些优势。
