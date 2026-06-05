# AgentHub 竞争格局 Web 调研报告 (2026-05)

> 调研日期：2026-05-21
> 调研范围：2025-2026 年新出现的 Agent 平台/工具/协议，聚焦与 AgentHub 的竞争与差异化

---

## 1. Executive Summary

2026 年是 AI coding agent 从 "单兵作战" 转向 "多 Agent 协作" 的关键转折年。Gartner 报告显示企业关于多 Agent 系统的咨询量同比 **飙升 1445%**。Andrej Karpathy 在 2026 年 2 月正式提出 "Agentic Engineering" 学科概念。

**与 AgentHub 最直接相关的五大发现**：

| 发现 | 威胁级别 | 说明 |
|------|----------|------|
| **GitHub Ace** 原型 | HIGH | Slack + GitHub + Agent 的多人协作工作区，与 AgentHub 理念高度重叠 |
| **SemaClaw** 开源 | MEDIUM | 同一引擎驱动 VS Code + IM（飞书/Telegram/QQ），底层架构可复用 |
| **Thenvoi Agentic Mesh** | MEDIUM | Agent 间通信中间件，Chat Room 概念可演化为 AgentHub 的替代 |
| **CodeBanana (出门问问)** | MEDIUM | 国内 "项目=群聊+Agent+Workspace" 产品，IM 形态的竞争对手 |
| **EvolClaw / AUN 网络** | LOW-MEDIUM | Agent 互通网络 + 群聊共享会话，但偏向个人 Agent 而非开发者协作 |

**AgentHub 的核心差异化机会**：
- **IM 原生 UX**：飞书/微信级熟悉的群聊交互 = 最低学习成本
- **Hub-Edge-Runner 架构**：边缘执行 + 中心编排，兼顾隐私与协作
- **开发者定向**：面向 Claude Code / Codex / OpenCode 用户，而非通用 Agent 平台
- **协议先行**：A2A + MCP 双协议栈，让 AgentHub 成为 Agent 间通信的 "IM 路由器"

---

## 2. 2025-2026 新出现的 Agent 平台

### 2.1 GitHub Next: Ace（研究原型）

- **URL**: https://githubnext.com/talks/one-developer-two-dozen-agents-zero-alignment/
- **发布方**: GitHub Next (Maggie Appleton)
- **状态**: 研究原型，数千用户技术预览

**核心理念**：现有 AI coding agent 都是 "单人游戏"（single-player），但软件开发本质是团队运动。Ace 提供 Slack 式聊天 + 共享终端 + Live Preview + Agent 共存的工作区。

**关键能力**：
- 多人 + 多 Agent 在同一个 Channel 中协作
- Cloud microVM 隔离每个 session 的 git branch
- 团队多人可 Prompt 同一个 Agent，Agent 读取全量对话上下文
- Agent 自动 commit + 可读的 commit message
- "Team Pulse" AI 仪表盘总结

**与 AgentHub 差异**：
| 维度 | GitHub Ace | AgentHub |
|------|-----------|----------|
| 形态 | 独立 Web 工作区 | IM 群聊（飞书/微信形态） |
| 基础设施 | Cloud microVM (GitHub 托管) | Hub-Edge-Runner (本地边缘执行) |
| 定位 | GitHub 生态内协作 | 跨工具/跨模型的 Agent 协作 |
| 用户群 | GitHub 用户 | Claude Code / Codex / OpenCode 用户 |
| 开放性 | GitHub Next 闭源研究 | 计划开源 |

**威胁评估**：如果 GitHub 将 Ace 产品化并集成到 GitHub.com，将形成巨大的网络效应壁垒。但 Ace 是 "从 GitHub 向外看" 的视角，AgentHub 可以从 "IM 入口" 差异化。

---

### 2.2 Sema Code / SemaClaw（开源）

- **论文**: https://arxiv.org/abs/2604.11045 (Sema Code) / https://arxiv.org/abs/2604.11548 (SemaClaw)
- **发布方**: 美的集团 AIRC 研究院
- **时间**: 2026-04-13
- **代码**: https://github.com/midea-ai/SemaClaw

**核心理念**："驾驭工程"（Harness Engineering）—— 决定 Agent 系统好坏的关键不在模型，而在模型外层的管控基础设施。

