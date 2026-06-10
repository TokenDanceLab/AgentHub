# Feature Reality Check — 2026-06-10

> 对最近实现的 AgentHub 功能进行无情的可用性审计。
> 每个 feature 标注状态、具体问题、修复评估。

## 审计结果总表

| # | Feature | Status | 修复时长 |
|---|---------|--------|---------|
| 1 | AgentMemory System | ⚠️ PARTIAL | > 30 min |
| 2 | Anthropic SDK Adapter | ✅ WORKS | — |
| 3 | OpenAI SDK Adapter | ✅ WORKS | — |
| 4 | Diff Apply Writeback | ✅ WORKS | — |
| 5 | RunEvent Replay | ✅ WORKS | — |
| 6 | Surfacing Auto-Promote | ⚠️ PARTIAL | > 30 min |
| 7 | Preview Components | ✅ WORKS | — |
| 8 | Skill/MCP Market | 👻 GHOST | > 30 min |

---

## 1. AgentMemory System

**Status: ⚠️ PARTIAL** — 后端读写链路完整且被调用；前端 API endpoint 和 UI 编辑器缺失。

### 已验证可用

- `ReadMemory()` 和 `BuildMemoryPrompt()` 实现完整，有单元测试（`memory_test.go` 共 12+ 测试用例）
- **实际被调用**：`handlers.go:1171` 在 `POST /v1/runs` 处理中调用 `runnerctx.BuildMemoryPrompt(req.WorkDir, req.ThreadID, req.AgentID)`，将结果拼入 `runCtx.SkillsPrompt`
- 磁盘格式设计合理：`.agenthub/memory/` 目录下的 YAML frontmatter + Markdown 文件
- 前端 `MemoryFileManager.ts` 提供完整的序列化/反序列化工具函数

### 具体问题

1. **无 REST API endpoint 暴露 memory 读写**
   - `openapi_contract_test.go:72` 标注 `/v1/projects/{projectId}/memory` 为 `"planned"`
   - 没有 `GET /v1/memory` 或 `POST /v1/memory` handler
   - 前端无法通过 API 读写 memory 内容
   - Memory 只能通过直接操作文件系统（手动创建 `.agenthub/memory/project.md`）才能生效

2. **前端无 Memory 编辑 UI**
   - `app/shared/src/memory/` 只有 types 和 MemoryFileManager（序列化工具）
   - 没有 Memory 编辑面板、查看器或管理页面组件
   - 用户无法从 UI 创建、查看或编辑 memory 条目

3. **前端 hubClient 缺少 memory API 调用方法**
   - `hubClient.ts` 没有 `readMemory()` / `writeMemory()` 方法

### 修复评估

- 需要：Edge handler（`GET/POST /v1/memory`）+ 前端编辑面板组件 + hubClient 方法
- 估计 > 30 min（涉及新 API endpoint + UI 组件）

---

## 2. Anthropic SDK Adapter

**Status: ✅ WORKS** — 完整实现，已注册，SSE 解析正确。

### 已验证

- **在 `main.go:475` 注册**：`adapters.NewAnthropicSDKAdapter(apiKey, cfg.AgentModel)`
- `ParseStream()` 通过 `http.NewRequestWithContext` 直接调用 Anthropic Messages API（`POST /v1/messages`）
- SSE 流解析完整：
  - `message_start` → `BusEventStatusChange`
  - `content_block_delta.text_delta` → `BusEventTextDelta`
  - `content_block_delta.thinking_delta` → `BusEventThinking`
  - `content_block_stop` → `BusEventTextBlock` / `BusEventToolCall`
  - `message_stop` → `BusEventContextUsage` + `BusEventResult`
  - `error` → `BusEventResult` (failure)
- 使用 `sdkNoopCommand()` 返回无害的 no-op 命令，实际工作在 `ParseStream` HTTP 中完成
- `ANTHROPIC_BASE_URL` 环境变量支持代理/proxy
- Thinking mode（budget tokens）支持

### 已知小问题（不影响可用性）

- `buildMessages()` 中 `if role == "assistant" { role = "assistant" }` 是冗余的恒等赋值（已被 cross-review 标记）
- 每个请求创建新的 `http.Client`（性能可优化，非功能性 bug）

---

## 3. OpenAI SDK Adapter

**Status: ✅ WORKS** — 完整实现，已注册，SSE 解析正确。

### 已验证

- **在 `main.go:484` 注册**：`adapters.NewOpenAISDKAdapter(apiKey, cfg.AgentModel)`
- `ParseStream()` 调用 OpenAI Chat Completions API（`POST /v1/chat/completions`）
- SSE 流解析完整：
  - `delta.content` → `BusEventTextDelta`
  - `delta.reasoning_content` → `BusEventThinking`（o-series 模型）
  - `delta.tool_calls` → `BusEventToolCall`（含参数累积器）
  - `finish_reason` + `usage` → `BusEventContextUsage` + `BusEventResult`
