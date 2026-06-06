---
name: dev-loop
description: "自主开发推进引擎——ROADMAP 驱动、模型分配、并行 subagent 协作、交叉审查、文档同步、自动沉淀。长程多步骤任务使用 /dev-loop 启动。短任务（单文件修复、小改动）不需要——直接做。"
---

# Dev Loop — 自主开发推进引擎

> 短任务（单文件修复、typo、小改动）**不需要这个 skill**——直接做，别绕弯。
> 长程任务（跨文件重构、多步骤功能、需要审查的变更）用它。

## 模型分配策略

> 最后更新：2026-06-07。与 AGENTS.md 保持同步。`opus` / `sonnet` / `haiku` 是 Claude CLI 路由别名；Codex 自带 agent 工具单独建模。

| 入口 | 别名/模型 | 上下文 | 强项 | 派发策略 |
|---|---|---:|---|---|
| Codex 自带 agent 工具 | GPT-5.5 low/mid | 256k | 前端、看图、UI/视觉判断、常规实现和审查 | 前端 UI、截图对比、局部体验判断、常规 code review |
| Codex 自带 agent 工具 | GPT-5.5 xhigh | 256k | 最强架构推理和复杂工程设计 | 复杂架构、关键方案、跨模块取舍、高强度 sidecar |
| Claude CLI | **opus** = DeepSeek-V4-Pro | 1M | 速度快、强推理、长上下文 | 大范围阅读、文档整理、roadmap/architecture 归纳、竞品/仓库查找、复杂方案审查 |
| Claude CLI | **sonnet** = GLM-5.1 | 200k | 强代码和 agentic 能力 | 窄范围代码实现、测试修复、Go/TS 小切片 |
| Claude CLI | **haiku** = DeepSeek-V4-Flash | 200k | 速度快、轻量反馈 | 快速检查、轻量 review、日志/文档/小范围 UI 可读性审查 |

- **主 Agent**：设计决策、审查输出、编辑核心文件（AGENTS.md/STATE.md/ROADMAP.md）。
- **Codex GPT-5.5 low/mid**：前端、看图、截图对比、常规 UI/UX 判断。
- **Codex GPT-5.5 xhigh**：复杂架构推理、关键方案和高风险设计复核。
- **Claude opus**：DeepSeek-V4-Pro，1M 上下文，速度快、强推理，适合长文本、找东西、简单文档、架构整理、大范围归纳和复杂方案审查。
- **Claude sonnet**：GLM-5.1，200k 上下文，强代码模型，适合明确路径内的实现和 focused tests；prompt 精简，只传必要文件。
- **Claude haiku**：DeepSeek-V4-Flash，200k 上下文，快速检查、轻量 review、日志/文档/小范围 UI 可读性审查，不作为代码主力。

## CC 原生工具配合

dev-loop 配合两个 CC 内置命令使用效果最好：

### `/goal` — 会话目标锁
- 用法：`/goal "完成 server 文档中文化"`
- 设置后，会话未达目标前 `/stop` 被阻止
- 适用于：一个明确的、可在本次会话完成的目标
- 完成后自动解除。中途变更目标用 `/goal` 重新设置

### `/loop` — 定时自触发
- 用法：`/loop 10m 继续完善项目，运行测试，提交代码`
- 适用于：需要持续关注的项目、长时间运行的迭代任务
- 选择间隔时注意：< 5 分钟保持 prompt cache 热，> 5 分钟 cache 失效但有更长自主窗口
- 如果没有具体的外部信号需要轮询，默认 20-30 分钟

**组合使用：** `/goal "完成翻译并清理"` + `/loop 10m /dev-loop 继续推进剩下的工作`

## 标准工作循环

### 1. 理解
- 读 `AGENTS.md`、`docs/roadmap.md` 和当前任务关联的设计/架构文档
- 理解现有架构、约定、当前进度
- STATE.md 是跨 session 状态文件，每次接手先读

