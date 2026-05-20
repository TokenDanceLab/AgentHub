# AgentHub 项目架构

## 目录结构

```
AgentHub/
├── ui/                     # React 前端
├── server/                 # 中心 IM Server（Go）
├── daemon/                 # 本地 Daemon（Go）
├── protocol/               # 共享 TS 类型定义
├── docs/                   # 产品文档 + 调研报告
└── .agenthub/              # 项目自身的 Memory/规则
```

## 角色定义

| 角色 | 目录 | 职责 |
|------|------|------|
| **IM Server** | `server/` | 用户注册登录 / 联系人好友 / 单聊群聊 / 消息路由中转 / WebSocket Hub / 多端同步 / Orchestrator 调度 |
| **本地 Daemon** | `daemon/` | 连中心 Server / 管理 Runner / workspace / git / Preview / 进程生命周期 |
| **Runner** | `daemon/` 内部管理 | 启动 Agent CLI 子进程 / 采集 stdout / 生成事件 |
| **Agent** | 系统外 CLI | Claude Code / Codex / OpenCode |
| **UI** | `ui/` | IM 聊天界面 / 会话列表 / 产物面板 / Diff 卡片 |

## 总架构

```mermaid
graph TB
    subgraph UI["ui/ 前端"]
        Web["Web / Tauri / PWA"]
    end

    subgraph Server["server/ 中心 IM Server"]
        User["用户/登录"]
        Contact["联系人/好友"]
        Conv["会话/群聊"]
        Msg["消息路由中转"]
        WS["WebSocket Hub"]
        Orch["Orchestrator"]
    end

    subgraph Daemon["daemon/ 本地 Daemon"]
        Connect["连中心 Server"]
        RunnerMgr["Runner 管理"]
        WS2["Workspace"]
        Preview["Preview"]
    end

    subgraph Agent["Agent CLI"]
        CC["Claude Code"]
        CX["Codex"]
        OC["OpenCode"]
    end

    Web -->|"HTTPS+WSS"| Server
    Server -->|"Runner Transport"| Daemon
    Daemon -->|"child_process"| Agent
```

## 消息流：用户发消息到 Agent 回复

```mermaid
sequenceDiagram
    actor User
    participant UI as ui/
    participant Server as server/
    participant Daemon as daemon/
    participant Agent as Agent CLI

    User->>UI: "@ClaudeCode 写登录页"
    UI->>Server: WebSocket 消息
    Server->>Server: 持久化 + 解析 @mention
    Server->>Daemon: 下派任务
    Daemon->>Agent: 启动 claude 子进程
    Agent-->>Daemon: stdout 流
    Daemon-->>Server: RunnerEvent 回传
    Server-->>UI: ServerEvent 推送
    UI-->>User: 渲染消息气泡/Diff/预览
```

**消息永远经过 server。daemon 不存消息，不直连 UI。**

## 四种部署拓扑

### P0 Desktop 全本地

```mermaid
graph LR
    subgraph Desktop["Tauri Desktop / 本机"]
        UI["ui/"]
        Server["server/"]
        Daemon["daemon/"]
        Agent["Agent CLI"]
    end

    UI -->|"localhost"| Server
    UI -->|"localhost"| Daemon
    Server -->|"local transport"| Daemon
    Daemon -->|"child_process"| Agent
```

Desktop UI 同时连 Server（IM 消息）和 Daemon（高频数据：日志/文件/Preview）。Server 负责 IM 中枢，Daemon 负责执行。

### P1 Desktop + SSH 远程 Runner

```mermaid
graph LR
    subgraph Local["本机"]
        UI["ui/"]
        Server["server/"]
    end

    subgraph Remote["远程服务器"]
        Daemon["daemon/"]
        Agent["Agent CLI"]
    end

    UI -->|"localhost"| Server
    Server -->|"SSH Tunnel"| Daemon
    Daemon --> Agent
```

本机只跑 UI 和 Server，重活交给远程 daemon。