**关键能力**：
- **Sema Code Core**：可嵌入的 Agent 运行时，与客户端解耦
- **SemaClaw**：同一 Core 引擎同时驱动 VS Code 插件 + 多通道 IM 网关
- **IM 适配器**：Telegram、飞书/Lark、QQ 频道
- **Web UI**：`http://127.0.0.1:18788/` 内置 Web 面板
- **DAG 团队编排**：编排器动态生成任务依赖图，DispatchBridge 确定性调度
- **PermissionBridge**：高风险操作需用户审批

**与 AgentHub 差异**：
| 维度 | SemaClaw | AgentHub |
|------|----------|----------|
| 架构 | 单体 Core + 多客户端适配器 | Hub-Edge-Runner 分布式架构 |
| IM 集成 | 适配器模式（1 个 Core 对多 IM） | IM 即原生协作层 |
| 多 Agent 协作 | DAG 编排 + DispatchBridge | 群聊式自然协作 |
| 目标用户 | 个人开发者 + 企业 | 开发者团队 |

**关键启示**：SemaClaw 证明了 "同一 Agent 引擎 + 多 IM 通道" 的技术可行性。AgentHub 可以借鉴其 PermissionBridge 和 DAG 编排思路。

---

### 2.3 Thenvoi / BAND Agentic Mesh

- **URL**: https://itbrief.com.au/story/thenvoi-unveils-platform-to-orchestrate-ai-coding-agents
- **发布方**: Thenvoi AI Ltd.
- **融资**: $17M Seed
- **代码**: https://github.com/thenvoi/codeband

**核心理念**："Agent 本身不能互相协作"—— 开发者用 Claude Code 做规划、Codex 写代码、其他 Agent 做测试，但这些工具在孤立 Session 中运行，靠人工做胶水。

**关键能力**：
- **Agentic Mesh**：Agent 之间互相发现、交换结构化消息、维持同步上下文
- **Shared Chat Rooms**：人和 Agent 在同一个聊天室里协作
- **Control Plane**：运行时治理（权限边界、凭证遍历、策略执行）
- **确定性路由**：patent-pending 多层架构（非 LLM 路由，避免非确定性错误）
- **Codeband**：开源的多 Agent 对抗编码工具（Claude Code 写 + Codex 审）

**与 AgentHub 差异**：
| 维度 | Thenvoi | AgentHub |
|------|---------|----------|
| 形态 | 中间件 / API 层 | IM 群聊入口 |
| Room 概念 | Shared Chat Rooms | IM 群聊天然就是 Room |
| 框架依赖 | 需集成 LangChain/CrewAI 等 | CLI Agent 直连，无需框架适配 |
| 治理 | 内置 Control Plane | Hub 层治理 |

**关键启示**：Thenvoi 的 Shared Chat Room 概念与 AgentHub 的 IM 群聊异曲同工。但 Thenvoi 是中间件（需要集成），AgentHub 可以做成开箱即用的产品。

---

### 2.4 Google Antigravity 2.0 / CLI

- **URL**: https://virtualizationreview.com/articles/2026/05/19/google-moves-gemini-cli-into-antigravity-cli-as-agent-platform-expands.aspx
- **Google I/O 2026 发布**
- **价格**: $100/月 AI Ultra tier

**关键能力**：
- Gemini CLI 并入 Antigravity CLI（消费者 6 月 18 日下线）
- 多 Agent 系统：Agent 间通信、分工、共享 backend
- 异步工作流：Agent 后台运行不阻塞终端
- Agent Manager：跨 workspace 管理多个 Agent
- 浏览器 Agent + AI IDE 集成

**与 AgentHub 差异**：Google 走 "全家桶" 路线（CLI + IDE + Browser + Cloud），AgentHub 走 "联合舰队" 路线（接入已有 CLI Agent）。

---

### 2.5 JetBrains Central

- **URL**: https://www.infoworld.com/article/4149535/new-jetbrains-platform-manages-ai-coding-agents.html
- **时间**: Q2 2026 Early Access
- **取代**: Code With Me（已退役）

**定位**：Agent 驱动的软件生产控制与执行平面。治理、云 Agent 运行时、跨 repo 共享上下文。面向 JetBrains IDE 生态。

