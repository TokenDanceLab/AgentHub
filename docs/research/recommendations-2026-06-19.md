# AgentHub 综合审计 — 行动建议

**日期：** 2026-06-19
**来源：** 10 项专项审计（参考竞品、性能、错误处理、TypeScript 严格模式、包体积、日志、环境变量、API 覆盖、迁移健康、WebSocket）
**仓库：** `D:/Code/TokenDance/AgentHub`

---

## 1. 快速修复（P0，每项 <1 小时）

| # | 做什么 | 为什么 | 预计耗时 |
|---|--------|--------|----------|
| 1.1 | **hub-server：消除 4 个 `panic()`** — `router.go:19`(SetTrustedProxies)、`router.go:22`(CORS)、`eventbus.go:50`(协程池)、`agent_spec.go:120`(json.Marshal) 改为返回 error | 生产代码路径中 panic 会导致整个进程崩溃，无优雅关闭 | 30min |
| 1.2 | **hub-server：删除重复的 `ErrUnauthorized` 定义** — `errcode/codes.go:88` 改为 re-export `sharederr.ErrUnauthorized` | 两个同名 sentinel 指针不同，`errors.Is` 行为不可预测 | 15min |
| 1.3 | **hub-server：NoRoute/NoMethod 加 traceId** — `router.go:32-46` 改用 `middleware.fail()` 或 `sharederr.EnvelopeForGinWithTrace()` | 当前 gin.H 直写无 traceId，404/405 错误无法追踪 | 20min |
| 1.4 | **edge-server：CORS/auth 中间件改用 JSON envelope** — `server.go:459,519` 的 `http.Error()` 改为 `writeJSON()` + `errcode.ErrorBody()` | 纯文本 `"unauthorized\n"` 会破坏客户端 JSON 解析 | 30min |
| 1.5 | **edge-server：access_log 生成并注入 request_id** — `access_log.go:40-58` 加 UUID 生成 + `context.WithValue` | edge-server 全链路无 request_id，请求关联完全断裂 | 30min |
| 1.6 | **web vite.config.ts：补全 manualChunks** — 增加 `vendor-tanstack`、`vendor-markdown` 两个 split | web 主包 4.87MB vs desktop 1.66MB，缺失的 chunk split 导致多打包 ~781KB | 15min |
| 1.7 | **迁移 0051：修复 down 脚本** — `0051_audit_indexes.down.sql` 删除的 3 个 UNIQUE 索引改为仅删除 0051 自身创建的非唯一索引 | down 会摧毁 `friendships`、`messages` 表的核心 UNIQUE 约束，不可逆 | 20min |

---

## 2. 本周完成（P1，每项 1-4 小时）

### 2.1 错误处理体系化

| # | 做什么 | 为什么 | 预计耗时 |
|---|--------|--------|----------|
| 2.1a | **hub-server 全量 handler：`err.(*errcode.Error)` → `errors.As(err, &e)`** — 涉及 `handler/agent.go`、`auth.go`、`document.go` 等 ~8 个文件 | 类型断言不解包错误链，service 层 wrap 后 handler 会误判为 ErrInternal | 2h |
| 2.1b | **edge-server MCP tools：24 处 `errors.New()` 替换为 `errcode.Err*` sentinel** — `mcp/tools.go:206-600` | 丢弃了 HTTP 状态码映射和 traceId 机制 | 2h |
| 2.1c | **hub-server middleware/auth.go：3 处 ad-hoc `&errcode.Error{}` 改用 `sharederr.ErrForbidden`** | 自造字面量破坏 `errors.Is` 语义一致性 | 30min |
| 2.1d | **edge-server errcode：补 re-export `ErrUnauthorized`、`ErrForbidden`、`ErrConflict`** | MCP/中间件无可用 sentinel 被迫用 `http.Error()` 或 `errors.New()` | 15min |

### 2.2 日志修复

