# Desktop Edge / Web Hub 对接计划

> 日期：2026-06-07
> 前置状态：Desktop/Web v4 shared workbench 主入口和平台边界冻结；视觉细节、交互 smoke 和生产 facade 仍在收口。旧 UI 不再作为 active path。
> 目标：在不污染 shared UI 的前提下，把 Desktop/Tauri + Local Edge、Web + Hub 的生产对接边界做干净。

## 目标架构

```text
Desktop 5173
  -> app/desktop/src/platform/DesktopRuntimeFacade
  -> Tauri Host API
       edge/fs/dialog/auth/window/system
  -> Local Edge REST + WebSocket
  -> Edge lifecycle + Agent Runtime adapters

Web 5174
  -> app/web/src/platform/WebRuntimeFacade
  -> Hub REST + WebSocket
  -> Hub sessions/messages/agent-tasks
  -> Edge target routing / relay

Shared UI
  -> @agenthub/shared platform ports only
  -> no Tauri import
  -> no direct Edge/Hub URL
```

核心原则：

1. `app/shared` 只定义 UI、contract 和 platform ports，不知道 Tauri、Edge URL、Hub URL 或 token 存储细节。
2. Desktop 的本机能力只在 `app/desktop/src/platform` 和 `app/desktop/src-tauri/src/host` 内出现。
3. Web 只对接 Hub，不重新直连 Local Edge，不持有本机文件系统能力。
4. Edge 是本地执行权威；Hub 是账号、云端 IM、多端同步、远程中继和审计权威。
5. 旧客户端 stores/hooks 只能作为迁移素材，不得恢复为 v4 主状态源。

## 当前链路

### Desktop

- `app/desktop/src/App.tsx` 已是薄入口：`useDesktopWorkbenchModel()` + `useCreateRun()` + `createDesktopPlatform()`。
- `useDesktopWorkbenchModel()` 读取 Edge threads/items/pins，并用 shared normalizer 投影 transcript。
- `useDesktopEdgeEvents()` 订阅 Edge `/v1/events`，按 active thread 过滤 live event，再投影 shared transcript。
- `createDesktopPlatform()` 已提供 `runs.submitComposerIntent()`、`attachments.pickFiles()` 和 `preview.openEvidence()`。
- `main.tsx` 启动前通过 Tauri `get_edge_auth_token` 注入 runtime Edge token。
- Tauri `EdgeManager` 已支持 sidecar/direct 启动 Local Edge。

### Web

- Web v4 使用同一 shared workbench。
- Web platform 走 Hub sessions/messages/agent profiles/agent tasks。
- Web 不应导入 Tauri，不应调用 Local Edge。

### Edge

- Edge REST authoritative contract 在 `api/openapi.yaml`。
- Edge WebSocket event contract 在 `api/events.md`。
- Edge server 当前拥有 `/v1/health`、threads/items/runs、agents、model catalog、permissions、events 等 P0 面。
- Edge workspace allowlist 已在 handler 层 fail-closed；Desktop host 文件/git/search 侧还需要同等收口。

## 旧客户端遗留清理边界

完整清单见 [v4-legacy-client-inventory-2026-06-07.md](v4-legacy-client-inventory-2026-06-07.md)。本节只保留生产对接必须遵守的边界。

| 类型 | 当前处理 |
|---|---|
| 旧 `ChatView/PromptInput/RunDetail/ThreadPanel` | 不得恢复 active path |
| 旧 `useChatMessages/useIMChat` | 不得作为 v4 state source |
| Zustand run/thread/chat stores | 只允许迁移非服务端 UI 偏好；服务端状态走 TanStack Query + event invalidation |
| 旧 `RunDetail*` 命名 | 继续收敛为 `RunEvidence*` / `EvidenceRef` |
| `showRunDetail/hideRunDetail` 等旧 i18n 文案 | 在 active UI 外继续清理，不能驱动新功能命名 |
| `workbenchDemoRuntimeStore` fallback | 只用于 demo/preview/未登录空态，不能掩盖 normal mode 真实提交失败 |
| `commands.rs` 巨石能力 | 拆成 host modules；新能力禁止继续写进巨石文件 |

## 目标文件边界

### Shared

