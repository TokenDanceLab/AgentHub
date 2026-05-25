# AgentHub Hub Server 开发流程文档

最后更新：2026-05-25 | 基于 `dev/delicious233` 当前代码 | 面向 Agent 可执行

---

## 0. 开发前必读

### 0.1 每个 Agent 接手任务前

1. 读 `AGENTS.md`（仓库根）
2. 读 `docs/handoff/STATE.md`（当前状态）
3. 读本文对应阶段的详细说明
4. 读 `hub-server/docs/hub-server-requirements.md` 对应章节
5. 确认当前分支是最新的 `dev/delicious233`

### 0.2 提交规范

```
type(scope): 中文摘要

type: feat|fix|docs|refactor|chore|test|perf
scope: hub
```

示例：`feat(hub): 实现 TokenDance ID OIDC PKCE 完整登录流程`

### 0.3 验证命令（每阶段结束必跑）

```powershell
cd hub-server
go build ./...
go test ./... -short -count=1
go vet ./...
cd ..
python -c "import yaml, pathlib; yaml.safe_load(pathlib.Path('api/openapi.yaml').read_text(encoding='utf-8')); print('yaml ok')"
```

### 0.4 代码模式

**分层架构**：
```
handler → service → repository → PostgreSQL
```

**依赖注入**：通过构造函数传递，不使用全局单例。

```go
// ✅ 正确
func NewAgentProfileHandler(svc *service.AgentProfileService) *AgentProfileHandler {
    return &AgentProfileHandler{svc: svc}
}

// ❌ 错误 — 不要引用全局 config.Cfg / repository.DB / cache.RDB
```

**ID 生成**：使用 `uuidv7.New()` 或 `uuidv7.Must()`。

**错误返回**：使用 `errcode` 包定义的错误。

```go
return errcode.ErrBadRequest.WithMessage("model_mapping must be a JSON object")
```

---

## 1. 开发阶段总览

```
Phase 0: 契约补全 (1-2d) ─────────────────────────────────┐
  ├── 无代码依赖                                           │
  └── 产出：api/openapi.yaml + api/events.md 更新           │
                                                            │
Phase 1: TokenDance ID OIDC (3-4d) ────────────────────────┤
  ├── 依赖：Phase 0 完成                                    │
  └── 产出：OIDC handler/service/repo + migration 0019      │
                                                            │
Phase 2: Agent Profile 持久化 (3-4d) ──────────────────────┤
  ├── 依赖：无（可并行 Phase 1）                            │
  └── 产出：profile handler/service/repo + migration 0020   │
                                                            │
Phase 3: Skill + MCP Catalog (3-4d) ───────────────────────┤
  ├── 依赖：Phase 2 完成                                    │
  └── 产出：skill + mcp handler/service/repo + migrations   │
                                                            │
Phase 4: Agent 市场 + 模型配置 (3-4d) ─────────────────────┤
  ├── 依赖：Phase 2 完成                                    │
  └── 产出：market handler/service + provider binding       │
                                                            │
Phase 5: Execution Target 管理 (2-3d) ─────────────────────┤
  ├── 依赖：Phase 2 完成                                    │
  └── 产出：target handler/service/repo + migration         │
                                                            │
Phase 6: 安全审计 (3-4d) ─────────────────────────────────┤
  ├── 依赖：Phase 1-5 核心功能稳定                          │
  └── 产出：audit handler/service/repo + migration          │
                                                            │
Phase 7: 远程 Relay + 多端增强 (3-4d) ────────────────────┤
  ├── 依赖：Phase 5 完成                                    │
  └── 产出：relay handler + device capability               │
                                                            │
Phase 8: 收敛 & 清理 (2-3d) ───────────────────────────────┤
  ├── 依赖：Phase 1-7 全部完成                              │
  └── 产出：命名迁移方案 + 全量契约覆盖 + 集成测试加固       │
```

---

## 2. Phase 0 — 契约补全

### 2.1 目标

补全 `api/openapi.yaml` 中缺失的 Hub 路由声明，在 `api/events.md` 中新增 Hub WebSocket 事件章节。

### 2.2 任务清单

#### 任务 0.1：OpenAPI 补全 Hub 路由

**文件**：`api/openapi.yaml`

**操作**：在文件末尾 `components` 前新增 path items。

**需补全的路由分组**：

1. **Session Members** (4 条)
```yaml
/client/sessions/{id}/members:
  get: ...
  post: ...
/client/sessions/{id}/members/{memberId}:
  delete: ...
/client/sessions/{id}:leave:
  post: ...
```

2. **Message Enhancements** (8 条)
```yaml
/client/sessions/{id}/messages/search:
  get: ...
/client/messages/search:
  get: ...
/client/sessions/{id}/messages/{msgId}:recall:
  post: ...
/client/sessions/{id}/messages/{msgId}:pin:
  post: ...
/client/sessions/{id}/messages/{msgId}:unpin:
  post: ...
/client/sessions/{id}/messages/{msgId}:read:
  post: ...
/client/sessions/{id}/pins:
  get: ...
/client/messages:forward:
  post: ...
```

