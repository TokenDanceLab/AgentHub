> 📦 已归档

# AgentHub 文档中文化路线图

日期：2026-05-21

目标：AgentHub 自有文档最终全部中文化，让同学、老师和后续接手的 Agent 都能直接读懂。这个任务可以交给 DeepSeek 等低成本模型分批执行；当前维护者只需要先保证关键入口准确。

DeepSeek 交接入口：`docs/deepseek-handoff.md`。

## 范围

需要中文化：

- `README.md`
- `AGENTS.md`
- `docs/*.md`
- `docs/research/*.md`
- `docs/reference/**/*.md`
- `hub-server/README.md`
- `edge-server/README.md`
- `runner/README.md`
- `api/README.md`

不翻译：

- `reference/**` 下 clone 回来的第三方仓库文件
- 代码文件、生成文件、锁文件
- Go package、TypeScript package、API method、JSON key、CLI 命令

## 优先级

| 批次 | 范围 | 目的 |
|---|---|---|
| P0 | `README.md`、`AGENTS.md`、`docs/glossary.md`、`docs/project-management.md`、`docs/language-policy.md` | 让新人、同学和 Agent 先看懂入口规则。 |
| P1 | `docs/architecture.md`、`docs/topology.md`、`docs/product-model.md`、`docs/data-model.md`、`docs/protocol.md`、`docs/implementation-plan.md` | 让核心架构和协议说明统一中文。 |
| P2 | `hub-server/README.md`、`edge-server/README.md`、`runner/README.md`、`api/README.md`、`docs/module-boundaries.md` | 让 Go 服务、API 契约和模块边界可读。 |
| P3 | `docs/research/*.md`，尤其 `docs/research/bytedance.md` | 让比赛材料和对外材料中文可交付。 |
| P4 | `docs/reference/01-learn/**`、`docs/reference/02-decide/**` | 让竞品调研和选型结论中文化。 |
| P5 | `docs/reference/03-build/**`、`docs/reference/04-plan/**` | 让后端、前端规格和实现计划中文化。 |

## DeepSeek 执行规则

给翻译模型的提示词应包含以下要求：

```text
你正在翻译 AgentHub 自有技术文档。

要求：
1. 输出中文技术文档，不要写翻译说明。
2. 保留 markdown 结构、标题层级、表格、链接和代码块。
3. 不翻译代码块、路径、命令、API method、JSON key、event type、Go/TS package 名。
4. 第三方项目名保留英文，例如 Multica、Ruflo、Codex、OpenHands。
5. 遇到不易懂的英文缩写，改成中文白话，例如“API 契约”和“事件契约”。
6. 不要新增“我们的决策过程”之类聊天式内容，只保留结论、规则、结构和接口。
7. 如果原文里有明显过时链接或旧中文 README 文件名，标记为 TODO，不要猜。
```

## 每批验收

每批翻译后至少检查：

```powershell
Select-String -Path .\README.md,.\README_EN.md,.\AGENTS.md,.\docs\*.md,.\docs\reference\README.md -Pattern ('README_Z' + 'H')
git diff --check
git status --short --branch
```

人工抽查重点：

- 链接没有被翻译坏。
- 代码块和命令没有被翻译。
- Hub Server、Edge Server、Runner、AgentRun、Artifact 等核心术语没有乱改。
- 没有新增大段“本文将介绍”“综上所述”之类空话。
- 没有把 `reference/**` 第三方仓库内容纳入翻译。

## 建议 issue

如果需要在 GitHub 追踪，开一个聚合 issue 即可：

```text
M0: 中文化 AgentHub 自有文档
```

验收标准：

- P0-P2 完成后，关键入口、服务 README 和 API README 均为中文。
- P3 完成后，比赛材料可以直接交给同学或老师阅读。
- P4-P5 完成后，`docs/reference/**` 自有调研和规格文档均为中文，保留必要英文源码符号。
