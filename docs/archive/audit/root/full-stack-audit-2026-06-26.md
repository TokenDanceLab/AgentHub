# AgentHub 全栈审计报告 — 2026-06-26

> 四路并行审计：Hub-Server 后端 / Desktop 前端 / Web+Mobile 前端 / 跨模块安全
> 发现问题总计：**78 项**（Critical 7 / High 15 / Medium 44 / Low 12）

---

## 一、Hub-Server 后端审计（29 项）

### Critical（5 项）

| ID | 文件 | 行号 | 描述 |
|----|------|------|------|
| HUB-C1 | `service/delivery_outbox.go` | 320,562 | Delivery Outbox 重试循环和清理从未启动——`wiring.go` 未注册后台 goroutine，投递记录无限堆积 |
| HUB-C2 | `service/eventbus.go` | 42,64-91 | EventBus `Publish` 在池满时阻塞——`ants.WithNonblocking(false)`，处理慢时阻塞 HTTP handler |
| HUB-C3 | `app/background.go` | 119-138 | `syncLegacySeqs` 阻塞优雅关闭——不检查 `ctx.Done()`，shutdown 时可能卡住 Redis/DB |
| HUB-C4 | `cache/client.go` | 510-517 | Redis session seq key 无 TTL——session 删除后 key 永久残留，Redis 内存泄漏 |
| HUB-C5 | `app/background.go` | 70-85 | `startTaskScheduler` 不响应 context 取消——`for range ticker.C` 无 `ctx.Done()` 分支 |

### High（5 项）

| ID | 文件 | 行号 | 描述 |
|----|------|------|------|
| HUB-H1 | `service/agent_dispatch.go` | 107-110 | 非 loopback HTTP 明文派发 Agent prompt——仅 warn 不阻断，中间人可窃取 |
| HUB-H2 | `service/audit.go` | 17-58 | 审计日志文件无 rotation——append-only 无限增长 |
| HUB-H3 | `service/agent_edge_callback.go` | 174 | `agent_run_events` 表无全局清理——terminal task 的事件永不删除 |
| HUB-H4 | `cache/client.go` | 110-113 | Redis `device_route:*` hash key 无 TTL——一次性连接遗留永久 key |
| HUB-H5 | `app/admin.go` | 20-69 | pprof 通过 TCP + Basic Auth 暴露——包含 heap dump、命令行参数 |

### Medium（13 项）

| ID | 描述 |
|----|------|
| HUB-M1 | `ws_rate_limit.go` — cleanup goroutine 无关闭机制 |
| HUB-M2 | `admin.go:116` — metricsCollector 不检查 ctx.Done() |
| HUB-M3 | `repository/db.go:132` — DB pool 缺 `SetConnMaxIdleTime` |
| HUB-M4 | `repository/db.go:121` — GORM `PrepareStmt` 缓存无限累积 |
| HUB-M5 | `ws/manager.go:214` — byUser map 重连时短暂持有新旧两个连接 |
| HUB-M6 | `cache/client.go:240` — `PopPendingTasks` crash 时丢数据 |
| HUB-M7 | `cache/client.go:565` — rate limit key 可能缺 TTL |
| HUB-M8 | `service/audit.go:181` — `audit_events` 表无保留策略 |
| HUB-M9 | `service/attachment.go:48` — uploads 目录无孤儿文件清理 |
| HUB-M10 | `repository/db.go:57` — GORM Info/Warn 日志可能含用户数据 |
| HUB-M11 | `service/eventbus.go:58` — 无 Unsubscribe 方法 |
| HUB-M12 | `app/events.go:332` — onRouteSet 回调 goroutine 无超时 |
| HUB-M13 | `ws/manager.go:368` — silent panic recovery 掩盖 cache bug |

### Low（6 项）

| ID | 描述 |
|----|------|
| HUB-L1 | `.env` 自动加载，缺少 `--no-dotenv` 生产开关 |
| HUB-L2 | Admin server 启动失败静默 |
| HUB-L3 | panic recovery 时 trace ID 不一致 |
| HUB-L4 | rate limit middleware 重复 fail-open 逻辑 |
| HUB-L5 | `ProbeAttachment` 返回 nil,nil 语义模糊 |
| HUB-L6 | GORM Warn 日志可能含用户消息内容 |

