# AgentHub Hub Server 需求文档

> 本文来自 `origin/server—hub` 分支的 Hub Server 需求草案，已经迁移到统一的 reference 文档区。
> 它用于描述中心 IM、好友、群聊、Agent 元数据、消息和任务路由需求；具体工程结构、数据库和消息队列选型仍需继续对齐 `docs/architecture.md`、`docs/module-boundaries.md` 和 `api/`。

## 1. 项目定位

Hub Server 是 AgentHub 的中心服务端，负责多人 IM 协作、用户关系、Agent 元数据、群聊关系、消息存储、实时推送和任务路由。

整体交互逻辑参考微信：

- 用户可以注册登录。
- 用户可以通过账号搜索并添加好友。
- 用户可以创建和管理自己的 Agent。
- 用户可以与好友私聊。
- 用户可以创建群聊，并拉自己的 Agent 和已添加好友进群。
- 群聊中既可以出现真实用户，也可以出现 Agent。
- 群聊消息通过 WebSocket 实时同步。
- 当用户在群聊中 @Agent 时，Hub Server 创建 Agent 任务，并通过 RabbitMQ 或 WebSocket 下发给后续的 Edge Server / Runner 执行。

Hub Server 不直接执行 Codex、Claude 等 Agent。它只负责保存 Agent 信息、管理 Agent 所属关系、处理权限和路由任务。

## 2. 技术栈

本节为 `server—hub` 分支提交的技术栈建议，供后续实现参考；最终选型以 `docs/architecture.md`、`docs/reference/03-build/backend/02-go-services.md` 和实际工程约束为准。

| 技术 | 用途 |
| :--- | :--- |
| Go | 后端主语言 |
| Gin | HTTP API 框架 |
| Gorm | ORM 数据访问 |
| MySQL | 核心业务数据存储 |
| Redis | Token 黑名单、验证码、在线状态、未读数、WebSocket 连接状态 |
| WebSocket | 实时消息、群聊推送、任务状态推送 |
| RabbitMQ | Agent 任务异步投递、消息削峰、后续 Edge Server 任务消费 |
| Docker | 本地开发和部署环境 |
| Docker Compose | 编排 Hub Server、MySQL、Redis、RabbitMQ |

## 3. 核心目标

第一阶段 Hub Server 需要完成以下能力：

1. JWT 注册登录。
2. 通过账号添加好友。
3. 添加和管理 Agent。
4. 创建群聊，支持拉自己的 Agent 和已添加用户。
5. 私聊和群聊基础消息收发。
6. WebSocket 实时推送消息。
7. RabbitMQ 预留 Agent 任务投递能力。

## 4. 角色与对象

| 对象 | 说明 |
| :--- | :--- |
| User | 真实用户，拥有账号、昵称、头像等资料 |
| Friend | 用户之间的好友关系 |
| Agent | 用户创建或绑定的 AI Agent，归属于某个用户 |
| Conversation | 会话，包含私聊、Agent 单聊、群聊 |
| Group | 群聊，允许多个用户和多个 Agent 作为成员 |
| Message | 消息，发送者可以是用户、Agent 或系统 |
| Task | Agent 执行任务，由 @Agent 或明确指令触发 |

## 5. 功能需求

### 5.1 JWT 注册登录

#### 注册

用户可以通过账号和密码注册。

账号规则：

- 账号全局唯一。
- 账号可用于搜索和添加好友。
- 第一版可使用 `account` 字段，不强制区分手机号、邮箱或用户名。

注册字段：

- account：账号，唯一。
- password：密码。
- nickname：昵称。
- avatar：头像，可选。

注册成功后：

- 创建用户记录。
- 密码加密存储。
- 返回用户基础信息和 JWT。

#### 登录

用户通过账号和密码登录。

登录成功后：

- 返回 access token。
- 可选返回 refresh token。
- 更新用户最后登录时间。
- 初始化 Redis 在线状态。

#### 鉴权

除注册、登录、健康检查外，其他接口默认需要 JWT。

JWT 中建议包含：

- user_id
- account
- token_version
- exp

#### 退出登录

第一版可选：

- 前端删除 token。
- 后端可将 token 加入 Redis 黑名单，直到 token 过期。

### 5.2 用户资料

用户可以查看和修改自己的基础资料。

支持字段：

- nickname
- avatar
- bio

用户可以通过账号搜索其他用户。

搜索限制：

