# 模型选择决策树

最后更新：2026-06-05

## 可用 subagent 入口

| 入口 | 别名/模型 | 上下文 | 优势 | 限制 |
|---|---|---:|---|---|
| Codex 自带 agent 工具 | GPT-5.5 low/mid | 256k | 前端、看图、UI/视觉判断、常规实现和审查 | 不吃超大仓库研究 |
| Codex 自带 agent 工具 | GPT-5.5 xhigh | 256k | 最强架构推理和复杂工程设计 | 上下文仍不适合超大仓库全文阅读 |
| Claude CLI | **sonnet** = DeepSeek-V4-Pro | 1M | 长上下文、找东西、长文本整理、架构整理 | 代码实现不作为首选 |
| Claude CLI | **opus** = GLM-5.1 | 200k | 强代码和 agentic 能力，适合聚焦实现 | 不要给大批量阅读 |
| Claude CLI | **haiku** = DeepSeek-V4-Flash | 200k | 速度快、轻量反馈，适合快速检查、轻量 review、日志/文档/小范围 UI 可读性审查 | 不作为代码主力 |

## 选择原则

- **先看入口**：Codex 自带 agent 工具和 Claude CLI 是两套执行面，不能把别名混用。
- **先限上下文**：超过 256k 的研究、竞品仓库阅读、跨大量文件审查优先 Claude sonnet；复杂架构判断优先 GPT-5.5 xhigh；明确文件集代码实现优先 Claude opus。
- **先限写入范围**：任何编码 subagent 都必须有允许路径、禁止范围、验收命令和证据输出。
- **轻量检查单独派发**：快速 sanity check、日志/文档/小范围 UI 可读性审查优先 Claude haiku，不让代码主力消耗在低风险扫读上。

## 决策流程

```
任务类型？
├── 核心实现 / 跨前后端小集成
│   ├── 上下文 <= 256k → GPT-5.5 low/mid 或 xhigh，按复杂度选择
│   └── 上下文 > 256k → Claude sonnet 先整理，再拆给实现 agent
├── 窄范围代码修复（明确 1-3 个文件）
│   ├── Go/TS/测试小切片 → Claude opus（GLM-5.1）
│   └── 高风险实现 review → GPT-5.5 xhigh 或主 Agent 复核
├── 长上下文推理 / 架构 / 安全 / 竞品仓库研究
│   └── GPT-5.5 xhigh（复杂架构）或 Claude sonnet（长文本/找东西/整理）
├── 截图 / 竞品图 / 视觉 QA / UI 可读性
│   └── Claude haiku（DeepSeek-V4-Flash，200k，快速轻量反馈）
├── 机械批量文档或格式统一
│   ├── 中等上下文 → GPT-5.5 low/mid
│   └── 超大上下文或需要归纳 → Claude sonnet 先整理，再分片执行
└── 交叉审查
    ├── 安全/架构/长期方向 → GPT-5.5 xhigh
    ├── 代码正确性/集成风险 → GPT-5.5 xhigh 或主 Agent
    ├── 小范围实现细节 → Claude opus
    └── 小范围 UI 可读性/布局文字检查 → Claude haiku
```

## 上下文管理

| Agent | 上限 | 策略 |
|---|---:|---|
| GPT-5.5 low/mid | 256k | 前端、看图、截图对比、常规 UI/UX 判断 |
| GPT-5.5 xhigh | 256k | 复杂架构、关键方案、高风险设计复核 |
| Claude sonnet | 1M | DeepSeek-V4-Pro；长文本、找东西、简单文档、架构整理、大范围归纳 |
| Claude opus | 200k | GLM-5.1；prompt 精简，只传相关文件；适合窄范围代码和测试 |
| Claude haiku | 200k | DeepSeek-V4-Flash；快速检查、轻量 review、日志/文档/小范围 UI 可读性审查 |

## 并行度

- 写入范围互不重叠时才能并行。
- R2/R4/R5/R3/R6A 这类 Desktop 队列按依赖顺序合并；只读 review 可并行。
- 视觉 QA 可以和代码 review 并行，但修复必须由主 Agent 统一分派。
- subagent 完成后，主 Agent 必须复核 diff、运行 targeted checks，再更新 roadmap 或合并。
