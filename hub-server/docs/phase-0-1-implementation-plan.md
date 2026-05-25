# Phase 0+1 实现计划

## 执行顺序

```
Step 0: 环境确认 (1min)
  ├── 确认分支 clean
  └── 确认 Go 可编译、测试全过

Step 1: Phase 0 契约补全 (并行, ~30min × 2 agents)
  ├── Agent-A: api/openapi.yaml 补全 37 条 Hub 路由
  └── Agent-B: api/events.md 新增 Hub WS 事件章节

Step 2: Phase 1 基础设施 (并行, ~20min × 3 agents)
  ├── Agent-C: Migration 0019 + User model
  ├── Agent-D: Config 扩展
  └── Agent-E: (等待 Step 1 完成，验证契约)

Step 3: Phase 1 业务层 (串行依赖)
  ├── Agent-F: Repository 扩展 (依赖 Step 2)
  ├── Agent-G: OIDC Service (依赖 Repository)
  └── Agent-H: OIDC Handler + Router + App (依赖 Service)

Step 4: 全量验证 (串行)
  └── 编译 + 测试 + vet + OpenAPI 校验
```

## Step 1: Phase 0 契约补全

### Agent-A 任务卡 — OpenAPI 补全

**文件**: `api/openapi.yaml`

**操作**: 在 `# ── Legacy / Planned ──` 之前插入 Hub 已实现路由的 OpenAPI 声明。

**需插入的路由（37条）**:

1. Session Members (4): /client/sessions/{id}/members GET/POST, /client/sessions/{id}/members/{memberId} DELETE, /client/sessions/{id}:leave POST
2. Message Enhancements (8): /client/sessions/{id}/messages/search GET, /client/messages/search GET, /client/sessions/{id}/messages/{msgId}:recall POST, ...:pin POST, ...:unpin POST, ...:read POST, /client/sessions/{id}/pins GET, /client/messages:forward POST  
3. Contact Enhancements (6): /client/contacts/{userId} DELETE, ...:block POST, ...:unblock POST, /client/contacts/{userId}/remark PATCH, /client/friend-requests GET, /client/friend-requests/sent GET
4. Attachments (3): /client/attachments:probe POST, /client/attachments:upload POST, /client/attachments/{id} GET
5. Notifications (3): /client/notifications GET, /client/notifications/{id}:read POST, /client/notifications:read-all POST
6. Custom Agents (5): /web/custom-agents GET/POST, /web/custom-agents/{id} GET/PATCH/DELETE
7. Session Management (4): /client/sessions/{id}:dissolve POST, ...:transfer-owner POST, /client/sessions/{id}/settings PATCH, /client/sessions/{id}/member-settings PATCH
8. Account (1): /client/auth/change-password POST
9. Edge/Web Misc (3): /edge/devices:register POST, /web/agent-tasks/{id}:cancel POST, /client/auth/oidc/authorize POST, /client/auth/oidc/callback POST

**约束**:
- 每条路由标注 `x-agenthub-status: implemented` + `x-agenthub-owner: Hub`
- 遵循已有 OpenAPI 风格（tags, parameters, responses）
- 鉴权路由标注 `security: [{ bearerAuth: [] }]`
- 模板参考现有的 `/client/auth/register` 路由

### Agent-B 任务卡 — Hub WS 事件文档化

**文件**: `api/events.md`

**操作**: 在文件末尾新增 "## Hub WebSocket Events" 章节。

**内容要求**:
1. 连接方式：`ws://host:8080/client/ws`，首帧 `{"type":"auth","payload":{"access_token":"..."}}`
2. Hub Frame 格式：`type` (dot.notation), `seq_id`, `payload` — 与 Edge EventEnvelope 的差异对照表
3. 24 种事件类型及其 payload schema
4. 代码示例

## Step 2: Phase 1 基础设施

### Agent-C 任务卡 — Migration + Model

**Migration 文件**:
- `hub-server/migrations/0019_token_dance_sub.up.sql`
- `hub-server/migrations/0019_token_dance_sub.down.sql`

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

**Model 修改**: `hub-server/internal/model/user.go`
- User struct 新增: `TokenDanceSub *string` + `TokenDanceSubLinkedAt *time.Time`
- GORM tag: `gorm:"column:tokendance_sub;uniqueIndex:idx_users_tokendance_sub,where:tokendance_sub IS NOT NULL AND tokendance_sub != ''"`

### Agent-D 任务卡 — Config 扩展

**修改文件**:
1. `hub-server/internal/config/config.go` — 新增 TokenDanceIDConfig struct + Config 中新增字段
2. `hub-server/configs/config.yaml` — 新增 tokendance_id 配置块
3. `hub-server/.env.example` — 新增 TokenDance 环境变量

## Step 3: Phase 1 业务层

### Agent-F 任务卡 — Repository

**修改**: `hub-server/internal/repository/user.go`
- 新增 `FindByTokenDanceSub(ctx, sub)` 
- 新增 `FindOrCreateByTokenDanceSub(ctx, sub)` — 首次自动创建用户

**新建**: `hub-server/internal/repository/user_extra_test.go`
- `TestFindOrCreateByTokenDanceSub_FirstTime` 
- `TestFindOrCreateByTokenDanceSub_ExistingUser`

### Agent-G 任务卡 — OIDC Service

**新建**: `hub-server/internal/service/oidc.go`
- OIDCService struct + GenerateAuthorizationURL + HandleCallback
- 使用 httptest.NewServer mock TokenDance ID

**新建**: `hub-server/internal/service/oidc_test.go`
- 覆盖: 正常PKCE / state过期 / code exchange失败 / id_token无效 / 首次用户创建

### Agent-H 任务卡 — Handler + Router + App

**新建**: `hub-server/internal/handler/oidc.go`
**新建**: `hub-server/internal/handler/oidc_test.go`
**修改**: `hub-server/internal/router/router.go`
**修改**: `hub-server/internal/app/app.go`