| 文件 | 职责 |
|---|---|
| `app/shared/src/platform/types.ts` | UI 可见 platform ports，保持平台无关 |
| `app/shared/src/transcript/*` | Edge/Hub runtime/message 到 `TranscriptBlock` 的归一化合同 |
| `app/shared/src/inspector/*` | `EvidenceRef` 聚合和 preview model |
| `app/shared/src/workbench/*` | 只消费 platform ports 和 shared contracts |

### Desktop TypeScript

| 文件 | 职责 |
|---|---|
| `app/desktop/src/platform/desktopHost.ts` | Tauri invoke typed wrapper，统一 command 名、参数、错误 |
| `app/desktop/src/platform/localEdgeRuntime.ts` | 组合 Edge status/auth/start/health、REST client、WS stream |
| `app/desktop/src/platform/desktopWorkbenchModel.ts` | 把 Local Edge snapshot/live events 投影为 shared workbench model |
| `app/desktop/src/platform/desktopPlatform.ts` | 实现 shared `AgentHubPlatform` ports，不直接写业务查询逻辑 |
| `app/desktop/src/api/*` | Edge REST/WS typed client；保留 zod 校验、auth、query helpers |

### Desktop Tauri

| 文件 | 职责 |
|---|---|
| `app/desktop/src-tauri/src/host/edge.rs` | Edge start/stop/status/auth token/health |
| `app/desktop/src-tauri/src/host/fs.rs` | 文件读写、目录树、复制、移动、删除、统一 allowlist |
| `app/desktop/src-tauri/src/host/git.rs` | git status/diff，必须限制在 workspace root |
| `app/desktop/src-tauri/src/host/search.rs` | rg/grep 搜索，必须限制在 workspace root |
| `app/desktop/src-tauri/src/host/auth.rs` | OIDC loopback + keyring session |
| `app/desktop/src-tauri/src/host/window.rs` | tray/window/notification/open external |
| `app/desktop/src-tauri/src/host/system.rs` | 诊断、平台信息、路径发现 |
| `app/desktop/src-tauri/src/commands.rs` | 注册和兼容 shim；不再承载业务逻辑 |

### Web

| 文件 | 职责 |
|---|---|
| `app/web/src/platform/webPlatform.ts` | 实现 shared platform ports，提交 Hub message/task |
| `app/web/src/platform/useWebWorkbenchModel.ts` | Hub sessions/messages/live events 到 shared workbench model |
| `app/web/src/platform/webHubRealtime.ts` | Hub WS query invalidation + runtime event append |
| `app/web/src/api/*` | Hub REST/WS typed client，不出现 Local Edge 连接 |

## 分阶段实施

### Phase 0：冻结边界和旧债清单

- 更新 roadmap/architecture 指向本计划。
- 给旧客户端遗留路径建立清单，标注 delete/migrate/keep；当前清单为 [v4-legacy-client-inventory-2026-06-07.md](v4-legacy-client-inventory-2026-06-07.md)。
- 保持 `verify-v4-old-ui-active-paths.ps1` 为合并门禁。

验证：

```powershell
.\scripts\verify-v4-old-ui-active-paths.ps1
git diff --check
```

### Phase 1：Desktop Runtime Facade

- 新增 `desktopHost.ts`，封装 `get_edge_status/get_edge_auth_token/start_edge/stop_edge/read_file` 等 invoke。
- 新增 `localEdgeRuntime.ts`，统一 Edge token、base URL、health、REST/WS factory。
- 把 `main.tsx` 的 token hydration 迁到 runtime facade 初始化路径。
- 保持 `edgeClient.ts` 继续作为 typed REST client，不把 UI hook 直接绑到 fetch。

验证：

```powershell
cd app\desktop; corepack.cmd pnpm exec vitest run src\platform\desktopPlatform.test.ts --reporter=dot
cd app\desktop; corepack.cmd pnpm typecheck
```

### Phase 2：Tauri Host API 拆分

- 建立 `src-tauri/src/host/mod.rs`。
- 先迁移 `edge.rs`，保留 command 名不变，减少前端改动。
- 再迁移 `fs.rs/git.rs/search.rs`，统一 path canonicalization、allowlist、typed error。
- `commands.rs` 只留薄 shim。

Rust 侧必须覆盖：

- path 不存在时的 parent canonicalization。
- symlink 越界。
- allowlist 空时危险操作 fail-closed。
- git/search 目录越界。
- Edge already running / not running 错误。

验证：

```powershell
cd app\desktop\src-tauri; cargo test
cd app\desktop; corepack.cmd pnpm typecheck
```

