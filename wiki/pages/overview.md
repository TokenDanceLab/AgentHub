---
title: AgentHub 产品总览
summary: AgentHub 是 IM 形态的多 Agent 协作工作台，采用 Hub/Edge 双层架构；活进度以 docs/progress/MASTER.md 为准（Phase 61）
tags:
  - overview
  - product
  - hub-edge
  - architecture
sources:
  - docs/architecture.md
  - docs/decisions.md
  - docs/roadmap.md
  - docs/progress/MASTER.md
  - docs/governance/security-risk-register.md
  - AGENTS.md
updated: 2026-07-18
---

# AgentHub 产品总览

## 一句话定位

AgentHub 是 **IM 形态的多 Agent 协作工作台**。用户面对的是联系人、群聊、项目会话、Agent 队友、审批、Diff、Preview、产物和部署结果，而不是 runtime 下拉框。

```text
AgentHub = shared IM workbench + local/remote Agent execution + Hub collaboration network
```

## Hub/Edge 双层架构

AgentHub 采用严格的 **Hub/Edge 分离**架构（[[architecture-seams|ADR-001]]）：

| 层 | 目录 | 职责 |
|---|---|---|
| **Hub Server** | `hub-server/` | TokenDance ID 身份接入、IM 会话、Agent 团队、多端同步、远程中继、审计 |
| **Edge Server** | `edge-server/` | 本地项目执行、Agent Runtime 适配器、Thread/Run 生命周期、事件存储、产物索引 |
| **Shared UI** | `app/shared/` | workbench、transcript、composer、inspector、platform contract |
| **Desktop** | `app/desktop/` | Tauri shell、Desktop adapter、Local Edge 本机能力 |
| **Web** | `app/web/` | Hub session、Web adapter、远程审批和查看 |

### 五层数据流

```text
Desktop: Workbench -> Platform Adapter -> Local Edge -> Agent Runtime Adapter -> Codex/Claude Code/OpenCode
Web:     Workbench -> Platform Adapter -> Hub Server -> Edge routing/relay -> Local Edge -> Agent Runtime Adapter
```

### 四条核心数据线

| 流 | 路径 |
|---|---|
| **控制线** | Workbench -> Platform Adapter -> Edge/Hub -> Runtime adapter -> Runtime |
| **事件线** | Runtime -> Edge EventStore -> Edge/Hub WS -> Platform Adapter -> Transcript |
| **证据线** | RunEvent -> EvidenceRef -> Inspector -> Artifact/File/Preview |
| **同步线** | Edge EventStore -> Hub Sync -> Web/Desktop/Mobile viewers |

### 非协商边界

1. UI 不能直接启动 Agent CLI
2. Web 不能持有 TokenDance API key、本机文件系统能力或 Local Edge 直连能力
3. Desktop renderer 不能获得 raw process execution 权限
4. Hub 权限由 Hub-local membership/resource/action 决定，TokenDance ID 只证明身份
5. 所有来源必须 normalize 到统一 transcript contract 后再渲染
6. Mock、fixture、observed、approved-real、production 必须**显式区分**

## 产品模型关键概念

| 概念 | 含义 | Owner |
|---|---|---|
| **Agent Runtime** | 能启动和解析某类 Agent CLI/SDK 的执行适配器 | `edge-server/internal/adapters/` |
| **Agent Profile** | 用户选择和管理的 Agent 实体（"谁来做事"） | Hub profile store / Edge local profile |
| **Agent Configuration** | Profile 的上下文、Skill、MCP、模型参数、审批策略 | Edge Context Builder + Hub store |
| **Execution Target** | 一次 Run 的执行位置：local、remote、cloud、relay | Edge registration + Hub routing |
| **Run Session** | 一次执行生命周期和事件序列 | Edge lifecycle + EventStore |
| **Artifact** | Agent 产物索引、预览、应用和版本 | Edge artifact index + workspace |

详细模块说明见 [[module-hub]]、[[module-edge]]、[[module-frontend]]。

## 技术主线

- **后端**：Hub Server 和 Edge Server 使用 Go
- **前端**：React + TypeScript，Desktop 使用 Tauri
- **协议**：REST JSON API（`api/openapi.yaml`）+ typed WebSocket events（`api/events.md`）
- **前端规范**：CSS Modules + OKLCH tokens，通用组件在 `app/shared/src/ui/`
- **状态管理**：服务端状态用 TanStack Query，客户端 UI 临时状态用 Zustand（[[architecture-seams|ADR-003]]）

固定端口：Hub Server `8080`，Local Edge `3210`，Desktop Vite `5173`，Web Vite `5174`。

## 程序状态（非 SSOT）

wiki 是编译知识层，**不覆盖** `AGENTS.md` / architecture / api / risk register。

| 表面 | 权威位置 |
|---|---|
| 规则 | `AGENTS.md` |
| 活进度 | `docs/progress/MASTER.md`（Phase 61 / milestone 82，2026-07-18） |
| 总进度入口 | `docs/roadmap.md` |
| 安全门禁 | `docs/governance/security-risk-register.md` |

P0 方向概览（细节以 MASTER + risk register 为准）：

| 方向 | 目标 |
|---|---|
| **文档治理** | active docs 只保留规则、路线、架构和契约入口；重复面归档 |
| **真实 E2E 合同** | `.agents/skills/real-e2e-acceptance/SKILL.md` 是唯一证据等级矩阵 |
| **远控拓扑前置** | P0 remote-control fixture 验证 `Web -> Hub -> Desktop/Edge -> Local Edge -> CLI/SDK` 离线拓扑 |
| **Chat flow 可靠性** | 发送不消失、消息线性排序、自动滚动、卡片合并 |
| **安全边界** | Hub/Edge 授权分离；Critical/High Open 默认阻断公开发布 |

安全风险态势与关闭条件见 [[risks-open]] 与 register SSOT，不在本页复述 Open/Accepted 状态表。

## 相关页面

- [[module-hub]] — Hub Server 模块详解
- [[module-edge]] — Edge Server 模块详解
- [[module-frontend]] — 前端（Desktop/Web/Shared）模块详解
- [[hotspots]] — 代码热点与复杂度地图
- [[risks-open]] — 当前安全风险登记与关闭条件
- [[cleanup-playbook]] — Cleanup 实施手册（历史基线）
- [[architecture-seams]] — 架构决策要点（ADR 摘要）
- [[flow-control-event]] — 控制流与事件流详解
