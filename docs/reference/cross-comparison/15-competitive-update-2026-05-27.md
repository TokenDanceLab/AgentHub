# 竞品动态追踪 — 2026-05-27

> 本文为 docs/reference/cross-comparison/14-product-direction-competitive-roadmap.md 的补充更新。
> 记录 2026 年 Q2 关键竞品变化及 AgentHub 应对建议。

## 一、关键变化

### 1. Teamily AI — 首个 IM-native 直接竞品

- 定位："AI-native instant messenger"，融 YuanbaoPai + 飞书 + LinkedIn
- 核心：跨群记忆共享、通用记忆系统、Agent 社交网络、集体智能
- 规模：300 万注册用户、$20M 融资、$19.9-$199.9/月
- **AgentHub 优势**：Teamily 是 SaaS-only，不跑真实 CLI runtime。AgentHub 是开发者向 + 本地执行 + 开源

### 2. Claude Code SDK — 从 Runtime 到 Agent Platform

- Agent Teams（TeammateIdle/TaskCompleted hooks）
- MCP Tunnels（内网穿透，无需暴露端口）
- MCP tool search 优化（134k→5k tokens，降 85%）
- 1M token context（Sonnet 4/4.5 beta）
- 14+ lifecycle hooks + HTTP hooks
- Enterprise MCP sandboxes（自托管，May 2026 public beta）

**影响**：Claude Code SDK 正在吸收 AgentHub 的 AgentTeam 层。AgentHub 必须做 Claude Code 不做的事——IM-native UX、多 Runtime 抽象、Hub 治理。

### 3. Codex CLI — MultiAgentV2 + Memory + Background

- MultiAgentV2：thread caps、root/subagent context hints、CSV fanout
- Background Computer Use：macOS 桌面自动化，多 Agent 并行
- Codex Memory（preview）：跨会话偏好记忆
- Standalone macOS app

**影响**：Codex 正从 Runtime 变成桌面 Agent 平台。AgentHub 的价值在 Runtime 之上——Team 协作层。

### 4. Cursor 3.x / Windsurf 2.0 — IDE 多 Agent 化

- Cursor "Glass"：8 并行 Agent、cloud agents、Bugbot
- Windsurf 2.0（$250M Cognition 收购）：Kanban Agent Command Center、950 tok/s

**影响**：IDE 在吸收 "Agent workspace"。AgentHub 的区隔是 IM-native（非 IDE 插件）+ Runtime 抽象。

### 5. 其他值得关注的

| 项目 | 融资 | 定位 |
|------|------|------|
| Dust | $40M Series B | "multiplayer AI"，300K+ agents、3,000+ orgs |
| SageOx | $15M seed | Human-agent team 共享上下文基础设施 |
| AionUI | — | "团战"模式（April 2026），Leader/Teammate |

## 二、AgentHub 独特定位（竞品无法短期复制）

1. **IM-native**：Agent 是群成员，任务通过对话流转。仅 Teamily 同赛道，但 Teamily 是 SaaS/非开发者向
2. **Hub-Edge 双层**：本地执行 + 云端治理。无竞品有此架构
3. **多 Runtime**：同时跑 Claude Code、Codex、OpenCode
4. **Execution Target 模型**：Local/Remote/Cloud/Hub Relay 统一抽象
5. **Append-only typed events**：RunEvent/TeamEvent 可回放审计

## 三、建议路线图调整

| 调整 | 原因 | 优先级 |
|------|------|:--:|
| AgentTeam P1→P0.5 | AionUI 已发团战、Claude 有 Teams SDK | **High** |
| Checkpoint/Undo | Claude Code/OpCode 已有，正成标配 | Medium |
| 远程 Edge PoC | Codex Background Use/Cursor cloud agents 拉高期望 | Medium |
| 跨会话 Memory | Codex Memory 预览已上线 | Medium |
| 不做 Canvas-first | LangGraph/Flowise 赛道不同 | — |