3. **Contact Enhancements** (6 条)
```yaml
/client/contacts/{userId}:
  delete: ...
/client/contacts/{userId}:block:
  post: ...
/client/contacts/{userId}:unblock:
  post: ...
/client/contacts/{userId}/remark:
  patch: ...
/client/friend-requests:
  get: ...
/client/friend-requests/sent:
  get: ...
```

4. **Attachments** (3 条)
```yaml
/client/attachments:probe:
  post: ...
/client/attachments:upload:
  post: ...
/client/attachments/{id}:
  get: ...
```

5. **Notifications** (3 条)
```yaml
/client/notifications:
  get: ...
/client/notifications/{id}:read:
  post: ...
/client/notifications:read-all:
  post: ...
```

6. **Custom Agents** (5 条)
```yaml
/web/custom-agents:
  get: ...
  post: ...
/web/custom-agents/{id}:
  get: ...
  patch: ...
  delete: ...
```

7. **Session Management** (4 条)
```yaml
/client/sessions/{id}:dissolve:
  post: ...
/client/sessions/{id}:transfer-owner:
  post: ...
/client/sessions/{id}/settings:
  patch: ...
/client/sessions/{id}/member-settings:
  patch: ...
```

8. **Account** (1 条)
```yaml
/client/auth/change-password:
  post: ...
```

9. **Edge/Web Misc** (3 条)
```yaml
/edge/devices:register:
  post: ...
/web/agent-tasks/{id}:cancel:
  post: ...
```

> 每条路由必须含：`x-agenthub-status: implemented`、`x-agenthub-owner: Hub`、request/response schema reference、security 标注。

#### 任务 0.2：Hub WebSocket 事件文档化

**文件**：`api/events.md`

**操作**：在文件末尾新增 "## Hub WebSocket Events" 章节。

**内容**：

1. 连接和认证说明：`ws://host:8080/client/ws`，首帧 `{"type":"auth","payload":{"access_token":"..."}}`
2. Hub Frame 格式说明（与 Edge EventEnvelope 的差异对照表）
3. 事件总表（24 种事件类型）
4. 每个事件的 payload schema

### 2.3 验证

```powershell
git diff --check -- api/
python -c "import yaml, pathlib; yaml.safe_load(pathlib.Path('api/openapi.yaml').read_text(encoding='utf-8')); print('yaml ok')"
```

### 2.4 提交

```text
docs(api): 补全 Hub Server 37 条路由 OpenAPI 声明与 WebSocket 事件契约
```

---

## 3. Phase 1 — TokenDance ID OIDC PKCE

### 3.1 目标

实现完整的 OIDC Authorization Code + PKCE 登录流程，让 Desktop/Web 能通过 TokenDance ID 获得 Hub session。

### 3.2 前置

- [x] Phase 0 完成
- [x] TokenDance ID 测试环境可用（或使用 mock）

### 3.3 任务清单

#### 任务 1.1：Migration 0019 — users 表新增 tokendance_sub

**新建文件**：
- `migrations/0019_token_dance_sub.up.sql`
- `migrations/0019_token_dance_sub.down.sql`

```sql
-- up
ALTER TABLE users ADD COLUMN IF NOT EXISTS tokendance_sub VARCHAR(255);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_tokendance_sub ON users(tokendance_sub) WHERE tokendance_sub IS NOT NULL AND tokendance_sub != '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS tokendance_sub_linked_at TIMESTAMPTZ;

-- down
DROP INDEX IF EXISTS idx_users_tokendance_sub;
ALTER TABLE users DROP COLUMN IF EXISTS tokendance_sub_linked_at;
ALTER TABLE users DROP COLUMN IF EXISTS tokendance_sub;
```

> 注意：`IF NOT EXISTS` 用于幂等，生产已有 users 表。

#### 任务 1.2：User model 新增字段

**修改文件**：`internal/model/user.go`

在 `User` struct 中新增：

```go
TokenDanceSub        *string    `gorm:"column:tokendance_sub;uniqueIndex:idx_users_tokendance_sub,where:tokendance_sub IS NOT NULL AND tokendance_sub != ''" json:"tokendance_sub,omitempty"`
TokenDanceSubLinkedAt *time.Time `gorm:"column:tokendance_sub_linked_at" json:"tokendance_sub_linked_at,omitempty"`
```

#### 任务 1.3：Config 扩展

**修改文件**：`internal/config/config.go`

1. 在 `Config` struct 中新增 `TokenDanceID` 字段
2. 新增 `TokenDanceIDConfig` struct（字段见需求文档 2.1.6）
3. `Validate()` 中新增校验：如果 OIDC callback 端点注册在 router 中，则 `ClientID` 和 `ClientSecret` 必须非空

**修改文件**：`configs/config.yaml`

新增 `tokendance_id` 配置块。

**修改文件**：`hub-server/.env.example`

新增 `AGENTHUB_TOKENDANCE_ID_*` 环境变量。