- 不返回密码等敏感字段。
- 被拉黑用户不可被正常添加。
- 搜索结果需要标识双方关系状态：陌生人、已申请、好友、已拉黑。

### 5.3 好友系统

好友系统参考微信添加好友流程。

#### 发送好友申请

用户 A 通过账号搜索到用户 B 后，可以发送好友申请。

约束：

- 不能添加自己。
- 已经是好友时不能重复申请。
- 已拉黑关系下不能申请。
- 重复申请应复用旧申请或提示已申请。

申请字段：

- requester_id
- receiver_id
- message：验证消息，可选。
- status：pending / accepted / rejected / expired

#### 处理好友申请

用户 B 可以同意或拒绝申请。

同意后：

- 创建双向好友关系。
- 可自动创建用户私聊会话。
- 通过 WebSocket 通知双方。

拒绝后：

- 更新申请状态。
- 通知申请方。

#### 好友列表

用户可以查看自己的好友列表。

好友列表需要包含：

- user_id
- account
- nickname
- avatar
- online_status
- remark，可选。

#### 删除好友

用户可以删除好友。

删除后：

- 双方好友关系失效。
- 历史私聊是否保留由产品决定，第一版建议保留历史会话但不能继续发送，或发送时提示已非好友。

### 5.4 Agent 管理

用户可以添加自己的 Agent。第一版 Agent 可以理解为用户创建的 AI 联系人。

Agent 字段：

- name：Agent 名称。
- avatar：头像，可选。
- description：描述。
- provider：codex / claude / opencode / custom。
- capabilities：能力标签，例如 code、review、doc、deploy。
- system_prompt：系统提示词，可选。
- owner_user_id：所属用户。
- status：available / unavailable / running。

#### 创建 Agent

用户可以创建 Agent。

约束：

- Agent 必须归属于创建者。
- Agent 名称在同一用户下建议唯一。
- 第一版只保存 Agent 元数据，不要求真正打通 runner。

#### Agent 列表

用户可以查看自己的 Agent 列表。

列表用于：

- 发起 Agent 单聊。
- 创建群聊时选择 Agent。
- 群聊中 @Agent。

#### 修改 Agent

用户可以修改自己 Agent 的基础资料。

#### 删除 Agent

用户可以删除自己的 Agent。

删除约束：

- 如果 Agent 已在群聊中，删除后应从群成员中移除或标记为不可用。
- 历史消息保留。

### 5.5 会话系统

会话是消息承载对象。

会话类型：

- private：用户与用户私聊。
- agent：用户与 Agent 单聊。
- group：群聊。

会话需要支持：

- 会话列表。
- 最近消息。
- 未读数。
- 置顶，可选。
- 归档，可选。

会话列表展示字段：

- conversation_id
- type
- title
- avatar
- last_message
- last_message_time
- unread_count

### 5.6 用户私聊

好友之间可以进行 1v1 私聊。

规则：

- 只有好友可以新建或继续私聊。
- 私聊会话成员固定为两个用户。
- 消息发送后由 Hub Server 存储并通过 WebSocket 推送给对方。

### 5.7 Agent 单聊

用户可以与自己的 Agent 建立单聊会话。

规则：

- 用户只能与自己的 Agent 单聊。
- 第一版可先支持发送消息和生成任务记录。
- 后续由 Edge Server / Runner 消费任务并返回 Agent 回复。

### 5.8 群聊系统

用户可以创建群聊，并拉自己的 Agent 和已添加好友进入群聊。

#### 创建群聊

创建群聊时可以选择：

- 好友用户。
- 自己创建的 Agent。

创建者自动成为群主。

群聊字段：

- group_id
- conversation_id
- name
- avatar
- owner_user_id
- announcement

#### 群成员

群成员类型：

- user
- agent

成员角色：

- owner：群主。
- admin：管理员，可选。
- member：普通用户。
- agent：Agent 成员。

约束：

- 只能拉自己的好友进群。
- 只能拉自己的 Agent 进群。
- 第一版可以只允许群主邀请新成员。
- Agent 成员不能主动管理群。

#### 群消息

群成员中的用户可以发送群消息。

消息发送后：

- Hub Server 校验发送者是否在群里。
- 存储消息。
- 分配会话内递增 seq。
- 推送给所有在线群成员。
- 离线成员下次登录后可拉取历史消息。

#### @Agent

当群消息中包含 @Agent 时：

