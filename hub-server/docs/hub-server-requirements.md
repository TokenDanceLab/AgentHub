# AgentHub Hub Server 需求文档

最后更新：2026-05-25 | 基于 `dev/delicious233` 当前代码 | 面向 Agent 可执行

---

## 1. 现状评估

### 1.1 已完成

| 模块 | 完成度 | 关键实现 |
|------|:--:|------|
| 账号体系 | 85% | 注册/登录/刷新/登出/profile/改密，bcrypt + HS256 JWT |
| IM 消息 | 90% | 发送/分页/增量同步/撤回/置顶/转发(并发8)/全文搜索/已读 |
| 联系人 | 85% | 搜索/好友请求/列表/黑名单/备注，批量查询已修复 |
| 会话 | 85% | 私聊/群聊/成员管理/转让/解散/搜索 |
| Agent 任务调度 | 80% | dispatch→ack→stream→done/fail，taskId↔edgeRunId |
| WebSocket | 85% | per-user 路由、心跳、丢帧告警、panic recovery |
| 中间件链 | 90% | CORS/APIVersion/BodyLimit/RateLimit/RequestID/AccessLog/Timeout |
| 数据库 | 90% | 18 migrations, GORM+PG, Upsert/jsonb校验/seq分配 |
| 缓存 | 85% | Redis singleflight/seq/路由/离线任务队列 |
| EventBus | 85% | ants pool 1024/panic recovery/metrics |
| 生产部署 | 80% | Docker Compose on hk2, nginx 反代 |

### 1.2 待完成能力栈（按优先级）

```
Priority 0 — 阻断：没有这些，产品不能正式对外
  P0-1: TokenDance ID OIDC PKCE 完整登录流程
  P0-2: 现有 ~36 路由 OpenAPI 覆盖补全
  P0-3: Hub WebSocket 事件写入 api/events.md

Priority 1 — 核心平台：没有这些，Settings 大部分入口是空的
  P1-1: Agent Profile Hub 持久化 (CRUD + 同步)
  P1-2: Agent Configuration 存储 (模型映射/审批策略/Provider binding)
  P1-3: Execution Target 管理 (设备注册增强/远程目标)
  P1-4: Skill 目录 (CRUD + 可见性 + 版本)
  P1-5: MCP Server 注册表

Priority 2 — 生态平台：AgentHub 差异化能力
  P2-1: Agent 市场 (发布/搜索/安装/评分)
  P2-2: 模型配置云端持久化 + 跨端同步
  P2-3: cc-switch provider binding
  P2-4: 安全审计日志

Priority 3 — 高级：远程/中继/多端增强
  P3-1: 远程控制 (Relay command + 审批代理)
  P3-2: 多端 device capability 差异同步
  P3-3: Runner → Runtime 命名迁移方案
```

---

## 2. P0 — 阻断级

### 2.1 TokenDance ID OIDC PKCE 完整登录流程

#### 2.1.1 现状

当前 `AuthMiddleware` 支持 TokenDance ID RS256/JWKS bearer token 作为兼容路径，但不能替代完整 Hub session。Desktop AuthPage 保留了 PKCE state 写入占位，但 OIDC callback 捕获和 Hub token exchange 未实现。

实际缺失链路：

```text
Desktop 打开系统浏览器 → TokenDance ID /oidc/auth?...&code_challenge=...&code_challenge_method=S256
  → 用户登录 TokenDance ID
  → TokenDance ID redirect 回 Hub callback
  → Hub POST /client/auth/oidc/callback 接收 code + code_verifier
  → Hub 拿 code 去 TokenDance ID /oidc/token 换 ID token
  → Hub 验证 ID token (issuer/audience/exp/JWKS)
  → Hub 把 tokendance_sub 映射到 Hub user（无则自动创建）
  → Hub 签发 Hub access/refresh session + device proof
  → Hub 返回 Hub tokens 给客户端
```

#### 2.1.2 新增 API

**`GET /client/auth/oidc/authorize`** — 生成 PKCE 参数并返回 redirect URL

```
Query:  device_type=desktop|web, device_id=..., redirect_uri=...
Response 200:
{
  "authorization_url": "https://id.vectorcontrol.tech/oidc/auth?...&code_challenge=...",
  "state": "临时state，服务端保存用于验证callback",
  "code_verifier": "本地生成的PKCE verifier"  
}
```

> 注意：`code_verifier` 需要返回给 Desktop 保存，因为 callback 时 Desktop 需要提供它。实际方案：Hub 不返回 code_verifier；Desktop 自己生成 PKCE pair，把 challenge 传给 Hub 的 authorize endpoint，Hub 只构造 URL。

**修订方案**：

**`POST /client/auth/oidc/authorize`** — 接收客户端生成的 PKCE challenge，返回 redirect URL

```
Request:
{
  "code_challenge": "客户端 S256 challenge (base64url)",
  "code_challenge_method": "S256",
  "device_type": "desktop|web",
  "device_id": "..."
}
Response 200:
{
  "state": "Hub 生成的随机 state (TTL 10min, Redis)",
  "authorization_url": "https://id.vectorcontrol.tech/oidc/auth?response_type=code&client_id=...&redirect_uri=...&code_challenge=...&code_challenge_method=S256&state=..."
}
```

**`POST /client/auth/oidc/callback`** — Hub-owned OIDC callback