#### 任务 1.4：Repository 扩展

**修改文件**：`internal/repository/user.go`

新增两个方法：

```go
func (r *UserRepository) FindByTokenDanceSub(ctx context.Context, sub string) (*model.User, error)
func (r *UserRepository) FindOrCreateByTokenDanceSub(ctx context.Context, sub string) (*model.User, error)
```

`FindOrCreateByTokenDanceSub` 逻辑：
1. 先 `FindByTokenDanceSub`
2. 找不到则创建新 User（username = `td_` + sub 前 8 位，nickname = sub，password_hash = ""）
3. 返回 user + 是否新建的标志

**新建文件**：`internal/repository/user_test.go`（如果没有独立测试）

新增 `TestFindOrCreateByTokenDanceSub` 覆盖首次创建和重复查找路径。

#### 任务 1.5：OIDC Service

**新建文件**：`internal/service/oidc.go`

```go
type OIDCService struct {
    cfg   *config.Config
    cache *cache.Client
    repo  repository.UserRepository
    jwt   *jwtutil.JWTUtil
}
```

实现三个方法（详参见需求文档 2.1.3）：

1. `GenerateAuthorizationURL(ctx, codeChallenge, codeChallengeMethod, deviceType, deviceID) (state, url, error)`
   - 生成 32 字节随机 state
   - 保存到 Redis：`state:{state}` → `{codeChallenge, deviceType, deviceID, createdAt}`，TTL 10min
   - 构造 TokenDance ID `/oidc/auth` URL
   - 返回 state 和完整 authorization_url

2. `HandleCallback(ctx, code, state, codeVerifier, deviceType, deviceID) (accessToken, refreshToken, user, error)`
   - 从 Redis 取 state 数据，验证存在/未过期/device 一致
   - HTTP POST TokenDance ID `/oidc/token`
   - 调用 `jwtutil.ParseTokenDanceJWT()` 验证 id_token
   - 提取 `tokendance_sub`
   - `repo.FindOrCreateByTokenDanceSub()`
   - `repo.UpsertDevice()`
   - 签发 Hub access/refresh token
   - 删除 Redis state（一次性消费）
   - 返回 tokens + user

3. `buildTokenDanceTokenRequest()` — HTTP POST 构造
4. `exchangeCodeForToken()` — code exchange HTTP call

**新建文件**：`internal/service/oidc_test.go`

使用 `httptest.NewServer` mock TokenDance ID，覆盖：
- 正常 PKCE 流程（verifier 匹配）
- state 过期 / 不存在
- code exchange 失败
- id_token 签名无效
- 用户首次自动创建

#### 任务 1.6：OIDC Handler

**新建文件**：`internal/handler/oidc.go`

```go
type OIDCHandler struct {
    svc *service.OIDCService
}
```

实现两个 handler：

1. `PostOIDCAuthorize(c *gin.Context)` — `POST /client/auth/oidc/authorize`
   - 校验 request body（code_challenge 必填，code_challenge_method 默认 S256）
   - 调用 svc.GenerateAuthorizationURL
   - 返回 state + authorization_url

2. `PostOIDCCallback(c *gin.Context)` — `POST /client/auth/oidc/callback`
   - 校验 request body（code, state, code_verifier, device_type, device_id）
   - 调用 svc.HandleCallback
   - 返回 access_token + refresh_token + user

**新建文件**：`internal/handler/oidc_test.go`

使用 mock OIDCService 接口，覆盖：
- 正常请求 200
- 缺少必填字段 400
- state 无效 400
- code exchange 失败 400

#### 任务 1.7：路由注册

**修改文件**：`internal/router/router.go`

在 `client` 路由组中新增：

```go
oidcHandler := handler.NewOIDCHandler(oidcSvc)
client.POST("/auth/oidc/authorize", oidcHandler.PostOIDCAuthorize)
client.POST("/auth/oidc/callback", oidcHandler.PostOIDCCallback)
```

注意：OIDC callback 不需要 `AuthMiddleware`——它是公开端点。

#### 任务 1.8：App 装配

**修改文件**：`internal/app/app.go`

1. 在 `Run()` 中，创建 `OIDCService`（如果 TokenDance config 存在）
2. 传入 router setup

```go
var oidcSvc *service.OIDCService
if cfg.TokenDanceID.ClientID != "" {
    oidcSvc = service.NewOIDCService(cfg, cacheClient, userRepo, jwtUtil)
}
```

### 3.4 验证

```powershell
cd hub-server

# 编译
go build ./...

# service 层测试
go test ./internal/service -run "TestOIDC" -count=1 -v

# handler 层测试
go test ./internal/handler -run "TestOIDC" -count=1 -v

# repository 层测试
go test ./internal/repository -run "TestFindOrCreateByTokenDanceSub" -count=1 -v

# 全量回归
go test ./... -short -count=1

# API 契约
cd .. && python -c "import yaml, pathlib; yaml.safe_load(pathlib.Path('api/openapi.yaml').read_text(encoding='utf-8')); print('yaml ok')"
```