### P2 Web/Mobile 远程控制

```mermaid
graph LR
    subgraph Mobile["手机/浏览器"]
        UI["ui/ PWA"]
    end

    subgraph Cloud["云端"]
        Server["server/"]
    end

    subgraph Home["家里电脑"]
        Daemon["daemon/"]
        Agent["Agent CLI"]
    end

    UI -->|"HTTPS+WSS"| Server
    Daemon -->|"reverse WSS 主动反连"| Server
    Daemon --> Agent
```

移动端只做控制台。家里电脑的 daemon 主动反连云端 Server。

### P3 全云端

```mermaid
graph LR
    subgraph Client["任意端"]
        UI["ui/"]
    end

    subgraph Cloud["云端 Docker"]
        Server["server/"]
        Daemon["daemon/"]
        Agent["Agent CLI"]
    end

    UI -->|"HTTPS+WSS"| Server
    Server -->|"内网"| Daemon
    Daemon --> Agent
```

## server/ 内部

```mermaid
graph TB
    subgraph Server["server/"]
        API["api/  HTTP REST"]
        WS["ws/  WebSocket Hub"]
        User["user/  注册/登录"]
        Contact["contact/  好友"]
        Conv["conversation/  会话/群聊"]
        Msg["message/  消息路由"]
        Orch["orchestration/  调度"]
        Mgr["runnermgr/  Runner管理"]
        DB["db/  SQLite"]
        Mem["memory/  Markdown索引"]
        Ctx["contextbuilder/  上下文构造"]
    end
```

## daemon/ 内部

```mermaid
graph TB
    subgraph Daemon["daemon/"]
        Connect["connect/  连Server(local/SSH/WSS)"]
        Runner["runner/  注册/心跳/事件上报"]
        Adapter["adapter/  ClaudeCode/Codex/OpenCode"]
        Exec["executor/  子进程启停"]
        WS["workspace/  git/diff/文件"]
        Preview["preview/  dev server"]
    end
```

## ui/ 内部

```mermaid
graph TB
    subgraph UI["ui/"]
        Login["pages/login  登录注册"]
        Chat["pages/chat  主IM界面"]
        Sidebar["components/sidebar  会话/联系人"]
        Bubble["components/chat  消息流/@mention"]
        Contact["components/contact  好友/加好友"]
        Group["components/group  群聊/成员"]
        Panel["components/panel  产物面板"]
        Diff["components/diff  Diff卡片"]
        Preview["components/preview  iframe预览"]
        Store["stores/  状态管理"]
        Hooks["hooks/  WS/API"]
    end
```

## 协议层

`protocol/` 先于所有代码。每个模块生成时必须读。

```
protocol/
├── index.ts
├── user.ts              # User / Auth
├── contact.ts           # Contact / FriendRequest
├── conversation.ts      # Conversation / Message / Thread
├── agent.ts             # Agent / AgentAdapter / AgentSession
├── runner.ts            # RunnerCommand / RunnerEvent
├── server-event.ts      # ServerEvent (WebSocket 推送)
├── artifact.ts          # Artifact / DiffArtifact
└── memory.ts            # MemoryDocument
```

## 端口

| 服务 | 地址 |
|------|------|
| Web UI | 127.0.0.1:3000 |
| Server API | 127.0.0.1:3210 |
| WebSocket | ws://127.0.0.1:3210/ws |
| Daemon | 127.0.0.1:39731 |
| Preview | 127.0.0.1:5100-5199 |

## 核心原则

- **server 是 IM 中枢**：所有用户、消息、联系人、群聊经过它
- **daemon 是执行桥梁**：连 center + 管 Runner + workspace + preview
- **UI 只连 Server**：消息/联系人/群聊走 Server，高频数据（日志/Preview）可本地直连 daemon
- **daemon 不存消息**：消息持久化只在 server
- **daemon 默认不暴露公网**：127.0.0.1、SSH tunnel、reverse WSS
