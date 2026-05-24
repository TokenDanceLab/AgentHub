# Server-Hub API 接口文档

## 基础信息

- **Base URL**: `http://<host>:8080`
- **统一响应格式**:

```json
{
  "code": "OK",
  "message": "",
  "data": { ... }
}
```

成功: `code = "OK"`, 失败: `code` 为具体错误码（见附录）。

- **认证方式**: 除注册/登录/刷新外，所有接口需在 Header 中携带 JWT:
  ```
  Authorization: Bearer <access_token>
  ```

---

## 1. 认证模块 `/client/auth`

### 1.1 注册

```
POST /client/auth/register
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| username | string | 是 | 用户名，4-32字符 |
| password | string | 是 | 密码，8-64字符 |
| nickname | string | 是 | 昵称，1-64字符 |

**响应** `data`:
```json
{ "user_id": "uuid" }
```

---

### 1.2 登录

```
POST /client/auth/login
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| username | string | 是 | 用户名 |
| password | string | 是 | 密码 |
| device_type | string | 是 | 设备类型: `"web"` 或 `"desktop"` |
| device_id | string | 是 | 设备唯一标识 (UUID) |

**响应** `data`:
```json
{
  "access_token": "jwt_string",
  "refresh_token": "base64_random_string",
  "expires_in": 900
}
```

> **对接注意**: `device_type` 决定接口访问权限。`web` 可调 `/web/*`，`desktop` 可调 `/edge/*`。

---

### 1.3 刷新令牌

```
POST /client/auth/refresh
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| refresh_token | string | 是 | 登录时获得的 refresh_token |

**响应** `data`:
```json
{
  "access_token": "new_jwt_string",
  "refresh_token": "same_refresh_token",
  "expires_in": 900
}
```

---

### 1.4 登出 ⚡

```
POST /client/auth/logout
```

无请求体。撤销当前设备的所有 refresh token。

---

### 1.5 获取当前用户 ⚡

```
GET /client/auth/me
```

**响应** `data`:
```json
{
  "id": "uuid",
  "username": "string",
  "nickname": "string",
  "avatar_url": "string",
  "created_at": "ISO8601",
  "updated_at": "ISO8601"
}
```

---

### 1.6 修改个人资料 ⚡

```
PUT /client/auth/profile
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| nickname | string | 否 | 新昵称 |
| avatar_url | string | 否 | 头像URL |

**响应** `data`: 更新后的完整用户对象。

---

### 1.7 修改密码 ⚡

```
PUT /client/auth/password
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| old_password | string | 是 | 旧密码 |
| new_password | string | 是 | 新密码，8-64字符 |

> 修改密码后，所有设备的 token 将被撤销，需重新登录。

---

## 2. 联系人模块 `/client/contacts` ⚡

### 2.1 搜索用户

```
GET /client/contacts/search?id=<user_id>
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | query | 是 | 目标用户 ID |

**响应** `data`:
```json
{
  "user_id": "uuid",
  "username": "string",
  "nickname": "string",
  "avatar_url": "string",
  "relationship": "stranger|friend|pending_sent|pending_received|blocked"
}
```

---

### 2.2 发送好友请求