### 3.5 提交策略

```text
# Task 1.1-1.2
feat(hub): 新增 tokendance_sub 用户字段与 migration 0019

# Task 1.3
feat(hub): 扩展 Config 支持 TokenDance ID OIDC 配置

# Task 1.4-1.5
feat(hub): 实现 OIDC PKCE authorize/callback service 与 user lookup

# Task 1.6-1.8
feat(hub): 注册 OIDC handler 路由并完成 app 装配
```

---

## 4. Phase 2 — Agent Profile 持久化

### 4.1 目标

实现 Agent Profile 的 CRUD Hub API，让 Desktop Settings > Agent Profiles 页可以从 Hub 读取和保存用户配置。

### 4.2 任务清单

#### 任务 2.1：Migration 0020 — agent_profiles 表

**新建文件**：
- `migrations/0020_agent_profiles.up.sql`
- `migrations/0020_agent_profiles.down.sql`

DDL 见需求文档 3.1.2。

#### 任务 2.2：Model

**新建文件**：`internal/model/agent_profile.go`

```go
type AgentProfile struct {
    ID              string     `gorm:"primaryKey" json:"id"`
    OwnerID         string     `gorm:"column:owner_id;not null;index:idx_agent_profiles_owner,where:deleted_at IS NULL" json:"owner_id"`
    Name            string     `gorm:"column:name;not null" json:"name"`
    Description     string     `gorm:"column:description" json:"description,omitempty"`
    RuntimeID       string     `gorm:"column:runtime_id;not null;index" json:"runtime_id"`
    Model           string     `gorm:"column:model" json:"model,omitempty"`
    Provider        string     `gorm:"column:provider" json:"provider,omitempty"`
    ReasoningEffort string     `gorm:"column:reasoning_effort;default:medium" json:"reasoning_effort,omitempty"`
    ModelMapping    string     `gorm:"column:model_mapping;type:jsonb;default:'{}'" json:"model_mapping,omitempty"`
    Skills          string     `gorm:"column:skills;type:jsonb;default:'[]'" json:"skills,omitempty"`
    MCPServers      string     `gorm:"column:mcp_servers;type:jsonb;default:'[]'" json:"mcp_servers,omitempty"`
    ToolAllowlist   string     `gorm:"column:tool_allowlist;type:jsonb;default:'[]'" json:"tool_allowlist,omitempty"`
    ApprovalPolicy  string     `gorm:"column:approval_policy;type:jsonb;default:'{}'" json:"approval_policy,omitempty"`
    PermissionMode  string     `gorm:"column:permission_mode;default:default" json:"permission_mode,omitempty"`
    TargetPrefs     string     `gorm:"column:target_preferences;type:jsonb;default:'{}'" json:"target_preferences,omitempty"`
    ContextBudget   int        `gorm:"column:context_budget_max_tokens;default:200000" json:"context_budget_max_tokens"`
    IsPublic        bool       `gorm:"column:is_public;default:false" json:"is_public"`
    InstallCount    int        `gorm:"column:install_count;default:0" json:"install_count,omitempty"`
    RatingAvg       float64    `gorm:"column:rating_avg;type:decimal(3,2);default:0" json:"rating_avg,omitempty"`
    RatingCount     int        `gorm:"column:rating_count;default:0" json:"rating_count,omitempty"`
    Version         int        `gorm:"column:version;default:1" json:"version"`
    CreatedAt       time.Time  `gorm:"column:created_at;autoCreateTime" json:"created_at"`
    UpdatedAt       time.Time  `gorm:"column:updated_at;autoUpdateTime" json:"updated_at"`
    DeletedAt       *time.Time `gorm:"column:deleted_at;index" json:"-"`
}

func (p *AgentProfile) BeforeCreate(tx *gorm.DB) error {
    if p.ID == "" {
        p.ID = uuidv7.Must()
    }
    return nil
}

// Validate 校验 JSONB 字段类型
func (p *AgentProfile) Validate() error {
    if !isJSONArray(p.Skills) {
        return fmt.Errorf("skills must be a JSON array")
    }
    if !isJSONArray(p.MCPServers) {
        return fmt.Errorf("mcp_servers must be a JSON array")
    }
    if !isJSONArray(p.ToolAllowlist) {
        return fmt.Errorf("tool_allowlist must be a JSON array")
    }
    if !isJSONObject(p.ModelMapping) {
        return fmt.Errorf("model_mapping must be a JSON object")
    }
    if !isJSONObject(p.ApprovalPolicy) {
        return fmt.Errorf("approval_policy must be a JSON object")
    }
    return nil
}
```

**新建文件**：`internal/model/agent_profile_test.go`

```go
func TestAgentProfile_ValidateRejectsWrongJSONBShapes(t *testing.T)
// skills = "not array" → error
// model_mapping = "not object" → error
// 正常 profile → nil
```

#### 任务 2.3：Repository

**新建文件**：`internal/repository/agent_profile.go`

