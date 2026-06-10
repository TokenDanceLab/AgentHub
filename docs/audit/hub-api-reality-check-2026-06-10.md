# Hub API Reality Check — 2026-06-10

> 审计方法：使用 HS256 JWT 伪造本地 session，直接 curl 所有 endpoint，记录真实 HTTP 状态码和响应体。
> Hub 运行在 `http://127.0.0.1:8080`，PostgreSQL + Redis 均正常。

## 测试用户

| 用户 | ID | 用途 |
|------|-----|------|
| audit-tester | `a0000000-0000-0000-0000-000000000001` | 主测试用户，device_type=web/desktop |
| audit-tester-2 | `b0000000-0000-0000-0000-000000000001` | 联系人/会话目标用户 |
| marketplace-system | `c0000000-0000-0000-0000-000000000001` | 系统内置用户 |

## 端点总览

### 汇总表

| # | Endpoint | Method | Status | 数据 | 备注 |
|---|----------|--------|--------|------|------|
| | **Health** | | | | |
| 1 | `/health` | GET | 200 | 有数据 | DB/Redis/uptime 全部正常 |
| 2 | `/health/live` | GET | 200 | 有数据 | |
| 3 | `/health/ready` | GET | 200 | 有数据 | |
| | **Auth** | | | | |
| 4 | `/client/auth/me` | GET | 200 | 有数据 | 返回完整用户信息 |
| 5 | `/client/auth/profile` | PUT | 200 | 有数据 | 昵称更新成功 |
| 6 | `/client/auth/logout` | POST | **500** | 错误 | 见 BUG-1 |
| 7 | `/client/auth/refresh` | POST | 400 | 错误 | 正确：空请求被拒 |
| 8 | `/client/auth/me` (无 token) | GET | 401 | 错误 | 正确：认证拦截 |
| 9 | `/client/auth/me` (无效 token) | GET | 401 | 错误 | 正确：认证拦截 |
| | **Contacts** | | | | |
| 10 | `/client/contacts` | GET | 200 | 有数据 | 返回好友列表 |
| 11 | `/client/contacts/friend-requests` | POST | 200 | OK | 发送好友请求成功 |
| 12 | `/client/contacts/friend-requests` | GET | 200 | 有数据 | 返回好友请求列表 |
| 13 | `/client/contacts/friend-requests/:id/accept` | POST | 200 | OK | 接受好友请求成功 |
| 14 | `/client/contacts/search?id=...` | GET | 200 | 有数据 | 搜索用户成功，含 relationship 字段 |
| | **Sessions** | | | | |
| 15 | `/client/sessions` | GET | 200 | 有数据 | 返回会话列表（含 group/private） |
| 16 | `/client/sessions/private` | POST | 200 | 有数据 | 创建私聊成功 |
| 17 | `/client/sessions/group` | POST | 200 | 有数据 | 创建群聊成功 |
| 18 | `/client/sessions/:id/info` | PUT | 200 | OK | 更新群信息成功 |
| 19 | `/client/sessions/:id/settings` | PUT | 200 | OK | 更新成员设置成功 |
| 20 | `/client/sessions/:id/leave` | POST | 400 | 错误 | 正确：群主不能离开 |
| 21 | `/client/sessions/:id` | DELETE | 400 | 错误 | 正确：群主不能删除 |
| 22 | `/client/sessions/search?q=...` | GET | 200 | 空数组 | 搜索无结果（正常） |
| | **Messages** | | | | |
| 23 | `/client/sessions/:id/messages` | POST | 200 | 有数据 | 发送消息成功（需 client_msg_id） |
| 24 | `/client/sessions/:id/messages` | POST | **500** | 错误 | 见 BUG-2 |
| 25 | `/client/sessions/:id/messages` | GET | 200 | 有数据 | 返回消息列表 |
| 26 | `/client/sessions/:id/messages/sync` | GET | 200 | 有数据 | 增量同步成功 |
| 27 | `/client/sessions/:id/messages/search?q=...` | GET | 200 | 有数据 | 会话内消息搜索成功 |
| 28 | `/client/messages/:id` | PUT | 200 | 有数据 | 编辑消息成功 |
| 29 | `/client/messages/:id/recall` | POST | 200 | OK | 撤回消息成功 |
| 30 | `/client/messages/:id/pin` | POST | 200 | OK | 置顶消息成功（需 session_id） |
| 31 | `/client/messages/:id/pin` | DELETE | 200 | OK | 取消置顶成功 |
| 32 | `/client/sessions/:id/pins` | GET | 200 | 有数据 | 置顶消息列表成功 |
| 33 | `/client/messages/:id/forward` | POST | 200 | OK | 转发消息成功 |
| 34 | `/client/sessions/:id/read` | POST | 200 | OK | 标记已读成功 |
| 35 | `/client/messages/search?q=...` | GET | 200 | 有数据 | 全局消息搜索成功 |
| | **Reactions** | | | | |
| 36 | `/client/messages/:id/reactions` | POST | **500** | 错误 | 见 BUG-3 |
| 37 | `/client/messages/:id/reactions` | GET | 200 | 空数组 | 列表成功（无数据） |
| 38 | `/client/messages/:id/reactions` | DELETE | **500** | 错误 | 同 BUG-3 |
| | **Agent Profiles** | | | | |
| 39 | `/web/agent-profiles` | GET | 200 | 有数据 | 返回用户自有的 profiles |
| 40 | `/web/agent-profiles` | POST | 200 | 有数据 | 创建 profile 成功 |
| 41 | `/web/agent-profiles/:id` | GET | 200 | 有数据 | 获取单个 profile 成功 |
| | **Skills** | | | | |
| 42 | `/web/skills` | GET | 200 | 有数据 | 返回用户自有的 skills |
| 43 | `/web/skills` | POST | 200 | 有数据 | 创建 skill 成功 |
| 44 | `/web/skills/:id` | GET | 200 | 有数据 | 获取单个 skill 成功 |
| | **MCP Servers** | | | | |
| 45 | `/web/mcp-servers` | GET | 200 | 有数据 | 返回用户自有的 MCP servers |
| 46 | `/web/mcp-servers` | POST | 200 | 有数据 | 创建 MCP server 成功 |
| 47 | `/web/mcp-servers/:id` | GET | 200 | 有数据 | 获取单个 MCP server 成功 |
| | **Agent Tasks** | | | | |
| 48 | `/web/agent-tasks` | POST | **404** | 错误 | AGENT_NOT_FOUND — 正确：没有活跃的 agent instance |
| | **Attachments** | | | | |
| 49 | `/client/attachments/probe` | POST | 200 | 有数据 | 探测附件成功 |
| 50 | `/client/attachments` | POST | 200 | 有数据 | 上传附件成功（需 hash + file） |
| 51 | `/client/attachments/:id` | GET | 404 | 错误 | 见 BUG-4 |
| | **Settings** | | | | |
| 52 | `/client/settings` | GET | 200 | 有数据 | 返回用户设置 |
| 53 | `/client/settings` | PATCH | 200 | 有数据 | 更新设置成功（需 `values` map） |
| | **Notifications** | | | | |
| 54 | `/client/notifications` | GET | 200 | 空数组 | 无通知（正常） |
| | **Custom Agents** | | | | |
| 55 | `/web/custom-agents` | GET | 200 | 空数组 | |
| 56 | `/web/custom-agents` | POST | 200 | 有数据 | 创建自定义 Agent 成功 |
| | **Market** | | | | |
| 57 | `/web/market/profiles` | GET | 200 | 空数组 | 无公开 profile（正常） |
| | **Devices** | | | | |
| 58 | `/web/devices` | GET | 200 | 空数组 | 无注册设备 |
| | **Execution Targets** | | | | |
| 59 | `/web/execution-targets` | GET | 200 | 空数组 | |
| 60 | `/web/execution-targets` | POST | **201** | 有数据 | 创建执行目标成功 |
| | **Documents** | | | | |
| 61 | `/web/documents` | GET | 200 | 空数组 | |
| 62 | `/web/documents` | POST | 200 | 有数据 | 创建文档成功 |
| | **Projects/Workspaces** | | | | |
| 63 | `/web/projects` | GET | 200 | 空数组 | |
| 64 | `/web/projects` | POST | 200 | 有数据 | 创建项目成功 |
| | **Agent Teams** | | | | |
| 65 | `/web/agent-teams` | GET | 200 | 空数组 | |
| 66 | `/web/agent-teams` | POST | 200 | 有数据 | 创建团队成功 |
| | **Provider Bindings** | | | | |
| 67 | `/web/provider-bindings` | GET | 200 | 空数组 | |
| 68 | `/web/provider-bindings` | POST | 200 | 有数据 | 创建 Provider Binding 成功 |
| | **Public Stats** | | | | |
| 69 | `/api/public/stats` | GET | 200 | 有数据 | 正常返回（bucket 化计数） |
| | **OIDC** | | | | |
| 70 | `/client/auth/oidc/authorize` | POST | 400 | 错误 | 正确：空请求被拒 |
| | **WebSocket** | | | | |
| 71 | `/client/ws` (无 token) | GET | 401 | 错误 | 正确：认证拦截 |
| | **Device Type Check** | | | | |
| 72 | `/web/*` (desktop token) | GET | 403 | 错误 | 正确：device type 不匹配 |

