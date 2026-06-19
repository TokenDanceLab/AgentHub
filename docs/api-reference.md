# AgentHub API 参考文档

> 基于 `api/openapi.yaml` v1 和 `api/events.md`
> 最后更新：2026-06-19
> 分支：feat/super-phase1-safety-foundation

---

## 目录

1. [概述](#概述)
2. [认证模型](#认证模型)
3. [服务器地址](#服务器地址)
4. [通用规范](#通用规范)
5. [Foundation — 基础端点](#foundation--基础端点)
6. [IMProject — 项目与消息端点](#improject--项目与消息端点)
7. [ExecutionRunner — 执行与运行端点](#executionrunner--执行与运行端点)
8. [HubSyncRelay — Hub 核心端点](#hubsyncrelay--hub-核心端点)
9. [WebSocket 事件参考](#websocket-事件参考)
10. [数据模型速查](#数据模型速查)
11. [错误码](#错误码)
12. [实现状态说明](#实现状态说明)

---

## 概述

AgentHub 提供 REST JSON API 用于命令和查询，WebSocket 负责实时状态、日志、消息增量、审批和产物通知的推送。

### 架构组件

| 组件 | 说明 | 默认端口 |
|------|------|----------|
| **Edge Server** | 本地运行时，管理 Agent 执行、项目、线程、运行、审批 | `127.0.0.1:3210` |
| **Hub Server** | 中心 Hub，管理用户、会话、消息、设备、Agent 调度 | `localhost:8080` |

### 标签分组

| 标签 | 说明 | 负责组件 |
|------|------|----------|
| `Foundation` | 健康检查、能力查询、事件流握手 | Edge |
| `IMProject` | 项目、对话、线程、消息、Item API | Edge |
| `ExecutionRunner` | Agent 运行时、AgentRun、审批、产物、预览 | Edge |
| `HubSyncRelay` | 认证、用户、联系人、群组、设备、Edge、同步、中继、云 | Hub |

### 状态标签

| 标签 | 含义 |
|------|------|
| `x-agenthub-status: implemented` | 已实现，可直接调用 |
| `x-agenthub-status: planned` | 远期规划，尚未实现 |

---

## 认证模型

AgentHub 采用多层认证体系，Hub 和 Edge 使用不同的 token 类型。

### 1. OIDC 认证流程（Hub 登录）

```
客户端                    Hub Server                 TokenDance ID
  |                          |                            |
  |-- POST /client/auth/oidc/authorize -->               |
  |   (PKCE challenge + device proof)                     |
  |                          |                            |
  |<-- authorization_url + state ----|                    |
  |                          |                            |
  |-- 浏览器打开 authorization_url ------------------->  |
  |                          |                            |
  |<-- 回调 code + state -----|                            |
  |                          |                            |
  |-- POST /client/auth/oidc/callback -->                |
  |   (code + state + code_verifier)                      |
  |                          |-- Token交换 + ID Token验证 -->|
  |                          |<-- ID Token (RS256) ------| |
  |                          | (验证 iss/aud/exp/JWKS)    |
  |<-- access_token + refresh_token + user ---|           |
```

**关键设计原则：**
- TokenDance ID 使用 RS256 签名（非对称密钥），通过 JWKS 端点验证
- Hub 本地 session token 使用 HS256 签名（对称密钥）
- 客户端**不应**直接使用 TokenDance ID bearer token 访问 Hub REST/WebSocket 端点
- Hub session token 通过 `/client/auth/refresh` 续期，通过 `/client/auth/logout` 注销

### 2. Hub Bearer Token（HS256）

用于所有 Hub REST 端点和 WebSocket 连接：

```text
Authorization: Bearer <hub-hs256-access-token>
```

**获取方式：**
- OIDC 回调成功后返回 `access_token`
- 通过 `/client/auth/refresh` 用 `refresh_token` 续期

**适用范围：** `/client/*`、`/edge/*`、`/web/*` 所有需要认证的端点

### 3. Edge Local Token（Edge 进程边界）

可选的本地 Edge 进程保护，用于桌面 Shell 到本地 Edge 的 loopback 通信：

```text
# 方式一：Authorization header
Authorization: Bearer <local-edge-token>

# 方式二：自定义 header（Authorization 已被占用时）
X-AgentHub-Edge-Token: <local-edge-token>

# 方式三：WebSocket query 参数（浏览器客户端）
GET /v1/events?access_token=<local-edge-token>
```

**配置方式：** `AGENTHUB_EDGE_AUTH_TOKEN` 环境变量或 `--local-auth-token` 启动参数

### 4. Edge API JWT（Cloud Edge）

云 Edge 设备注册后获得 Edge-scoped JWT：

```json
{
  "iss": "agenthub-hub",
  "aud": "agenthub-edge",
  "purpose": "edge-api",
  "device_type": "edge",
  "device_id": "<registered-device-uuid>"
}
```

### 5. 安全方案总览

| 方案 | Token 类型 | 签名算法 | 用途 |
|------|-----------|----------|------|
| `bearerAuth` | Hub HS256 access token | HS256 | Hub REST + WebSocket 认证 |
| `edgeBearerAuth` | Local Edge token | 对称字符串 | 本地 Edge 进程边界 |
| `edgeLocalToken` | Local Edge token (header) | 对称字符串 | Edge `/v1/events` header 替代 |
| `edgeWebSocketQueryToken` | Local Edge token (query) | 对称字符串 | Edge WebSocket 浏览器 query 认证 |
| `hubWebSocketQueryToken` | Hub HS256 access token (query) | HS256 | Hub WebSocket 浏览器 query 认证 |

---

## 服务器地址

| 地址 | 说明 |
|------|------|
| `http://127.0.0.1:3210` | 本地 Edge Server |
| `http://localhost:8080` | 本地 Hub Server |
| `http://api.hub.vectorcontrol.tech` | 生产 Hub Server |

---

## 通用规范

### 分页

列表端点统一使用以下参数：

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `pageSize` | `integer` | `50` | 每页条数 (1-200) |
| `pageCursor` | `string` | — | 分页游标，从上次响应的 `nextCursor` 获取 |

**分页响应结构：**

```json
{
  "items": [{ "..." : "..." }],
  "page": {
    "nextCursor": "cursor_xyz",
    "hasMore": true
  }
}
```

### Hub 响应信封

Hub 端点统一使用以下响应格式：

```json
{
  "code": "OK",
  "message": "操作成功",
  "data": { }
}
```

### HTTP 状态码概要

| 状态码 | 含义 |
|--------|------|
| `200` | 成功 |
| `201` | 创建成功 |
| `202` | 已接受（异步处理） |
| `204` | 成功，无响应体 |
| `302` | 重定向（产物内容签名 URL） |
| `400` | 请求参数错误 |
| `401` | 未认证 |
| `403` | 无权限 |
| `404` | 资源不存在 |
| `409` | 冲突 |

### 错误响应格式

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Project not found: proj_xxx",
    "traceId": "trace_01HX...",
    "details": {}
  }
}
```

---

## Foundation — 基础端点

### GET /v1/health — 健康检查

Edge Server 健康检查。

```
GET /v1/health
```

**响应 200：** `{"status": "ok"}`

---

### GET /v1/events — WebSocket 事件流

打开 Edge 本地 WebSocket 事件流。事件格式和类型详见 [WebSocket 事件参考](#websocket-事件参考)。

```
GET /v1/events?cursor=evt_cursor&access_token=<edge-token>
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|:---:|------|
| `cursor` | `string` | 否 | 断线重连游标 |
| `access_token` | `string` | 否 | Edge 本地 token（浏览器客户端） |

**认证方式（三选一）：**
- Query: `?access_token=<edge-token>`
- Header: `Authorization: Bearer <edge-token>`
- Header: `X-AgentHub-Edge-Token: <edge-token>`

**响应 101：** Switching Protocols（升级为 WebSocket）
**响应 401：** 认证失败

---

### GET /v1/metrics — Prometheus 指标

```
GET /v1/metrics
```

**响应 200：** Prometheus text format

---

## IMProject — 项目与消息端点

### 项目 (Projects)

#### GET /v1/projects — 列出项目

```
GET /v1/projects?pageSize=50&pageCursor=
```

**响应 200：**
```json
{
  "items": [
    {
      "id": "proj_01HX...",
      "name": "My Project",
      "description": "项目描述",
      "createdAt": "2026-05-22T12:00:00Z"
    }
  ],
  "page": { "nextCursor": "cursor_xyz", "hasMore": false }
}
```

#### POST /v1/projects — 创建项目

```
POST /v1/projects
Content-Type: application/json

{
  "name": "My Project",
  "description": "项目描述"
}
```

**响应 201：** 创建的项目对象

#### GET /v1/projects/{projectId} — 获取项目

```
GET /v1/projects/proj_01HX...
```

**响应 404：** 项目不存在

---

### 线程 (Threads)

#### GET /v1/threads — 列出线程

```
GET /v1/threads?projectId=proj_01HX...&pageSize=50
```

#### POST /v1/threads — 创建线程

```
POST /v1/threads
Content-Type: application/json

{
  "projectId": "proj_01HX...",
  "title": "线程标题",
  "metadata": { "key": "value" }
}
```

**响应 201：** 创建的线程对象

#### GET /v1/threads/{threadId} — 获取线程

```
GET /v1/threads/thread_01HX...
```

#### PATCH /v1/threads/{threadId} — 更新线程

```
PATCH /v1/threads/thread_01HX...
Content-Type: application/json

{
  "title": "新标题",
  "status": "archived",
  "metadata": { "updated": true }
}
```

#### DELETE /v1/threads/{threadId} — 删除线程

删除线程及其关联的本地 run/item 记录。

```
DELETE /v1/threads/thread_01HX...
```

**响应 204：** 已删除

#### POST /v1/threads/{threadId}:archive — 归档线程

```
POST /v1/threads/thread_01HX...:archive
```

**响应 202：** 已接受

---

### 线程置顶 (Pins)

#### GET /v1/threads/{threadId}/pins — 列出置顶

```
GET /v1/threads/thread_01HX.../pins
```

**响应 200：**
```json
{
  "code": "OK",
  "data": {
    "items": [
      {
        "threadId": "thread_01HX...",
        "itemId": "item_01HX...",
        "pinnedBy": "user",
        "pinnedAt": "2026-05-22T12:00:00Z",
        "item": {
          "itemId": "item_01HX...",
          "projectId": "proj_01HX...",
          "threadId": "thread_01HX...",
          "type": "message",
          "role": "user",
          "status": "completed",
          "content": "消息内容"
        }
      }
    ],
    "page": { "hasMore": false }
  }
}
```

#### POST /v1/threads/{threadId}/pins — 置顶 Item

```
POST /v1/threads/thread_01HX.../pins
Content-Type: application/json

{
  "itemId": "item_01HX...",
  "pinnedBy": "user"
}
```

#### DELETE /v1/threads/{threadId}/pins — 取消置顶

```
DELETE /v1/threads/thread_01HX.../pins?itemId=item_01HX...
```

---

### 消息 (Messages)

#### POST /v1/threads/{threadId}/messages — 发送消息

```
POST /v1/threads/thread_01HX.../messages
Content-Type: application/json

{
  "content": "你好，请帮我审查这段代码",
  "role": "user"
}
```

**响应 201：**
```json
{
  "itemId": "item_01HX...",
  "projectId": "proj_01HX...",
  "threadId": "thread_01HX...",
  "type": "message",
  "role": "user",
  "status": "completed",
  "content": "你好，请帮我审查这段代码",
  "createdAt": "2026-05-22T12:00:00Z"
}
```

消息 `content` 可携带 IM 编排 metadata（@Agent 提及、orchestrator queue 投影）：

```json
{
  "content": "{\"text\":\"@Reviewer 审查 shared transcript\",\"metadata\":{\"mentions\":[{\"id\":\"agent-reviewer\",\"label\":\"Reviewer\",\"runtime_id\":\"codex\"}],\"orchestrator_queue\":{\"status\":\"queued\",\"route\":\"review\"}}}",
  "role": "user"
}
```

---

### Items

#### GET /v1/threads/{threadId}/items — 列出线程 Items

```
GET /v1/threads/thread_01HX.../items?pageSize=50
```

#### GET /v1/items/{itemId} — 获取 Item

```
GET /v1/items/item_01HX...
```

---

## ExecutionRunner — 执行与运行端点

### Agent 适配器

#### GET /v1/agents — 列出可用 Agent 适配器

```
GET /v1/agents
```

**响应 200：**
```json
{
  "items": [
    {
      "id": "claude-code",
      "name": "Claude Code",
      "description": "Anthropic Claude Code CLI",
      "version": "2.0.0",
      "runtimeId": "claude-code",
      "model": "claude-sonnet-4-6",
      "status": "available",
      "capabilities": {
        "streaming": true,
        "toolCalls": true,
        "fileChanges": true
      }
    },
    {
      "id": "codex",
      "name": "Codex CLI",
      "description": "OpenAI Codex CLI",
      "runtimeId": "codex",
      "status": "available",
      "capabilities": {
        "streaming": true,
        "toolCalls": true,
        "fileChanges": true
      }
    },
    {
      "id": "opencode",
      "name": "OpenCode",
      "description": "OpenCode agent",
      "runtimeId": "opencode",
      "status": "available",
      "capabilities": {}
    }
  ],
  "page": { "hasMore": false }
}
```

---

### 模型目录

#### GET /v1/model-catalog — 模型目录

从本地 provider 配置中发现并返回模型目录（API key 等敏感信息已脱敏）。

```
GET /v1/model-catalog
```

**响应 200：**
```json
{
  "code": "OK",
  "data": {
    "items": [
      {
        "id": "model_01",
        "value": "claude-sonnet-4-6",
        "label": "Claude Sonnet 4.6",
        "provider": "anthropic",
        "runtimeId": "claude-code",
        "resolvedModel": "claude-sonnet-4-6",
        "sourceId": "src_01",
        "sourceLabel": "Anthropic API",
        "status": "available",
        "tags": ["claude", "anthropic"],
        "reasoningEfforts": ["low", "medium", "high", "max"],
        "default": true
      }
    ],
    "sources": [
      {
        "id": "src_01",
        "label": "Anthropic API",
        "status": "available"
      }
    ]
  }
}
```

---

### Runners

#### GET /v1/runners — 列出 Runners

兼容性端点，用于运行时/目标健康检查。

```
GET /v1/runners
```

---

### AgentRun

#### POST /v1/runs — 启动 AgentRun

```
POST /v1/runs
Authorization: Bearer <edge-token>
Content-Type: application/json

{
  "projectId": "proj_01HX...",
  "threadId": "thread_01HX...",
  "prompt": "帮我审查 src/main.go 的安全性",
  "agentId": "claude-code",
  "model": "claude-sonnet-4-6",
  "reasoningEffort": "high",
  "permissionMode": "acceptEdits",
  "workDir": "/path/to/project",
  "systemPrompt": "你是一个安全审查专家",
  "allowedTools": ["read_file", "write_file", "grep"],
  "sessionId": "session_01HX...",
  "continue": false,
  "fork": false
}
```

**StartRunRequest 字段详解：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|:---:|------|
| `projectId` | `string` | 否 | 项目 ID；P0 兼容模式下默认为本地项目 |
| `threadId` | `string` | 否 | 线程 ID；P0 兼容模式下默认为本地线程 |
| `prompt` | `string` | 否 | 用户消息或任务描述 |
| `agentId` | `string` | 否 | Agent 适配器 ID：`claude-code`、`codex`、`opencode`、`orchestrator` |
| `model` | `string` | 否 | 模型覆盖，如 `claude-sonnet-4-6` |
| `sessionId` | `string` | 否 | 恢复指定 session（Claude Code `--resume`，OpenCode `--session`） |
| `continue` | `boolean` | 否 | 继续最近的 session（Claude Code `--continue`） |
| `fork` | `boolean` | 否 | 继续前 fork session（Claude Code `--fork-session`） |
| `reasoningEffort` | `string` | 否 | 推理努力程度：`low`/`medium`/`high`/`max`（Claude Code）；`minimal`/`low`/`medium`/`high`/`xhigh`（Codex） |
| `thinkingMode` | `string` | 否 | 思考模式覆盖 |
| `maxThinkingTokens` | `integer` | 否 | 最大 thinking token 预算 |
| `permissionMode` | `string` | 否 | 权限模式：`default`/`acceptEdits`/`bypassPermissions`/`plan`/`dontAsk` |
| `workDir` | `string` | 否 | 工作目录覆盖（须在 workspace allowlist 内） |
| `includePartial` | `boolean` | 否 | 包含部分 stream_event 消息 |
| `structuredOutputSchema` | `string` | 否 | JSON Schema 字符串 |
| `systemPrompt` | `string` | 否 | 系统提示词覆盖 |
| `appendSystemPrompt` | `string` | 否 | 追加系统提示词 |
| `allowedTools` | `string[]` | 否 | 工具允许列表 |
| `configOverrides` | `object` | 否 | 运行时特定 key/value 覆盖 |
| `ephemeral` | `boolean` | 否 | 请求无持久化 session 的运行 |
| `hubTaskId` | `string` | 否 | Hub task id |

**响应 202：**
```json
{
  "runId": "run_01HX...",
  "projectId": "proj_01HX...",
  "threadId": "thread_01HX...",
  "status": "queued",
  "createdAt": "2026-05-22T12:00:00Z"
}
```

**响应 403：** workDir 不在 workspace allowlist 内时拒绝

---

#### GET /v1/runs — 列出 AgentRuns

```
GET /v1/runs?threadId=thread_01HX...&pageSize=50
Authorization: Bearer <edge-token>
```

#### GET /v1/runs/{runId} — 获取 AgentRun

```
GET /v1/runs/run_01HX...
```

#### POST /v1/runs/{runId}:cancel — 取消 AgentRun

```
POST /v1/runs/run_01HX...:cancel
```

**响应 202：** 已接受

#### GET /v1/runs/{runId}/diff — 运行差异快照

```
GET /v1/runs/run_01HX.../diff
```

**响应 200：**
```json
{
  "code": "OK",
  "data": {
    "runId": "run_01HX...",
    "files": [
      {
        "path": "src/main.go",
        "diff": "@@ -1,5 +1,7 @@\n ...",
        "status": "modified"
      },
      {
        "path": "src/new_file.go",
        "diff": "...",
        "status": "added"
      }
    ]
  }
}
```

---

### 审批 (Approvals)

#### POST /v1/permissions/decide — 审批权限请求

```
POST /v1/permissions/decide
Content-Type: application/json

{
  "runId": "run_01HX...",
  "requestId": "req_01HX...",
  "decision": "allow",
  "reason": "已知安全命令"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|:---:|------|
| `runId` | `string` | 是 | Edge run id |
| `requestId` | `string` | 是 | 权限请求 id |
| `decision` | `string` | 是 | `allow` 或 `deny` |
| `reason` | `string` | 否 | 决策原因 |

**响应 200：** 决策已记录
**响应 404：** 权限请求不存在

---

### 产物 (Artifacts)

#### GET /v1/artifacts — 列出产物

```
GET /v1/artifacts?runId=run_01HX...
```

**响应 200：**
```json
{
  "code": "OK",
  "data": {
    "items": [
      {
        "id": "artifact_01HX...",
        "runId": "run_01HX...",
        "threadId": "thread_01HX...",
        "kind": "file",
        "path": "output/report.md",
        "sizeBytes": 2048,
        "createdAt": "2026-05-22T12:05:00Z"
      }
    ],
    "page": { "hasMore": false }
  }
}
```

#### GET /v1/artifacts/{artifactId} — 获取产物元数据

```
GET /v1/artifacts/artifact_01HX...
```

> 注意：产物内容读取（`/v1/artifacts/{artifactId}/content`）、应用（`:apply`）和丢弃（`:discard`）当前为 planned 状态。

---

### 预览 (Previews)

#### GET /v1/previews — 列出预览

```
GET /v1/previews?runId=run_01HX...
```

**响应 200：**
```json
{
  "code": "OK",
  "data": {
    "items": [
      {
        "id": "preview_01HX...",
        "runId": "run_01HX...",
        "threadId": "thread_01HX...",
        "url": "http://localhost:3000",
        "status": "ready",
        "createdAt": "2026-05-22T12:03:00Z"
      }
    ],
    "page": { "hasMore": false }
  }
}
```

#### POST /v1/previews — 启动预览

```
POST /v1/previews
Content-Type: application/json

{
  "runId": "run_01HX..."
}
```

#### GET /v1/previews/{previewId} — 获取预览

```
GET /v1/previews/preview_01HX...
```

#### POST /v1/previews/{previewId}:stop — 停止预览

```
POST /v1/previews/preview_01HX...:stop
```

---

### 子 Agent 实例

#### GET /v1/agent-instances — 列出编排器子 Agent 实例

```
GET /v1/agent-instances?runId=run_01HX...&parentId=parent_01HX...
```

#### GET /v1/agent-instances/{id} — 获取子 Agent 实例

```
GET /v1/agent-instances/agent_01HX...
```

---

## HubSyncRelay — Hub 核心端点

### 认证 (Auth)

#### POST /client/auth/oidc/authorize — 生成 OIDC 授权 URL

```
POST /client/auth/oidc/authorize
Content-Type: application/json

{
  "code_challenge": "base64url-encoded-s256-challenge",
  "code_challenge_method": "S256",
  "device_type": "desktop",
  "device_id": "550e8400-e29b-41d4-a716-446655440000",
  "redirect_uri": "http://localhost:3000/callback"
}
```

**响应 200：**
```json
{
  "code": "OK",
  "data": {
    "state": "hub-state-01HX...",
    "authorization_url": "https://id.tokendance.example/oidc/authorize?..."
  }
}
```

#### POST /client/auth/oidc/callback — 交换 OIDC Code

```
POST /client/auth/oidc/callback
Content-Type: application/json

{
  "code": "tokendance-auth-code",
  "state": "hub-state-01HX...",
  "code_verifier": "original-pkce-verifier",
  "device_type": "desktop",
  "device_id": "550e8400-e29b-41d4-a716-446655440000",
  "redirect_uri": "http://localhost:3000/callback"
}
```

**响应 200：**
```json
{
  "code": "OK",
  "data": {
    "access_token": "eyJhbGciOiJIUzI1NiIs...",
    "refresh_token": "eyJhbGciOiJIUzI1NiIs...",
    "expires_in": 3600,
    "user": {
      "id": "550e8400-e29b-41d4-a716-446655440001",
      "username": "alice",
      "nickname": "Alice",
      "avatar_url": "https://...",
      "tokendance_sub": "td-sub-abc123"
    }
  }
}
```

#### GET /client/auth/me — 获取当前用户

```
GET /client/auth/me
Authorization: Bearer <hub-access-token>
```

#### POST /client/auth/refresh — 刷新 Token

```
POST /client/auth/refresh
Content-Type: application/json

{
  "refresh_token": "eyJhbGciOiJIUzI1NiIs..."
}
```

#### POST /client/auth/logout — 注销

```
POST /client/auth/logout
Authorization: Bearer <hub-access-token>
```

#### PUT /client/auth/profile — 更新用户信息

```
PUT /client/auth/profile
Authorization: Bearer <hub-access-token>
Content-Type: application/json

{
  "nickname": "Alice2",
  "avatar_url": "https://..."
}
```

---

### 联系人 (Contacts)

#### GET /client/contacts — 列出联系人

```
GET /client/contacts
Authorization: Bearer <hub-access-token>
```

#### GET /client/contacts/search — 搜索联系人

```
GET /client/contacts/search?q=alice
Authorization: Bearer <hub-access-token>
```

#### DELETE /client/contacts/{userId} — 删除联系人

```
DELETE /client/contacts/user_01HX...
Authorization: Bearer <hub-access-token>
```

#### POST /client/contacts/{userId}/block — 屏蔽用户

```
POST /client/contacts/user_01HX.../block
Authorization: Bearer <hub-access-token>
```

#### POST /client/contacts/{userId}/unblock — 取消屏蔽

```
POST /client/contacts/user_01HX.../unblock
Authorization: Bearer <hub-access-token>
```

#### PUT /client/contacts/{userId}/remark — 更新备注

```
PUT /client/contacts/user_01HX.../remark
Authorization: Bearer <hub-access-token>
Content-Type: application/json

{ "remark": "同事-后端组" }
```

#### 好友请求

```
GET    /client/contacts/friend-requests             # 列出收到的好友请求
POST   /client/contacts/friend-requests             # 发送好友请求 { "friend_id": "...", "message": "..." }
POST   /client/contacts/friend-requests/{id}/accept  # 接受好友请求
POST   /client/contacts/friend-requests/{id}/reject  # 拒绝好友请求
```

---

### 会话 (Sessions)

#### GET /client/sessions — 列出会话

```
GET /client/sessions
Authorization: Bearer <hub-access-token>
```

#### POST /client/sessions/private — 创建私聊

```
POST /client/sessions/private
Authorization: Bearer <hub-access-token>
Content-Type: application/json

{ "peer_user_id": "user_01HX..." }
```

#### POST /client/sessions/group — 创建群聊

```
POST /client/sessions/group
Authorization: Bearer <hub-access-token>
Content-Type: application/json

{
  "name": "项目A讨论组",
  "member_ids": ["user_01HX...", "user_02HX..."]
}
```

> `member_ids` 可为空数组，用于先建立群再邀请 Agent。

#### GET /client/sessions/search — 搜索会话

```
GET /client/sessions/search?q=项目A
Authorization: Bearer <hub-access-token>
```

#### 会话管理操作

```
GET    /client/sessions/{id}/messages              # 获取会话消息（分页）
GET    /client/sessions/{id}/messages/sync         # 增量同步消息 ?cursor=...&limit=50
POST   /client/sessions/{id}/messages              # 发送消息
GET    /client/sessions/{id}/messages/search       # 搜索会话内消息 ?q=...
GET    /client/sessions/{id}/pins                  # 列出置顶消息
POST   /client/sessions/{id}/members               # 添加成员 { "members": ["user_03"] }
DELETE /client/sessions/{id}/members/{user_id}      # 移除成员
POST   /client/sessions/{id}/leave                 # 离开会话
POST   /client/sessions/{id}/dissolve              # 解散群
POST   /client/sessions/{id}/transfer-owner        # 转让群主 { "new_owner_user_id": "..." }
PUT    /client/sessions/{id}/settings              # 更新会话设置 { "pinned": true, "muted": false }
PUT    /client/sessions/{id}/info                  # 更新群信息 { "name": "...", "announcement": "..." }
POST   /client/sessions/{id}/read                  # 标记所有消息已读
POST   /client/sessions/{id}/agents                # 添加 Agent 到会话
DELETE /client/sessions/{id}                       # 删除会话（软删除）
```

**发送消息示例：**

```
POST /client/sessions/sess_01HX.../messages
Authorization: Bearer <hub-access-token>
Content-Type: application/json

{
  "content_type": "text",
  "content": "你好！",
  "client_msg_id": "550e8400-e29b-41d4-a716-446655440099"
}
```

**添加 Agent 到会话：**

```
POST /client/sessions/sess_01HX.../agents
Authorization: Bearer <hub-access-token>
Content-Type: application/json

{
  "agent_type": "claude-code",
  "display_name": "Code Reviewer"
}
```

---

### 消息操作 (Message Operations)

```
PUT    /client/messages/{id}           # 编辑消息
POST   /client/messages/{id}/recall    # 撤回消息
POST   /client/messages/{id}/pin       # 置顶消息
DELETE /client/messages/{id}/pin       # 取消置顶
POST   /client/messages/{id}/forward   # 转发消息 { "target_session_id": "..." }
```

#### 消息 Reaction

```
GET    /client/messages/{id}/reactions?session_id=...  # 列出 reaction
POST   /client/messages/{id}/reactions                 # 添加 reaction
DELETE /client/messages/{id}/reactions                 # 移除 reaction
```

**添加 Reaction 示例：**

```
POST /client/messages/msg_01HX.../reactions
Content-Type: application/json

{ "session_id": "sess_01HX...", "reaction": "👍" }
```

**响应：**
```json
{
  "code": "OK",
  "data": {
    "message_id": "msg_01HX...",
    "session_id": "sess_01HX...",
    "reaction": "👍",
    "count": 3,
    "reacted_by_me": true
  }
}
```

---

### 附件 (Attachments)

#### POST /client/attachments/probe — 检查附件是否存在

```
POST /client/attachments/probe
Authorization: Bearer <hub-access-token>
Content-Type: application/json

{ "hash": "sha256hex..." }
```

#### POST /client/attachments — 上传附件

```
POST /client/attachments
Authorization: Bearer <hub-access-token>
Content-Type: multipart/form-data

file: <binary>
```

#### GET /client/attachments/{id} — 下载附件

```
GET /client/attachments/att_01HX...
Authorization: Bearer <hub-access-token>
```

---

### 通知 (Notifications)

```
GET  /client/notifications                    # 列出通知 ?unread_only=true&limit=20
POST /client/notifications/{id}/read          # 标记单条已读
POST /client/notifications/read-all           # 全部标记已读
```

---

### WebSocket

#### GET /client/ws — Hub WebSocket

Hub 实时 IM + Agent 调度 WebSocket 连接。

```
ws://host:8080/client/ws?access_token=<hub-access-token>
```

**连接流程：**
1. 客户端用 Hub HS256 access token 发起 WebSocket 升级
2. Hub 在 HTTP upgrade 阶段验证 token（TokenDance ID RS256 token 不可用于 `/client/ws`）
3. 升级成功后 Hub 发送 `auth.ok`
4. 客户端可发送 `typing` 事件
5. Hub 推  送实时消息、会话、设备、Agent 等事件

**认证失败：** 升级前返回 401，不建立 WebSocket

> Hub WebSocket 事件类型详见 [WebSocket 事件参考](#websocket-事件参考)。

---

### Agent 任务 (Agent Tasks)

#### POST /web/agent-tasks — 触发 Agent 任务

```
POST /web/agent-tasks
Authorization: Bearer <hub-access-token>
Content-Type: application/json

{
  "trigger_message_id": "msg_01HX...",
  "agent_type": "claude-code",
  "agent_instance_id": "agent_inst_01HX...",
  "target_id": "550e8400-e29b-41d4-a716-446655440010",
  "model_params": "{\"model\":\"claude-sonnet-4-6\",\"reasoningEffort\":\"high\"}"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|:---:|------|
| `trigger_message_id` | `string` | 是 | 触发消息 ID |
| `agent_instance_id` | `string` | 否 | 精确 AgentInstance ID |
| `agent_type` | `string` | 否 | Edge Runtime adapter id：`codex`、`claude-code`、`opencode` |
| `custom_agent_id` | `string` | 否 | CustomAgent ID |
| `model_params` | `string` | 否 | JSON 字符串，model/provider/reasoning 提示 |
| `target_id` | `string` (UUID) | 否 | owner-scoped ExecutionTarget ID（精确桌面路由） |

#### 任务事件查询

```
GET /web/agent-tasks/{id}/events               # 列出任务运行时事件
GET /web/agent-tasks/{id}/events/summary       # 运行时事件摘要
GET /web/agent-tasks/{id}/summary              # 同上（兼容别名）
```

**运行时事件摘要响应：**
```json
{
  "code": "OK",
  "data": {
    "task_id": "task_01HX...",
    "edge_run_id": "run_01HX...",
    "status": "running",
    "total_events": 42,
    "last_event_seq": 42,
    "event_type_counts": { "run.agent.tool_call": 8, "run.agent.text_block": 5 },
    "tool_call_count": 8,
    "step_count": 3,
    "artifact_count": 2,
    "approval_count": 1,
    "pending_approvals": 0,
    "decided_approvals": 1,
    "input_tokens": 1234,
    "output_tokens": 567,
    "output_bytes": 8192,
    "started_at": "2026-05-22T12:00:00Z",
    "elapsed_ms": 45200
  }
}
```

#### 任务审批

```
GET  /web/agent-tasks/{id}/approvals                            # 列出任务审批投影
POST /web/agent-tasks/{id}/approvals/{approvalId}/decide        # 决定审批
```

**决定审批请求：**
```json
{
  "decision": "allow",
  "reason": "已知安全命令"
}
```

#### 任务产物

```
GET /web/agent-tasks/{id}/artifacts              # 列出任务产物投影
```

#### 任务取消

```
POST /web/agent-tasks/{id}/cancel                # 取消任务
```

---

### Edge 回调

Desktop Edge 通过以下端点向 Hub 上报运行状态：

```
POST /edge/agent-tasks/{id}/ack       # 确认接受任务（可附带 run_id）
POST /edge/agent-tasks/{id}/stream    # 上报 Agent 输出流
POST /edge/agent-tasks/{id}/done      # 上报任务完成
POST /edge/agent-tasks/{id}/fail      # 上报任务失败
```

**Stream 上报示例：**
```json
{
  "event_type": "run.agent.tool_call",
  "payload": { "callId": "call_1", "toolName": "read_file" },
  "edge_run_id": "run_01HX..."
}
```

**Done 上报示例：**
```json
{
  "edge_run_id": "run_01HX...",
  "final_content": "审查完成。发现 2 个安全问题..."
}
```

**Fail 上报示例：**
```json
{
  "edge_run_id": "run_01HX...",
  "error": "进程被用户终止"
}
```

---

### 设备 (Devices)

#### POST /edge/devices/register — 注册桌面设备

```
POST /edge/devices/register
Authorization: Bearer <hub-access-token>
Content-Type: application/json

{
  "device_id": "550e8400-e29b-41d4-a716-446655440099",
  "app_version": "1.0.0",
  "capabilities": ["desktop", "edge"]
}
```

#### POST /cloud/edge/register — 注册云 Edge

```
POST /cloud/edge/register
Authorization: Bearer <hub-access-token>
Content-Type: application/json

{
  "device_id": "550e8400-e29b-41d4-a716-446655440100",
  "name": "cloud-edge-01",
  "host": "10.0.0.5",
  "port": 3210,
  "capabilities": ["edge", "cloud"]
}
```

**响应：**
```json
{
  "code": "OK",
  "data": {
    "device_id": "550e8400-e29b-41d4-a716-446655440100",
    "device_type": "cloud_edge",
    "jwt": "eyJhbGciOiJIUzI1NiIs..."
  }
}
```

#### GET /web/devices — 列出设备

```
GET /web/devices
Authorization: Bearer <hub-access-token>
```

---

### 执行目标 (Execution Targets)

```
GET    /web/execution-targets           # 列出执行目标
POST   /web/execution-targets           # 创建执行目标
GET    /web/execution-targets/{id}      # 获取执行目标
PATCH  /web/execution-targets/{id}      # 更新执行目标
DELETE /web/execution-targets/{id}      # 删除执行目标
POST   /web/execution-targets/{id}/ping # Ping 执行目标
```

**创建执行目标示例：**
```json
{
  "name": "我的桌面",
  "target_type": "local_edge",
  "host": "127.0.0.1",
  "port": 3210,
  "workspace_root": "/home/user/projects",
  "workspace_allowlist": ["/home/user/projects", "/home/user/sandbox"],
  "trust_level": "local",
  "auth_method": "none",
  "device_id": "550e8400-e29b-41d4-a716-446655440099",
  "capabilities": { "runtime": ["claude-code", "codex"] }
}
```

**执行目标字段说明：**

| 字段 | 说明 |
|------|------|
| `target_type` | `local_edge` / `remote_ssh` / `tailscale` / `cloud_edge` / `hub_relay` |
| `trust_level` | `local` / `remote` / `cloud` / `relay` |
| `health_state` | 系统管理的健康状态：`online`/`healthy`/`offline`/`mismatch`/`stale`；`online` 为可调度状态 |
| `auth_method` | 公开认证策略：`none`/`ssh_tunnel`/`tailscale_mtls`/`hub_jwt`（不包含凭据） |

---

### Agent Profile（Agent 配置）

```
GET    /web/agent-profiles             # 列出 Agent Profiles
POST   /web/agent-profiles             # 创建 Agent Profile
GET    /web/agent-profiles/{id}        # 获取 Agent Profile
PATCH  /web/agent-profiles/{id}        # 更新 Agent Profile
DELETE /web/agent-profiles/{id}        # 删除 Agent Profile
POST   /web/agent-profiles/{id}/publish # 发布到市场（admin）
POST   /web/agent-profiles/{id}/install # 从市场安装
```

**创建 Agent Profile 示例：**
```json
{
  "name": "Security Reviewer",
  "description": "专注于代码安全审查",
  "runtime_id": "claude-code",
  "model": "claude-sonnet-4-6",
  "provider": "anthropic",
  "reasoning_effort": "high",
  "permission_mode": "acceptEdits",
  "skills": ["skill-uuid-1", "skill-uuid-2"],
  "mcp_servers": ["mcp-uuid-1"],
  "tool_allowlist": ["read_file", "write_file", "grep", "bash"],
  "approval_policy": { "mode": "workspace-write" },
  "target_preferences": { "trust_level": "local" },
  "context_budget_max_tokens": 200000
}
```

---

### 市场 (Marketplace)

```
GET  /web/market/profiles              # 搜索市场 Profile ?q=...&pageSize=20
GET  /web/market/profiles/{id}         # 获取市场 Profile
POST /web/market/profiles/{id}/install # 安装市场 Profile
POST /web/market/profiles/{id}/rate    # 评分 { "rating": 5 }
```

---

### Hub 项目 (Web Projects)

```
GET   /web/projects                          # 列出 Hub 项目
POST  /web/projects                          # 创建项目工作区
GET   /web/projects/{id}                     # 获取项目
PATCH /web/projects/{id}                     # 更新项目
GET   /web/projects/{id}/threads             # 列出项目线程
POST  /web/projects/{id}/threads             # 创建项目线程
GET   /web/projects/{id}/threads/{threadId}/messages  # 获取项目线程消息
POST  /web/projects/{id}/threads/{threadId}/messages  # 发送项目线程消息
```

---

### Agent 团队 (Agent Teams)

```
POST   /web/agent-teams                                          # 创建团队
GET    /web/agent-teams                                          # 列出团队
GET    /web/agent-teams/{id}                                     # 获取团队详情（含成员）
PUT    /web/agent-teams/{id}                                     # 更新团队
DELETE /web/agent-teams/{id}                                     # 删除团队
POST   /web/agent-teams/{id}/members                             # 添加成员
DELETE /web/agent-teams/{id}/members/{member_id}                  # 移除成员
POST   /web/agent-teams/{id}/runs                                # 启动 TeamRun
GET    /web/agent-teams/{id}/runs                                # 列出团队 runs
GET    /web/agent-teams/{id}/runs/{run_id}                       # 获取 run 详情
GET    /web/agent-teams/{id}/runs/{run_id}/state                 # 重放 run 状态
GET    /web/agent-teams/{id}/runs/{run_id}/events                # 列出 TeamEvent
GET    /web/agent-teams/{id}/runs/{run_id}/tasks                 # 列出 TeamTask
POST   /web/agent-teams/{id}/runs/{run_id}/route-decisions       # 记录路由决策
POST   /web/agent-teams/{id}/runs/{run_id}/approvals/{id}/decide # 决定 TeamRun 审批
POST   /web/agent-teams/{id}/runs/{run_id}/conflicts/{id}/resolve # 解决文件冲突
POST   /web/agent-teams/{id}/runs/{run_id}/assignments            # 创建委托
GET    /web/agent-teams/{id}/runs/{run_id}/assignments            # 列出委托
POST   /web/agent-teams/{id}/runs/{run_id}/assignments/{id}/dispatch  # 派发委托
POST   /web/agent-teams/{id}/runs/{run_id}/assignments/{id}/complete  # 完成委托
POST   /web/agent-teams/{id}/runs/{run_id}/assignments/{id}/fail      # 委托失败
```

**创建团队示例：**
```json
{
  "name": "代码审查团队",
  "description": "自动化代码审查流程"
}
```

**添加成员示例：**
```json
{
  "agent_profile_id": "550e8400-e29b-41d4-a716-446655440050",
  "role": "supervisor"
}
```

**启动 TeamRun 示例：**
```json
{
  "trigger_message": "审查最近的 PR 变更",
  "target_id": "550e8400-e29b-41d4-a716-446655440010"
}
```

---

### Skills、MCP Servers、Provider Bindings

```
# Skills
GET    /web/skills                    # 列出 Skills
POST   /web/skills                    # 创建 Skill
GET    /web/skills/{id}               # 获取 Skill
PUT    /web/skills/{id}               # 更新 Skill
DELETE /web/skills/{id}               # 删除 Skill
POST   /web/skills/{id}/publish       # 发布到市场（admin）
POST   /web/skills/{id}/unpublish     # 下架（admin）

# MCP Servers
GET    /web/mcp-servers               # 列出 MCP Servers
POST   /web/mcp-servers               # 创建 MCP Server
GET    /web/mcp-servers/{id}          # 获取
PUT    /web/mcp-servers/{id}          # 更新
DELETE /web/mcp-servers/{id}          # 删除
POST   /web/mcp-servers/{id}/publish  # 发布（admin）
POST   /web/mcp-servers/{id}/unpublish # 下架（admin）

# Provider Bindings
GET    /web/provider-bindings         # 列出
POST   /web/provider-bindings         # 创建
PUT    /web/provider-bindings/{id}    # 更新
DELETE /web/provider-bindings/{id}    # 删除
```

---

### 审计与管理

```
GET /web/audit-events                    # 列出审计事件（admin）
GET /api/public/stats                    # 公开统计数据
POST /web/relay/commands                 # 创建中继命令（admin）
GET  /web/relay/commands/{id}            # 获取中继命令
POST /web/relay/commands/{id}/ack        # 确认中继命令
```

---

### 历史端点（Legacy / Planned）

以下端点文档化但尚未实现或已弃用：

| 路径 | 状态 | 说明 |
|------|------|------|
| `/v1/auth/login` | planned | 密码登录（非 OIDC） |
| `/v1/auth/logout` | planned | 注销 |
| `/v1/users/me` | planned | 当前用户信息 |
| `/v1/contacts` | planned | 联系人列表 |
| `/v1/groups` | planned | 群组 CRUD |
| `/v1/devices` | planned | 设备管理 |
| `/v1/edges` | planned | Edge 节点注册/心跳 |
| `/v1/sync/*` | planned | 事件同步 |
| `/v1/relay/*` | planned | 中继命令 |
| `/v1/cloud/*` | planned | 云 Runner 管理 |
| `/client/friend-requests` (legacy) | deprecated | 使用 `/client/contacts/friend-requests` |
| `/client/sessions/{id}/member-settings` (legacy) | deprecated | 使用 `PUT /client/sessions/{id}/settings` |

---

## WebSocket 事件参考

### Edge WebSocket 事件 (`/v1/events`)

#### EventEnvelope 格式

```json
{
  "version": "v1",
  "id": "evt_01HX...",
  "seq": 42,
  "type": "run.output",
  "scope": {
    "projectId": "proj_1",
    "threadId": "thread_1",
    "runId": "run_1"
  },
  "traceId": "trace_01HX...",
  "sentAt": "2026-05-22T12:00:00Z",
  "payload": {}
}
```

| 字段 | 必填 | 说明 |
|------|:---:|------|
| `version` | 是 | 协议版本，固定 `v1` |
| `id` | 是 | 事件 ID，全局唯一 |
| `seq` | 是 | 事件流内递增序号 |
| `type` | 是 | 事件类型 |
| `scope` | 是 | 关联资源 ID |
| `traceId` | 否 | 链路追踪 ID |
| `sentAt` | 是 | RFC3339 UTC 时间 |
| `payload` | 是 | 事件载荷 |

#### IM / Project 事件

| type | 阶段 | 说明 |
|------|------|------|
| `project.created` | P0 | 项目创建或注册 |
| `project.updated` | P0 | 项目元数据更新（planned） |
| `conversation.created` | P1 | 会话创建（planned） |
| `conversation.member.added` | P1 | 会话成员加入（planned） |
| `thread.created` | P0 | Thread 创建 |
| `thread.updated` | P0 | Thread 状态或标题更新 |
| `thread.deleted` | P0 | Thread 删除 |
| `thread.forked` | P1 | Thread 分支（planned） |
| `thread.pin.created` | P0 | Thread item 置顶 |
| `thread.pin.deleted` | P0 | Thread item 取消置顶 |
| `message.created` | P0 | 消息创建 |
| `message.delta` | P0 | Agent 消息流式增量 |
| `item.created` | P0 | Thread Item 创建 |
| `item.updated` | P0 | Thread Item 状态更新（planned） |

#### Execution / Runtime 事件

| type | 阶段 | 说明 |
|------|------|------|
| `runner.online` | P0 | Runner 在线（planned） |
| `runner.offline` | P0 | Runner 离线（planned） |
| `run.queued` | P0 | AgentRun 已排队 |
| `run.started` | P0 | AgentRun 已启动 |
| `run.output` | P0 | 单条 stdout/stderr（planned，当前仅 batch 已实现） |
| `run.output.batch` | P0 | 批量 stdout/stderr |
| `run.status.changed` | P0 | 状态变化（planned） |
| `run.persistence_error` | P0 | 持久化错误 |
| `approval.requested` | P0 | 请求用户审批（planned） |
| `approval.decided` | P0 | 用户已审批（planned） |
| `artifact.created` | P0 | 产物创建 |
| `artifact.updated` | P1 | 产物元数据更新（planned） |
| `preview.ready` | P0 | 预览可用 |
| `preview.stopped` | P1 | 预览停止 |
| `run.finished` | P0 | AgentRun 正常结束 |
| `run.failed` | P0 | AgentRun 失败 |
| `run.cancelled` | P0 | AgentRun 已取消 |
| `run.agent.text_delta` | P0 | Agent 流式文本增量（CLI-agnostic） |
| `run.agent.text_block` | P0 | Agent 完整文本块 |
| `run.agent.thinking` | P0 | Agent 思考/推理内容 |
| `run.agent.tool_call` | P0 | Agent 请求工具调用 |
| `run.agent.tool_result` | P0 | 工具调用执行结果 |
| `run.agent.file_change` | P0 | 文件变更事件 |
| `run.agent.route_decision` | P1 | Runtime 解析出的 CoordinatorRouteDecision |
| `run.agent.session_init` | P0 | Agent 会话初始化 |
| `run.agent.result` | P0 | Agent 执行结束（成功/失败、token 用量） |
| `run.agent.compact_boundary` | P1 | 上下文压缩边界 |
| `run.agent.api_retry` | P1 | API 重试通知 |
| `run.agent.task_started` | P1 | 子代理任务启动 |
| `run.agent.task_dispatched` | P1 | 子代理任务已派发 |
| `run.agent.task_dispatch_failed` | P1 | 子代理派发失败 |
| `run.agent.task_progress` | P1 | 子代理任务进度 |
| `run.agent.task_notification` | P1 | 子代理任务完成/失败 |
| `run.agent.sub_agent_status` | P1 | 子代理运行状态更新 |
| `run.agent.sub_agents_complete` | P1 | 所有子代理执行完毕 |
| `run.agent.session_state_changed` | P1 | 会话状态变更 |
| `run.agent.status_change` | P1 | Agent 适配器状态变更 |
| `run.agent.session_metrics` | P1 | 会话度量信息 |
| `run.agent.context_usage` | P1 | 上下文使用量报告 |
| `run.agent.context_warning` | P1 | 上下文容量警告 |
| `run.agent.context_compaction` | P1 | 上下文压缩通知 |
| `run.agent.hook_started` | P1 | Hook 执行开始 |
| `run.agent.hook_progress` | P1 | Hook 执行输出 |
| `run.agent.hook_response` | P1 | Hook 执行完成 |
| `run.agent.tool_use_summary` | P1 | 批量工具调用摘要 |
| `run.agent.auth_status` | P1 | 认证状态变更 |
| `run.agent.rate_limit` | P1 | 速率限制通知 |
| `run.agent.permission_requested` | P1 | Agent 请求权限审批 |
| `run.agent.permission_decided` | P1 | 权限审批结果 |
| `run.agent.cli_invocation_plan` | P1 | 无执行调用计划（脱敏） |

#### AgentTeam / TeamRun 事件

| type | 阶段 | 说明 |
|------|------|------|
| `team.route.decided` | P1 | 路由决策已接受 |
| `team.route.rejected` | P1 | 路由决策被 guardrail 拒绝 |
| `team.task.created` | P1 | TeamTask 已创建 |
| `team.approval.decided` | P1 | TeamRun 审批已决策 |
| `assignment.created` | P1 | TeamAssignment 已创建 |
| `assignment.dispatched` | P1 | TeamAssignment 已派发 |
| `assignment.completed` | P1 | TeamAssignment 完成 |
| `assignment.failed` | P1 | TeamAssignment 失败 |
| `assignment.cancelled` | P1 | TeamAssignment 取消 |

#### Hub / Sync / Relay 事件

| type | 阶段 | 说明 |
|------|------|------|
| `device.registered` | P2 | 设备注册 |
| `edge.registered` | P2 | Edge 注册 |
| `edge.heartbeat` | P2 | Edge 心跳 |
| `edge.online` | P2 | Edge 上线 |
| `edge.offline` | P2 | Edge 离线 |
| `sync.event.uploaded` | P2 | Edge event 已上传 |
| `sync.ack` | P2 | Hub 同步确认 |
| `relay.command.created` | P3 | Hub 创建中继命令 |
| `relay.command.acknowledged` | P3 | Edge 确认中继命令 |
| `cloud.runner.allocated` | P3 | Cloud Runner 已分配 |
| `cloud.runner.released` | P3 | Cloud Runner 已释放 |

#### 公共事件

| type | 阶段 | 说明 |
|------|------|------|
| `error` | P0 | 事件流错误 |

---

### Hub WebSocket 事件 (`/client/ws`)

#### Frame 格式

```json
{
  "type": "message.new",
  "seq_id": 42,
  "payload": {}
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|:---:|------|
| `type` | `string` | 是 | 事件类型，dot.notation 格式 |
| `seq_id` | `number` | 否 | 服务端排序字段（仅 Hub-emitted 帧） |
| `payload` | `object` | 视事件而定 | 事件载荷 |

> Hub 帧格式为扁平 `{type, seq_id, payload}`，与 Edge 的 `EventEnvelope`（含 version/id/scope/traceId/sentAt 包裹）格式不同。

#### Auth（认证）

| type | 方向 | 说明 |
|------|------|------|
| `auth` | Client→Hub | 历史帧认证（仅测试/兼容入口） |
| `auth.ok` | Hub→Client | 认证成功 `{ user_id, device_id }` |
| `auth.fail` | Hub→Client | 认证失败 `{ reason }` |

**示例：**
```json
{"type":"auth.ok","payload":{"user_id":"user_01HX...","device_id":"device_01HX..."}}
{"type":"auth.fail","payload":{"reason":"invalid token"}}
```

#### Typing（正在输入）

| type | 方向 | 说明 |
|------|------|------|
| `typing` | Client→Hub | 用户正在输入 `{ session_id }` |

#### Message（消息）

| type | 说明 |
|------|------|
| `message.new` | 新消息 |
| `message.edited` | 消息已编辑 |
| `message.recall` | 消息撤回 |
| `message.pin` | 消息置顶 |
| `message.unpin` | 取消置顶 |
| `message.read` | 消息已读回执 |
| `message.reaction_added` | Reaction 已添加 |
| `message.reaction_removed` | Reaction 已移除 |

**message.new 示例：**
```json
{"type":"message.new","seq_id":42,"payload":{"message_id":"msg_01HX...","session_id":"sess_01HX...","sender_id":"user_01HX...","sender_type":"user","content":{"text":"Hello"},"content_type":"text","created_at":"2026-05-25T12:00:00Z"}}
```

#### Session（会话）

| type | 说明 |
|------|------|
| `session.created` | 会话创建 |
| `session.dissolved` | 群解散 |
| `session.member_joined` | 成员加入 |
| `session.member_left` | 成员离开 |
| `session.info_updated` | 会话信息变更 |

#### Device（设备 Presence）

| type | 说明 |
|------|------|
| `device.online` | 用户上线（user-level presence） |
| `device.offline` | 用户离线 |
| `device.kicked` | 设备被踢下线 |

```json
{"type":"device.online","payload":{"user_id":"user_01HX..."}}
```

#### Agent Task（Agent 任务）

| type | 方向 | 说明 |
|------|------|------|
| `agent.dispatch` | Hub→Edge | 分发 agent 任务 |
| `agent.stream` | Edge→Hub / Hub→Client | typed runtime event |
| `agent.done` | Edge→Hub | Agent 任务完成 |
| `agent.failed` | Edge→Hub | Agent 任务失败 |
| `agent.cancel` | Hub→Edge | 取消 agent 任务 |
| `agent.control` | Hub→Edge | 设备级控制命令 |
| `agent.timeout` | Hub→Edge | 任务超时 |

**agent.stream 示例：**
```json
{"type":"agent.stream","payload":{"id":"evt_01HX...","task_id":"task_01HX...","edge_run_id":"run_01HX...","session_id":"sess_01HX...","agent_instance_id":"agent_01HX...","event_seq":1,"event_type":"run.agent.tool_call","payload":{"callId":"call_1","toolName":"read_file"},"created_at":"2026-05-25T12:00:00Z"}}
```

**agent.control (permission.decide) 示例：**
```json
{"type":"agent.control","payload":{"kind":"permission.decide","agent_task_id":"task_01HX...","target_id":"target_01HX...","edge_device_id":"device_01HX...","team_id":"team_01HX...","team_run_id":"run_team_01HX...","approval_id":"req_01HX...","edge_control":{"runId":"edge_run_01HX...","requestId":"req_01HX...","decision":"allow","reason":"Known safe command"}}}
```

#### TeamRun 事件

| type | 方向 | 说明 |
|------|------|------|
| `team.run.started` | Hub→Client | TeamRun 已启动 |
| `team.event` | Hub→Client | 通用 TeamRun 事件日志 |
| `team.assignment.done` | Hub→Client | TeamAssignment 已成功完成 |
| `team.assignment.failed` | Hub→Client | TeamAssignment 执行失败 |

#### Notification & Friend

| type | 说明 |
|------|------|
| `notification.new` | 新通知 |
| `friend.request` | 收到好友请求 |
| `friend.accepted` | 好友请求被接受 |

---

### Edge Adapter Fixture JSON Contract

Edge adapter 测试使用的 no-spend AgentHubAgentSpec→RuntimeInvocation 静态 JSON fixture 映射：

| Fixture signal | AgentHub event | 关键 payload 字段 |
|------|------|------|
| `invocation_plan` | `run.agent.cli_invocation_plan` | `adapterId`, `commandName`, `argFlags`, `configKeys`, `promptRedacted`, `executionMode: fixture`, `noSpendDefault: true` |
| `assistant_message` / `text_block` | `run.agent.text_block` | `content`, provider/session/trace refs |
| `tool_call` | `run.agent.tool_call` | `callId`, `toolName`, redacted `input` |
| `tool_result` | `run.agent.tool_result` | `callId`, `toolName`, `content`, `isError` |
| `file_change` | `run.agent.file_change` | `callId`, `toolName`, `path`, `kind`, optional `diff` |
| `permission_request` | `run.agent.permission_requested` | `requestId`, `toolName`, `toolUseId`, `riskLevel`, `reason` |
| `artifact` | `artifact.created` | `artifactId`, `path`, `kind`, `sizeBytes`, `summary` |
| `usage` / `context_usage` | `run.agent.context_usage` | `inputTokens`, `outputTokens`, `totalTokens`, `model`, `sessionId` |
| `terminal_result` | `run.agent.result` | `success`, `summary`, `terminalReason` |
| `error` | `run.agent.result` | `success: false`, `terminalReason: error` |
| `cancelled` / `cancellation` | `run.agent.result` | `success: false`, `cancelled: true`, `terminalReason: cancelled` |

> Fixture event payload 必须脱敏 raw prompt、API token、authorization header、secret-like key、绝对 workspace path 和 provider trace body。

---

## 数据模型速查

### 核心实体

| Schema | 说明 |
|--------|------|
| `Resource` | 通用资源对象（`additionalProperties: true`） |
| `ListResponse` | 分页列表 `{ items[], page: { nextCursor, hasMore } }` |
| `PageInfo` | 分页信息 |
| `ErrorResponse` | 错误响应 `{ error: { code, message, traceId, details } }` |
| `Item` | Thread 中的消息/Item `{ itemId, projectId, threadId, type, role, status, content }` |
| `Run` | AgentRun `{ runId, projectId, threadId, status, createdAt, startedAt, finishedAt }` |
| `RunDiff` | Run 差异快照 `{ runId, files[]: { path, diff, status } }` |
| `Artifact` | 产物 `{ id, runId, threadId, kind, path, sizeBytes }` |
| `Preview` | 预览 `{ id, runId, threadId, url, status: starting\|ready\|stopped }` |
| `AgentInfo` | Agent 适配器信息 `{ id, name, status, capabilities }` |
| `AgentInstance` | Hub 会话中的 Agent 实例 `{ id, agent_type, session_id, display_name }` |
| `AgentProfile` | Agent 配置 Profile `{ id, name, runtime_id, model, skills, mcp_servers, tool_allowlist, ... }` |
| `ExecutionTarget` | 执行目标 `{ id, owner_id, name, target_type, is_online, health_state }` |
| `Device` | 设备 `{ id, user_id, device_type, capabilities }` |
| `WorkspaceProject` | Hub 项目工作区 |
| `WorkspaceThread` | Hub 项目线程（群会话的投影） |
| `Skill` | 用户 Skill 配置 |
| `MCPServer` | MCP 服务器配置 `{ id, name, transport: stdio\|sse\|streamable, command, args, env, url }` |
| `ProviderBinding` | Provider 绑定 `{ id, provider, is_available, quota_used, quota_limit }` |

### 团队模型

| Schema | 说明 |
|--------|------|
| `AgentTeam` | Agent 团队 `{ id, owner_id, name }` |
| `AgentTeamMember` | 团队成员 `{ id, team_id, agent_profile_id, role: supervisor\|executor\|reviewer }` |
| `AgentTeamDetail` | 团队详情（含 members 数组） |
| `AgentTeamRun` | TeamRun `{ id, team_id, status: queued\|running\|completed\|failed\|cancelled }` |
| `AgentTeamAssignment` | 团队委托 `{ id, team_run_id, from_member_id, to_member_id, type: delegate\|review\|approve\|notify, status }` |
| `AgentTeamTask` | 团队任务 `{ id, team_run_id, assignment_id, assignee_member_id, status, objective }` |
| `TeamRunState` | 团队运行完整状态（replay） |
| `CoordinatorRouteDecision` | 协调器路由决策 `{ action: delegate\|review\|approve\|finish, next_worker, instructions }` |

### 审批与权限模型

| Schema | 说明 |
|--------|------|
| `AgentTaskApproval` | 任务审批 `{ approval_id, task_id, request_id, tool_name, status: pending\|allow\|deny, edge_control }` |
| `AgentTaskApprovalList` | 审批列表 `{ approvals[], pending[], decided[] }` |
| `TaskApprovalDecisionRequest` | 审批决策请求 `{ decision: allow\|deny, reason }` |
| `TeamApprovalEdgeControl` | Edge 控制载荷 `{ runId, requestId, decision, reason }` |
| `AgentControlPayload` | Agent 控制命令 `{ kind: permission.decide, edge_device_id, edge_control }` |
| `TeamApprovalState` | TeamRun 审批状态（含 edge_device_id 精确路由） |
| `TeamConflictState` | 文件冲突 `{ conflict_id, path, status: pending\|resolved }` |

### 运行时事件模型

| Schema | 说明 |
|--------|------|
| `AgentRunEvent` | 运行时事件 `{ id, task_id, edge_run_id, event_seq, event_type, payload, created_at }` |
| `AgentRunEventSummary` | 事件摘要 `{ task_id, status, total_events, tool_call_count, input_tokens, output_tokens, elapsed_ms }` |
| `AgentTaskArtifact` | 任务产物投影 `{ task_id, path, action, diff, can_apply, can_revert }` |
| `AgentTaskArtifactList` | 任务产物列表 |

---

## 错误码

### 标准 HTTP 错误码

| 状态码 | `error.code` | 说明 |
|--------|-------------|------|
| `400` | `BAD_REQUEST` | 请求参数格式错误或缺少必填字段 |
| `400` | `INVALID_DECISION` | 无效的审批决策 payload |
| `401` | `UNAUTHORIZED` | 未提供有效认证凭据 |
| `401` | `INVALID_TOKEN` | Token 无效或已过期 |
| `403` | `FORBIDDEN` | 无权限访问该资源 |
| `403` | `WORKSPACE_DENIED` | workDir 不在 workspace allowlist 内 |
| `404` | `NOT_FOUND` | 请求的资源不存在 |
| `404` | `PENDING_REQUEST_NOT_FOUND` | 待处理权限请求不存在 |
| `409` | `TARGET_NOT_ROUTABLE` | 执行目标不可路由（remote/cloud target 尚未实现） |
| `409` | `CONFLICT` | 资源冲突 |

### Hub 错误信封

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Project not found: proj_xxx",
    "traceId": "trace_01HX...",
    "details": {}
  }
}
```

### WebSocket 错误事件

当事件流无法回放时，Edge 发送 `error` 事件：

```json
{
  "type": "error",
  "payload": {
    "code": "CURSOR_EXPIRED",
    "message": "Event store cannot replay from this cursor. Re-fetch from REST.",
    "traceId": "trace_01HX..."
  }
}
```

### 常见业务错误

| 场景 | 状态码 | 说明 |
|------|--------|------|
| workspace allowlist 拒绝 | `403` | workDir 不在 Edge 进程的允许 root 列表内 |
| device_id 不匹配 JWT | `400` | 注册时的 device_id 必须与 JWT claim 一致 |
| 目标设备离线 | Hub queues | agent.dispatch/control 进入专属队列，reconnect 后 replay，不 fallback |
| 云 Edge target 未实现 | `409` | remote_ssh/tailscale/cloud_edge/hub_relay target 的实时健康证明路径未实现 |
| approval 无法映射到 edge_device_id | Hub rejects | 审批决策被拒绝，不会静默 fallback 到其他桌面 |
| TokenDance ID RS256 token 用于 Hub | `401` | 升级前返回 401；仅接受 Hub-issued HS256 token |
| 消息 content 超过 1 MiB | Hub rejects | stream/done/fail 回调 payload 超过 1 MiB 预算被拒绝 |
| 空消息 content | `400` | 纯空白字符消息被 Edge 拒绝 |

---

## 实现状态说明

### 当前实现状态（2026-06-19）

**Edge Server：**
- 核心端点已实现：health、runs、threads、projects、agents、events、permissions
- `/v1/runners` 为兼容性接口
- Approval、Artifact content、Workspace、Runner 生命周期等为 planned

**Hub Server：**
- 完整实现：Auth (OIDC)、Contacts、Sessions、Messages、Notifications、Attachments、Devices、Agent Tasks、Agent Profiles、Custom Agents、Execution Targets、Projects、Agent Teams、Skills、MCP Servers、Provider Bindings、Market
- 部分端点标记为 legacy/deprecated（使用新路径替代）
- 历史 `/v1/auth`、`/v1/users`、`/v1/contacts` 等路径为 planned（远期迁移）

### 实现标记速查

| 标记 | 含义 |
|------|------|
| `implemented` | 已实现，可直接调用 |
| `planned` | 远期规划，尚未实现 |
| `deprecated` | 已弃用，使用新路径替代 |
| `contract-draft` | 实验性合约草案，未接入实际端点 |

---

> 完整 OpenAPI 规范见 `api/openapi.yaml`，WebSocket 事件文档见 `api/events.md`。