```go
type AgentProfileRepository struct {
    db *gorm.DB
}

func (r *AgentProfileRepository) Create(ctx, profile) error
func (r *AgentProfileRepository) GetByID(ctx, id) (*model.AgentProfile, error)
func (r *AgentProfileRepository) Update(ctx, profile) error
func (r *AgentProfileRepository) SoftDelete(ctx, id, ownerID) error
func (r *AgentProfileRepository) List(ctx, ownerID, filters) ([]model.AgentProfile, PageInfo, error)
```

`List` 支持过滤：
- `runtime_id` → WHERE runtime_id =
- `is_public` → WHERE is_public = true（市场查询）
- `q` → WHERE name ILIKE '%q%' OR description ILIKE '%q%'
- 分页使用 cursor-based: `WHERE id > cursor ORDER BY id LIMIT pageSize+1`

#### 任务 2.4：Service

**新建文件**：`internal/service/agent_profile.go`

```go
type AgentProfileService struct {
    repo   repository.AgentProfileRepository
    cache  *cache.Client
    bus    *Bus  // event bus for profile.* events
}
```

方法：
- `Create(ctx, ownerID, req) → (*model.AgentProfile, error)` — Validate() + Create + Publish `profile.created`
- `Update(ctx, id, ownerID, req) → (*model.AgentProfile, error)` — GetByID(权限检查) + partial update + version++ + Publish `profile.updated`
- `Get(ctx, id) → (*model.AgentProfile, error)`
- `List(ctx, ownerID, filters) → ([]AgentProfile, PageInfo, error)`
- `Delete(ctx, id, ownerID) → error` — 软删除 + Publish `profile.deleted`
- `Publish(ctx, id, ownerID) → error` — is_public=true + Publish `profile.published`
- `Unpublish(ctx, id, ownerID) → error` — is_public=false
- `Install(ctx, id, targetUserID) → (*model.AgentProfile, error)` — 复制 Profile + install_count++

**新建文件**：`internal/service/agent_profile_test.go`

使用 `go-sqlmock` mock DB，覆盖：
- 创建成功
- JSONB 校验失败
- 非 owner 更新 → forbidden
- 安装（install_count 递增）
- 重复安装 → 409

#### 任务 2.5：Handler

**新建文件**：`internal/handler/agent_profile.go`

注册路由（`/web` group，需要 `DeviceTypeCheck("web")`）：

```go
web.GET("/agent-profiles", handler.ListProfiles)
web.POST("/agent-profiles", handler.CreateProfile)
web.GET("/agent-profiles/:id", handler.GetProfile)
web.PATCH("/agent-profiles/:id", handler.UpdateProfile)
web.DELETE("/agent-profiles/:id", handler.DeleteProfile)
web.POST("/agent-profiles/:id:publish", handler.PublishProfile)
web.POST("/agent-profiles/:id:install", handler.InstallProfile)
```

#### 任务 2.6：App 装配

**修改文件**：`internal/app/app.go`

创建 `AgentProfileRepository` → `AgentProfileService` → `AgentProfileHandler` 依赖链，传入 router。

### 4.3 验证

```powershell
cd hub-server

# Model 校验
go test ./internal/model -run "TestAgentProfile_Validate" -count=1 -v

# Repository
go test ./internal/repository -run "TestAgentProfile" -count=1 -v

# Service
go test ./internal/service -run "TestAgentProfile" -count=1 -v

# Handler
go test ./internal/handler -run "TestAgentProfile" -count=1 -v

# 全量回归
go test ./... -short -count=1
```

---

## 5. Phase 3 — Skill + MCP Catalog

### 5.1 目标

实现 Skill 目录和 MCP Server 注册表的 CRUD API。

### 5.2 任务清单

#### 任务 3.1：Migration 0022 — skills 表 / 0023 — mcp_servers 表

DDL 见需求文档 3.4.2 和 3.5.2。

#### 任务 3.2：Model + Repository + Service + Handler

遵循与 Phase 2 相同的四层模式：

**新建文件**：
| 层 | Skill | MCP Server |
|------|------|------|
| Model | `internal/model/skill.go` | `internal/model/mcp_server.go` |
| Model test | `internal/model/skill_test.go` | `internal/model/mcp_server_test.go` |
| Repository | `internal/repository/skill.go` | `internal/repository/mcp_server.go` |
| Service | `internal/service/skill.go` | `internal/service/mcp_server.go` |
| Service test | `internal/service/skill_test.go` | `internal/service/mcp_server_test.go` |
| Handler | `internal/handler/skill.go` | `internal/handler/mcp_server.go` |
| Handler test | `internal/handler/skill_test.go` | `internal/handler/mcp_server_test.go` |

**MCP Server 安全校验**（model Validate）：
```go
func (m *MCPServer) Validate() error {
    // auth_config 中不得包含明文密钥
    dangerousKeys := []string{"api_key", "secret", "token", "password", "key"}
    for _, key := range dangerousKeys {
        if val, ok := m.authConfigMap()[key]; ok && val != "" && val != "***" {
            return fmt.Errorf("auth_config must not contain plaintext %s", key)
        }
    }
}
```