## BUG 列表

### BUG-1: POST /client/auth/logout 返回 500

- **现象**：使用 JWT 伪造的 session 调用 logout 返回 `INTERNAL_ERROR`
- **原因**：JWT 是直接签发的，没有经过 OIDC 登录流程，因此 `refresh_tokens` 表中没有记录。Logout handler 尝试撤销 refresh token 时失败。
- **严重性**：低 — 仅影响伪造 token 场景。正常 OIDC 登录的用户应该可以正常 logout。
- **建议**：Logout handler 应该在找不到 refresh token 时返回 200 而非 500（幂等退出）。

### BUG-2: POST /client/sessions/:id/messages 无 client_msg_id 时返回 500

- **现象**：发送消息时不提供 `client_msg_id` 字段，服务器返回 500 而非 400。
- **原因**：`messages` 表的 `client_msg_id` 列是 `uuid NOT NULL`，空字符串无法插入 UUID 列，导致数据库错误被包装为 500。
- **严重性**：中 — 客户端忘记传 `client_msg_id` 时收到 500 而非有意义的错误信息。
- **建议**：在 handler 或 service 层校验 `client_msg_id` 必须是非空 UUID，或由 server 自动生成（类似 `ForwardMessage` 的处理方式）。
- **文件**：`hub-server/internal/handler/message.go` SendMessage 方法。