```
Request:
{
  "code": "TokenDance ID 返回的 authorization code",
  "state": "authorize 步骤返回的 state",
  "code_verifier": "客户端保存的 PKCE verifier",
  "device_type": "desktop|web",
  "device_id": "..."
}
Response 200:
{
  "access_token": "Hub HS256 access token",
  "refresh_token": "Hub refresh token (opaque)",
  "expires_in": 900,
  "user": { "user_id": "...", "username": "...", "nickname": "...", "avatar_url": "..." }
}
Response 400: { "error": { "code": "oidc_invalid_state", "message": "state 已过期或不存在" } }
Response 400: { "error": { "code": "oidc_code_exchange_failed", "message": "..." } }
Response 400: { "error": { "code": "oidc_id_token_invalid", "message": "issuer/audience/exp 校验失败" } }
```

#### 2.1.3 新增 Service 逻辑 (`internal/service/oidc.go`)

```
OIDCService 依赖:
  - config *config.Config (TokenDanceID issuer/client_id/client_secret)
  - cache  *cache.Client (state 临时存储)
  - repo   UserRepository
  - jwt    *jwtutil (签发 Hub token)

方法:
  - GenerateAuthorizationURL(codeChallenge, deviceType, deviceID) → (state, url, error)
    1. 生成 crypto/rand 32-byte state
    2. state → Redis SETEX state:{state} = {codeChallenge, deviceType, deviceID, createdAt} TTL 10min
    3. 构造 TokenDance ID /oidc/auth URL
    4. 返回

  - HandleCallback(code, state, codeVerifier, deviceType, deviceID) → (accessToken, refreshToken, user, error)
    1. GET Redis state:{state}，校验存在/未过期/device一致
    2. POST TokenDance ID /oidc/token { grant_type=authorization_code, code, code_verifier, client_id, client_secret }
    3. 从 response 提取 id_token
    4. 调用 jwtutil.ParseTokenDanceJWT(id_token) 验证签名/iss/aud/exp
    5. 提取 tokendance_sub
    6. repo.FindOrCreateUserByTokenDanceSub(tokendance_sub) — 首次自动创建
    7. repo.UpsertDevice(userID, deviceType, deviceID)
    8. jwtutil.GenerateAccessToken(userID, deviceType, deviceID)
    9. jwtutil.GenerateRefreshToken() + repo.UpsertRefreshToken()
   10. DELETE Redis state:{state} (一次性消费)
   11. 返回 tokens + user
```

#### 2.1.4 新增 Repository 逻辑

```
UserRepository 新增:
  - FindByTokenDanceSub(sub string) (*model.User, error)
  - FindOrCreateByTokenDanceSub(sub string) (*model.User, error)
    首次调用时自动生成 username = "td_{sub前8位}"、nickname = sub、password_hash 为空
```

#### 2.1.5 新增 Model/Migration

**Migration 0019: `users` 表新增字段**

```sql
-- 0019_token_dance_sub.up.sql
ALTER TABLE users ADD COLUMN tokendance_sub VARCHAR(255);
CREATE UNIQUE INDEX idx_users_tokendance_sub ON users(tokendance_sub) WHERE tokendance_sub IS NOT NULL AND tokendance_sub != '';
ALTER TABLE users ADD COLUMN tokendance_sub_linked_at TIMESTAMPTZ;

-- 0019_token_dance_sub.down.sql
DROP INDEX IF EXISTS idx_users_tokendance_sub;
ALTER TABLE users DROP COLUMN IF EXISTS tokendance_sub_linked_at;
ALTER TABLE users DROP COLUMN IF EXISTS tokendance_sub;
```

**User model 新增字段：**
```go
TokenDanceSub       *string    `gorm:"column:tokendance_sub;uniqueIndex"`
TokenDanceSubLinkedAt *time.Time `gorm:"column:tokendance_sub_linked_at"`
```

#### 2.1.6 配置文件变更

`configs/config.yaml` 新增：
```yaml
tokendance_id:
  issuer_url: "https://id.vectorcontrol.tech"
  jwks_uri: "https://id.vectorcontrol.tech/oidc/jwks"
  client_id: ""         # 环境变量 AGENTHUB_TOKENDANCE_ID_CLIENT_ID
  client_secret: ""     # 环境变量 AGENTHUB_TOKENDANCE_ID_CLIENT_SECRET
  redirect_uri: "http://localhost:8080/client/auth/oidc/callback"  # 环境变量可覆盖
```

`internal/config/config.go` 新增 struct：
```go
TokenDanceID struct {
  IssuerURL   string `mapstructure:"issuer_url"`
  JWKSURI     string `mapstructure:"jwks_uri"`
  ClientID    string `mapstructure:"client_id"`
  ClientSecret string `mapstructure:"client_secret"`
  RedirectURI string `mapstructure:"redirect_uri"`
}
```

#### 2.1.7 验收

```powershell
# 单元测试
cd hub-server
go test ./internal/service -run "TestOIDC" -count=1 -v
go test ./internal/handler -run "TestOIDC" -count=1 -v
go test ./internal/repository -run "TestUserTokenDance" -count=1 -v

# 集成验证 (需要 TokenDance ID 测试环境)
# 1. 构造 PKCE challenge pair
# 2. POST /client/auth/oidc/authorize → 拿到 authorization_url + state
# 3. 模拟 callback: POST /client/auth/oidc/callback
# 4. 拿到 Hub access_token
# 5. 用 access_token 调 GET /client/auth/me → 200

# 安全验证
go test ./internal/jwtutil -run "TestParseTokenDanceJWT" -count=1 -v
# 验证：错误 issuer → 拒绝；错误 audience → 拒绝；过期 → 拒绝
```