- System prompt 正确合并（system + append_system + skills）
- `OPENAI_BASE_URL` 环境变量支持代理
- Reasoning effort 和 structured output schema 支持

---

## 4. Diff Apply Writeback

**Status: ✅ WORKS** — 完整实现，已挂载路由，有路径安全校验。

### 已验证

- **路由已挂载**：`handlers.go:1766` 检测 `/v1/runs/{runId}/apply`，`handlers.go:1772` 检测 `/v1/runs/{runId}/apply-all`
- `PostApplyRunDiff()` 和 `PostApplyAllRunDiffs()` 实现完整
- **实际修改磁盘文件**：`applyHunkToFile()` → `os.ReadFile` → `applyHunkToContent()` → `os.WriteFile`
- **Workspace allowlist 校验**：`validateWorkDirAllowed()` 对每个请求调用（fail-closed：空 allowlist 拒绝所有）
- **路径逃逸防护**：`isPathWithin()` 检查 target 不逃出 workDir
- **备份机制**：`createBackup()` 在修改前创建 `.bak` 文件
- **新建文件支持**：`createNewFileFromHunk()` 处理文件不存在的情况
- Unified diff 解析和 hunk 应用逻辑完整

### 小注意事项

- `applyHunkToContent` 使用简单的 prefix/suffix 对齐，对复杂多 hunk 交错修改可能有 corner case
- 1MB 请求体限制（`io.LimitReader`）

---

## 5. RunEvent Replay

**Status: ✅ WORKS** — 完整的 WS 断线重连 + 事件回补链路。

### 已验证链路

1. **前端 WS 实时事件**：`webHubRealtime.ts` 订阅 Hub WS，在 `onAuthSuccess` 回调中触发 replay
2. **事件序号追踪**：`trackEventSeq()` 在每个 agent WS 事件中提取 `event_seq`，存入 `useConnectionStore.lastEventSeq`
3. **连接状态存储**：`connectionStore.ts` 提供 `lastEventSeq`、`recoveryState`、`recoveryError` 状态管理
4. **回补请求**：`replayMissedEvents()` 调用 `hubClient.listTaskRunEventsAfter(taskId, lastSeq)` → `GET /web/agent-tasks/{id}/events?after_seq={seq}&limit=500`
5. **Hub 侧 endpoint**：`hub-server/internal/handler/agent.go:210` `TaskEvents` handler 支持 `after_seq` 查询参数
6. **Hub 路由注册**：`router.go:216` `web.GET("/agent-tasks/:id/events", agentHandler.TaskEvents)`
7. **回补后状态更新**：replay 成功后更新 `lastEventSeq` 和 `recoveryState`

### 连接链路完整度

- WS auth → trackSeq → disconnect → reconnect → onAuthSuccess → replayMissedEvents → REST API → 事件注入
- 所有环节都有代码实现，且 `webHubRealtime.ts` 是 web 工作台的实际入口

---

## 6. Surfacing Auto-Promote

**Status: ⚠️ PARTIAL** — 后端检测和 emit 链路完整；前端不消费 surfaced 事件。

### 已验证后端可用

- **快照采集**：`process_executor.go:459` 在 run 启动时调用 `TakeWorkdirSnapshot(workDir)`
- **完成后检测**：`process_executor.go:1103` 在 finish 时调用 `SurfaceAndEmit(e.bus, writer, snapshot, current)`（仅对 status=finished 的 run）
- **事件发布**：`SurfaceAndEmit()` 通过 `bus.Publish()` 发布 4 种事件：
  - `BusEventSurfacedArtifact` (run.agent.surfaced_artifact)
  - `BusEventSurfacedPreview` (run.agent.surfaced_preview)
  - `BusEventSurfacedDiff` (run.agent.surfaced_diff)
  - `BusEventSurfacedDeploy` (run.agent.surfaced_deploy)
- **Store 持久化**：`UpsertArtifact`、`UpsertPreview`、`UpsertRunDiffFile` 将结果写入 store
- **Edge WS 转发**：Edge `GetEvents` handler 通过 `Bus.Subscribe()` 订阅所有 bus 事件，surfaced 事件会推送给所有 WS 客户端

### 具体问题

1. **前端不识别 surfaced 事件类型**
   - 在整个 `app/` 目录中搜索 `surfaced_artifact`/`surfaced_preview`/`surfaced_diff` → **零匹配**
   - 前端 event handler（`webHubRealtime.ts`、`transcript` 模块）不处理这些事件
   - 即使 Edge 正确 emit 了 surfaced 事件，前端收到后也会被丢弃