| # | 做什么 | 为什么 | 预计耗时 |
|---|--------|--------|----------|
| 2.2a | **hub-server：PII 泄露修复** — `oidc.go:204` 的 email 和 name 从 Debug 日志中移除或脱敏 | 即使 Debug 级别也不应记录用户邮箱全量 | 10min |
| 2.2b | **hub-server + edge-server：统一 error key 为 `"error"`** — 修复 ~13 处 `"err"` 异名（`ws.go` 7 处、`agent_team_routing.go` 2 处等） | 两套 key 名导致日志聚合查询漏报 | 1h |
| 2.2c | **edge-server：access_log 字段对齐** — `"remote_addr"` → `"client_ip"`（与 hub-server 和 `pkg/reqlog` 一致） | 字段名不一致破坏跨服务日志看板 | 10min |
| 2.2d | **hub-server GORM adapter：Info/Warn/Error 改用结构化 kv** — `db.go:59,65,71` 的 `fmt.Sprintf` 改为 `slog.Info(msg, "sql", sql, "rows", rows, "elapsed", elapsed)` | 当前把所有字段压缩成一个不透明字符串，无法结构化查询 | 30min |
| 2.2e | **edge-server：access_log 切到 `pkg/reqlog/nethttp.go`** — 删除自造版本，复用已带 request_id 生成+传播的共享实现 | 减少维护 4 份重复 access_log 代码 | 1h |
| 2.2f | **edge-server：slog 开启 `AddSource: true`** — `main.go:109` 加 `&slog.HandlerOptions{AddSource: true}` | edge-server 错误日志无 `source` 字段，无法定位代码行 | 5min |

### 2.3 安全加固

| # | 做什么 | 为什么 | 预计耗时 |
|---|--------|--------|----------|
| 2.3a | **WebSocket：hub-server 加 `SetReadLimit()`、edge-server 设 `ReadBufferSize`** — hub 建议 512KB（适配 agent.stream），edge 建议 64KB | 无帧大小限制，攻击者可发送无限大帧耗尽内存 | 30min |
| 2.3b | **hub-server `processIncoming` 改用 `conn.ReadMessage(ctx)` 替代裸 `conn.W.Read(context.Background())`** | 绕过已有的 60s 读超时保护，半开 TCP 连接导致协程永久泄漏 | 20min |
| 2.3c | **edge-server：移除 auto-generated token 前缀日志** — `server.go:103-105` 删掉 `token_prefix` 字段 | 即使是 Debug 级别也不应记录 Bearer token 片段 | 5min |
| 2.3d | **hub-server + edge-server：`os.Exit(1)` 改为 signal/shutdown** — `wiring.go:223` 和 `server.go:164` | goroutine 内 os.Exit 跳过所有 defer，DB/Redis 连接泄漏 | 1h |

### 2.4 包体积紧急瘦身

| # | 做什么 | 为什么 | 预计耗时 |
|---|--------|--------|----------|
| 2.4a | **移除 devicon + simple-icons 两个图标库** — `shared/package.json` 和 `designIcons.tsx` 从 @lobehub/icons 中找替代或内联 6 个 SVG | 为 6 个图标引入两套完整图标库，浪费 ~150-200KB | 1h |
| 2.4b | **`ModelReasoningPicker.tsx` barrel import 改 subpath import** — 9 个图标从 `@lobehub/icons` 桶导入改为 `/icons/Claude` 等子路径 | barrel 导入 302 个图标，tree-shaking 被击穿 | 30min |
| 2.4c | **合并双份 Prism 高亮器** — 移除 `syntaxHighlight.ts` 的 standalone prismjs，统一用 `react-syntax-highlighter`（已在 Markdown.tsx 中使用） | 两套 Prism + 重复注册 14 种语言语法，浪费 ~50KB | 1h |

---

## 3. 下月推进（P2，架构级改进）

### 3.1 性能优化