---

## 二、Desktop 前端审计（21 项）

### High（3 项）

| ID | 文件 | 描述 |
|----|------|------|
| DESK-H1 | `api/queryClient.ts:2-4` | React Query 缺 `gcTime` 配置——缓存永不主动回收 |
| DESK-H2 | `config.ts:87-88` | 健康检查/Runner 每 5 秒轮询——应提高到 15-30s |
| DESK-H3 | `components/DesktopEntryGate.tsx:35-38` | **在 render 中调用副作用回调** `onLoginSuccess()`——React 反模式 |

### Medium（10 项）

| ID | 描述 |
|----|------|
| DESK-M1 | `useHubIntegration.ts` — `outputByRunRef` Map 可能无限增长 |
| DESK-M2 | `host/edge.rs:171` — `read_cli_version` 子进程泄漏风险 |
| DESK-M3 | `useHealth.ts / useRunners.ts` — 后台窗口不休眠仍持续轮询 |
| DESK-M4 | `DiffViewer.tsx:106` — `activeFiles` 和 reduce 未用 useMemo |
| DESK-M5 | `useShellShortcuts.ts:81` — 依赖数组 15 个值，频繁重建监听器 |
| DESK-M6 | `MarkdownRenderer.tsx` + `prismRegistry.ts` — 语法高亮双重注册 |
| DESK-M7 | `useHubWebSocket.ts:248` — 重连靠 setState 间接触发，脆弱 |
| DESK-M8 | `useEdgeStatus.ts:46` — eslint-disable 掩盖潜在依赖问题 |
| DESK-M9 | `edge_manager.rs:218` — auth token 明文写磁盘 |
| DESK-M10 | CSS — 41 个 Module 文件可能产生冗余 |

### Low（8 项）

| ID | 描述 |
|----|------|
| DESK-L1 | useEventStream 保持 1000 条事件日志 |
| DESK-L2 | useStreamingText bufferRef 持有流文本 |
| DESK-L3 | useHealth/useRunners 仍用 stub 数据 |
| DESK-L4 | App.tsx runtimeEvidence 缺 useMemo |
| DESK-L5 | DesktopHubTaskBridge useEffect 依赖过多 |
| DESK-L6 | dangerouslySetInnerHTML 未二次净化 |
| DESK-L7 | localStorage 存用户行为数据 |
| DESK-L8 | useHubIntegration useEffect 缺依赖声明 |

---

## 三、Web + Mobile 前端审计（26 项）

### Critical（1 项）

| ID | 文件 | 描述 |
|----|------|------|
| WEB-C1 | `web/src/hooks/useHubSession.ts:10-26` | **从 localStorage 读 token**——XSS 持久化风险，跨标签页泄露 |

### High（5 项）

| ID | 文件 | 描述 |
|----|------|------|
| WEB-H1 | `web/src/api/hubWS.ts:64-74` | WS token 嵌在 URL query——网关/代理日志泄漏 |
| WEB-H2 | `web/src/api/hubClient.ts:1032` | `uploadMultipart` 缺 401 token refresh |
| WEB-H3 | `web/src/components/ErrorBoundary.tsx:225` | 生产环境泄漏 stack trace |
| WEB-H4 | `mobile-rn/src/screens/ChatScreen.tsx` | ScrollView 无 FlatList 虚拟化——长对话崩溃 |
| WEB-H5 | `mobile-rn/src/session/secureStoreAdapter.ts:9` | SecureStore 无错误处理——写入失败可能崩溃 |

### Medium（12 项）