### BUG-3: POST/DELETE /client/messages/:id/reactions 返回 500

- **现象**：添加或删除消息 reaction 时返回 500。
- **原因**：`message_reactions` 表的列名是 `emoji`（text），但 model struct 的 `Reaction` 字段映射到 `reaction` 列（`gorm:"type:varchar(64)"`）。GORM 尝试 INSERT 到不存在的 `reaction` 列，导致 PostgreSQL 报错。
- **严重性**：高 — Reactions 功能完全不可用。
- **修复方案**：
  - 方案 A：在 model 中给 Reaction 字段加 `gorm:"column:emoji"` tag。
  - 方案 B：写 migration 将 `emoji` 列重命名为 `reaction`。
- **文件**：`hub-server/internal/model/message_reaction.go` 第 17 行。
- **数据库确认**：`\d message_reactions` 显示列为 `emoji text NOT NULL`。

### BUG-4: GET /client/attachments/:id 返回 404

- **现象**：上传成功的附件，通过 GET 下载时返回 `ATTACH_NOT_FOUND`。
- **原因**：Download handler 通过 `CanUserAccessReferencedAttachment` 检查用户是否有权访问。该检查要求附件通过 `message_attachments` 关联表绑定到一个用户是其活跃成员的 session。独立上传（未关联消息）的附件无法被下载。
- **严重性**：低 — 这是设计行为，不是 bug。附件必须先通过消息引用才能被下载。前端工作流是：上传 -> 获得附件 ID -> 发消息引用附件 -> 通过消息下载附件。
- **建议**：考虑在 API 文档或错误消息中明确说明此行为。

## 数据质量备注

### 初始数据（Seeded Market Data）

- Skills: 8 条公开记录（owner = marketplace-system）
- MCP Servers: 6 条公开记录（owner = marketplace-system）
- Agent Profiles: 0 条公开记录

用户的 `/web/skills` 和 `/web/mcp-servers` 列表只显示自己创建的记录，不包含市场数据。市场数据通过 `/web/market/profiles` 查看（当前仅支持 agent profiles 市场，skills 和 MCP 的市场端点尚未独立）。

### Public Stats 桶化

`/api/public/stats` 的计数使用 `publicCountBucket` 函数进行模糊化：
- count < 10 → 返回 0
- count < 100 → 向下取整到 10
- count < 1000 → 向下取整到 100

这是正确的隐私保护行为。

## 测试覆盖率

| 类别 | 测试端点数 | 通过 | 失败/BUG |
|------|-----------|------|---------|
| Health | 3 | 3 | 0 |
| Auth | 6 | 4 | 1 (BUG-1) |
| Contacts | 5 | 5 | 0 |
| Sessions | 8 | 8 | 0 |
| Messages | 13 | 11 | 1 (BUG-2) |
| Reactions | 3 | 1 | 1 (BUG-3) |
| Agent Profiles | 3 | 3 | 0 |
| Skills | 3 | 3 | 0 |
| MCP Servers | 3 | 3 | 0 |
| Agent Tasks | 1 | 1 | 0 |
| Attachments | 3 | 2 | 1 (BUG-4, 设计行为) |
| Settings | 2 | 2 | 0 |
| Notifications | 1 | 1 | 0 |
| Custom Agents | 2 | 2 | 0 |
| Market | 1 | 1 | 0 |
| Devices | 1 | 1 | 0 |
| Execution Targets | 2 | 2 | 0 |
| Documents | 2 | 2 | 0 |
| Projects | 2 | 2 | 0 |
| Agent Teams | 2 | 2 | 0 |
| Provider Bindings | 2 | 2 | 0 |
| Public Stats | 1 | 1 | 0 |
| OIDC | 1 | 1 | 0 |
| WebSocket | 1 | 1 | 0 |
| Security | 2 | 2 | 0 |
| **总计** | **72** | **67** | **4** |

## 结论

Hub API 整体健康度良好。72 个端点测试中 67 个正常工作。

需要修复的问题：
1. **BUG-3 (高)**: Message reactions 因列名不匹配（`emoji` vs `reaction`）完全不可用。
2. **BUG-2 (中)**: 发送消息缺少 `client_msg_id` 时返回 500 而非 400。
3. **BUG-1 (低)**: 伪造 token 的 logout 应幂等返回 200。
4. **BUG-4 (低/设计)**: 附件下载需要消息关联，错误消息可以更清晰。