```
POST /client/contacts/friend-requests
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| friend_id | string | 是 | 目标用户 ID |
| message | string | 否 | 验证消息 |

> 发送后，接收方会通过 WebSocket 收到 `notification.new` 推送。

---

### 2.3 查看收到的好友请求

```
GET /client/contacts/friend-requests
```

**响应** `data`: 数组
```json
[{
  "request_id": "uuid",
  "user_id": "uuid",
  "username": "string",
  "nickname": "string",
  "avatar_url": "string",
  "message": "string",
  "created_at": "ISO8601"
}]
```

---

### 2.4 接受好友请求

```
POST /client/contacts/friend-requests/:id/accept
```

`:id` 为 `request_id`（从 2.3 获取）。

---

### 2.5 拒绝好友请求

```
POST /client/contacts/friend-requests/:id/reject
```

`:id` 为 `request_id`。

---

### 2.6 联系人列表

```
GET /client/contacts
```

**响应** `data`: 数组
```json
[{
  "user_id": "uuid",
  "username": "string",
  "nickname": "string",
  "avatar_url": "string",
  "remark": "string",
  "online": true,
  "type": "user"
}]
```

> `online` 表示该用户是否有任意设备在线。

---

### 2.7 删除联系人

```
DELETE /client/contacts/:user_id
```

双向删除好友关系。

---

### 2.8 屏蔽用户

```
POST /client/contacts/:user_id/block
```

屏蔽后对方无法发消息到私聊会话。

---

### 2.9 取消屏蔽

```
POST /client/contacts/:user_id/unblock
```

---

### 2.10 修改备注

```
PUT /client/contacts/:user_id/remark
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| remark | string | 是 | 备注名 |

---

## 3. 会话模块 `/client/sessions` ⚡

### 3.1 会话列表

```
GET /client/sessions
```

**响应** `data`: 数组
```json
[{
  "session_id": "uuid",
  "type": "private|group",
  "name": "string",
  "avatar_url": "string",
  "owner_user_id": "uuid",
  "pinned": false,
  "archived": false,
  "muted": false,
  "last_message_at": "ISO8601",
  "unread_count": 5,
  "member_count": 3,
  "role": "owner|member",
  "created_at": "ISO8601"
}]
```

> **对接注意**: `type` 字段区分私聊(`private`)和群聊(`group`)。`unread_count` 由服务端计算：`next_seq - last_read_seq`。

---

### 3.2 创建私聊

```
POST /client/sessions/private
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| target_user_id | string | 是 | 对方用户 ID |

**响应** `data`:
```json
{
  "session_id": "uuid",
  "type": "private",
  "created": true
}
```

> 如果私聊已存在，返回已有 `session_id`，`created: false`。私聊会话是去重的。

---

### 3.3 创建群聊

```
POST /client/sessions/group
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | 是 | 群名称，1-64字符 |
| member_ids | string[] | 是 | 初始成员 ID 列表（需是好友） |

**响应** `data`:
```json
{
  "session_id": "uuid",
  "type": "group",
  "created": true
}
```

> 创建者自动成为群主（role=owner）。

---

### 3.4 添加群成员

```
POST /client/sessions/:id/members
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| member_ids | string[] | 是 | 要添加的用户 ID 列表 |

---

### 3.5 移除群成员（踢人）

```
DELETE /client/sessions/:id/members/:user_id
```

> 仅群主可操作。

---

### 3.6 退出群聊

```
POST /client/sessions/:id/leave
```

> 群主不能直接退出，需先转让或解散。退出时会清理该用户邀请的 Agent 实例。

---

### 3.7 转让群主

```
POST /client/sessions/:id/transfer-owner
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| new_owner_id | string | 是 | 新群主用户 ID |

> 仅群主可操作。新群主必须是群成员。

---

### 3.8 解散群聊

```
POST /client/sessions/:id/dissolve
```

> 仅群主可操作。解散后不可恢复。

---

### 3.9 修改群信息

```
PUT /client/sessions/:id/info
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | 否 | 群名称 |
| avatar_url | string | 否 | 群头像 |
| announcement | string | 否 | 群公告 |

---

### 3.10 修改个人会话设置

```
PUT /client/sessions/:id/settings
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| pinned | bool | 否 | 是否置顶 |
| archived | bool | 否 | 是否归档 |
| muted | bool | 否 | 是否免打扰 |

---

### 3.11 删除会话（仅对自己）

```
DELETE /client/sessions/:id
```

> 软删除，只标记当前用户离开，不影响其他成员。

---

### 3.12 搜索会话

