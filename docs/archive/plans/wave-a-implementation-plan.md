# Wave A 快速修复实施计划

> 分支：`fix/wave-a-quick-fixes` | 工作树：`.worktrees/wave-a-quick-fixes`
> 来源：全栈审计报告 `docs/audit/full-stack-audit-2026-06-26.md`
> 原则：每项独立 commit、单文件改动、最小化修改、改完即验证

---

## 前置要求

```bash
cd D:\Code\TokenDance\AgentHub\.worktrees\wave-a-quick-fixes
```

每完成一项：`git add <文件> && git commit -m "<message>"`

---

## Hub-Server（8 项）

### FIX-01: Redis session seq key 加 TTL
- **文件**：`hub-server/internal/cache/client.go`
- **行号**：~516（`SetNX` 调用附近）
- **改动**：把 `SetNX(ctx, key, "0", 0)` 的 `0` 改为 `30 * 24 * time.Hour`
- **原因**：HUB-C4 — session 删除后 seq key 永久残留，Redis 内存泄漏
- **验证**：`cd hub-server && go build ./...`
- **Commit**：`fix(hub): Redis session seq key 添加 30 天 TTL 防止泄漏`

### FIX-02: TaskScheduler 响应 context 取消
- **文件**：`hub-server/internal/app/background.go`
- **行号**：~74（`for range ticker.C`）
- **改动**：把 `for range ticker.C {` 改为 `for { select { case <-ticker.C: ... case <-ctx.Done(): return } }`
- **原因**：HUB-C5 — shutdown 时 goroutine 继续运行直到下一次 tick
- **验证**：`cd hub-server && go build ./...`
- **Commit**：`fix(hub): taskScheduler 响应 context 取消，防止 shutdown 泄漏`

### FIX-03: 明文 HTTP dispatch 拒绝非 loopback
- **文件**：`hub-server/internal/service/agent_dispatch.go`
- **行号**：~107-110
- **改动**：把 `slog.Warn(...)` 改为 `return fmt.Errorf("non-loopback HTTP dispatch without TLS is not allowed")`
- **原因**：HUB-H1 — Agent prompt 明文传输，中间人可窃取
- **验证**：`cd hub-server && go build ./... && go test ./internal/service/ -short -count=1 -timeout 60s`
- **Commit**：`fix(hub): 拒绝非 loopback 明文 HTTP 派发，防止 Agent prompt 泄漏`

### FIX-04: Redis device_route key 加 TTL
- **文件**：`hub-server/internal/cache/client.go`
- **行号**：~110-113（`SetRoute` 函数）
- **改动**：`HSet` 之后立即 `Expire(ctx, key, 7*24*time.Hour)`
- **原因**：HUB-H4 — 一次性连接遗留永久 key
- **验证**：`cd hub-server && go build ./...`
- **Commit**：`fix(hub): Redis device_route key 添加 7 天 TTL`

### FIX-05: ws_rate_limit cleanup goroutine 可关闭
- **文件**：`hub-server/internal/middleware/ws_rate_limit.go`
- **行号**：~35-36（`init()` 函数），~57-70（`cleanup()` 方法）
- **改动**：新增 `stopCh chan struct{}` 字段 + `Stop()` 方法，`cleanup()` 中 `select` 监听 `stopCh`。在 `init()` 中启动。如果调用方不调用 `Stop()` 也没关系——只是不能被测试中 clean up
- **原因**：HUB-M1 — goroutine 永远运行
- **验证**：`cd hub-server && go build ./...`
- **Commit**：`fix(hub): ws_rate_limit cleanup goroutine 可关闭`

### FIX-06: metricsCollector 响应 context 取消
- **文件**：`hub-server/internal/app/admin.go`
- **行号**：~116-136（`startMetricsCollector` 函数中的 `for range ticker.C`）
- **改动**：同 FIX-02，改为 select + ctx.Done()
- **原因**：HUB-M2
- **验证**：`cd hub-server && go build ./...`
- **Commit**：`fix(hub): metricsCollector 响应 context 取消`

