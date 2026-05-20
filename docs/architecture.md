# AgentHub Architecture

## Hub-Edge-Runner 架构总览

```mermaid
graph TB
    subgraph Desktop["AgentHub Desktop"]
        UI["apps/web UI"]
        Edge["services/edge<br/>Edge Server"]
        R["services/runner<br/>Runner"]
    end

    subgraph Cloud["云端"]
        Hub["services/hub<br/>Hub Server"]
    end

    subgraph Mobile["移动端"]
        MUI["PWA / Web"]
    end

    subgraph Agents["Agent CLI"]
        CC["Claude Code"]
        CX["Codex"]
        OC["OpenCode"]
    end

    UI -->|"localhost"| Edge
    Edge -->|"local transport"| R
    R -->|"child_process"| Agents
    Edge <-->|"reverse WSS<br/>sync/relay"| Hub
    MUI -->|"HTTPS+WSS"| Hub
```

## 三个核心角色

### Hub Server（中心 IM Server）

```mermaid
graph TB
    subgraph Hub["services/hub/"]
        Auth["auth/ 登录/OAuth"]
        User["user/ 用户"]
        Device["device/ 设备管理"]
        Contact["contact/ 好友/Agent联系人"]
        IM["im/ 单聊/群聊/消息路由"]
        Sync["sync/ Edge同步"]
        Relay["relay/ Hub↔Edge命令中继"]
        Orch["orchestrator/ 云端调度"]
        Reg["runner-registry/ Edge/Runner注册"]
        Art["artifact/ 云端artifact"]
        Mem["memory/ 云端Memory"]
        WSG["ws-gateway/ Web/Mobile WSS"]
        Store["store/ PostgreSQL/SQLite"]
    end
```

**Hub 是 IM 大脑**：用户账号、好友关系、群聊管理、消息路由中转、多端同步、Edge 节点注册、远程控制中继。

### Edge Server（本地 Server）

```mermaid
graph TB
    subgraph Edge["services/edge/"]
        API["local-api/ Desktop UI REST"]
        WS["local-ws/ Desktop UI WebSocket"]
        Store["local-store/ SQLite"]
        IM["im-lite/ 本地会话/消息"]
        HC["hub-client/ 连Hub"]
        SC["sync-client/ 消息/Memory同步"]
        Orch["local-orchestrator/ 本地调度"]
        RM["runner-manager/ Runner管理"]
        CB["context-builder/ 上下文构造"]
        AI["artifact-index/ 本地产物"]
        Mem["memory/ .agenthub Markdown"]
        Sec["security/ 本地权限"]
    end
```

**Edge 是本地小中枢**：本地会话、消息存储、项目 Memory、Context 构造、Runner 管理、连 Hub 同步。离线可独立运行。

### Runner（执行节点）

```mermaid
graph TB
    subgraph Runner["services/runner/"]
        Svc["service/ Runner API"]
        Exec["executor/ 子进程管理"]
        Adapters["adapters/"]
        CC["claude-code/"]
        CX["codex/"]
        OC["opencode/"]
        WS["workspace/ git worktree"]
        Diff["diff/ patch"]
        Prev["preview/ dev server"]
        Logs["logs/ stdout/stderr"]
        Sec["security/ 路径守卫/命令审批"]
    end
```

**Runner 只管执行**：启动 Agent CLI、读写 workspace、生成 Diff、启动 Preview。不存消息，不管 IM。

## 四种部署模式

### P0 Desktop 全本地

```mermaid
graph LR
    subgraph Local["127.0.0.1"]
        UI["UI :3000"]
        Edge["Edge :3210"]
        Hub["Hub :3211"]
        Runner["Runner :39731"]
        Agent["Agent CLI"]
    end

    UI --> Edge
    UI --> Hub
    Edge --> Runner
    Edge -.->|"IM同步"| Hub
    Runner --> Agent
```

Desktop 三个都在本机。Edge 管本地执行，Hub 管 IM（也在 localhost）。离线时 Edge + Runner 仍可工作。

### P1 Desktop + Hub 同步

```mermaid
graph LR
    subgraph Local["本机"]
        UI["UI"]
        Edge["Edge"]
        Runner["Runner"]
    end

    subgraph Cloud["云端"]
        Hub["Hub"]
    end

    Agent["Agent CLI"]

    UI --> Edge
    Edge --> Runner
    Runner --> Agent
    Edge <-->|"reverse WSS"| Hub
```

Edge 主动连云端 Hub。手机可查看状态，消息云端备份。本地执行不受影响。

### P2 移动远程控制