---

### 2.2 OpenAPI 覆盖补全

#### 2.2.1 现状

`api/openapi.yaml` 已覆盖约 40 个 endpoint。Hub 代码中实际存在约 36 个额外路由未覆盖。

#### 2.2.2 需补全的路由清单

**Session 成员**
| 路由 | 方法 | 说明 |
|------|------|------|
| `/client/sessions/{id}/members` | GET | 列出会话成员 |
| `/client/sessions/{id}/members` | POST | 批量添加成员 |
| `/client/sessions/{id}/members/{memberId}` | DELETE | 移除成员 |
| `/client/sessions/{id}/leave` | POST | 离开会话 |

**消息增强**
| 路由 | 方法 | 说明 |
|------|------|------|
| `/client/sessions/{id}/messages/search` | GET | 单会话内搜索消息 |
| `/client/messages/search` | GET | 跨会话搜索消息 |
| `/client/sessions/{id}/messages/{msgId}:recall` | POST | 撤回消息 |
| `/client/sessions/{id}/messages/{msgId}:pin` | POST | 置顶消息 |
| `/client/sessions/{id}/messages/{msgId}:unpin` | POST | 取消置顶 |
| `/client/sessions/{id}/messages/{msgId}:read` | POST | 标记已读 |
| `/client/sessions/{id}/pins` | GET | 列出置顶消息 |
| `/client/messages:forward` | POST | 转发消息 |

**联系人增强**
| 路由 | 方法 | 说明 |
|------|------|------|
| `/client/contacts/{userId}` | DELETE | 删除联系人 |
| `/client/contacts/{userId}:block` | POST | 拉黑用户 |
| `/client/contacts/{userId}:unblock` | POST | 解除拉黑 |
| `/client/contacts/{userId}/remark` | PATCH | 修改备注 |
| `/client/friend-requests` | GET | 列出收到的好友请求 |
| `/client/friend-requests/sent` | GET | 列出发出的好友请求 |

**附件**
| 路由 | 方法 | 说明 |
|------|------|------|
| `/client/attachments:probe` | POST | 检查附件是否已上传 |
| `/client/attachments:upload` | POST | 上传附件 |
| `/client/attachments/{id}` | GET | 下载附件 |

**通知**
| 路由 | 方法 | 说明 |
|------|------|------|
| `/client/notifications` | GET | 列出通知 |
| `/client/notifications/{id}:read` | POST | 标记通知已读 |
| `/client/notifications:read-all` | POST | 全部已读 |

**Custom Agent / Profile**
| 路由 | 方法 | 说明 |
|------|------|------|
| `/web/custom-agents` | GET | 列出自定义 Agent |
| `/web/custom-agents` | POST | 创建自定义 Agent |
| `/web/custom-agents/{id}` | GET | 获取自定义 Agent |
| `/web/custom-agents/{id}` | PATCH | 更新自定义 Agent |
| `/web/custom-agents/{id}` | DELETE | 删除自定义 Agent |

**会话管理增强**
| 路由 | 方法 | 说明 |
|------|------|------|
| `/client/sessions/{id}:dissolve` | POST | 解散群聊 |
| `/client/sessions/{id}:transfer-owner` | POST | 转让群主 |
| `/client/sessions/{id}/settings` | PATCH | 更新会话设置 |
| `/client/sessions/{id}/member-settings` | PATCH | 更新个人会话设置(置顶/免打扰/归档) |

**账号增强**
| 路由 | 方法 | 说明 |
|------|------|------|
| `/client/auth/change-password` | POST | 修改密码 |

**Agent 任务**
| 路由 | 方法 | 说明 |
|------|------|------|
| `/edge/devices:register` | POST | 注册设备 |

**Web Agent**
| 路由 | 方法 | 说明 |
|------|------|------|
| `/web/agent-tasks/{id}:cancel` | POST | 取消 Agent 任务 |

#### 2.2.3 验收

```powershell
python -c "import yaml, pathlib; yaml.safe_load(pathlib.Path('api/openapi.yaml').read_text(encoding='utf-8')); print('yaml ok')"
# 确认所有上述 endpoint 在 openapi.yaml 中有对应的 path item
```

---

### 2.3 Hub WebSocket 事件契约文档化

#### 2.3.1 现状

Hub WebSocket 使用 `ws.Frame` 格式（flat `dot.notation` types），与 Edge WebSocket 的 `EventEnvelope` 格式不同。Hub 事件未写入 `api/events.md`。

#### 2.3.2 需文档化的事件类型