- Hub Server 识别 mention。
- 校验该 Agent 是否在群里。
- 校验发送者是否有权限调用该 Agent。
- 创建 Agent task。
- 通过 RabbitMQ 投递任务事件。
- 同时通过 WebSocket 推送任务创建状态。

第一版 Agent 可以暂时不真实执行，但必须生成任务记录，便于后续接入 Edge Server / Runner。

### 5.9 消息系统

消息类型：

- text：普通文本。
- image：图片，可选。
- file：文件，可选。
- code：代码块，可选。
- system：系统消息。
- task：Agent 任务状态消息。
- artifact：Agent 产物卡片，后续扩展。

消息发送者类型：

- user
- agent
- system

核心字段：

- message_id
- conversation_id
- seq
- sender_type
- sender_id
- content_type
- content
- created_at

重要规则：

- 消息顺序以 Hub Server 生成的 seq 为准。
- 客户端本地生成的消息 ID 只能作为临时 ID。
- 消息必须先通过 Hub Server 校验和持久化，再广播给其他成员。

### 5.10 WebSocket 实时通信

WebSocket 用于实时消息和状态推送。

连接方式：

- 客户端连接时携带 JWT。
- Hub Server 验证 token。
- 验证通过后建立 user_id 与连接的映射。

需要支持的事件：

| 事件 | 说明 |
| :--- | :--- |
| message.created | 新消息 |
| conversation.updated | 会话最近消息、未读数更新 |
| friend.requested | 收到好友申请 |
| friend.accepted | 好友申请通过 |
| group.member_added | 群成员新增 |
| group.member_removed | 群成员移除 |
| task.created | Agent 任务创建 |
| task.running | Agent 任务执行中 |
| task.completed | Agent 任务完成 |
| task.failed | Agent 任务失败 |

心跳机制：

- 客户端定期 ping。
- 服务端定期检测连接存活。
- Redis 记录用户在线状态。

### 5.11 RabbitMQ 任务队列

RabbitMQ 用于 Agent 任务异步投递。

第一版建议设计以下 exchange 和 queue：

| 名称 | 类型 | 说明 |
| :--- | :--- | :--- |
| agent.task.exchange | direct/topic | Agent 任务交换机 |
| agent.task.queue | queue | 等待 Edge Server / Runner 消费的任务 |
| agent.task.result.queue | queue | 接收 Agent 执行结果，可后续扩展 |

任务消息示例：

```json
{
  "task_id": "task_123",
  "conversation_id": "conv_123",
  "trigger_message_id": "msg_123",
  "agent_id": "agent_123",
  "owner_user_id": "user_123",
  "content": "帮我生成一个登录页",
  "created_at": "2026-05-21T08:00:00Z"
}
```

RabbitMQ 在 MVP 中的最低要求：

- Hub Server 能在 @Agent 后发布任务消息。
- 任务发布失败时要记录失败状态。
- 任务状态要能在数据库中查询。

### 5.12 权限规则

#### 用户权限

- 用户只能查看自己参与的会话。
- 用户只能给好友发送私聊消息。
- 用户只能创建和管理自己的 Agent。
- 用户只能把自己的好友拉进群。
- 用户只能把自己的 Agent 拉进群。

#### 群权限

- 群主可以修改群信息。
- 群主可以添加或移除群成员。
- 第一版可以不做管理员，后续扩展。
- 普通成员可以发送消息。
- Agent 成员不能主动发送消息，除非由任务触发。

#### Agent 权限

- Agent 必须属于某个用户。
- Agent 是否可以被群成员调用，第一版可按“Agent 在群里即可被调用”处理。
- 后续可增加“仅群主可调用”“所有成员可调用”“指定成员可调用”等策略。

## 6. 接口需求

### 6.1 Auth

| 方法 | 路径 | 说明 |
| :--- | :--- | :--- |
| POST | /api/v1/auth/register | 注册 |
| POST | /api/v1/auth/login | 登录 |
| POST | /api/v1/auth/logout | 退出登录 |
| GET | /api/v1/auth/me | 当前用户信息 |

### 6.2 User

| 方法 | 路径 | 说明 |
| :--- | :--- | :--- |
| GET | /api/v1/users/search | 通过账号搜索用户 |
| GET | /api/v1/users/:id | 查看用户资料 |
| PUT | /api/v1/users/me | 修改我的资料 |

### 6.3 Friend