#### 任务 3.3：路由注册

```go
// Skills — /web group
web.GET("/skills", skillHandler.List)
web.POST("/skills", skillHandler.Create)
web.GET("/skills/:id", skillHandler.Get)
web.PATCH("/skills/:id", skillHandler.Update)
web.DELETE("/skills/:id", skillHandler.Delete)
web.POST("/skills/:id:publish", skillHandler.Publish)

// MCP Servers — /web group
web.GET("/mcp-servers", mcpHandler.List)
web.POST("/mcp-servers", mcpHandler.Create)
web.GET("/mcp-servers/:id", mcpHandler.Get)
web.PATCH("/mcp-servers/:id", mcpHandler.Update)
web.DELETE("/mcp-servers/:id", mcpHandler.Delete)
web.POST("/mcp-servers/:id:test", mcpHandler.TestConnection)
```

### 5.3 验证

```powershell
cd hub-server
go test ./internal/model -run "TestSkill|TestMCPServer" -count=1 -v
go test ./internal/service -run "TestSkill|TestMCPServer" -count=1 -v
# 安全验证：mcp_server auth_config 含明文 api_key → Validate 报错
```

---

## 6. Phase 4 — Agent 市场 + 模型配置

### 6.1 目标

实现 Agent 市场 API（搜索/安装/评分），Providing binding 元数据存储。

### 6.2 任务清单

#### 任务 4.1：Market Service

**新建文件**：`internal/service/market.go`

```go
type MarketService struct {
    profileRepo repository.AgentProfileRepository
    cache       *cache.Client
}
```

方法：
- `SearchProfiles(ctx, q, runtimeID, sortBy, pageSize, cursor) → ([]AgentProfile, PageInfo, error)` — 查询 `is_public=true` 的 Profile，支持搜索/排序
- `InstallProfile(ctx, profileID, installerID) → (*model.AgentProfile, error)` — 见需求 4.1.2
- `RateProfile(ctx, profileID, raterID, score) → (newAvg, newCount, error)` — 评分 1-5，同一用户可重复评分（覆盖旧分）

**Market Handler**：

```go
// /web group
web.GET("/market/profiles", marketHandler.Search)
web.GET("/market/profiles/:id", profileHandler.Get)  // 复用 profile handler
web.POST("/market/profiles/:id:install", marketHandler.Install)
web.POST("/market/profiles/:id:rate", marketHandler.Rate)
```

#### 任务 4.2：Provider Binding

**Migration 0024** — `provider_bindings` 表
**新建文件**：`internal/model/provider_binding.go`、`internal/repository/provider_binding.go`、`internal/service/provider_binding.go`、`internal/handler/provider_binding.go`

```go
// /web group
web.GET("/provider-bindings", pbHandler.List)
web.POST("/provider-bindings", pbHandler.Create)
web.DELETE("/provider-bindings/:id", pbHandler.Delete)
web.POST("/provider-bindings/:id:refresh", pbHandler.Refresh)
```

Handler 校验：`base_url` 不得含 `@`、`token=`、`key=`、`secret=` (AH-SR 安全约束)。

### 6.3 验证

```powershell
cd hub-server
go test ./internal/service -run "TestMarket" -count=1 -v
go test ./internal/model -run "TestProviderBinding" -count=1 -v
```

---

## 7. Phase 5 — Execution Target 管理

### 7.1 目标

实现 Execution Target 的 CRUD，让 Desktop Settings > Execution Targets 页可以注册和管理远程执行目标。

### 7.2 任务清单

#### 任务 5.1：Migration 0021 — execution_targets 表

DDL 见需求文档 3.3.2。

#### 任务 5.2：Model + Repository + Service + Handler

```go
// /web group
web.GET("/execution-targets", targetHandler.List)
web.POST("/execution-targets", targetHandler.Create)
web.GET("/execution-targets/:id", targetHandler.Get)
web.PATCH("/execution-targets/:id", targetHandler.Update)
web.DELETE("/execution-targets/:id", targetHandler.Delete)
web.POST("/execution-targets/:id:ping", targetHandler.Ping)
```

`Ping` 逻辑：
- `target_type=local_edge` → 检查对应 device 的在线状态
- `target_type=remote_ssh` → 尝试 TCP dial host:port
- `target_type=hub_relay` → 检查路由中 device 在线
- 更新 `is_online` 和 `last_seen_at`

### 7.3 验证

```powershell
cd hub-server
go test ./internal/service -run "TestExecutionTarget" -count=1 -v
```

---

## 8. Phase 6 — 安全审计

### 8.1 目标

实现安全审计事件记录和查询 API。

### 8.2 任务清单

#### 任务 6.1：Migration 0025 — audit_events 表

DDL 见需求文档 4.4.2。

#### 任务 6.2：Audit Service

**新建文件**：`internal/service/audit.go`