| type | 方向 | 说明 |
|------|------|------|
| `auth` | Client→Hub | 认证帧 `{type:"auth", payload:{access_token:"..."}}` |
| `auth.ok` | Hub→Client | 认证成功 |
| `auth.fail` | Hub→Client | 认证失败 |
| `message.new` | Hub→Client | 新消息 |
| `message.recall` | Hub→Client | 消息撤回 |
| `message.pin` | Hub→Client | 消息置顶 |
| `message.unpin` | Hub→Client | 取消置顶 |
| `message.read` | Hub→Client | 消息已读 |
| `session.created` | Hub→Client | 会话创建 |
| `session.dissolved` | Hub→Client | 会话解散 |
| `session.member_joined` | Hub→Client | 成员加入 |
| `session.member_left` | Hub→Client | 成员离开 |
| `session.info_updated` | Hub→Client | 会话信息更新 |
| `device.online` | Hub→Client | 设备上线 |
| `device.offline` | Hub→Client | 设备离线 |
| `device.kicked` | Hub→Client | 设备被踢出 |
| `agent.dispatch` | Hub→Edge | 调度 Agent 任务 |
| `agent.stream` | Edge→Hub | Agent 流式输出 |
| `agent.done` | Edge→Hub | Agent 任务完成 |
| `agent.failed` | Edge→Hub | Agent 任务失败 |
| `agent.cancel` | Hub→Edge | 取消 Agent 任务 |
| `notification.new` | Hub→Client | 新通知 |
| `friend.request` | Hub→Client | 好友请求 |
| `friend.accepted` | Hub→Client | 好友请求被接受 |

#### 2.3.3 需文档化的帧格式

```json
{
  "type": "message.new",
  "seq_id": 42,
  "payload": {
    "message_id": "...",
    "session_id": "...",
    "sender_id": "...",
    "content": {...},
    "created_at": "2026-05-25T12:00:00Z"
  }
}
```

与 Edge EventEnvelope 的关键差异：Hub 用 `seq_id` 而非 `seq`；无 `version`/`id`/`scope`/`traceId`/`sentAt` 信封包装。

#### 2.3.4 验收

在 `api/events.md` 新增 "## Hub WebSocket Events" 章节，列清所有事件类型、帧格式、方向、payload schema。

---

## 3. P1 — 核心平台能力

### 3.1 Agent Profile Hub 持久化

#### 3.1.1 需求

Desktop Settings > Agent Profiles 页当前只读展示 Edge `/v1/agents` 返回的 Runtime 列表。用户需要能够创建、编辑、保存 Agent Profile（给 Runtime 绑定模型、配置、审批策略、执行目标），并能跨设备同步。

#### 3.1.2 数据模型

**新表 `agent_profiles` (Migration 0020)**

```sql
CREATE TABLE agent_profiles (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id     UUID NOT NULL REFERENCES users(id),
    name         VARCHAR(128) NOT NULL,
    description  TEXT,
    runtime_id   VARCHAR(64) NOT NULL,          -- claude-code | codex | opencode
    model        VARCHAR(128),                   -- claude-sonnet-4-6 | gpt-5.5 | ...
    provider     VARCHAR(64),                    -- anthropic | openai | newapi
    reasoning_effort VARCHAR(32) DEFAULT 'medium',
    model_mapping JSONB DEFAULT '{}',            -- {"sonnet": "claude-sonnet-4-6", ...}
    skills       JSONB DEFAULT '[]',             -- ["skill-id-1", "skill-id-2"]
    mcp_servers  JSONB DEFAULT '[]',             -- [{"server_id":"...","enabled":true}]
    tool_allowlist JSONB DEFAULT '[]',
    approval_policy JSONB DEFAULT '{}',          -- {"file_writes":"ask","bash":"ask","network":"auto_allow"}
    permission_mode VARCHAR(32) DEFAULT 'default',
    target_preferences JSONB DEFAULT '{}',       -- {"preferred":"local","fallback":"hub_relay"}
    context_budget_max_tokens INT DEFAULT 200000,
    is_public    BOOLEAN DEFAULT FALSE,           -- 是否发布到市场
    install_count INT DEFAULT 0,                  -- 市场安装次数
    rating_avg   DECIMAL(3,2) DEFAULT 0,
    rating_count INT DEFAULT 0,
    version      INT DEFAULT 1,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at   TIMESTAMPTZ                  -- 软删除
);

CREATE INDEX idx_agent_profiles_owner ON agent_profiles(owner_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_agent_profiles_public ON agent_profiles(is_public) WHERE is_public = TRUE AND deleted_at IS NULL;
CREATE INDEX idx_agent_profiles_runtime ON agent_profiles(runtime_id);
```

#### 3.1.3 API

**`GET /web/agent-profiles`** — 列出用户的 Profile

```
Query: pageSize=50, pageCursor=..., runtime_id=... (过滤)
Response 200: ListResponse<AgentProfile>
```

**`POST /web/agent-profiles`** — 创建 Profile

```
Request:
{
  "name": "My Reviewer",
  "description": "Uses Codex with high reasoning for code review",
  "runtime_id": "codex",
  "model": "gpt-5.5",
  "reasoning_effort": "xhigh",
  "permission_mode": "acceptEdits",
  "approval_policy": { "file_writes": "ask", "bash": "ask" }
}
Response 201: AgentProfile
Error: 400 (jsonb schema validation failed — capability_tags/tool_allowlist 必须为 JSON array，model_params/approval_policy/model_mapping 必须为 JSON object)
```

**`GET /web/agent-profiles/{id}`** — 获取 Profile 详情

**`PATCH /web/agent-profiles/{id}`** — 更新 Profile

```
Request: 部分字段（只传要更新的 key）
Response 200: AgentProfile
```

**`DELETE /web/agent-profiles/{id}`** — 软删除 Profile

