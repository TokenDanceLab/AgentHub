# P0 集成缺口分析: Desktop ↔ Edge 事件流

生成日期: 2026-05-23
分析范围: 共享类型、Desktop UI 层、Edge 事件总线、各 Adapter 输出

---

## 1. Edge 定义但 Desktop 未消费的事件（14 个缺口）

### 1.1 核心生命周期缺口 (2 个 — 高优先级)

| 事件 | Edge 发射位置 | Desktop 状态 | 影响 |
|---|---|---|---|
| `run.queued` | `api/handlers.go:342` | useChatMessages 未处理; 仅在 useEventStream 中通用日志 | UI 在 run.started 之前看不到排队状态 |
| `run.cancelled` | `process_executor.go:316` | **完全缺失** — processEvent 无 `case 'run.cancelled'` | 取消后 isStreaming 保持 true, 光标永远闪烁 |

### 1.2 Agent 子事件缺口 (12 个 — 中优先级 P1+)

以下事件 Edge 通过 NDJSON 解析器 (`parser_ndjson.go`) 全部发出, Desktop `useChatMessages.processEvent` 完全未处理。它们落入 `default: break` 被静默丢弃。

| 事件 | BusEvent 常量 (adapter.go) | 设计阶段 |
|---|---|---|
| `run.agent.compact_boundary` | `BusEventCompactBoundary` | events.md P1 |
| `run.agent.status_change` | `BusEventStatusChange` | events.md P0 (run.status.changed 是另一个事件) |
| `run.agent.api_retry` | `BusEventAPIRetry` | events.md P1 |
| `run.agent.task_started` | `BusEventTaskStarted` | events.md P1 |
| `run.agent.task_progress` | `BusEventTaskProgress` | events.md P1 |
| `run.agent.task_notification` | `BusEventTaskNotification` | events.md P1 |
| `run.agent.session_state_changed` | `BusEventSessionStateChanged` | events.md P1 |
| `run.agent.hook_started` | `BusEventHookStarted` | events.md P1 |
| `run.agent.hook_progress` | `BusEventHookProgress` | events.md P1 |
| `run.agent.hook_response` | `BusEventHookResponse` | events.md P1 |
| `run.agent.tool_use_summary` | `BusEventToolUseSummary` | events.md P1 |
| `run.agent.auth_status` | `BusEventAuthStatus` | events.md P1 |
| `run.agent.rate_limit` | `BusEventRateLimit` | events.md P1 |

---

## 2. 类型不匹配（8 项）

### 2.1 AgentResultEvent: `tokenUsage` vs Edge `usage` (严重)

**共享类型** — `app/shared/src/events.ts:142-154`:
```typescript
export interface AgentResultEvent extends EventEnvelope {
  type: 'run.agent.result';
  payload: {
    runId: string;
    success: boolean;
    error?: string;
    tokenUsage?: { input: number; output: number };  // <-- 期望 tokenUsage
  };
}
```

**Edge 实际输出**:
- NDJSON (`parser_ndjson.go:230-239`): `{ usage: { inputTokens, outputTokens } }` — 字段名 `usage`, 子键 `inputTokens`/`outputTokens`
- Codex (`codex.go:213-216`): `{ usage: { input_tokens, output_tokens } }` — snake_case
- OpenCode (`opencode.go:163-167`): `{ usage: { total, input, output, reasoning, cache } }` — 子键 `input`/`output`

**Desktop 消费** — `useChatMessages.ts:247-263`: 读取 `event.payload.tokenUsage` 始终为 `undefined`, token 用量从不显示。

### 2.2 AgentFileChangeEvent: 完全不同的 payload shape (严重)

**共享类型** — `app/shared/src/events.ts:120-129`:
```typescript
payload: { runId, path, action: 'created'|'modified'|'deleted', diff? }
```

**Edge NDJSON 实际输出** — `parser_ndjson.go:264-270`:
```typescript
payload: { callId, toolName, content, isError }  // 完全不同的字段!
```

**影响**: Desktop `useChatMessages.ts:222-245` 读取 `event.payload.path` 和 `event.payload.action` 始终为 `undefined`, 文件变更卡片只渲染空标题。`path` 为 `undefined` 导致 UI 显示 `<code></code>` 空格, `action` 为 `undefined` 导致 CSS 类回退到 `modified` 默认值。