```go
type AuditService struct {
    repo repository.AuditRepository
}

// Record 写入审计事件（fire-and-forget，不阻塞主流程）
func (s *AuditService) Record(ctx, event)
func (s *AuditService) Query(ctx, userID, filters) ([]AuditEvent, PageInfo, error)
```

**事件采集点插入**（在已有 handler/service 中）：

| 插入位置 | 事件 | 时间 |
|------|------|------|
| `service/auth.go:Login()` | `auth.login` / `auth.login_failed` | Phase 6 |
| `handler/agent_profile.go:CreateProfile()` | `profile.created` | Phase 2 |
| `handler/agent_profile.go:UpdateProfile()` | `profile.modified` | Phase 2 |
| `handler/agent_profile.go:DeleteProfile()` | `profile.deleted` | Phase 2 |
| `handler/execution_target.go:CreateTarget()` | `target.registered` | Phase 5 |
| `service/agent.go:HandleTaskAck()` | `run.started` | Phase 6 |
| `service/agent.go:HandleTaskDone()` | `run.completed` | Phase 6 |

> 方式：在对应 handler/service 构造函数中注入 `*AuditService`，成功路径调用 `auditSvc.Record()`。

#### 任务 6.3：Audit Handler

```go
// /web group
web.GET("/audit-events", auditHandler.Query)
web.GET("/audit-events/:id", auditHandler.Get)
```

权限：非 admin 用户只能查自己的事件（`WHERE user_id = current_user`）。

### 8.3 验证

```powershell
cd hub-server
go test ./internal/service -run "TestAudit" -count=1 -v
go test ./internal/handler -run "TestAudit" -count=1 -v
# 非 admin 查他人事件 → 403
# admin 查全部 → 200
```

---

## 9. Phase 7 — 远程 Relay + 多端增强

### 9.1 目标

实现远程 Relay 命令基础设施和设备 capability 同步。

### 9.2 任务清单

#### 任务 7.1：Relay Service + Handler

**新建文件**：`internal/service/relay.go`、`internal/handler/relay.go`

```go
// /web group
web.POST("/relay/commands", relayHandler.CreateCommand)
web.GET("/relay/commands/:id", relayHandler.GetCommand)
web.POST("/relay/commands/:id:ack", relayHandler.AckCommand)
```

`CreateCommand` 逻辑：
1. 生成 relay command ID
2. 查 device_route 找到目标 Edge
3. 通过 WS Push 发送 `agent.dispatch`（含 relay command payload）
4. 如果 Edge 离线，写入 pending queue
5. 返回 command_id

#### 任务 7.2：Device Capability 增强

**修改文件**：`internal/handler/device.go`

`RegisterDevice` 时接受 capability 对象：

```json
{
  "device_type": "desktop",
  "device_id": "...",
  "app_version": "0.1.0",
  "capabilities": {
    "runtimes": ["claude-code", "codex"],
    "max_concurrent_runs": 5,
    "os": "windows",
    "arch": "amd64"
  }
}
```

`GET /web/devices` 返回 capability 列表（多端差异对比）。

### 9.3 验证

```powershell
cd hub-server
go test ./internal/service -run "TestRelay" -count=1 -v
go test ./internal/handler -run "TestDeviceCapability" -count=1 -v
```

---

## 10. Phase 8 — 收敛 & 清理

### 10.1 目标

Runner → Runtime 命名迁移方案落地，全量契约覆盖验证，集成测试加固。

### 10.2 任务清单

#### 任务 8.1：API 命名迁移文档

**新建文件**：`api/deprecations.md`

标注以下历史命名和当前语义的映射（见 `docs/system-architecture.md` 2.6 节）：

| 历史命名 | 当前语义 | 迁移计划 |
|------|------|------|
| `/v1/runners` | Runtime/Target health 摘要 | Q3 新增 `/v1/runtimes`，保留兼容 |
| `runner.online` | Runtime available | 并行发布 `runtime.online` |
| `runner.offline` | Runtime unavailable | 并行发布 `runtime.offline` |
| `runner_offline` | Target offline 错误码 | 新增 `runtime_unavailable` |

#### 任务 8.2：全量 OpenAPI 覆盖审计

运行以下检查确认契约覆盖率为 100%：

```powershell
# 从 router.go 提取所有路由 → 与 openapi.yaml 逐条对照
cd hub-server
rg -n '\.GET\(|\.POST\(|\.PATCH\(|\.DELETE\(' internal/router/router.go
cd ..
python -c "
import yaml, pathlib
spec = yaml.safe_load(pathlib.Path('api/openapi.yaml').read_text(encoding='utf-8'))
paths = list(spec.get('paths', {}).keys())
print(f'OpenAPI paths: {len(paths)}')
for p in sorted(paths):
    print(f'  {p}')
"
```

生成缺失路由清单，逐条补全或标注为 planned。

#### 任务 8.3：集成测试加固

**修改文件**：`hub-server/tests/`

