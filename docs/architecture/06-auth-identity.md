# Auth and Identity

> 子文档 | 主索引：[architecture.md](../architecture.md)
>
> 最后更新：2026-10-18

## 概述

AgentHub 使用 TokenDance ID 作为统一身份提供者，Hub Server 作为 OIDC relying party。

## OIDC PKCE Flow

完整认证流程：

```text
用户点击登录
  -> 客户端生成 PKCE verifier + challenge
  -> Hub 创建 state、保存 challenge，返回 authorization URL
  -> 重定向到 TokenDance ID authorization endpoint
  -> 用户在 TokenDance ID 完成认证
  -> TokenDance ID 回调客户端（authorization code）
  -> 客户端把 code + verifier 提交给 Hub；Hub 校验 challenge 并换取 ID token
  -> Hub 签发自己的 JWT session
```

Desktop 额外步骤：

```text
Hub 签发 JWT
  -> Desktop Tauri 拦截 loopback callback
  -> 存入 Tauri keyring / session
  -> 后续 API 调用通过 getAccessToken() 回调注入
```

## JWT 签发

Hub 签发的 JWT 包含（`pkg/jwtutil/hub_claims.go` 的 `HubSessionClaims`）：

- `user_id`、`device_id`、`device_type`：Hub 本地用户与设备标识
- `purpose`（可选，omitempty）：产品 session 不写入
- 注册 claims：`iss`/`aud`/`sub`/`exp`/`iat`/`jti`（`sub` 是 Hub `user.ID`，不是 TokenDance ID sub）
- 签名：HS256，使用 `AGENTHUB_JWT_SECRET`

membership 与具体授权不进入 JWT，由 Hub 侧按用户/资源/动作解析。

前端不解析 JWT 内容，只作为 Bearer token 传递给 API。

## TokenDance ID 集成

Hub 作为 TokenDance ID 的 relying party：

- 使用 OIDC Authorization Code + PKCE 流程
- 通过 JWKS 验证 TokenDance ID 的 token 签名
- TokenDance ID 只证明身份，不授权具体操作

Hub 权限由 Hub-local membership/resource/action 决定，TokenDance ID 只提供身份证明。

## 设备注册

Desktop 设备：

- 首次登录后设备自动注册到 Hub
- Tauri keyring 存储 access token
- 支持多设备同时登录

Web 设备：

- 浏览器 session 管理
- 无持久化 keyring

## Auth Token 管道

```text
Desktop Tauri keyring/session
  -> getAccessToken() callback
  -> { getToken: getAccessToken }
  -> hubQueries / sessionQueries / documentQueries / projectQueries
  -> Hub REST API Authorization: Bearer <token>
```

所有 Desktop 的 Hub API 查询（`app/desktop/src/api/*Queries.ts`）统一通过 `getToken` 回调注入 auth token，不硬编码 token 值；`projectQueries.ts` 是 `app/web` 侧查询。

## 安全边界

- Web 不能持有 TokenDance API key 或本机文件系统能力。
- Desktop 文件操作必须经过 allowlist 和 typed Host API。
- TokenDance ID 只证明身份；具体操作授权由 Hub-local membership/resource/action 决定。

## 相关文档

- [01-hub-server.md](01-hub-server.md) — Hub session 管理
- [04-frontend-data-flow.md](04-frontend-data-flow.md) — 前端 auth token 消费方式