| # | 做什么 | 为什么 | 预计耗时 |
|---|--------|--------|----------|
| 3.1a | **修复 N+1 查询：`agent_team_compete.go:235`** — `GetTeamTaskByAssignmentID` 循环内调用改为批量 `WHERE assignment_id IN ?` | 每个 assignment 触发一次独立 DB 查询，N 个 assignment = N 次查询 | 1.5h |
| 3.1b | **`countMatchingRouteDecisions` O(n) 优化** — `agent_team_routing.go:222-246` 把计数逻辑下沉到 SQL `GROUP BY route_pattern` | 全量加载 10000 行 + 逐行 json.Unmarshal，写路径 CPU/内存热点 | 2h |
| 3.1c | **i18n locale JSON 懒加载** — desktop/web 的 `en.json`(108KB) + `zh.json`(104KB) 改为按语言动态 import | 两个语言包全量打进主包，浪费 ~212KB | 2h |
| 3.1d | **edge-server `fireHubStream` 批量合并** — `process_executor.go:1664-1670` 连续 chunk 合并为一个 HTTP 请求 | 每个输出文本块起一个 goroutine + HTTP 调用，高频 agent 产生大量短寿协程 | 2h |
| 3.1e | **WebSocket 开启压缩** — hub 设 `CompressionMode`、edge 设 `EnableCompression: true` | JSON 帧压缩率 3-10x，频繁事件（typing/stream/message）带宽显著下降 | 1h |

### 3.2 工程治理

| # | 做什么 | 为什么 | 预计耗时 |
|---|--------|--------|----------|
| 3.2a | **补全 `api/openapi.yaml` 缺失的 13 个路由** — 含 `/health/*`、`/client/sessions`、`/client/settings`、`/web/documents` CRUD、`/client/team-runs/*/compete-summary`、`/client/team-runs/*/review-decision`、`/web/agent-tasks/:id/regenerate` | 路由已实现但 API 文档零覆盖，新接入方无法集成 | 4h |
| 3.2b | **edge-server `.env.example` 新建** — 覆盖 35+ 个未文档化环境变量（store/runner/fault/evidence/deploy/security/mcp-sync） | 部署时无参考文档，运维靠读源码 | 2h |
| 3.2c | **hub-server + edge-server `.env.example` 补漏** — hub 补 JWT 多密钥轮换、S3、rate_limit、audit_log、compete、edge_url 等 8 个；edge 新建全量 | 共计 ~40 个变量无文档 | 2h |
| 3.2d | **环境变量验证加固** — 布尔型变量严格解析（拒绝 typo 如 `treu`），关键空值变量（`AGENTHUB_DB_PASSWORD`、`AGENTHUB_EDGE_URL`、`AGENTHUB_HUB_URL`）启动时警告 | 当前 typo 静默启用/禁用功能，无提示 | 3h |
| 3.2e | **hub-server：access_log 切到 `pkg/reqlog/gin.go`** — 同 edge 一样，删除自造版复用共享实现 | 减少重复代码，统一行为 | 1h |

### 3.3 TypeScript 严格模式推进

| # | 做什么 | 为什么 | 预计耗时 |
|---|--------|--------|----------|
| 3.3a | **四个包统一加 `noImplicitReturns` + `noFallthroughCasesInSwitch`** — 预计零额外错误 | 低成本，防止隐式返回 undefined 和 switch 穿透 bug | 30min |
| 3.3b | **加 `noImplicitOverride`** — 检查并修复 override 缺失 | 捕获方法签名漂移 | 1h |
| 3.3c | **加 `noUnusedLocals` + `noUnusedParameters`** — ~159 处死代码清理 | 减少代码噪音，发现潜在逻辑错误 | 2h |
| 3.3d | **评估 `noPropertyAccessFromIndexSignature`** — 暂不启用，但为 CSS Module 准备 codemod（`styles.foo` → `styles['foo']`），目标一个月内 desktop/web 启用 | 该单标志产生 96% 增量错误（3316/3462），需工具化迁移 | 4h（含 codemod 脚本） |

### 3.4 数据库迁移修复

| # | 做什么 | 为什么 | 预计耗时 |
|---|--------|--------|----------|
| 3.4a | **补 7 个缺失的 FK 约束** — `workspaces.owner_id`、`delivery_outbox.task_id`、`agent_team_assignments.run_id`、`agent_team_runs.target_id/session_id/trigger_user_id`、`delivery_outbox.edge_device_id` | 核心关联列无引用完整性保护 | 2h |
| 3.4b | **补 5 个缺失索引** — `agent_teams.owner_id`、`agent_team_runs` 的 `team_id`/`status`/`session_id`/`trigger_user_id` | 高频 join 和 filter 列无索引，全表扫描 | 1h |
| 3.4c | **修复 `agent_team_members.agent_profile_id` FK 指向** — 当前指向 `custom_agents` 而非 `agent_profiles`，列名与引用表不匹配 | 语义错误：列名叫 profile 却指向 agents 表 | 1h |
| 3.4d | **删除 `delivery_outbox.delivery_id` 冗余索引** — UNIQUE 已隐含索引，显式 `CREATE INDEX` 多余 | 同一列双索引浪费写性能 | 10min |
| 3.4e | **0051 索引名冲突修复** — `idx_friendships_user_friend` 等 3 个索引改用新名称（如 `idx_friendships_user_friend_status`） | 当前因 IF NOT EXISTS 撞名静默跳过，0051 的意图从未生效 | 30min |

