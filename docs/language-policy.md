# AgentHub 文档语言规则

日期：2026-05-21

AgentHub 的文档默认面向两类读者：同学、老师等人类读者，以及后续接手的 Agent。语言规则要同时照顾这两类读者。

## 总原则

- AgentHub 自有文档最终全部中文化。
- 关键入口先中文化，长文档按 `docs/chinese-documentation-roadmap.md` 分批交给低成本模型处理。
- 代码和协议保持英文；commit / issue / PR 标题使用英文规范前缀 + 中文内容。
- 第三方 clone 下来的 `reference/**` 原仓库文件不翻译、不改写。
- 不使用没解释的缩写。需要英文术语时，第一次出现就写白话解释。

## 中文化范围

这些 AgentHub 自有文档必须中文化：

- `README.md`
- `AGENTS.md`
- `docs/*.md`
- `docs/research/*.md`
- `docs/reference/**/*.md`
- `services/*/README.md`
- `packages/*/README.md`

英文版 README 保留在 `README_EN.md`。如果 README 结构有变化，中文主入口先改，英文版随后同步要点。

## 保持英文的内容

这些内容保持英文，避免代码和工具链混乱：

- Go package 名、TypeScript package 名、目录名
- Protobuf message、field、enum、service 名
- API method、WebSocket event、JSON key
- Git branch 名
- Git commit message 的 type/scope，例如 `docs:`、`feat(edge):`
- CLI 命令和配置 key
- 第三方项目、库和产品名

示例：

```text
正确：唯一协议源头是 proto/agenthub/v1，Go 和 TypeScript 类型从这里生成。
避免：只写英文缩写，不解释它解决什么问题。
```

## 调研文档规则

`docs/reference/**` 是 Agent 和实现阶段使用的深度调研区，里面可能包含英文摘录、源码符号和原仓库术语。它也要逐步中文化，但要按路线图分批做，避免一次性低质量机械翻译。

- `docs/reference/README.md` 用中文说明每份文档该什么时候读。
- 新增调研文档必须有中文标题或中文摘要。
- 修改调研文档时，补清楚中文结论和 Agent 阅读路线。
- 翻译正文时保留代码块、文件路径、函数名、协议字段、第三方项目名。
- 比赛材料和老师会看的材料优先中文化，例如 `docs/research/bytedance.md`。

## 新文档默认规则

新增文档时按用途选语言：

| 文档用途 | 默认语言 |
|---|---|
| 项目介绍、架构解释、管理规范、比赛材料 | 中文 |
| 协议 schema、代码生成说明、API 字段参考 | 中文说明 + 英文字段 |
| 第三方源码摘录、竞品原文笔记 | 中文说明 + 保留必要英文原文 |
| 给外部开源社区看的说明 | 可新增英文版，但中文主入口保持最新 |

## 写作要求

- 少用黑话，多写“它负责什么、它不负责什么、它和谁交互”。
- 缩写必须解释；如果解释后仍然不清楚，就换成中文短语。
- 同一个概念全仓库统一叫法，例如 Hub Server、Edge Server、Runner 不随意改成 LocalServer、Daemon 或 Worker。
- 讨论阶段可以长，落到仓库里的文档要收口成规则、结构和接口，不写聊天式决策过程。
