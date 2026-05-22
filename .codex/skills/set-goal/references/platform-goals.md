# 平台 Goal 规则

`set-goal` 可以在不同 Agent 平台运行。不同平台的 goal / todo 工具不一样，但行为必须一致：平台运行时 goal 只是会话辅助，仓库里的路线图才是跨会话依据。

## 必须写入的 goal 文本

如果当前平台支持 goal 或 todo 状态，创建或更新 goal 时必须包含：

```text
使用当前仓库的 docs/roadmap.md 和 docs/roadmaps/ 记录进展、决策、验证结果和下一步。
```

推荐目标：

```text
按照当前仓库的 docs/roadmap.md 和 docs/roadmaps/ 持续推进 AgentHub，完成一个可验证的小增量，并同步测试、文档、review 和 git 状态。
```

## Codex

Codex 可用时：

- 优先创建一个具体、当前仓库范围内的 active goal。
- 使用 plan / todo 工具维护本轮执行清单。
- 同一时间只保留一个 `in_progress` 任务。
- 如果 goal 工具失败，继续用 plan 和 `docs/roadmaps/**`；不要因为运行时 goal 写不进去而停止。

## Claude Code / DeepSeek / 其它 Agent

如果平台没有 goal 工具：

- 在第一条进度说明里声明当前目标。
- 维护本轮短 checklist。
- 使用 `docs/roadmap.md`、方向路线图和分支路线图作为持久台账。

## 卫生规则

- goal 不能大于当前仓库范围。
- goal 不能替代路线图。
- 不读 `AGENTS.md`、`README.md` 和路线图，不得新开方向。
- 只把可复用、可验证的信息写进路线图；命令噪音和临时猜测不写。