新增集成测试文件：
- `tests/oidc_integration_test.go` — OIDC PKCE 端到端（mock TokenDance ID）
- `tests/profile_integration_test.go` — Profile CRUD 完整流程
- `tests/market_integration_test.go` — 市场发布→搜索→安装→评分

```powershell
cd hub-server
go test ./tests -count=1 -v  # 全量集成测试通过
```

#### 任务 8.4：.env.example 同步

确保所有 `AGENTHUB_*` 变量在 `.env.example` 中有占位说明。

#### 任务 8.5：README 更新

更新 `hub-server/README.md`：
- 更新 migration 数量（17→25+）
- 新增 Phase 1-7 的 API 分组说明
- 更新数据库表清单

### 10.3 验证

```powershell
cd hub-server
go test ./... -short -count=1 -race
go vet ./...
go test ./tests -count=1 -v
cd ..
python -c "import yaml, pathlib; yaml.safe_load(pathlib.Path('api/openapi.yaml').read_text(encoding='utf-8')); print('yaml ok')"
```

---

## 11. 跨阶段约束

### 11.1 文件修改范围

每个阶段只修改以下目录中的文件：

```
hub-server/internal/{config,model,repository,service,handler,router,app}/
hub-server/migrations/
hub-server/configs/
hub-server/.env.example
hub-server/docs/
hub-server/README.md
api/openapi.yaml
api/events.md
```

不要修改 `edge-server/` 或 `app/` 中的文件（除非 Phase 明确要求）。

### 11.2 测试要求

| 层 | 最低新增测试 | 覆盖重点 |
|------|:--|------|
| model | Validate() 100% | JSONB 类型校验/安全约束 |
| repository | 所有新方法 | 正常路径 + 边界(空/重复/不存在) |
| service | 所有公开方法 | 正常路径 + 权限 + 错误 |
| handler | 所有 endpoint | 200/400/401/403/409/500 |

### 11.3 安全自查

每阶段结束时检查：
- [ ] 新增 handler 是否通过 AuthMiddleware（公开端点除外）
- [ ] 资源操作是否校验 owner_id
- [ ] JSONB 字段是否在 model+handler 双层校验
- [ ] 不存储明文 token/key/secret
- [ ] 错误消息不泄露内部实现

### 11.4 回滚策略

每阶段提交独立、可 cherry-pick。如果某阶段需要回滚：
- Migration 有对应的 `.down.sql`
- Service 层改动不影响已有 API
- 新增路由回滚只需删除 router 注册行

---

## 12. 进度追踪表

| Phase | 目标 | 预估 | Migrations | 新建文件 | 修改文件 | 状态 |
|------|------|:--:|:--:|------|------|:--:|
| 0 | 契约补全 | 1-2d | 0 | 0 | 2 (openapi.yaml, events.md) | ⬜ |
| 1 | OIDC PKCE | 3-4d | 1 (0019) | 4 | 5 | ⬜ |
| 2 | Profile 持久化 | 3-4d | 1 (0020) | 7 | 2 | ⬜ |
| 3 | Skill + MCP | 3-4d | 2 (0022,0023) | 14 | 1 | ⬜ |
| 4 | Market + 模型 | 3-4d | 1 (0024) | 6 | 1 | ⬜ |
| 5 | Target 管理 | 2-3d | 1 (0021) | 7 | 1 | ⬜ |
| 6 | 安全审计 | 3-4d | 1 (0025) | 4 | 7+ (插入审计点) | ⬜ |
| 7 | Relay + 多端 | 3-4d | 0 | 4 | 2 | ⬜ |
| 8 | 收敛清理 | 2-3d | 0 | 2 | 3 | ⬜ |

**总计**：23-32 天，8 个 Phase，7 个 migration，48+ 新建文件，24+ 修改文件。

---

## 13. 给 Agent 的任务卡模板

当把某个 Phase 的任务分发给 Agent 时，必须提供以下格式的任务卡：

```markdown
## 目标
[Phase X: 简要描述]

## 分支
feat/hub-{short-name} （从最新的 dev/delicious233 创建）

## 允许修改
hub-server/internal/{model,repository,service,handler,router,app,config}/
hub-server/migrations/
hub-server/configs/
hub-server/.env.example
api/openapi.yaml
api/events.md

## 必须阅读
- AGENTS.md
- docs/handoff/STATE.md
- hub-server/docs/hub-server-requirements.md （对应章节）
- hub-server/docs/hub-server-development-plan.md （当前 Phase）

## 不能修改
- edge-server/
- app/
- hub-server/internal/middleware/ （除非 Phase 明确要求）
- hub-server/go.mod （除非需要新增依赖）

## 验证命令
cd hub-server
go build ./...
go test ./... -short -count=1
go vet ./...

## 提交要求
- 每个逻辑完成点一个 commit
- 格式：feat(hub): 中文摘要
- 完成后 push 分支、开 draft PR 到 dev/delicious233

## 安全红线
- 不存明文密钥
- 所有 JSONB 字段有 Validate()
- 资源操作校验 owner
- 新 handler 通过 AuthMiddleware
```
