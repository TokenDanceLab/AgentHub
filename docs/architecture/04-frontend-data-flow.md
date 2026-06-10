# Frontend Data Flow

> 子文档 | 主索引：[architecture.md](../architecture.md)
>
> 最后更新：2026-06-10

## 概述

前端通过 Platform Adapter 统一消费后端数据。shared UI 不直接调用 Tauri invoke、Hub client 或 Edge client。

## Platform Adapter Pattern

```ts
interface AgentHubPlatform {
  surface: "desktop" | "web";
  capabilities: PlatformCapabilities;
  conversations: ConversationPort;
  runs: RunPort;
  agents: AgentProfilePort;
  artifacts: ArtifactPort;
  approvals: ApprovalPort;
  host?: DesktopHostPort;
}
```

### Desktop Adapter

- Local Edge status/start/stop
- Edge REST/WS
- Tauri file/dialog/window/keyring/notification
- Local workspace allowlist
- TokenDance ID loopback callback

### Web Adapter

- Hub REST/WS
- Hub session
- Remote Edge/Cloud target routing
- Browser-safe preview
- Remote approval

UI 能根据 `capabilities` 隐藏或禁用不可用动作，但不能 fork 另一套组件。

## React Query Hooks

所有后端数据通过 React Query 管理：

- `hubQueries.ts` — Hub API 查询
- `sessionQueries.ts` — 会话查询
- `documentQueries.ts` — 文档查询
- `projectQueries.ts` — 项目查询

Desktop 的 Hub API 查询统一通过 `getToken` 回调注入 auth token，不硬编码 token 值。

## WebSocket Events

### 实时缓存失效模式

```text
Hub WS event (message.new / session.updated / ...)
  -> useHubWebSocket event handler
  -> React Query queryClient.invalidateQueries([queryKey])
  -> UI 自动重新获取最新数据
```

Desktop `useHubWebSocket.ts` 接入 workbench model 后，Hub 的实时事件直接驱动 React Query 缓存失效。覆盖消息、会话、联系人和 Agent 相关的所有实时更新。

## Settings 三层回退模式

Desktop 设置读取按以下优先级回退：

```text
Edge settings API (本地实时配置)
  -> Hub settings API (跨设备同步)
    -> localStorage (离线兜底)
```

实现位置：Desktop platform adapter 的 settings 读取逻辑。Hub 设置优先于本地默认，Edge 设置优先于 Hub（本地执行相关配置优先本地）。

## Agent Profile 合并策略

Desktop 的 Agent 列表按以下优先级合并：

```text
Edge local profiles (本地已安装的 Agent)
  > Hub agent profiles (云端共享的 Agent)
    > raw adapter list (运行时自动发现的 Agent)
```

实现位置：`useHubAgentProfiles` 等 hooks + Desktop workbench model。

- Edge 本地 profile 优先保证离线可用
- Hub profile 提供跨设备共享
- Raw adapter 是底层 runtime 的可用列表

## 安全边界

- UI 不能直接启动 Agent CLI
- Web 不能持有 TokenDance API key 或本机文件系统能力
- Desktop 文件操作必须经过 allowlist 和 typed Host API

## 相关文档

- [01-hub-server.md](01-hub-server.md) — Hub Server API 详情
- [02-edge-server.md](02-edge-server.md) — Edge Server 事件源
- [03-runtime-adapters.md](03-runtime-adapters.md) — Runtime adapter 事件映射
- [06-auth-identity.md](06-auth-identity.md) — Auth token 管道完整流程