---

## 4. 延迟评估（Nice-to-Have）

### 4.1 架构参考落地

| # | 来源 | 建议 | 收益 | 复杂度 |
|---|------|------|------|--------|
| 4.1a | **OpenHands Microagents** | 引入 `.agenthub/microagents/` 约定：按项目/仓库注入领域专用 agent 行为，trigger-key 匹配即可加载 Markdown prompt | 无需 fork 即可定制 agent 行为 | 中 |
| 4.1b | **Codex app-server protocol v2** | 为 AgentHub 的 WS/NDJSON 流定义版本化、类型化协议（Go stub + TS client 双语言代码生成） | 当前非版本化 WS 协议无法演进 | 高 |
| 4.1c | **Dify 工具提供者注册表** | 插件式 tool-provider registry，按 provider 管理凭据，DDD 边界解耦工具集成与核心编排 | 当前工具硬编码在 orchestrator 中 | 中 |
| 4.1d | **LangGraph 图状态机** | Graph-based 路由 DAG 替代当前 ad-hoc NDJSON 转发 | 路由可观测、可回溯 | 高 |
| 4.1e | **Flowise 可视化画布** | 补充 agent pipeline 配置的 node-graph 视图（chat-first UX 的互补） | 降低复杂 pipeline 配置门槛 | 高 |

### 4.2 体验优化

| # | 做什么 | 为什么 |
|---|--------|--------|
| 4.2a | **edge-server：Upgrader 调大读写缓冲区** — `handlers.go:89` 设 `ReadBufferSize: 8192, WriteBufferSize: 8192` | 当前默认 4096，高吞吐事件流场景偏小 |
| 4.2b | **GORM slow-query 日志 elapsed 改为 `slog.Duration`** — `db.go:86,94` | `fmt.Sprintf("%.3fms")` 是字符串，无法做数值聚合查询 |
| 4.2c | **edge-server `writeJSON` 先 marshal 再写头** — `handlers.go:379` | 当前先写 header 后 encode，失败时响应处于未定义状态 |
| 4.2d | **补 `api/openapi.yaml` 中 ~6 个 underspecified 响应 schema** — `/client/auth/me`、`/api/public/stats` 等 | 响应结构描述为 "User profile." 一句话，无可用 schema |
| 4.2e | **hub-server log 初始化前移** — `wiring.go:63` 的 `log.Init()` 提到 `cmd/main.go` 最开始 | 避免启动早期错误走 Go 默认 text handler，与后续 JSON 格式不一致 |
| 4.2f | **i18n 仅加载当前语言** — 按 Accept-Language 动态选择 en/zh | 当前两个语言包全量打进主包 |
| 4.2g | **`agent_team_compete.go:235` 的 compete summary builder N+1 批量化** — 同 3.1a |

---

## 汇总

| 优先级 | 条目数 | 累计预估工时 |
|--------|--------|-------------|
| P0 快速修复 | 7 | ~3h |
| P1 本周 | 21 | ~15h |
| P2 下月 | 22 | ~28h |
| 延迟 | 13 | — |
| **合计** | **63** | **~46h（P0-P2）** |

**建议执行顺序：**
1. 先做所有 P0（共 7 项，半天），消除 crash 风险和安全漏洞
2. P1 中优先 2.2（日志修复）和 2.3（安全加固），再 2.4（包体积），最后 2.1（错误处理）
3. P2 中优先 3.4（迁移修复，防止下次 migration down 灾难），再 3.2（工程治理），最后 3.1（性能）和 3.3（TS 严格模式）