2. **Hub 不转发 surfaced 事件**
   - Hub 的 Edge 协议处理器只处理 `run.agent.*` 事件写入 `agent_run_events` 表
   - `surfaced_*` 事件不匹配 Hub 已知的 event_type，不会写入数据库或通过 WS 推送给 Web 客户端
   - Surfaced 事件只在 Desktop（直连 Edge WS）场景可达前端

3. **前端 transcript 无渲染**
   - 没有 surfaced artifact/preview/diff 的 transcript card 渲染器

### 修复评估

- 需要：前端 transcript card 渲染 + Hub Edge 协议事件映射 + Web 前端事件处理
- 估计 > 30 min

---

## 7. Preview Components

**Status: ✅ WORKS** — 4 个预览组件全部实现，已在 RightInspector 和 FilePreviewRouter 中挂载。

### 已验证

- **依赖已安装**：`app/shared/package.json` 包含 `jszip ^3.10.1`、`mammoth ^1.12.0`、`xlsx ^0.18.5`
- **组件存在**：
  - `SlideshowPreview.tsx`（.pptx/.ppt → JSZip + XML 解析）
  - `TablePreview.tsx`（.xlsx/.xls/.csv → SheetJS）
  - `DocxPreview.tsx`（.docx → mammoth.js）
  - `DagTree.tsx`（Agent 调度 DAG 树可视化）
- **实际渲染位置**：
  - `RightInspector.tsx:996-1016` — 3 个预览组件在 inspector 预览区渲染
  - `FilePreviewRouter.tsx:60-80` — 按文件扩展名路由到对应预览组件
  - `OverviewPanel.tsx:127` — DagTree 在概览面板中渲染
- **从 `ui/index.ts` 统一导出** — 所有 4 个组件都通过 barrel export 暴露
- CSS Modules 伴随每个组件

### 注意

- 实际使用取决于有 surfaced artifact 数据流入（见 Feature 6），但组件本身代码完整且已挂载

---

## 8. Skill/MCP Market

**Status: 👻 GHOST** — UI 组件存在，Hub API 存在，但两端未连接。Market 面板永远为空。

### 已验证存在的代码

1. **前端 UI 组件**：`SkillMarketView`（AgentsPage.tsx:1397）完整实现，包含搜索、类型过滤、安装/卸载按钮
2. **Hub API**：
   - `router.go:238-244` — 7 个 skill endpoints（CRUD + publish/unpublish）
   - `SkillHandler` 完整实现 + 测试
3. **hubClient 方法**：
   - `shared/hubClient.ts:1104` — `listPublicSkills()`
   - `web/hubClient.ts:1480` — `listPublicSkills()`
   - `desktop/hubClient.ts:1585` — `listPublicSkills()`

### 具体问题

1. **WorkbenchRoutes 未传递 skill market props**
   - `WorkbenchRoutes.tsx:1123` 渲染 `<AgentsPage>` 时，不传 `skillMarketItems`、`onSkillInstall`、`skillMarketSearchQuery` 等任何 skill market 相关 props
   - `SkillMarketView` 渲染时所有数据为空数组/默认值 → 永远显示"暂无公共 Skill"

2. **无数据获取逻辑**
   - 没有在任何 web/desktop 视图模型或 hook 中调用 `listPublicSkills()`
   - 没有 React Query hook 获取 skill market 数据

3. **安装回调未连接**
   - `onSkillInstall` prop 为 `undefined` → 点击"安装"按钮无任何效果
   - Hub 没有专门的 "install skill to agent profile" endpoint（CRUD 是 skill 本身，不是 skill→profile 绑定）

4. **Navigation 到 skill market 可能未被触发**
   - `activePane === 'skillMarket'` 分支存在，但导航栏是否包含该入口取决于 navItems 配置

### 修复评估

- 需要：数据获取 hook + WorkbenchRoutes props 连接 + Hub skill→profile 安装 API
- 估计 > 30 min（涉及新增 hook + prop drilling + 可能的新 API）

---

## 总结

### 可用（4/8）
- Anthropic SDK Adapter — 完整可用
- OpenAI SDK Adapter — 完整可用
- Diff Apply Writeback — 完整可用，含安全校验
- RunEvent Replay — 完整可用，断线重连链路完整

### 部分可用（2/8）
- **AgentMemory** — 后端注入链路可用，缺 API + UI
- **Surfacing** — 后端检测+emit 可用，前端不消费 surfaced 事件

### 幽灵代码（1/8）
- **Skill/MCP Market** — 全栈代码都存在，但数据获取和事件连接完全断裂

### 完整可用（1/8）
- **Preview Components** — 代码完整，依赖已安装，渲染路径已挂载（实际触发依赖 Surfacing 数据流）