```
GET /client/sessions/search?q=<keyword>
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| q | query | 是 | 搜索关键词（匹配会话名称） |

**响应** `data`: 会话列表（格式同 3.1）。

---

## 4. 消息模块 `/client/sessions/:id` + `/client/messages` ⚡

### 4.1 发送消息

```
POST /client/sessions/:id/messages
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| client_msg_id | string | 是 | 客户端消息唯一 ID (UUID)，用于幂等去重 |
| content_type | string | 是 | 消息类型: `text` `code` `diff` `image` `file` `link_card` `deploy_card` |
| content | string | 是 | 消息内容。text 类型为纯文本；其他类型为 JSON 字符串 |
| reply_to_message_id | string | 否 | 被回复消息的 ID |

**响应** `data`:
```json
{
  "message_id": "uuid",
  "seq_id": 1,
  "created_at": "ISO8601"
}
```

> **对接注意**: `client_msg_id` 是幂等键，同一 `session_id + client_msg_id` 重复发送会返回已有消息，不会重复插入。

---

### 4.2 获取历史消息

```
GET /client/sessions/:id/messages?before_seq=<seq>&limit=<n>
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| before_seq | query | 否 | 从该 seq 之前开始拉取（不含该条），不传则从最新开始 |
| limit | query | 否 | 每页数量，默认 50，最大 100 |

**响应** `data`: 消息数组（倒序，最新在前）
```json
[{
  "id": "uuid",
  "session_id": "uuid",
  "seq_id": 10,
  "client_msg_id": "uuid",
  "sender_type": "user|agent",
  "sender_id": "uuid",
  "content_type": "text",
  "content": "消息内容",
  "reply_to_message_id": null,
  "reply_to": { ... },
  "recalled": false,
  "created_at": "ISO8601"
}]
```

---

### 4.3 增量同步消息

```
GET /client/sessions/:id/messages/sync?after_seq=<seq>&limit=<n>
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| after_seq | query | 是 | 从该 seq 之后开始拉取（不含该条），通常传本地最大 seq |
| limit | query | 否 | 默认 50，最大 500 |

**响应** `data`: 消息数组（正序，旧的在前）。格式同 4.2。

> **对接注意**: 增量同步是消息同步的核心接口。客户端首次进入会话用 4.2 拉历史，后续通过 WebSocket 实时接收 + 此接口补偿拉取。

---

### 4.4 撤回消息

```
POST /client/messages/:id/recall
```

> 发送者 5 分钟内可撤回自己的消息；群主可撤回任意消息。撤回后通过 WebSocket 广播 `message.recall`。

---

### 4.5 置顶消息

```
POST /client/messages/:id/pin
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| session_id | string | 是 | 会话 ID |

> 每个会话最多置顶 50 条。重复置顶不报错。

---

### 4.6 查看置顶列表

```
GET /client/sessions/:id/pins
```

**响应** `data`: 消息数组（格式同 4.2）。

---

### 4.7 取消置顶

```
DELETE /client/messages/:id/pin
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| session_id | string | 是 | 会话 ID |

---

### 4.8 转发消息

```
POST /client/messages/:id/forward
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| target_session_ids | string[] | 是 | 目标会话 ID 列表 |

> 转发会在每个目标会话中插入新消息（新 seq_id），通过 WebSocket 广播 `message.new`。

---

### 4.9 标记已读

```
POST /client/sessions/:id/read
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| last_read_seq | int64 | 是 | 已读到的最大 seq_id |

---

### 4.10 搜索会话内消息

```
GET /client/sessions/:id/messages/search?q=<keyword>&content_type=<type>&from=<date>&to=<date>
```

### 4.11 全局搜索消息

```
GET /client/messages/search?q=<keyword>&session_id=<sid>&content_type=<type>&from=<date>&to=<date>
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| q | query | 是 | 搜索关键词 |
| session_id | query | 否 | 限制搜索范围（4.10 已指定在 URL 中；4.11 可选） |
| content_type | query | 否 | 按消息类型过滤 |
| from / to | query | 否 | 时间范围（ISO8601） |

> 4.10 必须在会话内；4.11 不指定 session_id 则搜索当前用户所有会话的消息。

---

## 5. 附件模块 `/client/attachments` ⚡

### 5.1 探测附件

```
POST /client/attachments/probe
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| hash | string | 是 | 文件 SHA-256 哈希（64位 hex） |

