# 2026 竞争格局与生态调研

> 调研日期：2026-05-21
> 基于 Web 搜索 + 14 份仓库深度调研 + 跨仓库综合分析

## 1. 直接威胁 — 与 AgentHub 定位最接近的新兴项目

### 1.1 Ruflo（45.2k Stars）

- **GitHub**: `ruvnet/ruflo`
- **定位**: 多 Agent 编排平台，专门为 Claude Code 设计
- **核心功能**: 100+ 专业化 Agent、Swarm 协调（分层/网格/自适应拓扑）、RAG 向量记忆、MCP 集成、跨机器通信、插件生态
- **安装**: `npx ruvflo init`
- **威胁等级**: **高**。45k stars 说明市场验证了"Claude Code + 多 Agent 编排"的需求。AgentHub 需要明确的差异化——Ruflo 是"Claude Code 的调度层"，AgentHub 是"IM 群聊式多 Agent 平台（不绑定单一 CLI）"

### 1.2 Multica（22.7k Stars）

- **GitHub**: `multica-ai/multica`，Apache 2.0
- **团队**: 4 人中国创业团队
- **定位**: AI Agent 协作平台，Linear 风格界面（issues/projects/kanban）
- **哲学**: "问题不是人和 AI 不能协作——是人和彼此的 AI 不能协作"
- **支持**: Claude Code、Codex、Cursor Agent、Hermes、OpenClaw
- **威胁等级**: **中高**。4 人团队 22.7k stars 证明小团队能做成。界面是 Linear 风格（项目管理），不是 IM 风格——这是 AgentHub 的差异点

### 1.3 Paperclip（50k Stars，2 个月）

- **定位**: 开源 Agent 编排平台，"AI 劳动力的人类控制面"
- **核心**: 组织层级（CEO/CTO/CMO）、供应商中立（Claude/GPT/Gemini 等通过 OpenRouter）、技能系统、内置 QA/Reviewer
- **威胁等级**: **中**。更偏向业务自动化而非 coding agent 协作

### 1.4 GitHub Ace（微软研究原型）

- **定位**: 协作式多 Agent 开发工作空间
- **核心**: 实时多人聊天 + 云端 microVM + 共享 Agent 访问
- **威胁等级**: **远期高**。如果是微软内部原型，可能催生官方产品。验证了"多人 + 多 Agent 共享上下文"的市场需求

### 1.5 Sema Code（arXiv 2026.4）

- **定位**: 将 AI Coding Agent 解耦为可编程、可嵌入基础设施
- **核心**: 多租户隔离、FIFO 队列、自适应上下文压缩、多 Agent 协作调度、4 层异步权限，**已接入飞书/Telegram**
- **威胁等级**: **中高**。架构理念接近 AgentHub（解耦 + 多通道 + 飞书集成）。但它是 npm 库而非独立产品

## 2. Claude Code 生态 2026

### 2.1 Agent SDK 已 GA（Python + TypeScript）

| 语言 | 包名 | 安装 |
|------|------|------|
| TypeScript | `@anthropic-ai/claude-agent-sdk` | `npm install @anthropic-ai/claude-agent-sdk` |
| Python | `claude-agent-sdk` | `pip install claude-agent-sdk` |

**核心 API**: `query()` 函数，内置完整 Agent Loop：

```python
async for message in query(
    prompt="Fix the bug in auth.py",
    options=ClaudeAgentOptions(
        allowed_tools=["Read", "Edit", "Bash", "Grep"],
        permission_mode="bypassPermissions",
        max_turns=10,
    ),
):
    # message 是流式事件
```

**AgentHub 影响**: 
- 之前设计的是 `exec.CommandContext(ctx, "claude", "-p", ...)` 包装 CLI
- **现在有了 SDK**，可以直接在 Go 中通过子进程调 Python/Node SDK，或直接嵌入（如果用 Node sidecar）
- CLI headless 仍然是轻量选择；SDK 提供更细粒度控制（session fork/resume、subagent spawn）
- **新**: 2026-06-15 起 SDK 和 `claude -p` 有独立的 Agent SDK credit 配额

### 2.2 源码泄露（2026-03-31）

v2.1.88 意外包含 59.8MB source map，暴露了完整 ~512K 行 TypeScript 代码（代号 "Tengu"）。关键发现：
- Agent Loop 是简单的 `while(true)` { 调 API → 分发工具调用 → 喂回结果 }
- 4 层上下文压缩：Microcompact → Snip → Autocompact → Reactive Compact
- 并发工具执行：只读工具并行批次，写工具序列化
- Sub-agent 有隔离上下文、工具白名单、独立 `.jsonl` transcript

## 3. Codex CLI 2026

### 3.1 Multi-Agent 已稳定

- **v0.115.0**: Multi-agent 从实验 → 默认启用（无需手动配置）
- **v0.128.0**（2026-04）: MultiAgentV2，持久化 `/goal`，外部 session 导入
- **最多 6 个并发 Agent 流**
- 三种内置 Agent 类型: `default` / `worker`（执行导向）/ `explorer`（只读探索）
- 自定义 Agent 通过 TOML 配置文件：`~/.codex/agents/` 或 `.codex/agents/`
- **`spawn_agents_on_csv`**: CSV 批量并行处理
- 默认模型 gpt-5.4

### 3.2 Desktop 更新（2026-04）

- 后台 Computer Use（macOS 应用后台操作）
- 持久化任务（跨天执行）
- Memory（记住偏好、修正、上下文）
- Agent SDK（沙箱执行）

## 4. 新兴 Agent 协议

### 4.1 Google A2A（Agent-to-Agent）

Google 发布的 Agent-to-Agent 协议，定义 Agent 间通信标准。对 AgentHub 的影响：
- 如果 A2A 成为行业标准，AgentHub 的 Orchestrator 需要支持 A2A 协议
- 当前 AgentHub 设计了自己的内部协议（protobuf），可以加一个 A2A adapter

### 4.2 Anthropic MCP（Model Context Protocol）

- MCP 已成为 Agent 工具集成的事实标准
- AgentHub 应优先支持 MCP 作为 Tool Provider（已在 design-protocol.md 中定义）

## 5. 对 AgentHub 的战略建议

### 5.1 差异化定位

| 竞品 | 核心交互 | AgentHub 差异化 |
|------|---------|----------------|
| Ruflo | Claude Code 调度层（NPM CLI） | 不绑定单一 Agent CLI |
| Multica | Linear 项目管理界面 | **IM 消息流**（更像飞书群聊） |
| Paperclip | 企业组织结构 | 开发者优先（不是企业自动化） |
| Sema Code | npm 库 + 飞书/Telegram bot | **完整 Desktop App + IM UI** |
| GitHub Ace | 云端多人协作 | P0 本地离线可用 |

### 5.2 利用 Claude Agent SDK

- **短期（P0-P1）**: 继续用 `claude -p --output-format stream-json`（最简、已验证）
- **中期（P2+）**: 封装 Claude Agent SDK 的 Python/TS 调用为另一个 Adapter 选项
- SDK 的优势：session fork/resume、subagent spawn、更细粒度的 permission 控制

### 5.3 关注 A2A 协议

- A2A 可能成为 Agent 间通信的行业标准
- AgentHub 的内部协议（protobuf）保持，但预留 A2A gateway

### 5.4 时间窗口

- 2026 年 Q2 是 Agent 协作平台的爆发期
- Ruflo 45k stars 验证了需求，但没有一个产品用 **IM 消息流**作为交互范式
- AgentHub 的窗口：12-18 个月，在"IM Agent 协作"这个细分建立认知