### 2.3 AgentToolCallEvent: status 值不匹配 (中等)

**共享类型** — `events.ts:97-107`: status 为 `'pending' | 'running' | 'completed' | 'failed'`

**Edge 实际输出**:
- NDJSON `tool_progress` (line 127-132): `status: "in_progress"` — 不在联合类型中
- NDJSON `content_block_start` (line 211-217): `status: "started"` — 不在联合类型中
- Codex (line 192-196): 无 status 字段 — 为 undefined

**Desktop 消费** — `useChatMessages.ts:171`: `const status = (event.payload.status ?? 'running')` 做 fallback, 但 TypeScript 类型覆盖不完整。

### 2.4 AgentToolResultEvent: `output` vs `content` (中等)

**共享类型** — `events.ts:109-118`: `payload.output` 
**Edge NDJSON** — `parser_ndjson.go:258-262`: 发送 `{ callId, content, isError }` — 字段名是 `content` 而非 `output`

**Desktop** — `useChatMessages.ts:198-200`: `event.payload.output` 读取到 `undefined`, tool_use 子节点显示空内容。对 Codex adapter 正常 (它发送 `output`)。

### 2.5 run.cancelled 事件类型在共享层缺失 (严重)

**events.ts:30-40**: RunLifecycleEvent 联合只包含 `'run.queued' | 'run.started' | 'run.finished' | 'run.failed'`, 不包含 `'run.cancelled'`。

**Edge**: `process_executor.go:316` 发出 `"run.cancelled"` 事件, `mock_executor.go:206` 也发出。`events.md` 文档第 139 行标注为 P1 "已实现"。

**影响**: 即使 Desktop 添加了 `case 'run.cancelled'`, TypeScript 也会报类型错误。

### 2.6 SessionInit payload 多余字段 (低)

**events.ts:131-140**: 定义 `{ model?, tools?, permissionMode? }`  
**Edge NDJSON** (`parser_ndjson.go:243-249`): 额外发送 `mcpServers`, `version` 字段  
**影响**: 无运行时错误, 字段被忽略, 但类型不够精确。

### 2.7 run.output 类型未使用 (低)

**events.ts:44-53**: 定义了 `RunOutputEvent` (type=`run.output` 单条), 但 Edge 始终只发 `run.output.batch`。`events.md` 中两者都定义了, Edge 选择只用 batch 模式。

### 2.8 runner.online / runner.offline 无 Edge 发射者 (低)

**events.ts:20-26**: `RunnerEvent` 定义了 `runner.online` 和 `runner.offline`, 但 Edge 事件总线不发出这些事件。它们记录在 `events.md` P0 阶段但尚未实现。

---

## 3. 需修改的 Desktop 文件及具体位置

### Priority 1 — 阻断级 (阻塞正常 UI 功能)

**文件 A**: `app/desktop/src/hooks/useChatMessages.ts`

| 行号 | 问题 | 需要的修改 |
|---|---|---|
| L83-L97 | `case 'run.started'` 无前置 `run.queued` 处理 | 新增 `case 'run.queued'`: 显示 "排队中" 系统消息, 但不设置 isStreaming=true |
| L265-L281 | `case 'run.finished'`/`'run.failed'` 之后缺少 `'run.cancelled'` | 新增 `case 'run.cancelled'`: 设置 `isStreaming=false`, 更新 `currentRun.status = 'cancelled'` |
| L222-L245 | `case 'run.agent.file_change'` 读取 `payload.path`/`payload.action`, 但 Edge 发送 `payload.callId`/`payload.toolName`/`payload.content` | 适配 NDJSON payload: 从 `content` 中解析路径/操作; 或将 NDJSON 端的 emit 对齐 shared types |
| L247-L263 | `case 'run.agent.result'` 读取 `payload.tokenUsage` | 改为 `payload.tokenUsage ?? (payload.usage ? { input: payload.usage.inputTokens ?? payload.usage.input, output: payload.usage.outputTokens ?? payload.usage.output } : undefined)` 或多层 fallback |
| L194-L220 | `case 'run.agent.tool_result'` 读取 `payload.output` 但 NDJSON 使用 `payload.content` | 改为 `payload.output ?? payload.content` |

**文件 B**: `app/shared/src/events.ts`