**响应** `data`:
```json
{
  "exists": true,
  "attachment": { ... }
}
```

> **对接注意**: 上传前先 probe，若 `exists: true` 可跳过上传，直接使用已有附件 ID。

---

### 5.2 上传附件

```
POST /client/attachments
Content-Type: multipart/form-data
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| hash | form | 是 | 文件 SHA-256 哈希 |
| original_name | form | 否 | 原始文件名 |
| file | file | 是 | 文件内容 |

> 服务端会校验上传文件的 SHA-256 是否与 `hash` 一致。最大文件 10MB。

**响应** `data`: 附件对象
```json
{
  "id": "uuid",
  "hash": "sha256hex",
  "size": 1024,
  "mime_type": "image/png",
  "original_name": "screenshot.png",
  "created_at": "ISO8601"
}
```

---

### 5.3 下载附件

```
GET /client/attachments/:id
```

返回文件流，`Content-Type` 和 `Content-Disposition` 由服务端设置。

---

## 6. 通知模块 `/client/notifications` ⚡

### 6.1 通知列表

```
GET /client/notifications?unread_only=<bool>&limit=<n>&offset=<n>
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| unread_only | query | 否 | 仅未读，默认 false |
| limit | query | 否 | 每页数量，默认 50 |
| offset | query | 否 | 偏移量，默认 0 |

**响应** `data`: 数组
```json
[{
  "id": "uuid",
  "user_id": "uuid",
  "type": "mention|friend_request|group_invite|agent_done|system",
  "payload": "JSON string",
  "read": false,
  "created_at": "ISO8601"
}]
```

---

### 6.2 标记单条已读

```
POST /client/notifications/:id/read
```

---

### 6.3 全部已读

```
POST /client/notifications/read-all
```

---

## 7. Agent 实例管理 `/client/sessions/:id/agents` ⚡

### 7.1 添加 Agent 到会话