**与 AgentHub 差异**：IDE 内嵌 vs IM 独立入口；JetBrains 生态绑定 vs AgentHub 跨工具。

---

### 2.6 Warp Oz

- **URL**: https://www.warp.dev/newsroom/2026/2/10/warp-launches-oz-the-orchestration-platform-for-cloud-coding-agents
- **时间**: 2026-02

**定位**：云原生 Agent 编排平台。并行运行/管理数百个 Agent，完整审计追踪，Docker 沙箱隔离。

---

### 2.7 开源编排平台精选

| 平台 | 语言 | Stars | 差异化 |
|------|------|-------|--------|
| [Paperclip](https://github.com/paperclipai/paperclip) | TypeScript | 50k+ | "公司" 组织架构模型，CEO/Worker Agent |
| [Swarms](https://github.com/Horizontes-LLC/swarms) | Python | - | 10+ Agent 架构，企业生产级 |
| [Agetor](https://github.com/alamops/agetor) | TypeScript | - | Kanban + Git Worktree 隔离 |
| [Mission Control](https://github.com/builderz-labs/mission-control) | TypeScript | - | 32 面板 Dashboard，零外部依赖 |
| [Zenflow](https://github.com/zendev-sh/zenflow) | Go | - | 单二进制文件，YAML DAG |
| [Hive Orchestrator](https://github.com/intertwine/hive-orchestrator) | Python | - | Git-native, Markdown 共享内存 |
| [OpenCognit](https://github.com/OpenCognit/opencognit) | TypeScript | - | CEO 编排器 + 持久记忆 + Critic 循环 |
| [NullBoiler](https://github.com/nullclaw/nullboiler) | Python | - | Tracker / Orchestrator / Agent 严格分离 |

**关键观察**：
1. 这些平台都是 "中央控制" 模式（一个 Orchestrator 调度 N 个 Worker），而非 AgentHub 的 "对等协作" IM 模式
2. 无一使用 IM 群聊作为人机交互界面
3. 多数面向 task 分发，而非 conversation 驱动的协作

---

## 3. Claude Code 生态

### 3.1 官方 Desktop App 重大更新

- **URL**: https://claude.com/blog/claude-code-desktop-redesign
- **时间**: 2026-01 (Desktop Preview) / 2026-04 (Redesign) / 2026-05 (Agent View)

**关键更新**：
- **Agent View** (2026-05-12)：统一管理所有 AI coding session，三态分类（Running / Awaiting Reply / Completed）
- **`/bg` 命令**：发送 session 到后台运行
- **Drag-and-drop 面板布局**：终端 / 预览 / Diff / 聊天自由排列
- **SSH 支持扩展至 macOS**
- **Figma "Code to Canvas"** 集成

### 3.2 第三方 UI / 前端生态

| 工具 | 类型 | Stars | 关键能力 |
|------|------|-------|----------|
| [1Code](https://hunted.space/dashboard/1code-cursor-like-ui-for-claude-code/launches/1code-2) | Web + Mac | PH #1 | Cursor-like UI，parallel agents |
| [ClaudeCodeUI](https://github.com/siteboon/claudecodeui) | Web | 10.5k | 远程 session 管理，移动端支持 |
| [Conductor](https://github.com/Conductor) | macOS Desktop | - | 多 worktree 并行，CI auto-forward |
| [Claude Chic](https://matthewrocklin.com/introducing-claude-chic/) | TUI (Python) | - | Textual 框架，Git Worktrees，2026-01 |
| [Toad](https://github.com/) | TUI | - | ACP 协议，支持 12+ Agent CLI |
| [Open Design](https://github.com/nexu-io/open-design) | Web | - | 16 种 CLI Agent 自动检测，设计品生成 |
| [Open CoDesign](https://github.com/OpenCoworkAI/open-codesign) | Desktop (Electron) | - | MIT 开源，多模型，完全本地 |
| [TOKENICODE](https://github.com/yiliqi78/TOKENICODE) | Desktop (Tauri) | - | Tauri 2 + React 19 + Tailwind 4 |

### 3.3 Agent SDK 生态

- **TypeScript**: `@anthropic-ai/claude-agent-sdk` v0.2.126
- **Python**: `claude-agent-sdk` v0.1.72
- **2026-06-15 起**：SDK 和 `claude -p` 用量从独立 Agent SDK credit 扣减
- **内置工具**: Read / Write / Edit / Bash / Glob / Grep / WebSearch / WebFetch / Monitor / AskUserQuestion
- **高级特性**: Hooks / Subagents / MCP / Sessions / Skills / Memory / Plugins
- **2026-03 源码泄露**（~512K 行 TypeScript）催生了大量社区复现项目

**与 AgentHub 差异**：
- Claude Code 官方路线是 "Desktop App + CLI" 双轨，无意做 Web/IM 界面
- 第三方 UI 生态活跃但碎片化——AgentHub 可以作为统一协作层
- Agent SDK 提供了标准化的 Agent 接入接口——AgentHub Edge 可以用 SDK 直接驱动 Claude Code Agent

---

## 4. Codex / Cursor / Windsurf 生态

### 4.1 OpenAI Codex CLI (2026)

- **Changelog**: https://developers.openai.com/codex/changelog
- **v0.128.0**: `/goal` 命令（Ralph Loop 模式），持久状态 survive 重启
- **v0.125.0**: Unix socket transport, remote thread config, Bedrock 支持, hooks 稳定
- **v0.106.0**: 多 Agent workflow tracking, TUI `/theme` 选择器, 语音输入
- **v0.78.0**: Firewall Rules API, macOS MDM 支持
- **GPT-5.4 支持** (2026-03)：1M token 上下文, native computer-use, 33% fewer false claims
- **Chat Completions API 已退役** (2026-02)，全面迁移到 Responses API

**Codex Desktop App (2026-02)**：
- macOS 桌面 App（Windows 计划中）
- 多个 Agent 并行在不同 project 中运行
- 内置 Worktree 支持，隔离 Agent 工作区
- 自动化定时任务（daily bug triage, CI failure summary）

**与 AgentHub 差异**：
- Codex Desktop 管理 "自己的多个 Agent"，而非 "团队的多个 Agent"
- 无群聊/IM 协作能力
- AgentHub 可以作为 "Codex Agent 的 IM 群聊管理层"

---

### 4.2 Cursor 3.0 (2026-04)

- **URL**: https://www.eweek.com/news/cursor-3-unified-workspace-ai-coding-agents/
- **关键更新**：
  - **Agents Window**：统一 sidebar 展示所有 Agent（local / cloud / SSH / worktrees）
  - **Parallel Agents**：跨 repo 和环境并行运行多个 Agent
  - **`/best-of-n`**：同一任务在多个模型上并行跑，选最佳输出
  - **Cloud ↔ Local Handoff**：Agent session 在云端和本地之间无缝迁移
  - **Design Mode**：浏览器内框选 UI 元素，Agent 直接修改

**Cursor 多 Agent 研究** (2026-01)：
- **Flat peer-to-peer 协调失败**：锁瓶颈 + 风险厌恶
- **Hierarchical Planner-Worker 模式成功**：Planner 探索代码库创建任务，Worker 独立执行
- **Judge Agent** 每周期决定是否继续，防止 drift
- **数百个并发 Agent 持续数周**运行
- **35% PR 由云 Agent 自主完成**

**与 AgentHub 差异**：
- Cursor 是 IDE 内 Agent 管理，AgentHub 是 IDE 外的 IM 协作
- Cursor 无群聊/团队沟通能力
- Cursor 的 Planner-Worker 架构可被 AgentHub 参考作为 "群聊内的任务分发模式"

---

### 4.3 Windsurf Cascade 2.0 (2026-04)

- **URL**: https://blink.new/blog/windsurf-review-2026
- **母公司**: Cognition (Devin)，此前被 OpenAI 约 $3B 收购 Codeium

**关键能力**：
- **Cascade Agent**: 理解全 codebase，多文件编辑，Flow State 上下文追踪
- **Agent Command Center**: Kanban 视图管理所有 Agent
- **Spaces**: 按 task 分组 Agent sessions / PRs / files
- **Devin in Windsurf**: 云端 VM + Desktop + Browser + Computer-Use
- **SWE-1.6 Fast**: 950 tok/s on Cerebras, free 3 个月
- **Memories System**: 跨 session 持久上下文
- **Wave 13**: 多 Agent 并行 + Git Worktrees
- **Cascade Hooks**: 自定义 pre/post hooks
- **MCP 支持**

**与 AgentHub 差异**：IDE 内置 vs 独立 IM 层。Windsurf 路线是 "All-in-One IDE"，AgentHub 是 "IM Layer on Top of Everything"。

---

## 5. 新兴 Agent 协议

### 5.1 A2A (Agent-to-Agent Protocol)

- **Spec**: https://github.com/a2aproject/A2A
- **官网**: https://a2a-protocol.org
- **发起方**: Google (2025-04)，已捐给 Linux Foundation
- **v1.0.0 GA**: 2026-03-12
- **GitHub Stars**: 22,700+
- **Partner**: 170+ 组织，TSC 8 席（Google / Microsoft / AWS / Salesforce / SAP / IBM / Cisco / ServiceNow）

**核心设计**：
- Agent Card：`/.well-known/agent.json`，自描述身份 + 能力 + 接口
- Task 生命周期: submitted → working → input-required → completed / failed / canceled
- 三种更新机制：Polling / SSE Streaming / Webhook Push
- JSON-RPC 2.0 over HTTP(S)，也支持 gRPC
- 5 种语言 SDK：Python / TypeScript / Java / Go / .NET
- A2A over MQTT：IoT/Edge 场景扩展

**对 AgentHub 的影响**：
- **AgentHub 应内建 A2A 支持**：让 AgentHub 内的 Agent 被外部 Agent 发现和调用
- **AgentHub 可以是 A2A Agent Card 的注册中心**：群聊里的每个 Agent 对外暴露标准 Agent Card
- **AgentHub 可以是 A2A Task 的 IM 视图**：Task 生命周期事件以群聊消息呈现

---

### 5.2 MCP (Model Context Protocol)

- **官网**: https://modelcontextprotocol.io
- **发起方**: Anthropic (2024-11)，已捐给 Linux Foundation AAIF (2025-12)
- **SDK 月下载**: 97-110M
- **MCP Servers**: 10,000-17,000+

**2026 关键更新**：
- **MCP Apps** (2026-01)：MCP Server 可推送交互式 HTML/JS UI 到 AI 聊天窗口
- **MCP Tool Search** (2026-01)：懒加载工具，Token 用量降 85%（134K→5K）
- **Self-Hosted Sandboxes + MCP Tunnels** (2026-04)：客户自控沙箱 + 内网穿透
- **Tasks Primitive (SEP-1686)**：长期自主工作流
- **2026 Roadmap**：Streamable HTTP / Session Resilience / Skills Primitive / Native Streaming

**安全事件**：OX Security 披露 MCP SDK STDIO transport RCE 漏洞，影响 7000+ 公开 Server，多个 CVE 已分配。

**对 AgentHub 的影响**：
- AgentHub Edge 可以作为 MCP Client，让 Agent 访问共享 MCP Server
- AgentHub Hub 可以托管 Team-level MCP Server 注册表
- MCP Apps 可能演变出自己的 UI 协作模式

---

### 5.3 协议栈全景

```
┌─────────────────────────────────────────────┐
│              AgentHub (IM 协作层)              │
│  群聊 / @提及 / 消息路由 / 权限 / 审计         │
├─────────────────────────────────────────────┤
│  A2A (Agent ↔ Agent)       │ MCP (Agent ↔ Tools) │
│  Task 委托 / Agent 发现     │ 工具发现 / 沙箱执行  │
├─────────────────────────────┴────────────────────┤
│  AGTP / A2A-over-MQTT (Transport Layer)          │
└──────────────────────────────────────────────────┘
```

---

## 6. 中国市场 / 中文生态

### 6.1 国内 Agent 平台概览

| 平台 | 发布方 | 时间 | 定位 | 多 Agent | IM 集成 |
|------|--------|------|------|----------|---------|
| **CodeBanana (CB)** | 出门问问 | 2026 | "项目=群聊+Agent+Workspace" | A2A 跨项目 | 群聊原生 |
| **QClaw V2** | 腾讯 | 2026-04 | 多 Agent 桌面助手 | 同时 3 Agent | 微信 |
| **玲珑 Agent OS** | 科大讯飞 | 2026-04 | 企业 AI 工作台 | Agent Teams | - |
| **万智 2.5** | 零一万物 | 2026 | 多智能体企业平台 | L1-L3 Agent 阶段 | - |
| **Qwen Cloud** | 阿里云 | 2026-05 | Agent 全栈基础设施 | 150+ 模型 | - |
| **ADP** | 腾讯云 | 2026-01 | 智能体开发平台 | Multi-Agent 编排 | GraphRAG |
| **天禧 Claw** | 联想 | 2026-04 | 个人 AI Agent | 多 Agent 协作 | 跨设备 |
| **Qoder Work** | 阿里 | 2026 | 桌面 Agent | Skill 调用 | 钉钉/微信/飞书 |

### 6.2 开源生态

| 项目 | 发布方 | Stars | 关键能力 |
|------|--------|-------|----------|
| **JiuwenSwarm** | 华为 2012 实验室 | - | Coordination Engineering, 蜂群智能体, PinchBench 94.2% |
| **灵玑OS** | 北京通明湖 | - | 国家级 Agent 共性基础设施 |
| **灵雀 LingQue** | 社区 | - | 内置多 Agent 协作引擎, Ralph Loop, 飞书/钉钉/命令行 |
| **EvolClaw** | 社区 | - | AUN 多智能体网络, 群聊共享会话, 飞书/微信/钉钉 |
| **CowAgent** | 社区 | - | AgentMesh 多智能体插件, 飞书/钉钉/企微/微信 |
| **OpenPollen** | 社区 | - | 9 大 IM 渠道, SKILL.md 无代码扩展 |
| **Hermes Agent** | 社区 | - | 统一消息网关, 跨平台持久记忆 |

### 6.3 CodeBanana (出门问问) -- 最接近的竞品

- **URL**: https://software.it168.com/a2026/0520/6929/000006929773.shtml
- **核心概念**："项目 = 群聊 + Agent + 独立 Workspace"
- **A2A 跨项目协作**：Agent 之间直接委托任务
- **Skills 技能市场**
- **Cron Job** 主动工作
- **100% AI Coding 研发生态**，产研效率提升 4 倍
- **入选 36氪 "2026 AI 最佳场景渗透案例"**

**与 AgentHub 对比**：
| 维度 | CodeBanana | AgentHub |
|------|-----------|----------|
| 形态 | 独立产品 | 开放平台/Hub |
| 底层 Agent | 自有 Agent | Claude Code / Codex / OpenCode |
| 群聊模型 | 项目 = 群聊 + Agent + Workspace | IM 群聊作为协作层 |
| 开放度 | 闭源 SaaS | 计划开源 |
| 目标用户 | 企业团队 | 开发者社区 |

### 6.4 飞书 / 钉钉 Agent 化现状

**飞书**：
- 官方开放平台支持机器人 API + WebSocket Stream 模式
- Coze 可一键发布到飞书
- 社区项目大量接入（OpenPollen / EvolClaw / LingQue / CowAgent）
- 飞书自身未推出多 Agent 群聊协作功能，以单 Agent 客服/助理为主

**钉钉**：
- 官方开放平台同样支持机器人 API + WebSocket
- 阿里内部有 Qoder Work 打通钉钉
- 阿里云 FunAgent 提供企业级 Agent 运维中台
- 同样没有原生多 Agent 群聊协作

**关键判断**：飞书/钉钉目前都是 "一个群聊里有一个机器人" 的模式，而非 "一个群聊里有多个 Agent 互相协作"。AgentHub 要做的 "拉群让 Claude Code 和 Codex 对话" 在这个维度上是独特定位。

---

## 7. 威胁与机会评估

### 7.1 威胁矩阵

| 威胁 | 来源 | 严重度 | 时间窗口 | 缓解策略 |
|------|------|--------|----------|----------|
| GitHub Ace 产品化 | GitHub | HIGH | 12-18 月 | 差异化 IM 入口 + 开源先发 |
| Cursor/VS Code 加群聊 | IDE 巨头 | MEDIUM | 6-12 月 | IDE 思维 vs IM 思维本质不同 |
| Thenvoi Chat Room 成熟 | 创业公司 | MEDIUM | 6-12 月 | 中间件 vs 产品层定位差异 |
| 飞书/钉钉原生多 Agent | IM 巨头 | MEDIUM | 12-24 月 | 企业 IM 不太可能优先面向开发者 |
| CodeBanana 功能演进 | 出门问问 | MEDIUM | 6-12 月 | 闭源 vs 开源生态差异 |
| Anthropic 官方加协作 | Anthropic | LOW-MEDIUM | 12+ 月 | Claude Code 定位是单机工具 |

### 7.2 机会矩阵

| 机会 | 说明 | 优先级 |
|------|------|--------|
| **IM 形态无竞品** | 目前没有 "飞书式群聊管理 Claude Code + Codex 协作" 的产品 | P0 |
| **协议层先发** | A2A + MCP 双协议栈可让 AgentHub 成为 Agent 互联的 IM 路由器 | P0 |
| **开源先发** | 2026 年多 Agent 编排平台井喷，但无一以 IM 为入口的成熟开源方案 | P0 |
| **SemaClaw 借鉴** | 其 Core + IM 适配器架构验证了技术路线，可复用设计思想 | P1 |
| **Claude Code SDK 成熟** | Agent SDK v0.2.x 已可用于生产级 Agent 构建 | P1 |
| **中国开发者市场** | 国内 Claude Code / Codex 用户快速增长，IM 习惯天然匹配 | P1 |
| **VS Code 多 Agent 成为共识** | 微软官方定位 VS Code 为多 Agent 平台 = 市场教育加速 | P2 |

### 7.3 差异化定位建议

```
AgentHub = IM 群聊 × Agent 协作 × 开放协议

                  飞书/微信级 UX
                       │
         ┌─────────────┼─────────────┐
         │             │             │
    拉 Claude Code   拉 Codex     拉 OpenCode
    "进群开会"      "进群写码"    "进群审查"
         │             │             │
         └─────────────┼─────────────┘
                       │
              A2A (Agent ↔ Agent)
              MCP (Agent ↔ Tools)
                       │
              Git Worktree 隔离
              Hub-Edge-Runner 架构
```

### 7.4 核心壁垒

1. **IM 原生交互范式**：群聊 = Agent 协作的 UI。无人做到。
2. **Hub-Edge 架构**：中心 Hub 协调 + 边缘本地执行 = 隐私 + 协作兼得
3. **协议中立**：A2A + MCP 双栈，不做 Vendor Lock-in
4. **开发者社区优先**：开源 + Claude Code / Codex 用户社群

---

## 8. 附录：信息源汇总

### 8.1 通用 Agent 平台
- Google Antigravity 2.0: https://virtualizationreview.com/articles/2026/05/19/google-moves-gemini-cli-into-antigravity-cli-as-agent-platform-expands.aspx
- GitHub Ace: https://githubnext.com/talks/one-developer-two-dozen-agents-zero-alignment/
- Sema Code: https://arxiv.org/abs/2604.11045
- SemaClaw: https://arxiv.org/abs/2604.11548
- Thenvoi: https://itbrief.com.au/story/thenvoi-unveils-platform-to-orchestrate-ai-coding-agents
- JetBrains Central: https://www.infoworld.com/article/4149535/new-jetbrains-platform-manages-ai-coding-agents.html
- Warp Oz: https://www.warp.dev/newsroom/2026/2/10/warp-launches-oz-the-orchestration-platform-for-cloud-coding-agents
- Builder 2.0: https://site.builder.io/blog/builder-2-0
- OSIRUS AI: https://www.tmcnet.com/usubmit/2026/04/21/10367933.htm
- Fetch Coder V2: https://www.fetch.ai/blog/fetch-ai-launches-fetch-coder-v2-the-ai-coding-assistant-purpose-built-for-autonomous-agents
- Alibaba Qoder: https://pandaily.com/alibaba-s-qoder-introduces-multi-agent-experts-mode-for-collaborative-coding
- 2026 评估榜单: https://www.ithome.com/0/949/878.htm
- Taskade 多 Agent 平台: https://www.taskade.com/blog/best-multi-agent-platforms

### 8.2 开源编排平台
- Paperclip: https://github.com/paperclipai/paperclip
- Swarms: https://github.com/Horizontes-LLC/swarms
- Agetor: https://github.com/alamops/agetor
- Mission Control: https://github.com/builderz-labs/mission-control
- Zenflow: https://github.com/zendev-sh/zenflow
- Hive Orchestrator: https://github.com/intertwine/hive-orchestrator
- OpenCognit: https://github.com/OpenCognit/opencognit
- NullBoiler: https://github.com/nullclaw/nullboiler
- Chassis: https://github.com/theo-kirby/chassis

### 8.3 Claude Code 生态
- Desktop Redesign: https://claude.com/blog/claude-code-desktop-redesign
- Agent View: https://www.aitop100.cn/infomation/details/33801.html
- 1Code: https://hunted.space/dashboard/1code-cursor-like-ui-for-claude-code/launches/1code-2
- ClaudeCodeUI: https://github.com/siteboon/claudecodeui
- Claude Chic: https://matthewrocklin.com/introducing-claude-chic/
- Agent SDK: https://code.claude.com/docs/en/agent-sdk/overview
- 源码复现: https://github.com/Windy3f3f3f3f/claude-code-from-scratch

### 8.4 Codex / Cursor / Windsurf
- Codex Changelog: https://developers.openai.com/codex/changelog
- Codex /goal: https://simonwillison.net/2026/Apr/30/codex-goals/
- Codex Desktop: https://www.theverge.com/ai-artificial-intelligence/913034/openai-codex-updates-use-macos
- Cursor 3: https://www.eweek.com/news/cursor-3-unified-workspace-ai-coding-agents/
- Windsurf Review: https://blink.new/blog/windsurf-review-2026
- Windsurf vs Copilot: https://www.morphllm.com/comparisons/windsurf-vs-copilot

### 8.5 Agent 协议
- A2A Spec: https://github.com/a2aproject/A2A
- A2A Protocol: https://www.programming-helper.com/tech/agent-to-agent-protocol-2026-google-a2a-standard
- A2A v1.0: https://discuss.google.dev/t/the-a2a-1-0-milestone-ensuring-and-testing-backward-compatibility/352258
- MCP Roadmap: https://modelcontextprotocol.io/development/roadmap
- MCP 2026: https://workos.com/blog/2026-mcp-roadmap-enterprise-readiness
- MCP vs A2A Guide: https://www.jitendrazaa.com/blog/ai/mcp-vs-a2a-vs-acp-vs-anp-complete-ai-agent-protocol-guide/
- Agent Protocols: https://getstream.io/blog/ai-agent-protocols/
- A2A over MQTT: https://www.emqx.com/en/blog/a2a-over-mqtt
- AGTP IETF Draft: https://www.ietf.org/ietf-ftp/internet-drafts/draft-hood-agtp-composition-00.html

### 8.6 中国市场
- CodeBanana: https://software.it168.com/a2026/0520/6929/000006929773.shtml
- QClaw V2: https://m.ithome.com/html/937473.htm
- 玲珑 Agent OS: http://g.pconline.com.cn/x/2141/21413832.html
- 万智 2.5: https://www.jazzyear.com/article_info.html?id=1661
- Qwen Cloud: https://www.chinaz.com/ainews/28167.shtml
- JiuwenSwarm: https://github.com/openJiuwen-ai/jiuwenswarm
- 灵玑OS: https://www.beijing.gov.cn/fuwu/lqfw/gggs/202605/t20260516_4653692.html
- EvolClaw: https://www.npmjs.com/package/evolclaw
- LingQue: https://github.com/LDPrompt/lingque
- CowAgent: https://github.com/zhayujie/chatgpt-on-wechat
- OpenPollen: https://juejin.cn/post/7610971570483380275
- QoderWork: https://m.ithome.com/html/933411.htm
- Hermes Agent: https://cloud.tencent.com/developer/article/2654156
- Coze/Dify 趋势: https://developer.baidu.com/article/detail.html?id=7080279

---

*本报告由 AgentHub 竞争调研任务生成，2026-05-21。所有信息基于公开 Web 搜索结果，URL 已在附录中标注。*