### FIX-07: DB pool 加 SetConnMaxIdleTime
- **文件**：`hub-server/internal/repository/db.go`
- **行号**：~132-134（`SetConnMaxLifetime` 之后）
- **改动**：新增 `db.SetConnMaxIdleTime(5 * time.Minute)`
- **原因**：HUB-M3 — 空闲连接只在 MaxLifetime 后才关闭
- **验证**：`cd hub-server && go build ./...`
- **Commit**：`fix(hub): DB pool 添加 SetConnMaxIdleTime 5 分钟`

### FIX-08: rate limit key TTL 原子化
- **文件**：`hub-server/internal/cache/client.go`
- **行号**：~565-579（`CheckRateLimit` 函数）
- **改动**：把 `Incr` + 条件 `Expire` 两次调用改为 Lua 脚本或 pipeline 原子执行。最简单方案：`Incr` 后总是 `Expire`（覆盖已有的 expiry 也没关系）
- **原因**：HUB-M7 — crash 时 key 永久残留
- **验证**：`cd hub-server && go build ./...`
- **Commit**：`fix(hub): rate limit key 无条件设 TTL 防止 crash 残留`

---

## Web 前端（5 项）

### FIX-09: 删除 localStorage token fallback
- **文件**：`app/web/src/hooks/useHubSession.ts`
- **行号**：~10-26（`getWebHubToken` 函数）
- **改动**：删除 `localStorage` 相关回退逻辑，只保留 `sessionStorage`。函数改为只读 sessionStorage 即可
- **原因**：WEB-C1 — XSS 持久化 token 泄漏
- **验证**：`cd app/web && corepack pnpm typecheck`
- **Commit**：`fix(web): 删除 localStorage token fallback，仅用 sessionStorage`

### FIX-10: ErrorBoundary 生产环境隐藏堆栈
- **文件**：`app/web/src/components/ErrorBoundary.tsx`
- **行号**：~225-234（渲染 error.stack 的 `<details>` 块）
- **改动**：用 `{import.meta.env.DEV && (<details>...</details>)}` 包裹
- **原因**：WEB-H3 — 生产泄漏文件路径和组件层级
- **验证**：`cd app/web && corepack pnpm typecheck`
- **Commit**：`fix(web): ErrorBoundary 仅 DEV 模式显示堆栈`

### FIX-11: uploadMultipart 加 401 token refresh
- **文件**：`app/web/src/api/hubClient.ts`
- **行号**：~1032-1072（`uploadMultipart` 函数）
- **改动**：参照同文件 `request()` 的 401 处理逻辑（~922-983 行），在 `uploadMultipart` 中加相同的 refresh + retry 一次逻辑
- **原因**：WEB-H2 — token 过期后上传直接失败
- **验证**：`cd app/web && corepack pnpm typecheck`
- **Commit**：`fix(web): uploadMultipart 支持 401 token refresh 重试`

### FIX-12: WebSocket token 改用 auth frame
- **文件**：`app/web/src/api/hubWS.ts`
- **行号**：~64-74（`withAccessToken` 函数）
- **注意**：这项可能需要同时改服务端。如果服务端不支持 connect-then-auth，则**跳过此项**，标注为 "HUB 需先支持 auth-frame 握手"
- **验证**：先确认 `hub-server/internal/handler/ws.go` 是否支持 connect 后发 auth frame。如果支持（`handleAuthFrame` 函数存在），则改前端
- **Commit**：`fix(web): WS token 改用 auth frame 而非 URL query（如服务端支持）`

### FIX-13: 轮询降频 + 后台暂停
- **文件**：`app/web/src/hooks/useHealth.ts`
- **改动**：把 `HEALTH_POLL_MS` 从 5000 改为 30000。如果函数内部是 stub 数据（不发真实请求），直接删掉 `setInterval`，改用静态值
- **原因**：WEB-L2 — 每 5 秒 fake 轮询浪费 CPU
- **验证**：`cd app/web && corepack pnpm typecheck`
- **Commit**：`fix(web): useHealth 移除 fake 轮询（stub 数据无需轮询）`

---