```mermaid
graph LR
    subgraph Phone["手机"]
        MUI["PWA"]
    end

    subgraph Cloud["云端"]
        Hub["Hub"]
    end

    subgraph Home["家里电脑"]
        Edge["Edge"]
        Runner["Runner"]
    end

    Agent["Agent CLI"]

    MUI -->|"HTTPS+WSS"| Hub
    Hub <-->|"中继"| Edge
    Edge --> Runner
    Runner --> Agent
```

手机发指令 → Hub 中继 → 家里 Edge → Runner 执行。结果原路返回。

### P3 全云端

```mermaid
graph LR
    subgraph Client["任意端"]
        UI["UI"]
    end

    subgraph Cloud["云端 Docker"]
        Hub["Hub"]
        Edge["Edge"]
        Runner["Runner"]
    end

    Agent["Agent CLI"]

    UI --> Hub
    Hub --> Edge
    Edge --> Runner
    Runner --> Agent
```

全部跑在云端 Docker 里。不需要本机。

## 消息流完整链路

```mermaid
sequenceDiagram
    actor User
    participant UI as apps/web
    participant Hub as Hub Server
    participant Edge as Edge Server
    participant Runner as Runner
    participant Agent as Agent CLI

    User->>UI: @ClaudeCode 写登录页
    UI->>Edge: WebSocket (localhost)
    Edge->>Edge: 持久化 + 解析 @mention
    Edge->>Edge: local-orchestrator 调度
    Edge->>Runner: 下派任务
    Runner->>Agent: 启动 claude 子进程
    Agent-->>Runner: stdout 流
    Runner-->>Edge: RunnerEvent
    Edge-->>UI: ServerEvent (WebSocket)
    Edge-->>Hub: 同步消息摘要 (在线时)
    UI-->>User: 渲染气泡 / Diff / Preview
```

## Hub ↔ Edge 同步协议

Edge 主动连接 Hub（reverse WSS），保持长连接。

```mermaid
sequenceDiagram
    participant Edge
    participant Hub

    Edge->>Hub: edge.register (edgeId, deviceName)
    Edge->>Hub: edge.heartbeat (定时)
    Edge->>Hub: conversation.synced (消息批量)
    Edge->>Hub: run.status (任务状态)
    Edge->>Hub: artifact.created (产物元数据)
    Hub-->>Edge: run.start (远程指令)
    Hub-->>Edge: message.deliver (云端消息)
    Hub-->>Edge: memory.sync.request
```

## 数据归属

| 数据 | Edge | Hub | Runner |
|------|:----:|:---:|:------:|
| 本地消息 | **主存** | 同步副本 | - |
| 云端群聊 | 缓存 | **主存** | - |
| 好友关系 | 缓存 | **主存** | - |
| Agent 联系人 | 缓存 | **主存** | - |
| 项目 .agenthub/ | **主索引** | 同步索引 | 读写文件 |
| Artifact 元数据 | **主存** | 同步 | 产生 |
| Diff / 日志文件 | 索引 | 可选同步 | **主存** |
| workspace 文件 | 索引 | - | **主存** |
| Runner 进程 | 管理 | 镜像状态 | **主状态** |

## 共享包

| 包 | 语言 | 用途 |
|---|---|---|
| `packages/protocol/` | TypeScript | 前后端共享事件/类型定义 |
| `packages/im-core/` | Go | Conversation/Message/Thread 共享逻辑 |
| `packages/memory-core/` | Go | Memory/ContextBuilder 共享逻辑 |
| `packages/artifact-core/` | Go | Artifact 类型和索引 |
| `packages/adapters/` | Go | ClaudeCode/Codex/OpenCode 适配层 |
| `packages/ui-kit/` | React | 共享 UI 组件 |

## 端口

| 服务 | 地址 |
|------|------|
| Web UI | 127.0.0.1:3000 |
| Edge Server | 127.0.0.1:3210 |
| Hub Server | 127.0.0.1:3211 (P0本地) / 云端域名 (P2) |
| Runner | 127.0.0.1:39731 |
| Preview | 127.0.0.1:5100-5199 |

## 核心原则

- **Hub 是 IM 中枢**：用户、消息、好友、群聊、多端同步都经过 Hub
- **Edge 是本地桥梁**：连 Hub + 管 Runner + workspace + preview + Memory
- **Runner 只管执行**：不存消息、不管 IM、不做 Memory
- **UI 默认连 Edge**（Desktop），Web/Mobile 连 Hub
- **Edge 主动连 Hub**：reverse WSS，Hub 不直连用户本机
- **离线可用**：Edge + Runner 可脱离 Hub 独立工作
