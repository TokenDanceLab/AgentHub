# Hub Server

> 子文档 | 主索引：[architecture.md](../architecture.md)
>
> 最后更新：2026-06-10

## 职责

Hub Server（`hub-server/`）是 AgentHub 的云端中枢：

- TokenDance ID relying party（OIDC 认证）
- Hub session 管理
- IM 消息存储和分发
- AgentTeam 编排
- Edge 同步、中继
- 审计日志

## 在架构中的位置

```text
Web shared workbench
  -> Web platform adapter
  -> Hub Server              <-- 本文档
  -> Edge routing / relay
  -> Edge Server
  -> AgentAdapter
```

## API 通信

| 方向 | 方式 |
|---|---|
| Web adapter -> Hub | REST JSON + WebSocket |
| Desktop adapter -> Hub | REST JSON + WebSocket（经 getToken 回调注入 auth token） |
| Hub -> Edge | REST callbacks + Hub WebSocket dispatch/relay |
| Hub -> TokenDance ID | OIDC Authorization Code + PKCE / JWKS |

## Auth Token 管道模式

Desktop 的所有 Hub API 查询统一通过 `getToken` 回调注入 auth token：

```text
Desktop Tauri keyring/session
  -> getAccessToken() callback
  -> { getToken: getAccessToken }
  -> hubQueries / sessionQueries / documentQueries / projectQueries
  -> Hub REST API Authorization: Bearer <token>
```

涉及文件：`hubQueries.ts`、`sessionQueries.ts`、`documentQueries.ts`、`projectQueries.ts`。

不硬编码 token 值。

## WebSocket 实时缓存失效模式

```text
Hub WS event (message.new / session.updated / ...)
  -> useHubWebSocket event handler
  -> React Query queryClient.invalidateQueries([queryKey])
  -> UI 自动重新获取最新数据
```

Desktop `useHubWebSocket.ts` 接入 workbench model 后，Hub 的实时事件直接驱动 React Query 缓存失效，无需手动刷新。覆盖消息、会话、联系人和 Agent 相关的所有实时更新。

## Chat Actions

Web 和 Desktop 的 workbench model 分别暴露 chat actions，统一命名但各自实现：

| Action | Web `useWebWorkbenchModel` | Desktop `useDesktopWorkbenchModel` |
|--------|---------------------------|-----------------------------------|
| send | Hub REST sendMessage | Hub REST sendMessage |
| recall | Hub REST recallMessage | Hub REST recallMessage |
| edit | Hub REST editMessage | Hub REST editMessage |
| pin | Hub REST pinMessage | Hub REST pinMessage |
| unpin | Hub REST unpinMessage | Hub REST unpinMessage |
| markRead | Hub REST markRead | Hub REST markRead |
| addReaction | Hub REST addReaction | -- |
| removeReaction | Hub REST removeReaction | -- |
| forward | Hub REST forwardMessage | -- |
| searchMessages | Hub REST searchMessages | -- |

自动已读回执：进入会话后自动标记最后一条消息为已读。

## 安全边界

- Web 不能持有 TokenDance API key 或本机文件系统能力。
- Hub 权限由 Hub-local membership/resource/action 决定，TokenDance ID 只证明身份。

## 相关文档

- [02-edge-server.md](02-edge-server.md) — Edge 与 Hub 的同步和中继关系
- [06-auth-identity.md](06-auth-identity.md) — OIDC PKCE 完整流程
- [04-frontend-data-flow.md](04-frontend-data-flow.md) — 前端如何消费 Hub 数据