| 行号 | 问题 | 需要的修改 |
|---|---|---|
| L31 | RunLifecycleEvent 联合缺少 `'run.cancelled'` | 新增 `'run.cancelled'` 加入 type 联合, payload 新增 `error?` 字段 |
| L120-L129 | AgentFileChangeEvent payload 不匹配 Edge 输出 | **方案 A**: 修改共享类型以匹配 Edge: `{ callId, toolName, content, isError }` + 适配 Desktop **方案 B**: 修改 Edge NDJSON 的 emitFileChange 输出 `{ path, action, diff? }` (推荐 — 因为 `events.md` 第 145 行明确了这个 shape) |
| L142-L154 | AgentResultEvent payload 缺少 `usage` 字段 | 新增 `usage?: { inputTokens?: number; outputTokens?: number; input?: number; output?: number }` 兼容多头 |

### Priority 2 — 功能级 (完善 Agent 状态可视化)

**文件 A**: `app/desktop/src/hooks/useChatMessages.ts`

| 行号 | 需要的修改 |
|---|---|
| L83-L97 (区域) | 新增 `case 'run.agent.session_state_changed'`: 更新 `currentRun.isStreaming` 或新增 UI 状态指标 |
| L167-L192 (区域) | 新增 `case 'run.agent.task_started'`: 在消息中插入子任务开始 card |
| L167-L192 (区域) | 新增 `case 'run.agent.task_progress'`: 更新子任务进度 |
| L167-L192 (区域) | 新增 `case 'run.agent.task_notification'`: 在消息中插入子任务完成/失败 card |
| L247-L263 (区域) | 新增 `case 'run.agent.tool_use_summary'`: 在消息中插入批量工具调用摘要块 |
| L83-L97 (区域) | 新增 `case 'run.agent.compact_boundary'`: 插入上下文压缩分隔线 |
| L83-L97 (区域) | 新增 `case 'run.agent.auth_status'`: 更新认证状态指示器 |

**文件 B**: `app/desktop/src/components/ChatView.types.ts`

| 行号 | 需要的修改 |
|---|---|
| L15-L29 | MessageBlock 联合新增: `{ kind: 'task_started'; taskId: string; description: string }`, `{ kind: 'task_notification'; taskId: string; status: string; summary?: string }`, `{ kind: 'compact_boundary'; trigger: string }`, `{ kind: 'tool_use_summary'; summary: string }` |

**文件 C**: `app/desktop/src/components/ChatView.tsx`

| 行号 | 需要的修改 |
|---|---|
| L158-L199 | `BlockRenderer` 新增 case 渲染上述新 block kinds |

### Priority 3 — 低优先级 (完善与类型收窄)

**文件 A**: `app/shared/src/events.ts`

| 行号 | 问题 | 需要的修改 |
|---|---|---|
| L131-L140 | AgentSessionInitEvent 缺少 mcpServers/version | 新增可选字段 `mcpServers?: unknown[]; version?: string` |
| L30-L40 | RunLifecycleEvent payload 缺少 `error` 字段 | `run.failed` 时 Edge 会发送 error 文本 |

**文件 B**: `app/desktop/src/stores/runStore.ts`

| 行号 | 问题 | 需要的修改 |
|---|---|---|
| L14-L17 | RunState 缺少 `cancelled` 状态 | `status: string` 已通用, 无需改; 但可加 type narrowing |

---

## 4. 实现优先级排序

### P0-阻断 (应立刻修复— 影响正确性和基本 UI)

1. **[类型] 修复 AgentFileChangeEvent** — `events.ts:120-129` + `useChatMessages.ts:222-245`
   - 方案: 修改 Edge `parser_ndjson.go:264-270` 的 `emit` 调用, 从 tool_result content 中提取 `path`/`action`/`diff`, 对齐 shared types 和 `events.md:145` 的约定
   - 或者: 修改 shared types 接受新 shape + 修改 useChatMessages 解析 content 字符串

2. **[类型] 修复 AgentResultEvent tokenUsage** — `events.ts:142-154` + `useChatMessages.ts:247-263`
   - 方案: shared types 新增 `usage` 备用字段, Desktop 读取时 fallback: `payload.tokenUsage ?? mapUsage(payload.usage)`