```
POST /client/sessions/:id/agents
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| agent_type | string | 是 | Agent 类型标识，如 `"claude-code"` |
| custom_agent_id | string | 否 | 自定义 Agent 模板 ID |
| display_name | string | 是 | Agent 在会话中的显示名称 |

> 仅群聊会话可添加 Agent。Agent 会作为会话成员（member_type=agent_instance）存在。

---

## 8. Web 端接口 `/web/*` ⚡ (device_type=web)

### 8.1 触发 Agent 任务

```
POST /web/agent-tasks
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| trigger_message_id | string | 是 | 触发任务的消息 ID |

**响应** `data`:
```json
{
  "id": "uuid",
  "agent_instance_id": "uuid",
  "triggered_by_user_id": "uuid",
  "trigger_message_id": "uuid",
  "status": "queued",
  "expire_at": "ISO8601",
  "created_at": "ISO8601"
}
```

> **对接注意**: 这是 Web 端触发 Agent 执行的核心接口。Hub 会自动查找该消息所在会话中由该用户邀请的 Agent 实例，创建任务后：
> - 若用户的 desktop 设备在线 → 通过 WebSocket 推送 `agent.dispatch` 帧
> - 若离线 → 任务入 Redis 队列，等 desktop 上线后拉取

---

### 8.2 取消 Agent 任务

```
POST /web/agent-tasks/:id/cancel
```

> 仅任务触发者可取消。已完成/失败/超时的任务不可取消。

---

### 8.3 自定义 Agent CRUD

#### 8.3.1 创建

```
POST /web/custom-agents
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | 是 | 名称 |
| agent_type | string | 是 | Agent 类型 |
| system_prompt | string | 是 | 系统提示词 |
| avatar_url | string | 否 | 头像 |
| capability_tags | string | 否 | 能力标签 (JSON) |
| tool_whitelist | string | 否 | 工具白名单 (JSON) |
| model_params | string | 否 | 模型参数 (JSON) |

**响应** `data`: 创建的 CustomAgent 对象（含 id）。

---

#### 8.3.2 列表

```
GET /web/custom-agents
```

**响应** `data`: CustomAgent 数组。

---

#### 8.3.3 更新

```
PUT /web/custom-agents/:id
```

参数同 8.3.1（全部必填）。

---

#### 8.3.4 删除

```
DELETE /web/custom-agents/:id
```

> 软删除。

---

## 9. Edge 端接口 `/edge/*` ⚡ (device_type=desktop)

### 9.1 注册设备

```
POST /edge/devices/register
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| device_id | string | 是 | 设备 ID |
| app_version | string | 否 | 客户端版本 |
| capabilities | string[] | 否 | 能力列表，如 `["claude-code"]` |

**响应** `data`: Device 对象。

---

### 9.2 Agent 任务回调

以下四个接口是 Edge 端执行 Agent 任务后的回调：

#### 9.2.1 确认接收

```
POST /edge/agent-tasks/:id/ack
```

任务状态: `queued/dispatched` → `running`

---

#### 9.2.2 流式输出

```
POST /edge/agent-tasks/:id/stream
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| content | string | 是 | 流式输出的内容片段 |

> 每次 stream 调用都会在会话中插入一条 sender_type=agent 的消息，并通过 WebSocket 广播 `message.new` 给所有会话成员。

---

#### 9.2.3 任务完成

```
POST /edge/agent-tasks/:id/done
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| final_content | string | 否 | Agent 最终输出（如为空则不插入最终消息） |

> 插入最终消息（如有），状态标记为 done，广播 `agent.done`，发送通知给任务触发者。

---

#### 9.2.4 任务失败

```
POST /edge/agent-tasks/:id/fail
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| error | string | 是 | 错误描述 |

> 状态标记为 failed，广播 `agent.failed`。

---

## 10. WebSocket `/client/ws`

### 连接流程

```
1. 客户端 GET /client/ws (Upgrade: websocket)
2. 5秒内发送 auth 帧:
   {
     "type": "auth",
     "payload": {
       "access_token": "jwt_string"
     }
   }
3. 收到响应帧:
   成功: { "type": "auth.ok" }
   失败: { "type": "auth.fail", "payload": { "reason": "..." } }
   连接断开
```

### 心跳

- 服务端每 30 秒发 ping
- 连续 2 次无 pong 响应断开连接

### 服务端推送事件类型

| type | 说明 | payload |
|------|------|---------|
| `message.new` | 新消息 | 完整 Message 对象 |
| `message.recall` | 消息撤回 | `{message_id, session_id}` |
| `message.pin` | 消息置顶 | MessagePin 对象 |
| `message.unpin` | 取消置顶 | `{session_id, message_id}` |
| `message.read` | 已读状态 | `{session_id, user_id, last_read_seq}` |
| `typing` | 输入状态 | `{user_id, session_id}` |
| `notification.new` | 新通知 | Notification 对象 |
| `agent.dispatch` | Agent 任务派发 | dispatchPayload 对象 |
| `agent.done` | Agent 任务完成 | `{task_id, agent_instance_id, session_id}` |
| `agent.failed` | Agent 任务失败 | `{task_id, agent_instance_id, session_id, error}` |
| `agent.cancel` | Agent 任务取消 | `{task_id, session_id, ...}` |
| `agent.timeout` | Agent 任务超时 | `{task_id, agent_instance_id, session_id}` |
| `device.online` | 好友上线 | `{user_id}` |
| `device.offline` | 好友下线 | `{user_id}` |
| `device.kicked` | 被踢下线 | `{reason}` |

### 客户端发送事件类型

| type | 说明 | payload |
|------|------|---------|
| `auth` | 认证（第一帧必须） | `{access_token}` |
| `typing` | 输入状态 | `{session_id}` 或直接字符串 |

---

## 附录: 错误码速查

### 认证类 (AUTH_*)
| 错误码 | HTTP | 说明 |
|--------|------|------|
| AUTH_INVALID_TOKEN | 401 | Token 无效或过期 |
| AUTH_INVALID_CREDENTIALS | 401 | 用户名或密码错误 |
| AUTH_TOKEN_EXPIRED | 401 | Token 已过期 |
| AUTH_DEVICE_MISMATCH | 403 | 设备类型不匹配 |
| AUTH_REFRESH_INVALID | 401 | Refresh token 无效或已撤销 |

### 用户类 (USER_*)
| 错误码 | HTTP | 说明 |
|--------|------|------|
| USER_NOT_FOUND | 404 | 用户不存在 |
| USER_USERNAME_TAKEN | 409 | 用户名已被注册 |
| USER_INVALID_PARAM | 400 | 参数校验失败 |

### 联系人/好友类 (FRIEND_*)
| 错误码 | HTTP | 说明 |
|--------|------|------|
| FRIEND_ALREADY | 409 | 已经是好友 |
| FRIEND_BLOCKED | 403 | 被对方屏蔽 |
| FRIEND_REQUEST_NOT_FOUND | 404 | 请求不存在 |

### 会话类 (SESSION_*)
| 错误码 | HTTP | 说明 |
|--------|------|------|
| SESSION_NOT_FOUND | 404 | 会话不存在 |
| SESSION_DISSOLVED | 410 | 会话已解散 |
| SESSION_NOT_MEMBER | 403 | 不是会话成员 |

### 消息类 (MSG_*)
| 错误码 | HTTP | 说明 |
|--------|------|------|
| MSG_NOT_FOUND | 404 | 消息不存在 |
| MSG_RECALL_TIMEOUT | 400 | 撤回超时（超过5分钟） |
| MSG_PIN_LIMIT_EXCEEDED | 400 | 置顶数量超限（50条） |
| MSG_BLOCKED_BY_RECEIVER | 403 | 被接收方屏蔽 |

### Agent 类 (AGENT_*)
| 错误码 | HTTP | 说明 |
|--------|------|------|
| AGENT_NOT_FOUND | 404 | Agent 实例不存在 |
| AGENT_OFFLINE | 503 | Agent 运行端离线 |
| AGENT_TASK_NOT_FOUND | 404 | 任务不存在 |
| AGENT_TASK_CANCELLED | 410 | 任务已取消 |
| AGENT_TASK_TIMEOUT | 410 | 任务超时（24小时） |

### 群组类 (GROUP_*)
| 错误码 | HTTP | 说明 |
|--------|------|------|
| GROUP_NOT_OWNER | 403 | 非群主 |
| GROUP_OWNER_CANNOT_LEAVE | 400 | 群主不能退群 |
| GROUP_ALREADY_MEMBER | 409 | 已是群成员 |

### 附件类 (ATTACH_*)
| 错误码 | HTTP | 说明 |
|--------|------|------|
| ATTACH_NOT_FOUND | 404 | 附件不存在 |
| ATTACH_TOO_LARGE | 413 | 文件超过大小限制 |
| ATTACH_HASH_MISMATCH | 400 | 文件哈希不匹配 |

### 通知类 (NOTIF_*)
| 错误码 | HTTP | 说明 |
|--------|------|------|
| NOTIF_NOT_FOUND | 404 | 通知不存在 |

### 通用
| 错误码 | HTTP | 说明 |
|--------|------|------|
| BAD_REQUEST | 400 | 请求参数错误 |
| INTERNAL_ERROR | 500 | 服务端内部错误 |

---

> 标注 ⚡ 的接口需要 `Authorization: Bearer <access_token>` 请求头。