| 方法 | 路径 | 说明 |
| :--- | :--- | :--- |
| POST | /api/v1/friends/requests | 发送好友申请 |
| GET | /api/v1/friends/requests | 查看收到/发出的好友申请 |
| POST | /api/v1/friends/requests/:id/accept | 同意好友申请 |
| POST | /api/v1/friends/requests/:id/reject | 拒绝好友申请 |
| GET | /api/v1/friends | 好友列表 |
| DELETE | /api/v1/friends/:friend_id | 删除好友 |

### 6.4 Agent

| 方法 | 路径 | 说明 |
| :--- | :--- | :--- |
| POST | /api/v1/agents | 创建 Agent |
| GET | /api/v1/agents | 我的 Agent 列表 |
| GET | /api/v1/agents/:id | Agent 详情 |
| PUT | /api/v1/agents/:id | 修改 Agent |
| DELETE | /api/v1/agents/:id | 删除 Agent |

### 6.5 Conversation

| 方法 | 路径 | 说明 |
| :--- | :--- | :--- |
| GET | /api/v1/conversations | 会话列表 |
| POST | /api/v1/conversations/private | 创建或获取用户私聊 |
| POST | /api/v1/conversations/agent | 创建或获取 Agent 单聊 |
| POST | /api/v1/groups | 创建群聊 |
| GET | /api/v1/groups/:id | 群详情 |
| POST | /api/v1/groups/:id/members | 添加群成员 |
| DELETE | /api/v1/groups/:id/members/:member_id | 移除群成员 |

### 6.6 Message

| 方法 | 路径 | 说明 |
| :--- | :--- | :--- |
| POST | /api/v1/conversations/:id/messages | 发送消息 |
| GET | /api/v1/conversations/:id/messages | 拉取历史消息 |
| POST | /api/v1/conversations/:id/read | 标记已读 |

### 6.7 Task

| 方法 | 路径 | 说明 |
| :--- | :--- | :--- |
| GET | /api/v1/tasks/:id | 查看任务详情 |
| POST | /api/v1/tasks/:id/cancel | 取消任务 |

### 6.8 WebSocket

| 方法 | 路径 | 说明 |
| :--- | :--- | :--- |
| GET | /ws | WebSocket 连接入口 |

## 7. 数据模型建议

### 7.1 users

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| id | bigint | 用户 ID |
| account | varchar | 唯一账号 |
| password_hash | varchar | 密码哈希 |
| nickname | varchar | 昵称 |
| avatar | varchar | 头像 |
| bio | varchar | 简介 |
| status | tinyint | 状态 |
| last_login_at | datetime | 最后登录时间 |
| created_at | datetime | 创建时间 |
| updated_at | datetime | 更新时间 |

### 7.2 friend_requests

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| id | bigint | 申请 ID |
| requester_id | bigint | 申请人 |
| receiver_id | bigint | 接收人 |
| message | varchar | 验证消息 |
| status | varchar | pending / accepted / rejected |
| created_at | datetime | 创建时间 |
| updated_at | datetime | 更新时间 |

### 7.3 friendships

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| id | bigint | 好友关系 ID |
| user_id | bigint | 用户 |
| friend_id | bigint | 好友 |
| remark | varchar | 备注 |
| status | varchar | active / deleted / blocked |
| created_at | datetime | 创建时间 |

建议好友关系存双向两条记录，查询更简单。

### 7.4 agents

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| id | bigint | Agent ID |
| owner_user_id | bigint | 所属用户 |
| name | varchar | 名称 |
| avatar | varchar | 头像 |
| description | text | 描述 |
| provider | varchar | codex / claude / opencode / custom |
| capabilities | json | 能力标签 |
| system_prompt | text | 系统提示词 |
| status | varchar | available / unavailable / running |
| created_at | datetime | 创建时间 |
| updated_at | datetime | 更新时间 |

### 7.5 conversations

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| id | bigint | 会话 ID |
| type | varchar | private / agent / group |
| title | varchar | 会话标题 |
| avatar | varchar | 会话头像 |
| last_message_id | bigint | 最后一条消息 |
| last_message_at | datetime | 最后活跃时间 |
| created_by | bigint | 创建人 |
| created_at | datetime | 创建时间 |

### 7.6 conversation_members

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| id | bigint | 成员记录 ID |
| conversation_id | bigint | 会话 ID |
| member_type | varchar | user / agent |
| member_id | bigint | 用户 ID 或 Agent ID |
| role | varchar | owner / admin / member / agent |
| joined_at | datetime | 加入时间 |
| muted | bool | 是否免打扰 |
| last_read_seq | bigint | 最后已读消息 seq |

