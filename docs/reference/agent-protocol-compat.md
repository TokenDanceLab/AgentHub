# Agent Protocol Compatibility Reference

> 最后更新：2026-06-25 | 文档性质：调研参考（非实现规范）
>
> **AgentHub is NOT a drop-in Agent Protocol implementation but offers equivalent functionality through its own API surface.**

---

## 1. 背景

[Agent Protocol](https://github.com/langchain-ai/agent-protocol) 是 LangChain 提出的 Agent 服务标准化接口，定义了三组核心概念：

| Agent Protocol 概念 | 含义 |
|---|---|
| **Runs** | 一次 Agent 执行的生命周期：创建、查询、列表、删除、等待完成 |
| **Threads** | 对话/会话容器，承载一组消息和 run 记录 |
| **Store** | 键值存储，用于持久化 Agent 记忆和上下文 |

AgentHub 在架构设计上与 Agent Protocol 共享相同的抽象层次，但命名体系、认证方式和路由前缀存在差异。本文档提供精确的端点映射和行为差异说明。

---

## 2. 架构层次对应

AgentHub 有两层 API 面：

| 层 | 端口 | 前缀 | 认证 | 适用场景 |
|---|---|---|---|---|
| **Edge Server** | 3210 | `/v1/` | Edge local token / Edge bearer | 本地执行、Desktop 客户端 |
| **Hub Server** | 8080 | `/client/`, `/web/`, `/edge/`, `/cloud/` | TokenDance ID JWT (Hub session) | 云端协作、Web 工作台、远程审批 |

Agent Protocol 规范假设单层 API（通常是 `/runs`, `/threads`, `/store`），使用 API Key 认证。AgentHub 区分本地执行面（Edge）和云端协作面（Hub），使用 JWT 认证。

---

## 3. Runs 映射

Agent Protocol 定义 5 个 Run 操作：`create`, `get`, `list`, `delete`, `wait`。

### 3.1 Edge Server — `/v1/runs`

最接近 Agent Protocol runs 概念。操作本地执行生命周期。

| Agent Protocol | AgentHub Edge 端点 | 方法 | 说明 |
|---|---|---|---|
| `POST /runs` | `POST /v1/runs` | create | 启动本地 AgentRun。body 可选传 `projectId`/`threadId`/`workDir` |
| `GET /runs/{run_id}` | `GET /v1/runs/{runId}` | get | 查询单个 run 状态 |
| `GET /runs` | `GET /v1/runs?threadId=...` | list | 按 thread 过滤 run 列表，支持分页 |
| `DELETE /runs/{run_id}` | `POST /v1/runs/{runId}:cancel` | delete | Edge 通过 cancel action 终止 run（非 HTTP DELETE） |
| `GET /runs/{run_id}/wait` | WebSocket `RunEvent` stream | wait | 通过 `GET /v1/events` WebSocket 订阅 run 事件流，无轮询 wait 端点 |

**行为差异：**
- Agent Protocol 的 `delete` 是软删除；AgentHub 的 cancel 是发送中断信号，run 记录保留。
- AgentHub 没有专有 `wait` HTTP 端点；等待完成通过 WebSocket 事件推送实现。
- Planned 但未实现：`interrupt`（暂停）、`resume`（恢复）、`retry`（重试）。

**curl 示例 (Edge)：**

```bash
# 启动 run
curl -s http://127.0.0.1:3210/v1/runs \
  -H "Authorization: Bearer $EDGE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"projectId":"proj-1","threadId":"thread-1","prompt":"请审查 src/handler.go"}'

# 查询 run 状态
curl -s http://127.0.0.1:3210/v1/runs/run-abc123 \
  -H "Authorization: Bearer $EDGE_TOKEN"

# 列出 thread 下所有 run
curl -s "http://127.0.0.1:3210/v1/runs?threadId=thread-1" \
  -H "Authorization: Bearer $EDGE_TOKEN"

# 取消 run
curl -s -X POST http://127.0.0.1:3210/v1/runs/run-abc123:cancel \
  -H "Authorization: Bearer $EDGE_TOKEN"
```

### 3.2 Hub Server — `/web/agent-tasks` 和 `/web/agent-teams`

Hub 侧通过两个路径管理 run：

| Agent Protocol | AgentHub Hub 端点 | 说明 |
|---|---|---|
| `POST /runs` | `POST /web/agent-tasks` | 触发单 Agent task（Web 工作台） |
| `POST /runs` | `POST /web/agent-teams/:id/runs` | 启动 TeamRun（多 Agent 编排） |
| `GET /runs/{run_id}` | `GET /web/agent-tasks/:id/events` | 获取 run 事件流（非单条状态） |
| `GET /runs/{run_id}` | `GET /web/agent-teams/:id/runs/:run_id` | 获取 TeamRun 详情 |
| `DELETE /runs/{run_id}` | `POST /web/agent-tasks/:id/cancel` | 取消 task |
| list | `GET /web/agent-teams/:id/runs` | 列出 TeamRun 历史 |

**curl 示例 (Hub)：**

```bash
# 触发 agent task
curl -s http://localhost:8080/web/agent-tasks \
  -H "Authorization: Bearer $HUB_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"session_id":"sess-1","agent_id":"agent-1","prompt":"你好"}'

# 启动 TeamRun
curl -s http://localhost:8080/web/agent-teams/team-1/runs \
  -H "Authorization: Bearer $HUB_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"goal":"审查并修复 bug"}'

# 查询 TeamRun
curl -s http://localhost:8080/web/agent-teams/team-1/runs/run-1 \
  -H "Authorization: Bearer $HUB_ACCESS_TOKEN"

# 列出 TeamRun 历史
curl -s http://localhost:8080/web/agent-teams/team-1/runs \
  -H "Authorization: Bearer $HUB_ACCESS_TOKEN"
```

---

## 4. Threads 映射

Agent Protocol 定义 5 个 Thread 操作：`create`, `get`, `list`, `delete`, `update`。

### 4.1 Edge Server — `/v1/threads`

最直接的 Agent Protocol threads 对等体。

| Agent Protocol | AgentHub Edge 端点 | 方法 | 说明 |
|---|---|---|---|
| `POST /threads` | `POST /v1/threads` | create | 在指定 project 下创建 thread |
| `GET /threads/{thread_id}` | `GET /v1/threads/{threadId}` | get | 获取 thread 详情 |
| `GET /threads` | `GET /v1/threads?projectId=...` | list | 按项目列出 thread，支持分页 |
| `DELETE /threads/{thread_id}` | `DELETE /v1/threads/{threadId}` | delete | 删除 thread 及关联的本地 run/item 记录 |
| `PATCH /threads/{thread_id}` | `PATCH /v1/threads/{threadId}` | update | 更新 thread 元数据（标题等） |

**AgentHub 额外能力（无 Agent Protocol 对等体）：**
- `POST /v1/threads/{threadId}:archive` — 归档 thread
- `GET /v1/threads/{threadId}/items` — 列出 thread 内消息/事件 items
- `GET /v1/threads/{threadId}/pins` — thread 内 pin 管理
- Planned: `POST /v1/threads/{threadId}:fork` — fork 线程

**curl 示例 (Edge)：**

```bash
# 创建 thread
curl -s http://127.0.0.1:3210/v1/threads \
  -H "Authorization: Bearer $EDGE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"projectId":"proj-1","title":"代码审查"}'

# 获取 thread
curl -s http://127.0.0.1:3210/v1/threads/thread-1 \
  -H "Authorization: Bearer $EDGE_TOKEN"

# 列出项目 thread
curl -s "http://127.0.0.1:3210/v1/threads?projectId=proj-1" \
  -H "Authorization: Bearer $EDGE_TOKEN"

# 更新 thread
curl -s -X PATCH http://127.0.0.1:3210/v1/threads/thread-1 \
  -H "Authorization: Bearer $EDGE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"代码审查（更新版）"}'

# 删除 thread
curl -s -X DELETE http://127.0.0.1:3210/v1/threads/thread-1 \
  -H "Authorization: Bearer $EDGE_TOKEN"
```

### 4.2 Hub Server — `/client/sessions`

Hub 的 session 概念等价于 Agent Protocol threads，但增加了群聊/私聊类型和 IM 特性。

| Agent Protocol | AgentHub Hub 端点 | 说明 |
|---|---|---|
| `POST /threads` | `POST /client/sessions` | 创建会话（type=private/group） |
| `GET /threads/{thread_id}` | session 信息嵌入消息列表响应 | 无独立 GET session 端点；通过消息列表间接获取 |
| `GET /threads` | `GET /client/sessions` | 列出当前用户所有会话 |
| `DELETE /threads/{thread_id}` | `DELETE /client/sessions/:id` | 软删除（仅对当前用户隐藏） |
| `PATCH /threads/{thread_id}` | `PUT /client/sessions/:id/info` | 更新群聊名称/头像/公告 |
| — | `PUT /client/sessions/:id/settings` | 更新用户对会话的 pin/archive/mute 设置 |

**会话类型：** AgentHub 区分 `private`（私聊）和 `group`（群聊），Agent Protocol 无此区分。

**curl 示例 (Hub)：**

```bash
# 创建私聊会话
curl -s http://localhost:8080/client/sessions \
  -H "Authorization: Bearer $HUB_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type":"private","target_user_id":"user-2"}'

# 创建群聊
curl -s http://localhost:8080/client/sessions \
  -H "Authorization: Bearer $HUB_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type":"group","name":"项目组","member_ids":["user-2","user-3"]}'

# 列出会话
curl -s http://localhost:8080/client/sessions \
  -H "Authorization: Bearer $HUB_ACCESS_TOKEN"

# 更新群聊信息
curl -s -X PUT http://localhost:8080/client/sessions/sess-1/info \
  -H "Authorization: Bearer $HUB_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"新项目组"}'

# 删除会话（仅对自己）
curl -s -X DELETE http://localhost:8080/client/sessions/sess-1 \
  -H "Authorization: Bearer $HUB_ACCESS_TOKEN"
```

### 4.3 Hub Server — `/web/projects/:id/threads`

Hub workspace 项目下的 thread，更接近 Edge 的 `/v1/threads` 概念。

| 操作 | 端点 |
|---|---|
| list | `GET /web/projects/:id/threads` |
| create | `POST /web/projects/:id/threads` |

---

## 5. Store 映射

Agent Protocol 定义 4 个 Store 操作：`get`, `put`, `delete`, `search`。

AgentHub 对应的是 **Documents**（`/web/documents`）和 **User Settings**（`/client/settings`）。

### 5.1 Documents — `/web/documents`

AgentHub 文档系统提供标题、类型、标签、内容、位置等结构化字段，比 Agent Protocol 的简单 key-value store 更丰富。

| Agent Protocol | AgentHub Hub 端点 | 方法 | 说明 |
|---|---|---|---|
| `PUT /store/{namespace}/{key}` | `POST /web/documents` | put | 创建文档；title 为必填，可附带 type/tag/location/content |
| `GET /store/{namespace}/{key}` | `GET /web/documents/:id` | get | 按 ID 获取文档 |
| `DELETE /store/{namespace}/{key}` | `DELETE /web/documents/:id` | delete | 删除文档 |
| `POST /store/search` | `GET /web/documents?type=...&tag=...` | search | 按 type/tag 过滤列表；无自由文本搜索端点 |

**行为差异：**
- Agent Protocol 使用 `{namespace}/{key}` 两级路径；AgentHub 使用文档 ID + type/tag 元数据。
- AgentHub 文档 Store 面向云文档管理，不是 Agent 运行时的低延迟 key-value 缓存。
- AgentHub 无 namespace 概念；type 字段可部分替代。
- Agent Protocol 的 `search` 支持自由文本；AgentHub 当前仅支持按 type/tag 过滤。

**curl 示例 (Hub)：**

```bash
# 创建文档（put）
curl -s http://localhost:8080/web/documents \
  -H "Authorization: Bearer $HUB_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"项目设计文档","type":"design","tag":"v1.0","content":"# 架构设计\n..."}'

# 获取文档（get）
curl -s http://localhost:8080/web/documents/doc-1 \
  -H "Authorization: Bearer $HUB_ACCESS_TOKEN"

# 列出/搜索文档
curl -s "http://localhost:8080/web/documents?type=design&tag=v1.0" \
  -H "Authorization: Bearer $HUB_ACCESS_TOKEN"

# 更新文档
curl -s -X PATCH http://localhost:8080/web/documents/doc-1 \
  -H "Authorization: Bearer $HUB_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content":"# 架构设计\n更新内容..."}'

# 删除文档
curl -s -X DELETE http://localhost:8080/web/documents/doc-1 \
  -H "Authorization: Bearer $HUB_ACCESS_TOKEN"
```

### 5.2 User Settings — `/client/settings`

轻量 user-scoped key-value store，适合 Agent 配置和偏好。

```bash
# 读取设置
curl -s http://localhost:8080/client/settings \
  -H "Authorization: Bearer $HUB_ACCESS_TOKEN"

# 写入/更新设置（merge patch）
curl -s -X PATCH http://localhost:8080/client/settings \
  -H "Authorization: Bearer $HUB_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model_preference":"claude-sonnet-4-20250514","auto_approve_tools":"read,glob,grep"}'
```

---

## 6. 认证差异

| 维度 | Agent Protocol | AgentHub |
|---|---|---|
| **认证方式** | API Key（`X-Api-Key` header 或 `Authorization: Bearer <key>`） | Hub: TokenDance ID OIDC PKCE → Hub JWT session; Edge: local token |
| **Token 格式** | 不透明字符串 | JWT (RS256)，含 `sub`/`exp`/`device_id` 等 claims |
| **Token 签发** | 服务端生成静态 key | Hub: OIDC Authorization Code flow; Edge: 本地生成 |
| **Token 轮换** | 手动重新生成 | Hub: access token (短期) + refresh token (长期)；`POST /client/auth/refresh` |
| **匿名访问** | 取决于实现 | Edge 本地无认证模式（开发时）；Hub 始终要求认证 |
| **设备绑定** | 无 | Edge 设备注册 + device_id claim；Cloud Edge 注册返回 Edge-scoped JWT |

**关键结论：** AgentHub 的 JWT 认证体系比 Agent Protocol 的 API Key 更复杂。如果你正在构建一个需要对接 Agent Protocol 客户端的适配层，需要在适配层内完成 Hub JWT → API Key 的转换。

---

## 7. 端点速查总表

| Agent Protocol | AgentHub Edge (3210) | AgentHub Hub (8080) | 完备度 |
|---|---|---|---|
| `POST /runs` | `POST /v1/runs` | `POST /web/agent-tasks` | 完全 |
| `GET /runs/{id}` | `GET /v1/runs/{id}` | `GET /web/agent-tasks/:id/events` | 部分（Hub 返回事件流非状态摘要） |
| `GET /runs` | `GET /v1/runs` | `GET /web/agent-teams/:id/runs` | 完全 |
| `DELETE /runs/{id}` | `POST /v1/runs/{id}:cancel` | `POST /web/agent-tasks/:id/cancel` | 行为差异（cancel vs delete） |
| `GET /runs/{id}/wait` | WebSocket `GET /v1/events` | — | 行为差异（push vs poll） |
| `POST /threads` | `POST /v1/threads` | `POST /client/sessions` | 完全 |
| `GET /threads/{id}` | `GET /v1/threads/{id}` | session embedded in message list | 部分（Hub 无独立 GET） |
| `GET /threads` | `GET /v1/threads` | `GET /client/sessions` | 完全 |
| `DELETE /threads/{id}` | `DELETE /v1/threads/{id}` | `DELETE /client/sessions/:id` | 完全 |
| `PATCH /threads/{id}` | `PATCH /v1/threads/{id}` | `PUT /client/sessions/:id/info` | 完全 |
| `PUT /store/{ns}/{key}` | — | `POST /web/documents` | 命名差异 |
| `GET /store/{ns}/{key}` | — | `GET /web/documents/:id` | 命名差异 |
| `DELETE /store/{ns}/{key}` | — | `DELETE /web/documents/:id` | 命名差异 |
| `POST /store/search` | — | `GET /web/documents` | 部分（仅过滤，无自由文本搜索） |

---

## 8. 兼容性声明

1. **AgentHub is NOT a drop-in Agent Protocol implementation.** 客户端不能将 AgentHub URL 直接替换 Agent Protocol 服务端 URL 使用。
2. **概念层等价，API 层不同。** AgentHub 的 runs、threads/sessions、documents 覆盖了 Agent Protocol 的全部核心能力，但路由前缀、认证方式和字段命名均不同。
3. **AgentHub 能力超集。** AgentHub 额外提供：IM 群聊/私聊、联系人管理、Agent Profile、Skill/MCP 市场、WebSocket 事件推送、Device/Edge 注册与路由、AgentTeam 编排、审批工作流、审计日志、Provider Binding 等多 Agent 协作能力，这些在 Agent Protocol 规范中无对应概念。
4. **认证不可互换。** AgentHub 使用 TokenDance ID OIDC + JWT Hub session 而非 API Key。如需在 AgentHub 前面构建 Agent Protocol 兼容网关，需要在适配层实现 API Key → Hub session 的转换。
5. **本地 vs 云端分层。** Edge Server 提供与 Agent Protocol 最接近的本地执行接口；Hub Server 提供多租户、多设备的云协作接口。两者组合覆盖 Agent Protocol 的全部场景。
