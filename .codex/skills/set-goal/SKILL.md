---
name: set-goal
description: Use when 用户要求持续推进 AgentHub、按路线图开发、协调 subagent、使用 worktree、自己迭代、自己 review、交叉 review、验证、更新文档或收口 git。
---

# Set Goal

这个 skill 用来启动仓库级持续开发循环。它不是普通的一次性修 bug 流程，而是让 Agent 按路线图持续推进、自己拆任务、自己验证、自己 review、必要时调度 subagent，并把进展写回仓库。

## 核心规则

AgentHub 的持续开发台账放在 `docs/roadmap.md` 和 `docs/roadmaps/`，不是根目录 `ROADMAP.md`。

每次触发时，先尝试设置平台运行时 goal。平台 goal 如果可用，必须包含这句话：

```text
使用当前仓库的 docs/roadmap.md 和 docs/roadmaps/ 记录进展、决策、验证结果和下一步。
```

如果平台 goal 工具不可用或报错，不要停止；继续使用 `docs/roadmap.md` 和对应方向路线图。

## 触发场景

以下情况使用本 skill：

- 用户调用 `set-goal`
- 用户说“持续开发”“综合推进项目”“继续按路线图推进”
- 用户要求 Agent 自己决定下一步、自己 review、自己提交
- 用户要求多 Agent / subagent / worktree 并行推进
- 当前任务跨多步，需要实现、验证、文档、review 和 git 收口

普通小修小补不需要强行触发，除非用户明确要求持续推进。

## 路线图位置

- 总路线图：`docs/roadmap.md`
- 前端路线图：`docs/roadmaps/frontend.md`
- 后端路线图：`docs/roadmaps/backend.md`
- 客户端路线图：`docs/roadmaps/client.md`
- 分支路线图：`docs/roadmaps/branches/<branch-name>.md`

分支名里的 `/` 在文件名中改成 `-`，例如：

```text
codex/m2-edge-data-layer -> docs/roadmaps/branches/codex-m2-edge-data-layer.md
```

## 执行入口

按顺序读取：

1. `AGENTS.md`
2. `README.md`
3. `docs/roadmap.md`
4. 当前任务所属方向的路线图
5. 当前分支路线图
6. 相关主文档、API 文档、代码和测试

然后加载本 skill 的 reference：

1. `references/platform-goals.md`
2. `references/roadmap-driven-loop.md`
3. `references/agent-development-loop.md`
4. `references/review-and-git-gates.md`

## 默认循环

每轮只选 1 到 3 个高价值任务，按这个顺序推进：

1. 确认当前分支、工作区和路线图。
2. 选择本轮任务，写清写入范围和验收命令。
3. 需要时使用 `.worktrees/` 和 subagent，但写入范围必须互不重叠。
4. 先做基线验证，再实现。
5. 实现后运行最小相关测试。
6. 自我 review：检查 diff、边界、错误处理、文档和隐私。
7. 交叉 review：非平凡改动必须让独立 reviewer 或 subagent 检查。
8. 修复 review 发现的高优先级问题。
9. 重新验证。
10. 更新路线图、相关文档和验收记录。
11. 检查 git status，提交并按项目规则 push。

## 自主边界

可以直接执行：

- 读文件、改代码、写测试、更新文档
- 创建或更新 `docs/roadmaps/**`
- 运行本地检查和测试
- 调度 subagent 做明确、窄范围的实现或 review
- 在当前分支提交小而完整的增量

必须暂停确认：

- 部署到生产环境
- 删除数据或执行不可逆迁移
- 处理真实密钥、token、私有服务器信息
- force push 共享分支
- 超出当前路线图的大范围重写

## 失败处理

如果遇到阻塞：

1. 先用具体命令复现。
2. 判断是环境、依赖、权限、测试、设计还是实现问题。
3. 尝试一个最小可逆修复。
4. 仍无法解决时，把错误原文、已尝试动作、下一步写入分支路线图。
5. 再向用户说明阻塞。

不要把“我觉得可能”写成事实；路线图只记录可复用、可验证的信息。