#### 3.1.4 Service 层 (`internal/service/profile.go`)

```
AgentProfileService:
  - Create(ctx, ownerID, req) → (*model.AgentProfile, error)
    校验: runtime_id 合法性（从 Edge adapter registry 已知列表对照）
    校验: JSONB 字段 structural validation (复用 model.ValidateJSONB)
  
  - Update(ctx, profileID, ownerID, req) → (*model.AgentProfile, error)
    只允许 owner 修改
    
  - Get(ctx, profileID) → (*model.AgentProfile, error)
  - List(ctx, ownerID, filters) → ([]AgentProfile, PageInfo, error)
  - Delete(ctx, profileID, ownerID) → error (软删除)
  - Publish(ctx, profileID, ownerID) → error (发布到市场)
  - Unpublish(ctx, profileID, ownerID) → error (从市场下架)
  - Install(ctx, profileID, targetUserID) → error (安装市场 Profile 副本)
```

#### 3.1.5 事件

| 事件 | 触发时机 |
|------|------|
| `profile.created` | 创建 Profile |
| `profile.updated` | 更新 Profile |
| `profile.deleted` | 删除 Profile |
| `profile.published` | 发布到市场 |
| `profile.installed` | 从市场安装 |

通过 Hub WebSocket 广播，类型使用 `profile.created` 等 dot notation。

#### 3.1.6 验收

```powershell
cd hub-server
go test ./internal/service -run "TestAgentProfile" -count=1 -v
go test ./internal/handler -run "TestAgentProfile" -count=1 -v
go test ./internal/model -run "TestAgentProfile" -count=1 -v

# JSONB 校验：传错误类型 → 400
# owner 校验：非 owner 不能修改/删除
# 市场：is_public=false 时不在公开列表中
```

---

### 3.2 Agent Configuration 存储

#### 3.2.1 需求

Agent Configuration 是 Profile 的实际配置集合（`AGENTS.md`、memory、上下文、Skill/MCP、模型映射、审批策略）。当前 Desktop Settings 中的模型配置/映射/cc-switch/审批策略都保存在 `localStorage`，无法跨端同步。

#### 3.2.2 设计

Agent Configuration 作为 Profile 的嵌套 JSONB 字段存在 `agent_profiles` 表中，不单独建表。结构：

```json
{
  "instructions_sources": {
    "agenthub_md": "https://...",
    "project_rules": "inline or ref"
  },
  "memory_sources": {
    "project_long_term": "..."
  },
  "model_mapping": {
    "opus": "deepseek-v4-pro",
    "sonnet": "kimi-k2.6",
    "haiku": "glm-5.1"
  },
  "provider_binding": {
    "provider": "cc-switch",
    "binding_id": "cc_switch_main",
    "fallback_provider": "newapi"
  },
  "approval_policy": {
    "file_writes": "ask",
    "bash_commands": "ask",
    "network_access": "auto_allow",
    "computer_use": "deny",
    "remote_execution": "deny"
  },
  "context_budget": {
    "max_tokens": 200000,
    "auto_compact_threshold": 0.85,
    "reserve_tokens": 10000
  },
  "execution_defaults": {
    "preferred_target": "local",
    "fallback_target": "hub_relay",
    "workspace_policy": "worktree",
    "worktree_base_ref": "head"
  }
}
```

#### 3.2.3 API

Configuration 更新走 `PATCH /web/agent-profiles/{id}`，请求体中的 `model_mapping`/`approval_policy`/`context_budget`/`execution_defaults` 等 JSONB 字段被更新。Hub handler 校验 JSONB structural validity。

#### 3.2.4 与 Desktop 同步

Desktop 登录后调用 `GET /web/agent-profiles` 拉取用户所有 Profile（包含 Configuration），与本地 localStorage 合并策略：
- Hub 优先：云端有版本号 `version`，Desktop 拉取后覆盖本地
- 离线优先：Desktop 修改 Configuration 后本地保存，上线后 `PATCH` 回 Hub

`agent_profiles.updated_at` 提供增量同步判断。

#### 3.2.5 验收

```powershell
# 端到端：Desktop 登录 → 修改模型映射 → PATCH /web/agent-profiles/{id} → 另一设备 GET → 看到修改
```

---

### 3.3 Execution Target 管理

#### 3.3.1 需求

Settings > Execution Targets 页当前只读展示 Edge health 中的 runner 状态。用户需要注册、查看远程执行目标（SSH/Tailscale/Cloud/Hub Relay），并能设置默认 Target。

#### 3.3.2 数据模型

**新表 `execution_targets` (Migration 0021)**

```sql
CREATE TABLE execution_targets (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id     UUID NOT NULL REFERENCES users(id),
    device_id    UUID REFERENCES devices(id),
    name         VARCHAR(128) NOT NULL,
    target_type  VARCHAR(32) NOT NULL,  -- local_edge | remote_ssh | tailscale | cloud_edge | hub_relay
    host         VARCHAR(256),          -- SSH/Tailscale host
    port         INT,
    workspace_root VARCHAR(512),
    auth_method  VARCHAR(32),           -- ssh_key | password | tailscale_magic | hub_token
    is_online    BOOLEAN DEFAULT FALSE,
    last_seen_at TIMESTAMPTZ,
    capabilities JSONB DEFAULT '{}',    -- {"runtimes":["claude-code","codex"],"max_concurrent":1,...}
    metadata     JSONB DEFAULT '{}',    -- 额外信息
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at   TIMESTAMPTZ
);

CREATE INDEX idx_execution_targets_owner ON execution_targets(owner_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_execution_targets_device ON execution_targets(device_id);
```