### Phase 3：Edge Snapshot + Event 恢复策略

- 明确 REST snapshot 是恢复权威，WS 只投递实时事件。
- WS 断线重连后根据 cursor replay；gap/error 时 invalidate `threads/runs/threadItems/threadPins`。
- active thread 切换时清 live buffer，避免跨会话串流。
- run submit 成功后更新 run cache，并等待 event stream 投影 transcript。

验证：

```powershell
cd app\desktop; corepack.cmd pnpm exec vitest run src\__tests__\eventClient.test.ts src\__tests__\runQueries.test.ts src\__tests__\threadQueries.test.tsx --reporter=dot
```

### Phase 4：Web Hub Runtime Facade

- 确认 `webPlatform.ts` 的 submit 只走 Hub `sendMessage` 和 `/web/agent-tasks`。
- Hub WS 只做 query invalidation 和 live runtime block append。
- 未登录使用 demo fallback；已登录无 session 显示 Hub 空态，不能假提交。
- 加强 `verify-web-hub-boundary.ps1`，防止 Web 重新 import Local Edge/Tauri；当前脚本已扫描 TS/TSX/JS/JSX/JSON，禁止 Local Edge loopback、`/v1/events`、`/v1/runs`、Tauri/Desktop runtime 引用和 Local Edge 用户可见文案，并断言 Web platform 不声明本地能力。
- Web OIDC `device_type` 固定为 `web`；Desktop/Tauri OIDC 分支必须留在 Desktop 包，不进入 `app/web`。

验证：

```powershell
.\scripts\verify-web-hub-boundary.ps1
cd app\web; corepack.cmd pnpm exec vitest run src\platform\webPlatform.test.ts src\platform\useWebWorkbenchModel.test.ts src\platform\webHubRealtime.test.ts --reporter=dot
cd app\web; corepack.cmd pnpm typecheck
```

最新验证：

- 2026-06-07：`.\scripts\verify-web-hub-boundary.ps1` 15/15 passed。
- 2026-06-07：`cd app\web; corepack.cmd pnpm exec vitest run src\api\hubAuth.test.ts src\platform\webPlatform.test.ts --reporter=dot`，2 文件 / 14 测试通过。
- 2026-06-07：`cd app\web; corepack.cmd pnpm typecheck` 通过。

### Phase 5：端到端 smoke

Desktop local smoke：

```powershell
cd edge-server
go run ./cmd/agenthub-edge --addr 127.0.0.1:3210 --runner-profile agenthub-runner-mock
```

另一个终端：

```powershell
cd app\desktop
corepack.cmd pnpm dev -- --host 127.0.0.1 --port 5173
```

验收：

- 5173 能读取 Edge health。
- 5173 能读取 thread list。
- 发送消息能创建 run 或在 demo mode 明确走 demo。
- run events 能进入 transcript 和 inspector。
- Edge token 开启时 REST bearer 和 WS `access_token` 均可用。

Web Hub smoke：

- 5174 未登录只显示 preview/demo。
- 登录态读取 Hub sessions/messages。
- @Agent submit 先确保 session agent instance，再创建 task。
- Hub WS event 能触发 query invalidation。

## 风险

| 风险 | 处理 |
|---|---|
| `commands.rs` 继续增长 | 新能力只进 `host/*`，PR review 阻断巨石继续扩写 |
| Web 误连 Local Edge | `verify-web-hub-boundary.ps1` 加强 import/path 扫描 |
| Desktop host 文件能力越权 | allowlist fail-closed，Rust path/symlink tests |
| WS 和 REST 双写导致竞态 | REST snapshot 权威；WS 只追加 live buffer 和 invalidate |
| demo fallback 掩盖真实错误 | data mode 显式化：demo/auto/normal；normal 下失败必须可见 |
| 后端/移动端并行改动混进 UI PR | 合并前按 `v4-merge-pr-readiness-2026-06-07.md` 分类确认 |

## 后续完成定义

达到生产对接完成时必须满足：

- shared UI 不含 Tauri/Edge/Hub transport 细节。
- Desktop 通过 runtime facade 对接 Tauri host + Local Edge。
- Web 通过 runtime facade 对接 Hub。
- `commands.rs` 不再承载业务逻辑。
- Desktop/Web typecheck 和 focused platform tests 通过。
- 旧 UI active path 扫描通过。
- PR 描述明确哪些是已完成 UI 冻结，哪些是后续生产接入。