### 7.7 groups

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| id | bigint | 群 ID |
| conversation_id | bigint | 关联会话 ID |
| name | varchar | 群名称 |
| avatar | varchar | 群头像 |
| owner_user_id | bigint | 群主 |
| announcement | text | 群公告 |
| created_at | datetime | 创建时间 |

### 7.8 messages

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| id | bigint | 消息 ID |
| conversation_id | bigint | 会话 ID |
| seq | bigint | 会话内递增序号 |
| sender_type | varchar | user / agent / system |
| sender_id | bigint | 发送者 ID |
| content_type | varchar | text / image / file / task / artifact |
| content | json/text | 消息内容 |
| created_at | datetime | 创建时间 |

### 7.9 message_mentions

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| id | bigint | ID |
| message_id | bigint | 消息 ID |
| target_type | varchar | user / agent |
| target_id | bigint | 目标 ID |

### 7.10 tasks

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| id | bigint | 任务 ID |
| conversation_id | bigint | 会话 ID |
| trigger_message_id | bigint | 触发消息 |
| agent_id | bigint | 目标 Agent |
| created_by | bigint | 触发用户 |
| status | varchar | pending / queued / running / completed / failed / canceled |
| input | json/text | 任务输入 |
| result | json/text | 任务结果 |
| created_at | datetime | 创建时间 |
| updated_at | datetime | 更新时间 |

## 8. 推荐项目结构

```text
hub-server
├── cmd
│   └── server
│       └── main.go
├── internal
│   ├── config
│   ├── database
│   ├── middleware
│   ├── router
│   ├── auth
│   ├── user
│   ├── friend
│   ├── agent
│   ├── conversation
│   ├── message
│   ├── group
│   ├── task
│   ├── websocket
│   ├── mq
│   └── permission
├── pkg
│   ├── jwt
│   ├── password
│   ├── response
│   └── snowflake
├── migrations
├── deployments
│   └── docker-compose.yml
├── Dockerfile
├── go.mod
└── README.md
```

## 9. 阶段开发顺序

建议按以下顺序实现：

1. 项目骨架、配置加载、日志、统一响应。
2. MySQL、Redis、RabbitMQ、Docker Compose。
3. Gorm 模型和数据库迁移。
4. JWT 注册登录。
5. 用户搜索和资料接口。
6. 好友申请、同意、好友列表。
7. 会话模型和私聊会话。
8. WebSocket 连接管理。
9. 私聊消息发送、保存、推送。
10. Agent 创建、列表、修改、删除。
11. 群聊创建，支持拉好友和自己的 Agent。
12. 群聊消息发送、保存、推送。
13. @Agent 识别、任务创建。
14. RabbitMQ 发布 Agent 任务。
15. 任务状态查询和基础推送。

## 10. 验收标准

MVP 完成后需要满足：

1. 用户 A 可以注册并登录。
2. 用户 B 可以注册并登录。
3. 用户 A 可以通过账号搜索用户 B。
4. 用户 A 可以向用户 B 发送好友申请。
5. 用户 B 可以同意好友申请。
6. 用户 A 和用户 B 可以成为好友并互相发送私聊消息。
7. 用户 A 可以创建自己的 Agent。
8. 用户 A 可以查看自己的 Agent 列表。
9. 用户 A 可以创建群聊，并拉用户 B 和自己的 Agent 入群。
10. 用户 A 和用户 B 可以在群聊中实时收发消息。
11. 用户 A 在群聊中 @Agent 后，Hub Server 可以创建任务记录。
12. @Agent 任务可以被发布到 RabbitMQ。
13. WebSocket 可以推送新消息、好友申请、群消息和任务状态。
14. 未登录用户无法访问受保护接口。
15. 用户不能拉陌生人或别人的 Agent 进群。

## 11. 后续扩展

- 接入 Edge Server，使 RabbitMQ 任务真正被 desktop 消费。
- 接入 runner，完成 Codex、Claude Code、OpenCode 实际执行。
- 支持 Agent 流式输出回传。
- 支持 Agent 产物卡片。
- 支持图片、文件上传和对象存储。
- 支持群管理员。
- 支持消息撤回、引用、转发。
- 支持消息已读回执。
- 支持 Agent 权限策略。
- 支持 Orchestrator 多 Agent 调度。