3. **[缺失] 处理 `run.cancelled`** — `events.ts:31` + `useChatMessages.ts:265-280`
   - 共享类型添加 `'run.cancelled'`, Desktop 添加 case 设置 `isStreaming=false`

4. **[类型] 修复 AgentToolResultEvent payload 字段** — `useChatMessages.ts:198-200`
   - 方案: `event.payload.output ?? event.payload.content`

### P1-完善 (应在当前迭代完成)

5. **[缺失] 处理 `run.queued`** — `useChatMessages.ts:83-97`
6. **[缺失] 处理 `run.agent.session_state_changed`** — `useChatMessages.ts` 新增 case
7. **[缺失] 处理 `run.agent.task_started/progress/notification`** — UI 子任务可视化
8. **[缺失] 处理 `run.agent.tool_use_summary`** — 批量工具调用卡片
9. **[类型] AgentToolCallEvent status 扩展** — `events.ts:104` 添加 `'started' | 'in_progress'`

### P2-打磨 (下个迭代)

10. **[缺失] 处理 `run.agent.compact_boundary`** — 上下文分隔线
11. **[缺失] 处理 `run.agent.hook_*` (3 events)** — Hook 执行透视
12. **[缺失] 处理 `run.agent.auth_status` / `run.agent.rate_limit`** — 状态栏指示器
13. **[类型] SessionInit 额外字段** — shared types 收窄
14. **[类型] 移除或标注未用的 `run.output` 单条类型** — events.ts

---

## 5. 端到端事件覆盖矩阵

| 事件类型 | events.md 阶段 | Edge emit | events.ts 类型 | useChatMessages 消费 | 状态 |
|---|---|---|---|---|---|
| `run.queued` | P0 | Y | Y | N | **缺口** |
| `run.started` | P0 | Y | Y | Y | OK |
| `run.finished` | P0 | Y | Y | Y | OK |
| `run.failed` | P0 | Y | Y | Y | OK |
| `run.cancelled` | P1 (已实现) | Y | N | N | **缺口** |
| `run.output` | P0 | N | Y | N | 类型冗余 |
| `run.output.batch` | P0 | Y | Y | Y | OK |
| `run.agent.text_delta` | P0 | Y | Y | Y | OK |
| `run.agent.text_block` | P0 | Y | Y | Y | OK |
| `run.agent.thinking` | P0 | Y | Y | Y | OK |
| `run.agent.tool_call` | P0 | Y | Y | Y | 部分 (status 不匹配) |
| `run.agent.tool_result` | P0 | Y | Y | Y | 部分 (字段名不匹配) |
| `run.agent.file_change` | P0 | Y | Y | Y | **损坏** (payload shape 不匹配) |
| `run.agent.session_init` | P0 | Y | Y | Y | OK (多余字段忽略) |
| `run.agent.result` | P0 | Y | Y | Y | **损坏** (tokenUsage 永远 undefined) |
| `run.agent.compact_boundary` | P1 | Y | N | N | **缺口** |
| `run.agent.status_change` | P0 (events.md) | Y | N | N | **缺口** |
| `run.agent.api_retry` | P1 | Y | N | N | **缺口** |
| `run.agent.task_started` | P1 | Y | N | N | **缺口** |
| `run.agent.task_progress` | P1 | Y | N | N | **缺口** |
| `run.agent.task_notification` | P1 | Y | N | N | **缺口** |
| `run.agent.session_state_changed` | P1 | Y | N | N | **缺口** |
| `run.agent.hook_started` | P1 | Y | N | N | **缺口** |
| `run.agent.hook_progress` | P1 | Y | N | N | **缺口** |
| `run.agent.hook_response` | P1 | Y | N | N | **缺口** |
| `run.agent.tool_use_summary` | P1 | Y | N | N | **缺口** |
| `run.agent.auth_status` | P1 | Y | N | N | **缺口** |
| `run.agent.rate_limit` | P1 | Y | N | N | **缺口** |
| `runner.online` | P0 | N | Y | N | 未实现 |
| `runner.offline` | P0 | N | Y | N | 未实现 |
| `error` | P0 | 间接 | Y | 仅日志 | 部分 |

**统计**: 32 个事件定义 | 15 OK / 4 破损 / 14 缺口 / 2 未实现 / 1 类型冗余