#### 3.3.3 API

**`GET /web/execution-targets`** — 列出用户的 Target

**`POST /web/execution-targets`** — 注册新 Target

**`GET /web/execution-targets/{id}`** — Target 详情

**`PATCH /web/execution-targets/{id}`** — 更新 Target

**`DELETE /web/execution-targets/{id}`** — 删除 Target

**`POST /web/execution-targets/{id}:ping`** — 健康检查（Hub 尝试连接 Target）

#### 3.3.4 与现有 Device 的关系

- `devices` 表记录实际注册的设备（与 Hub session 绑定）
- `execution_targets` 记录用户可选的执行位置
- 本地 Desktop Edge 对应的 Target 在设备注册时自动创建
- 远程 Target 由用户手动创建

#### 3.3.5 验收

```powershell
cd hub-server
go test ./internal/service -run "TestExecutionTarget" -count=1 -v
```

---

### 3.4 Skill 目录

#### 3.4.1 需求

Settings > Skills 页需要展示可用 Skill 列表、已安装状态、启用/禁用、团队可见性。Skill 执行本身在 Edge 侧；Hub 负责元数据、可见性和审计。

#### 3.4.2 数据模型

**新表 `skills` (Migration 0022)**

```sql
CREATE TABLE skills (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id      UUID NOT NULL REFERENCES users(id),
    name          VARCHAR(128) NOT NULL,
    description   TEXT,
    skill_type    VARCHAR(32) NOT NULL,   -- agent_skill | project_skill | team_skill
    runtime_ids   JSONB DEFAULT '[]',     -- 兼容的 Runtime
    entry_point   VARCHAR(512),            -- 脚本路径或入口
    config_schema JSONB DEFAULT '{}',      -- JSON Schema for configuration
    is_public     BOOLEAN DEFAULT FALSE,   -- 是否发布到团队
    version       VARCHAR(32) DEFAULT '1.0.0',
    install_count INT DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at    TIMESTAMPTZ
);
```

#### 3.4.3 API

**`GET /web/skills`** — 搜索/浏览 Skill（支持公开+自己的）

**`POST /web/skills`** — 创建 Skill

**`GET /web/skills/{id}`** — Skill 详情

**`PATCH /web/skills/{id}`** — 更新 Skill

**`DELETE /web/skills/{id}`** — 删除 Skill

**`POST /web/skills/{id}:publish`** — 发布到团队

#### 3.4.4 验收

```powershell
cd hub-server
go test ./internal/service -run "TestSkill" -count=1 -v
```

---

### 3.5 MCP Server 注册表

#### 3.5.1 需求

Settings > MCP 页需要展示 MCP server 列表、连接状态、工具白名单、OAuth 状态。

#### 3.5.2 数据模型

**新表 `mcp_servers` (Migration 0023)**

```sql
CREATE TABLE mcp_servers (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id      UUID NOT NULL REFERENCES users(id),
    name          VARCHAR(128) NOT NULL,
    transport     VARCHAR(32) NOT NULL,   -- stdio | http | sse
    command       VARCHAR(512),           -- for stdio transport
    args          JSONB DEFAULT '[]',
    env_vars      JSONB DEFAULT '{}',
    url           VARCHAR(512),           -- for http/sse transport
    auth_type     VARCHAR(32),            -- none | oauth | api_key | bearer
    auth_config   JSONB DEFAULT '{}',     -- 不存真实密钥，只存 OAuth 端点/scope
    tool_schema   JSONB DEFAULT '{}',     -- 可用工具列表
    is_public     BOOLEAN DEFAULT FALSE,
    install_count INT DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at    TIMESTAMPTZ
);
```

#### 3.5.3 API

**`GET /web/mcp-servers`** — 搜索/浏览 MCP Server

**`POST /web/mcp-servers`** — 注册 MCP Server

**`GET /web/mcp-servers/{id}`** — 详情

**`PATCH /web/mcp-servers/{id}`** — 更新

**`DELETE /web/mcp-servers/{id}`** — 删除

**`POST /web/mcp-servers/{id}:test`** — 连接测试（Hub 发送测试请求）

#### 3.5.4 安全约束

`auth_config` JSONB 字段不得包含真实 API key。Hub 的 model hook 和 handler 校验：`auth_config` 中的 `api_key`、`secret`、`token` 字段必须为空或已脱敏（`***`）。

#### 3.5.5 验收

```powershell
cd hub-server
go test ./internal/model -run "TestMCPServerValidate" -count=1 -v  # auth_config 不得含明文密钥
go test ./internal/service -run "TestMCPServer" -count=1 -v
```

---

## 4. P2 — 生态平台能力

### 4.1 Agent 市场

#### 4.1.1 需求

Settings > Agent Market 页需要展示可安装的公开 Agent Profile 模板，支持搜索、安装、评分。

#### 4.1.2 API

复用 `agent_profiles` 表（`is_public=true` 即为发布到市场）。

**`GET /web/market/profiles`** — 搜索公开 Profile

```
Query: q=..., runtime_id=..., sort_by=install_count|rating|recent, pageSize=50, pageCursor=...
Response 200: ListResponse<AgentProfile>
```

