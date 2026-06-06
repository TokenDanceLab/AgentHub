# 模型选择决策树

最后更新：2026-06-05

## 可用 subagent 入口

| 入口 | 别名/模型 | 上下文 | 优势 | 限制 |
|---|---|---:|---|---|
| Codex 自带 agent 工具 | GPT-5.5 | 256k | 全方面强，代码、agentic 执行、审查都稳 | 上下文不如 Claude opus，不能吃超大仓库研究 |
| Claude CLI | **opus** = DeepSeek-V4-Pro | 1M | 速度快、强推理、长上下文，适合架构设计、安全审查、竞品仓库研究 | 代码实现不作为首选 |
| Claude CLI | **sonnet** = GLM-5.1 | 200k | 强代码和 agentic 能力，适合聚焦实现 | 不要给大批量阅读 |
| Claude CLI | **haiku** = DeepSeek-V4-Flash | 200k | 速度快、轻量反馈，适合快速检查、轻量 review、日志/文档/小范围 UI 可读性审查 | 不作为代码主力 |

## 选择原则

- **先看入口**：Codex 自带 agent 工具和 Claude CLI 是两套执行面，不能把别名混用。
- **先限上下文**：超过 256k 的研究、竞品仓库阅读、跨大量文件审查优先 Claude opus；不超过 256k 的核心代码实现优先 Codex GPT-5.5。
- **先限写入范围**：任何编码 subagent 都必须有允许路径、禁止范围、验收命令和证据输出。
- **轻量检查单独派发**：快速 sanity check、日志/文档/小范围 UI 可读性审查优先 Claude haiku，不让代码主力消耗在低风险扫读上。

## 决策流程

```
任务类型？
├── 核心实现 / 跨前后端小集成
│   ├── 上下文 <= 256k → Codex GPT-5.5 subagent
│   └── 上下文 > 256k → 拆小；设计交给 Claude opus，代码交给 GPT-5.5/sonnet
├── 窄范围代码修复（明确 1-3 个文件）
│   ├── Go/TS/测试小切片 → Claude sonnet（GLM-5.1）
│   └── 高风险实现 review → Codex GPT-5.5 或 Claude opus 复核
├── 长上下文推理 / 架构 / 安全 / 竞品仓库研究
│   └── Claude opus（DeepSeek-V4-Pro, 1M）
├── 截图 / 竞品图 / 视觉 QA / UI 可读性
│   └── Claude haiku（DeepSeek-V4-Flash，200k，快速轻量反馈）
├── 机械批量文档或格式统一
│   ├── 中等上下文 → Codex GPT-5.5
│   └── 超大上下文或需要归纳 → Claude opus 先规划，再分片执行
└── 交叉审查
    ├── 安全/架构/长期方向 → Claude opus
    ├── 代码正确性/集成风险 → Codex GPT-5.5
    ├── 小范围实现细节 → Claude sonnet
    └── 小范围 UI 可读性/布局文字检查 → Claude haiku
```

## 上下文管理

| Agent | 上限 | 策略 |
|---|---:|---|
| Codex GPT-5.5 | 256k | 给完整任务卡 + 必要文件；适合强实现和强 review |
| Claude opus | 1M | DeepSeek-V4-Pro；可给大仓库、大量文档、竞品源码；产出方案/审查，不直接机械改大批文件 |
| Claude sonnet | 200k | GLM-5.1；prompt 精简，只传相关文件；适合窄范围代码和测试 |
| Claude haiku | 200k | DeepSeek-V4-Flash；快速检查、轻量 review、日志/文档/小范围 UI 可读性审查 |

## 并行度

- 写入范围互不重叠时才能并行。
- R2/R4/R5/R3/R6A 这类 Desktop 队列按依赖顺序合并；只读 review 可并行。
- 视觉 QA 可以和代码 review 并行，但修复必须由主 Agent 统一分派。
- subagent 完成后，主 Agent 必须复核 diff、运行 targeted checks，再更新 roadmap 或合并。