## Desktop 前端（5 项）

### FIX-14: DesktopEntryGate render 副作用移入 useEffect
- **文件**：`app/desktop/src/components/DesktopEntryGate.tsx`
- **行号**：~35-38
- **改动**：把 `if (user) { onLoginSuccess(); return null; }` 从函数体移入 `useEffect(() => { if (user) onLoginSuccess(); }, [user])`，函数体改为 `if (user) return null`
- **原因**：DESK-H3 — React 反模式，并发模式下可能双重调用
- **验证**：`cd app/desktop && pnpm typecheck`
- **Commit**：`fix(desktop): DesktopEntryGate onLoginSuccess 从 render 移入 useEffect`

### FIX-15: React Query 加 gcTime
- **文件**：`app/desktop/src/api/queryClient.ts`
- **行号**：~2-4
- **改动**：在 `defaultOptions.queries` 中加 `gcTime: 5 * 60 * 1000`（5 分钟）
- **原因**：DESK-H1 — 缓存永不主动回收
- **验证**：`cd app/desktop && pnpm typecheck`
- **Commit**：`fix(desktop): React Query 添加 gcTime 5 分钟`

### FIX-16: 健康检查/Runner 轮询降频
- **文件**：`app/desktop/src/config.ts`
- **行号**：~87-88
- **改动**：`HEALTH_POLL_MS` 从 5000 → 30000，`RUNNERS_POLL_MS` 从 5000 → 30000
- **原因**：DESK-H2 — Desktop 后台不休眠持续消耗 CPU/网络
- **验证**：`cd app/desktop && pnpm typecheck`
- **Commit**：`fix(desktop): 健康检查/Runner 轮询从 5s 降为 30s`

### FIX-17: useHealth/useRunners 后台暂停轮询
- **文件**：`app/desktop/src/hooks/useHealth.ts` + `app/desktop/src/hooks/useRunners.ts`
- **改动**：在 `useEffect` 中监听 `document.visibilitychange`，不可见时 `clearInterval`，可见时重新开始
- **原因**：DESK-M3 — Tauri 桌面应用切到后台仍持续轮询
- **验证**：`cd app/desktop && pnpm typecheck`
- **Commit**：`fix(desktop): useHealth/useRunners 页面不可见时暂停轮询`

### FIX-18: read_cli_version 子进程泄漏
- **文件**：`app/desktop/src-tauri/src/host/edge.rs`
- **行号**：~196（`Err(_) => return None` 分支）
- **改动**：在 `return None` 前加 `let _ = child.kill(); let _ = child.wait();`
- **原因**：DESK-M2 — try_wait 失败时子进程未被回收
- **验证**：`cd app/desktop/src-tauri && cargo check`
- **Commit**：`fix(desktop): read_cli_version 错误路径 kill 子进程`

---

## 实施顺序

按模块分组、同模块无依赖的可以并行：

```
Hub-Server:   FIX-01 → FIX-02 → FIX-03 → FIX-04 → FIX-05 → FIX-06 → FIX-07 → FIX-08
               (这些互不依赖，可以任意顺序)
Web:          FIX-09 → FIX-10 → FIX-11 → FIX-12 → FIX-13
               (FIX-12 可能跳过，其余无依赖)
Desktop:      FIX-14 → FIX-15 → FIX-16 → FIX-17 → FIX-18
               (互不依赖，任意顺序)
```

## 验证总成

全部改完后运行：

```bash
# Go 后端
cd hub-server && go build ./... && go test ./... -short -count=1 -timeout 120s
cd edge-server && go build ./...

# 前端
cd app/desktop && pnpm typecheck
cd app/web && corepack pnpm typecheck

# Rust
cd app/desktop/src-tauri && cargo check

# Git
git diff --check
git status --short --branch
```

## 提交模板

```
fix(<scope>): <中文描述>

<来源审计 ID> — <一句话原因>
```

示例：
```
fix(hub): Redis session seq key 添加 30 天 TTL 防止泄漏

HUB-C4 — session 删除后 seq key 永久残留，Redis 内存泄漏
```
