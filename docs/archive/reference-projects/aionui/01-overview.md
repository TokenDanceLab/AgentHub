# 01 - AionUi 项目概况

## 一句话定位

AionUi 是一个**免费、开源、本地优先的 AI Agent Cowork 桌面应用**，将命令行 AI Agent（Claude Code、Codex、Gemini CLI 等 20+）封装为统一的图形化协作平台，支持多 Agent 并行、Team 编排、24/7 定时自动化和远程访问。

## 核心数据

| 指标 | 数值 |
|------|------|
| Stars | 26,311 |
| Forks | 2,459 |
| License | Apache-2.0 |
| 最新版本 | v1.9.25（2026-05） |
| 首次发布 | 2025-08-07 |
| 主要语言 | TypeScript（Electron + React） |
| 测试框架 | Vitest + Playwright |
| 包管理 | npm + Bun |

## 技术栈清单

| 层 | 技术 | 说明 |
|----|------|------|
| 桌面框架 | Electron 33 + electron-vite | 主进程 + 渲染进程架构 |
| 前端 UI | React 18 + TypeScript | 函数组件 + Hooks |
| UI 组件库 | Arco Design (@arco-design/web-react) | 字节跳动企业级组件库 |
| CSS 方案 | UnoCSS | 原子化 CSS，按需生成 |
| 状态管理 | React Context + useReducer | 无外部状态库 |
| 数据库 | SQLite（better-sqlite3） | 本地持久化 |
| 服务端 | Bun / Node.js HTTP | 内置 Web 服务器（远程访问） |
| Agent 协议 | ACP（@agentclientprotocol/sdk v0.18） | 统一 Agent 通信接口 |
| MCP | @modelcontextprotocol/sdk | 工具和资源管理 |
| Lint/Format | oxlint + oxfmt | Rust 工具链，高性能 |
| 监控 | Sentry | 错误追踪 |
| 测试 | Vitest + Playwright | 单元 + E2E |
| CLI 后端 | aionrs（Rust 二进制，外部） | 内置 Agent 引擎 |
| 实时通信 | WebSocket | 前端-后端双向推送 |

## 架构框图

```
┌─────────────────────────────────────────────────────────────┐
│                    Electron Desktop Shell                      │
├──────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌──────────────────────────────────────┐  │
│  │ Main Process │  │         Renderer Process              │  │
│  │ (Node.js)    │  │  ┌────────┐ ┌────────┐ ┌────────┐   │  │
│  │              │  │  │Convers.│ │  Team  │ │  Cron  │   │  │
│  │              │  │  │  Page  │ │  Page  │ │  Page  │   │  │
│  │              │  │  └────────┘ └────────┘ └────────┘   │  │
│  │              │  │  ┌──────────────────────────────┐    │  │
│  │              │  │  │   Arco Design + UnoCSS       │    │  │
│  │              │  └──────────────────────────────────────┘  │
│  │              │                                            │
│  │  ┌───────────┴───────────────────────────────────────┐   │
│  │  │              Process Layer (Node.js)               │   │
│  │  │                                                   │   │
│  │  │  ┌─────────┐ ┌────────┐ ┌──────────┐ ┌────────┐  │   │
│  │  │  │  Agent  │ │  Team  │ │ Extension│ │  Cron  │  │   │
│  │  │  │ Adapters│ │ Session│ │  System  │ │Service │  │   │
│  │  │  └────┬────┘ └───┬────┘ └────┬─────┘ └───┬────┘  │   │
│  │  │       │          │           │            │       │   │
│  │  │  ┌────┴──────────┴───────────┴────────────┴───┐   │   │
│  │  │  │              ACP Runtime                    │   │   │
│  │  │  │  (Agent Communication Protocol)             │   │   │
│  │  │  └──────────────────┬─────────────────────────┘   │   │
│  │  │                     │                              │   │
│  │  │  ┌──────────────────┴─────────────────────────┐   │   │
│  │  │  │           MCP Server / Client               │   │   │
│  │  │  └────────────────────────────────────────────┘   │   │
│  │  └──────────────────────────────────────────────────┘   │
│  │                                                          │
│  │  ┌──────────────────────────────────────────────────────┐│
│  │  │              Infrastructure                          ││
│  │  │  ┌────────┐ ┌──────────┐ ┌──────────┐ ┌─────────┐  ││
│  │  │  │ SQLite │ │Web Server│ │ Channels │ │  Skills │  ││
│  │  │  │  (DB)  │ │(Remote)  │ │(IM bots) │ │(builtin)│  ││
│  │  │  └────────┘ └──────────┘ └──────────┘ └─────────┘  ││
│  │  └──────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
     │                │                  │
     ▼                ▼                  ▼
┌─────────┐   ┌────────────┐   ┌──────────────────┐
│ aionrs  │   │Claude Code │   │  Gemini CLI /    │
│ (Rust)  │   │  Codex …   │   │  OpenClaw …      │
└─────────┘   └────────────┘   └──────────────────┘
 Built-in       External CLI        ACP Agents
 Agent           Agents
```

## 核心产品形态

1. **Desktop App**：Electron 桌面端，完整功能
2. **WebUI**：内置 HTTP 服务器，支持远程浏览器访问
3. **IM Bot**：支持 Telegram、飞书、钉钉、微信、企业微信等消息通道
4. **CLI**：`npm start cli` 命令行模式
5. **PWA**：支持 PWA 安装

## 与 AgentHub 的总体契合度

**评分：8/10**

| 维度 | 契合度 | 说明 |
|------|--------|------|
| 产品定位 | 9/10 | 同为 AI Agent 协作平台，AgentHub 偏分布式、AionUi 偏本地 |
| 技术架构 | 7/10 | Electron vs Tauri 不同栈，但 Agent 适配、MCP、安全模型高度可参考 |
| Agent 模型 | 9/10 | ACP 协议、Team Mode 是对 AgentHub 最直接的参考 |
| UI 模式 | 8/10 | Arco Design + 对话式 UI，与 AgentHub 的 React 前端可互通 |
| 安全模型 | 8/10 | 扩展沙箱、审批门控、权限声明值得采纳 |
| 生态集成 | 7/10 | IM Bot 通道、Cron 自动化是 AgentHub 的 P1/M4 方向 |