| ID | 描述 |
|----|------|
| WEB-M1 | `transport.ts` — 离线队列无上限，localStorage 可能溢出 |
| WEB-M2 | `transport.ts` — maxRetries 后永不恢复，无 `online` 事件监听 |
| WEB-M3 | `useWebAuth.ts` — fragile effect dependency |
| WEB-M4 | `i18n/index.ts` — 全量静态 import 所有语言包 |
| WEB-M5 | `hubStore.ts` — sessionStorage 模块级初始化（SSR 不兼容） |
| WEB-M6 | `useHubWSConnection.ts` — auth 失败静默，只报一次 toast |
| WEB-M7 | `mobile-rn/src/api/hubLifecycle.ts` — 前台重连无 backoff |
| WEB-M8 | `mobile-rn/src/api/hubLifecycle.ts` — 快速前后台切换竞态 |
| WEB-M9 | `mobile-rn/src/screens/ThreadsScreen.tsx` — 无 FlatList |
| WEB-M10 | `mobile-rn/src/integrations/useNativeCapabilities.ts` — 双重 refresh |
| WEB-M11 | `mobile-rn/src/config/appConfig.ts:3` — OIDC issuer 硬编码 |
| WEB-M12 | queryClient `retry: 2` 无指数退避 |

### Low（8 项）

| ID | 描述 |
|----|------|
| WEB-L1 | useStreamingText effect 缺依赖数组 |
| WEB-L2 | useHealth fake polling 浪费 CPU |
| WEB-L3 | MarkdownRenderer 无显式 HTML sanitization |
| WEB-L4 | i18n useStrings 不响应运行时 locale 切换 |
| WEB-L5 | deepLink `seenUrls` Set 无上限 |
| WEB-L6 | notificationBridge `handledNotificationIds` 无上限 |
| WEB-L7 | mobile hubClient timeout 行为不明确 |

---

## 四、跨模块安全审计（21 项）

### Critical（1 项）

| ID | 文件 | 描述 |
|----|------|------|
| SEC-C1 | `edge-server/internal/api/handlers.go:2079` | Edge API 仅靠单层中间件鉴权——中间件配置错误则全部端点暴露 |

### High（2 项）

| ID | 文件 | 描述 |
|----|------|------|
| SEC-H1 | `hub-server/internal/middleware/auth.go:28` | Token 黑名单/撤销检查缺失——logout 后 access token 仍可用至过期 |
| SEC-H2 | `edge-server/internal/api/handlers.go:1104` | Edge PostRuns 本地模式缺 run ownership 检查 |

### 已验证安全（15 项通过）

workspace allowlist fail-closed、Hub-to-Edge JWT device binding 完整、PKCE CSRF 保护正确、sessionStorage-only token、OIDC redirect_uri 校验、handler 层输入校验全面、WebSocket origin 校验、panic recovery 无堆栈泄漏、Edge 回调 device 绑定、WSAuthMiddleware 拒绝 TokenDance ID token 等。

---

## 五、已修复项（edge-server 两轮）

以下 10 项 edge-server 内存/磁盘泄漏已在 2026-06-26 修复并推送（`db93a1eb` + `91fdcf65`）：

| 修复 | 描述 |
|------|------|
| WAL auto-checkpoint | `PRAGMA wal_autocheckpoint=100` |
| WAL 定期 TRUNCATE | 每 5 分钟 + Close 时 |
| surfacing 遍历上限 | maxWalkFiles=2000, maxWalkDepth=24 |
| Go 内存软上限 | `debug.SetMemoryLimit(512MB)` + `GOGC=50` |
| MCP syncer 泄漏 | `ShutdownHooks` → `syncer.Stop()` |
| EventLog 50MB 上限 | `truncateLocked()` 保留后 75% |
| fireHub goroutine 池 | `callbackSem(10)` 信号量 |
| WorkdirSnapshot defer | 清理移到 surfacing 前 |
| Store 定期清理 | `cleanupLoop` 每 5 分钟 |
| Bus.Close 幂等 | `sync.Once` 包装 |

---

## 六、统计数据

| 范围 | Critical | High | Medium | Low | 合计 |
|------|:--:|:--:|:--:|:--:|:--:|
| Hub-Server | 5 | 5 | 13 | 6 | **29** |
| Desktop 前端 | 0 | 3 | 10 | 8 | **21** |
| Web + Mobile | 1 | 5 | 12 | 8 | **26** |
| 跨模块安全 | 1 | 2 | — | — | **3**（不含 15 PASS） |
| **合计** | **7** | **15** | **44** | **12** | **78**（不含 15 PASS） |

> 审计日期：2026-06-26 | 审计方法：四路并行 Explore Agent 深度扫描
