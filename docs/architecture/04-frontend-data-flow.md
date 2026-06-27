# Frontend Data Flow

> 子文档 | 主索引：[architecture.md](../architecture.md)
>
> 最后更新：2026-06-27

## 概述

前端通过 Platform Adapter 统一消费后端数据。shared UI 不直接调用 Tauri invoke、Hub client 或 Edge client。

## Platform Adapter Pattern

```ts
interface AgentHubPlatform {
  surface: AgentHubSurface;           // "desktop" | "web"
  capabilities: SurfaceCapabilities;  // { localEdge, localFiles, browserPreview }
  conversations: ConversationPort;
  runs: RunPort;
  attachments?: AttachmentPort;
  host?: HostDiagnosticsPort;
  preview?: PreviewPort;
  settings?: SettingsPort;
}
```

### Desktop Adapter

- Local Edge status/start/stop
- Edge REST/WS（Thread / Run / Artifact / Agent）
- **Hub REST/WS**（认证 / 联系人 / 会话 / 消息 / 项目 / 文档）—— 通过 `hubClient.ts` 直连 Hub Server，不经过 Edge
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

## Desktop Query Hooks (`app/desktop/src/api/`)

| 文件 | 用途 |
|---|---|
| `hubClient.ts` | Hub REST 客户端（sendMessage/recall/edit/pin/unpin/markRead/reactions） |
| `hubQueries.ts` | Hub 联系人/会话/消息 React Query hooks |
| `sessionQueries.ts` | 会话 CRUD + 消息操作 hooks（pin/unpin/forward/markRead/reactions） |
| `hubWS.ts` | Hub WebSocket 连接管理 |
| `hubAuth.ts` | Hub 认证 + token 管理 |
| `hubTokenStorage.ts` | Token 持久化 |
| `edgeClient.ts` | Edge REST 客户端 |
| `edgeAuth.ts` | Edge 认证 |
| `eventClient.ts` | Edge EventStore 客户端 |
| `runQueries.ts` | Edge run lifecycle hooks |
| `runEvidenceQueries.ts` | Run evidence 查询 |
| `threadQueries.ts` | Thread CRUD hooks |
| `agentQueries.ts` | Agent 列表查询 |
| `agentProfileQueries.ts` | Hub Agent Profile CRUD hooks |
| `agentTeamQueries.ts` | Agent Team Run hooks |
| `contactQueries.ts` | 联系人 hooks |
| `projectQueries.ts` | Hub projects hooks |
| `documentQueries.ts` | Hub documents CRUD hooks |
| `executionTargetQueries.ts` | Execution target hooks |
| `modelCatalogQueries.ts` | 模型目录发现 |
| `teamRunQueries.ts` | TeamRun 编排 hooks |
| `deviceId.ts` | 设备 ID 管理 |
| `schemas.ts` | Zod schema 验证 |
| `allowlistValidation.ts` | Tool allowlist 验证 |
| `transport.ts` | HTTP transport 层 |
| `queryClient.ts` | React Query client 配置 |

## Web Query Hooks (`app/web/src/api/`)

| 文件 | 用途 |
|---|---|
| `hubClient.ts` | Hub REST 客户端（sendMessage/recall/edit/pin/unpin/markRead/forward/reactions/search） |
| `hubWS.ts` | Hub WebSocket 连接管理 |
| `hubAuth.ts` | Hub 认证 + token 管理 |
| `hubTokenStorage.ts` | Token 持久化 |
| `edgeClient.ts` | Edge REST 客户端 |
| `transport.ts` | HTTP transport 层 |
| `queryClient.ts` | React Query client 配置 |
| `runQueries.ts` | Edge run lifecycle hooks |
| `threadQueries.ts` | Thread CRUD hooks |
| `agentQueries.ts` | Agent 列表查询 |
| `agentTeamQueries.ts` | Agent Team hooks |
| `contactQueries.ts` | 联系人 hooks |
| `projectQueries.ts` | Hub projects hooks |
| `executionTargetQueries.ts` | Execution target hooks |
| `deviceId.ts` | 设备 ID 管理 |