### 2. 规划
- 长期任务：创建 ROADMAP.md 或在现有 ROADMAP 中登记任务
- 本次会话目标明确 → `/goal "描述"` 锁定，防止中途退出
- 用平台 goal/todo 工具跟踪 session 状态（ROADMAP.md 是跨 session 权威）
- 从 ROADMAP 中选取 1-3 个最高价值任务
- 不确定的设计先做轻量探索（只读 agent）

### 3. 执行
- **自己（主 session）**：设计决策、审查输出、编辑核心文件（AGENTS.md/STATE.md/ROADMAP.md）
- **派 GPT-5.5 low/mid**：前端 UI、看图、截图对比、局部体验判断
- **派 GPT-5.5 xhigh**：复杂架构、关键方案、跨模块取舍
- **派 Claude opus**：长文本、找东西、简单文档、架构整理、大范围归纳、复杂方案审查
- **派 Claude sonnet**：窄范围编码实现、bug 修复、focused tests
- **派 Claude haiku**：快速检查、轻量 review、日志/文档/小范围 UI 可读性审查
- 每次 subagent 完成后审查其输出

### 4. 审查
- 完成一批变更后启动交叉审查：按维度混用 GPT-5.5 low/mid/xhigh、Claude opus、Claude sonnet、Claude haiku
- 维度：结构、文档、安全、架构、易用性、视觉 QA
- 让其他 agent 提问题："审查这个变更，列出你担心的问题"
- 修复高优先级项

### 5. 同步
- AGENTS.md / CLAUDE.md（规则变更）
- `docs/roadmap.md` 或当前任务计划文档（事实变更：进度、阻塞、下一步）
- ROADMAP.md（标记完成、记录阻塞、写下一步）
- 运行 `neat-freak` 清理过时文档
- 运行 `memory-management` 同步 memory（如有跨系统需求）
- Git：小范围 commit，及时 push

### 6. 沉淀
- 发现可复用的 SOP → 写成项目级 skill
- Skill 不含本机路径、凭据、IP——别人也能用
- 自己调用测试，迭代描述和触发条件

## Worktree 指南

**什么时候用：**
- 跨 session 重构（跨天、跨对话）
- 可能破坏主分支的实验性变更
- 并行开发多个独立功能

**什么时候不用：**
- 单文件修复、文档变更 → 直接在主分支
- 90% 的工作不需要 worktree

## 审查模式

### 交叉审查维度与模型
| 维度 | 模型 | 为什么 |
|---|---|---|
| 结构 | opus | 长上下文整理和跨文件一致性检查 |
| 文档 | opus | 一致性检查、整理和归纳 |
| 安全 | **GPT-5.5 xhigh** | 必须深度推理 |
| 架构 | **GPT-5.5 xhigh** | 需要设计判断 |
| 易用性 | GPT-5.5 low/mid | 前端体验和截图判断 |
| 业务逻辑 | **sonnet** | 强代码模型，适合 focused 逻辑检查 |

审查 agent 的 prompt 要具体：告诉它查什么、怎么报告、文件在哪。

### 自我质疑
- "新 agent 能理解吗？" "STATE.md 需要更新吗？"
- "有文件引用过时路径吗？" "memory 同步了吗？"
- "这个改动影响了其他项目吗？"

## 产品思维

- 用户第一次用怎么想？错误信息有用吗？
- 测试覆盖了真实场景还是只测 happy path？
- E2E 能跑通完整用户流程吗？界面一致吗？

## Git 约定

- `main` 稳定，`dev` 开发；小范围 commit，及时 push
- 不用 `--force`、`--no-verify`
- Commit message 写"为什么"不是"做了什么"

## 自主边界

**无需确认可直接做：** 读文件、写代码、加测试、更新文档、跑本地命令、派 subagent、小范围 commit。

**必须暂停等确认：** 生产部署、破坏性数据变更、secret 处理、不可逆迁移、超出 ROADMAP 范围的大重写。

**受阻时：** 先尝试直接解决。经过具体尝试仍受阻后，把阻塞点和下一步写入 ROADMAP.md，再问用户。

## 参考

- `references/model-strategy.md` — 模型选择决策树 + fallback 策略
- `references/review-checklist.md` — 代码审查清单