**`GET /web/market/profiles/{id}`** — 市场 Profile 详情（含评分/评论摘要）

**`POST /web/market/profiles/{id}:install`** — 安装 Profile

```
复制 Profile 到当前用户，owner_id = 当前用户，is_public = false
install_count + 1 在原 Profile 上
Response 201: 新 Profile
Error 409: 已安装过
```

**`POST /web/market/profiles/{id}:rate`** — 评分

```
Request: { "score": 4 }  // 1-5
Response 200: { "rating_avg": 4.2, "rating_count": 15 }
```

#### 4.1.3 验收

```powershell
cd hub-server
go test ./internal/service -run "TestMarket" -count=1 -v
# 安装 → install_count +1
# 安装同 Profile 两次 → 409
# 评分 → rating_avg 更新
```

---

### 4.2 模型配置云端持久化

#### 4.2.1 需求

Desktop Settings > Model Config / Model Mapping 当前存 localStorage。需要云端持久化实现跨端同步。

#### 4.2.2 设计

不单独建表。模型配置和映射作为 `agent_profiles` 中用户 "default profile" 的 JSONB 字段：

- `model` / `provider` / `reasoning_effort` → Profile 顶级字段
- `model_mapping` → Profile JSONB 字段（alias → provider/model/reasoning 映射表）
- `provider_binding` → Profile JSONB 字段

Desktop 登录后 `GET /web/agent-profiles` 拉取默认 Profile → TanStack Query cache → Zustand 消费。

Desktop 修改模型配置 → `PATCH /web/agent-profiles/{default_id}` → Hub 更新 → 其他登录设备下次拉取同步。

#### 4.2.3 验收

```powershell
# 集成验证：Desktop A 改模型映射 → PATCH Hub → Desktop B 登录 → GET 拉到修改
```

---

### 4.3 cc-switch Provider Binding

#### 4.3.1 需求

Settings > cc-switch 页需要展示 cc-switch 的 provider 可用性、切换、配额提示。

#### 4.3.2 设计

Hub 不直接集成 cc-switch SDK——cc-switch 是外部配置源。Hub 提供 provider binding 的元数据存储和状态查询 API。

**新表 `provider_bindings` (Migration 0024)**