## React Query Hooks

所有后端数据通过 React Query 管理。Desktop 的 Hub API 查询统一通过 `getToken` 回调注入 auth token，不硬编码 token 值。

## WebSocket 实时缓存失效模式

```text
Hub WS event (message.new / session.updated / ...)
  -> useHubWebSocket event handler
  -> React Query queryClient.invalidateQueries([queryKey])
  -> UI 自动重新获取最新数据
```

覆盖消息、会话、联系人和 Agent 相关的所有实时更新。

## Settings 三层回退模式

Desktop 设置读取按以下优先级回退：

```text
Edge settings API (本地实时配置)
  -> Hub settings API (跨设备同步)
    -> localStorage (离线兜底)
```

Hub 设置优先于本地默认，Edge 设置优先于 Hub（本地执行相关配置优先本地）。

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

## 数据模式与 E2E 边界

`app/shared/src/demo/dataMode.ts` 仍是产品兼容字段，但不能再被当成“数据来源、执行能力、登录状态”三者的唯一事实源。测试和文档必须同时标注三条轴：

| 轴 | 含义 | 例子 |
|---|---|---|
| Surface | 运行壳层 | Desktop Vite、Web Vite、Desktop Tauri |
| Data Source | UI 数据来源 | `local-mock`、`deterministic-fixture`、`stubbed-hub-session`、`observed-hub-replay`、approved real source |
| Auth/Execution | 登录和执行真实性 | anonymous、local-only、hub-signed-in、approved-real |

| 产品模式 | `dataMode` | Data Source | Auth/Execution | Workbench runtime 网络边界 | 不得声称 |
|---|---|---|---|---|---|
| Demo | `mock` | `local-mock` | anonymous | 不访问 Hub/Edge；Desktop 入口页只允许 `GET /v1/health` preflight | real replay、真实登录、真实执行 |
| Fixture | `fixture` | `deterministic-fixture` | anonymous | 不访问 Hub/Edge | real replay、真实用户数据 |
| Local | `auto`/local target | Local Edge | local-only | Desktop 可访问 `127.0.0.1:3210`；Web 不直连 Local Edge | Hub 登录或云端同步 |
| Login/Hub | `auto`/Hub session | Hub | hub-signed-in | Web/Desktop 通过 Hub；真实登录需 Hub session 证据 | TokenDance API key、模型消耗 |
| Observed | `observed` | `observed-hub-replay` 或本地只读记录 | read-only observed | 只读回放端点；不执行新 CLI/model/API | mock fallback、真实执行 |
| Approved Real | `approved-real` | approved Hub/Edge/CLI/API | approved-real | 只允许审批清单中的真实路径 | silent fallback、stubbed real、packaged release |

Phase-aware 边界：

| Phase | 允许范围 |
|---|---|
| Entry preflight | Desktop 入口页可探测 Local Edge health，用于展示本地连接状态 |
| Workbench runtime | 按上表执行；Demo/Fixture 进入工作台后不再触碰 Hub/Edge |
| Manifest preflight | 只读 manifest，不触碰 Hub/Edge/TokenDance ID/Gateway |

- 持久化 key：`agenthub.workbench.dataMode`（localStorage）。
- E2E 网络边界合同：`app/shared/src/testing/e2eDataModeContract.ts`。
- Stubbed Hub、fixture、readiness-only 或 manifest-only 必须输出 `real_tested=false`，不能冒充真实登录、真实 CLI/model/API、packaged Desktop 或 release 证据。

## 安全边界

- UI 不能直接启动 Agent CLI
- Web 不能持有 TokenDance API key 或本机文件系统能力
- Desktop 文件操作必须经过 allowlist 和 typed Host API

## 相关文档

- [01-hub-server.md](01-hub-server.md) — Hub Server API 详情
- [02-edge-server.md](02-edge-server.md) — Edge Server 事件源
- [03-runtime-adapters.md](03-runtime-adapters.md) — Runtime adapter 事件映射
- [06-auth-identity.md](06-auth-identity.md) — Auth token 管道完整流程