```sql
CREATE TABLE provider_bindings (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id      UUID NOT NULL REFERENCES users(id),
    binding_name  VARCHAR(64),             -- cc-switch binding name
    provider      VARCHAR(64) NOT NULL,     -- anthropic | openai | newapi | custom
    base_url      VARCHAR(512),
    is_available  BOOLEAN DEFAULT TRUE,
    quota_used    BIGINT DEFAULT 0,
    quota_limit   BIGINT DEFAULT 0,
    last_checked  TIMESTAMPTZ,
    metadata      JSONB DEFAULT '{}',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

#### 4.3.3 API

**`GET /web/provider-bindings`** — 列出用户的 provider bindings

**`POST /web/provider-bindings`** — 创建

**`DELETE /web/provider-bindings/{id}`** — 删除

**`POST /web/provider-bindings/{id}:refresh`** — 刷新状态（Hub 查询 cc-switch 或 provider health endpoint）

#### 4.3.4 安全约束

`base_url` 不得包含 API key。Hub handler 校验 URL 不包含 `@`、`token=`、`key=`、`secret=` 等敏感模式。

---

### 4.4 安全审计日志

#### 4.4.1 需求

Settings > Security Audit 页需要展示 Agent 操作审计线索。审计日志最终会显示：谁在什么时间用什么 Profile 在哪个 Target 上做了什么，以及审批决策。

#### 4.4.2 数据模型

**新表 `audit_events` (Migration 0025)**

```sql
CREATE TABLE audit_events (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID REFERENCES users(id),
    profile_id    UUID,
    target_id     UUID,
    event_type    VARCHAR(64) NOT NULL,   -- run.started | run.completed | permission.granted | file.written | command.executed | profile.modified | target.registered
    severity      VARCHAR(16) DEFAULT 'info', -- info | warning | critical
    summary       TEXT NOT NULL,
    details       JSONB DEFAULT '{}',
    client_ip     INET,
    user_agent    VARCHAR(512),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_events_user ON audit_events(user_id, created_at DESC);
CREATE INDEX idx_audit_events_type ON audit_events(event_type, created_at DESC);
CREATE INDEX idx_audit_events_severity ON audit_events(severity, created_at DESC);
-- 自动清理：90 天 TTL
```

#### 4.4.3 API

**`GET /web/audit-events`** — 查询审计事件

```
Query: user_id=..., event_type=..., severity=..., since=..., until=..., pageSize=50, pageCursor=...
Response 200: ListResponse<AuditEvent>
Response 403: 非 admin 用户只能看自己的
```

**`GET /web/audit-events/{id}`** — 事件详情

#### 4.4.4 事件采集点

| 事件 | 触发位置 | 严重度 |
|------|------|:--:|
| `run.started` | Hub agent dispatch 或 Edge run ack | info |
| `run.completed` | Edge task done/fail callback | info |
| `permission.granted` | Edge permission decide | warning |
| `permission.denied` | Edge permission decide | warning |
| `profile.created/modified/deleted` | Profile CRUD handler | info |
| `target.registered` | Target 注册 | info |
| `command.high_risk` | Edge security hook 检测到危险命令 | critical |
| `file.written` | Agent 写文件（Edge report 到 Hub） | info |
| `auth.login` | 登录成功 | warning |
| `auth.login_failed` | 登录失败 | warning |
| `device.registered` | 新设备注册 | warning |

#### 4.4.5 验收

```powershell
cd hub-server
go test ./internal/service -run "TestAudit" -count=1 -v
go test ./internal/handler -run "TestAudit" -count=1 -v
# 非 admin 看不到他人事件
# 90 天旧事件被清理
```

---

## 5. P3 — 高级能力

### 5.1 远程控制 & Relay

#### 5.1.1 需求

Web/Mobile 通过 Hub 对目标 Edge 发起远程 run、远程审批、Preview 代理。

#### 5.1.2 API (已在 openapi.yaml 占位，未实现)

**`POST /v1/relay/commands`** — 创建 relay command

```
Request:
{
  "target_edge_id": "...",
  "command_type": "start_run | cancel_run | approve | preview_proxy",
  "payload": { ... }
}
Response 202: { "command_id": "..." }
```

**`GET /v1/relay/commands/{id}`** — 查询 relay 命令状态

**`POST /v1/relay/commands/{id}:ack`** — Edge 确认 relay 命令

Relay 流程：
1. Web → Hub: `POST /v1/relay/commands`
2. Hub → Edge (WS): `agent.dispatch` 转发 relay 命令
3. Edge → Hub: `POST /v1/relay/commands/{id}:ack`
4. Edge 执行命令，通过 task stream/done/fail 回调结果
5. Hub → Web (WS): task 状态回传

### 5.2 Device Capability 同步

#### 5.2.1 需求

多端场景下区分各设备的 Runtime 能力差异。

#### 5.2.2 设计

增强现有 `devices` 表的 `capabilities` JSONB 字段，Edge 注册时上报：

```json
{
  "runtimes": ["claude-code", "codex", "opencode"],
  "max_concurrent_runs": 5,
  "os": "windows",
  "arch": "amd64",
  "workspace_roots": ["D:\\Projects"],
  "supports_gpu": false,
  "supports_remote": false
}
```

API：

**`GET /web/devices`** — 列出设备（含 capability 差异）

**`GET /web/devices/{id}`** — 设备详情（capability 矩阵）

### 5.3 Runner → Runtime 命名迁移

#### 5.3.1 需求

`/v1/runners`、`runner.online`、`runner.offline`、`runner_offline` 等历史命名需要长期兼容策略。

#### 5.3.2 方案

1. 保留现有 `/v1/runners` endpoint（P0 兼容性）
2. 新增 `GET /v1/runtimes` endpoint — 语义更清晰
3. `api/openapi.yaml` 标注 `/v1/runners` 为 deprecated
4. 新增事件类型 `runtime.online` / `runtime.offline`（与现有 `runner.*` 并行发布）
5. 不在 Q2 移除 `runner.*` 命名

---

## 6. 非功能需求

### 6.1 测试要求

| 层 | 新增代码最低覆盖率 |
|------|:--:|
| handler | 80% |
| service | 80% |
| repository | 75% |
| model | 90% (Validate 方法) |

### 6.2 安全要求

- 所有新增 handler 需通过 `AuthMiddleware`
- 用户只能操作自己的资源（owner_id 校验）
- `auth_config`/`base_url`/`env_vars` 不存明文密钥
- JSONB 字段 structural validation 必须 service+model 双层校验
- 审计事件不包含 token/密钥/密码原文

### 6.3 API 契约

- 新增 REST endpoint 必须在 `api/openapi.yaml` 中声明
- 新增 WebSocket 事件必须在 `api/events.md` 中声明
- 遵循 `api/conventions.md` 的命名/分页/错误规范

### 6.4 错误处理

- 统一 `{ error: { code, message, traceId, details } }` 格式
- 错误码稳定、可程序判断
- 不泄露内部实现细节

### 6.5 配置

- 新增配置项使用 `AGENTHUB_` 环境变量前缀
- 敏感配置仅从环境变量读取，不在 config.yaml 写死
- `.env.example` 同步更新

---

## 7. 总验收矩阵

| 阶段 | 测试命令 | 阻塞项 |
|------|------|:--:|
| P0 | `go test ./... -short -count=1` 全部通过 | TokenDance OIDC e2e 需要 TokenDance ID 测试环境 |
| P1 | `go test ./internal/service -run "TestAgentProfile\|TestSkill\|TestMCPServer\|TestExecutionTarget" -count=1` | 无 |
| P2 | `go test ./internal/service -run "TestMarket\|TestAudit\|TestProviderBinding" -count=1` | 无 |
| P3 | `go test ./internal/service -run "TestRelay\|TestDeviceCapability" -count=1` | 需要 Edge 配合 |

## 8. 外部依赖

| 依赖 | 影响阶段 | 风险缓解 |
|------|:--:|------|
| TokenDance ID 测试环境 | P0 | Mock OIDC server 用于单元测试 |
| Edge adapter registry 已知 Runtime 列表 | P1 | Hub 维护 Runtime 白名单配置 |
| cc-switch CLI/API | P2 | 仅存 metadata，不做实时查询 |
| Remote Edge 配合 | P3 | P3 可在无真实 Edge 下开发（mock） |
