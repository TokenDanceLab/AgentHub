# AgentHub Desktop Client -- P0 架构实施详情

> 从 `docs/roadmaps/client.md` 提取的 Phase 0 实施细节：代码片段、风险评估、测试要求、验收标准。
> 原文路线图仅保留任务清单和依赖关系，详见 `docs/roadmaps/client.md`。

---

## P0-1: 状态架构重构（5 天）

### 参考模式（Multica，源码级）

| # | Multica 源文件:行 | 模式 |
|---|---------|------|
| 13 | `packages/core/` Zustand stores (view-store, draft-store, create-mode-store) | Zustand 只存纯客户端状态（UI selections, filters, drafts, modal state, navigation） |
| 14 | `CLAUDE.md` "WS events invalidate queries -- they never write to stores directly" | WebSocket 事件 → TanStack Query 缓存失效，绝不直接写 store |
| 22 | `packages/core/api/schema.ts` `parseWithFallback` with Zod | 所有 API 响应经过 Zod schema 验证，schema drift 不会导致白屏 |
| 23 | `CLAUDE.md` "Mutations are optimistic by default" | useMutation → onMutate (apply locally) → onError (rollback) → onSettled (invalidate) |

**Multica 核心规则**：服务端数据（threads, runs, agents, messages）全部由 TanStack Query 管理；Zustand 仅管理 UI 状态（sidebar width, theme, streaming flag, modal state）。**绝不**将服务端数据复制到 Zustand。

### 当前代码（AgentHub）

| 文件:行 | 问题 |
|------|------|
| `app/desktop/src/stores/runStore.ts:6-12` | `RunState` 混用服务端数据（outputText, toolCalls, changedFiles）和客户端标志（isStreaming） |
| `app/desktop/src/hooks/useChatMessages.ts:128-503` | `processEvent()` 直接将流式输出写入本地 reducer state，不经过缓存层 |
| `app/desktop/src/App.tsx:154-197` | 以 10s `setInterval` 轮询 agents 和 threads，无缓存去重 |
| `app/desktop/src/api/edgeClient.ts:28-104` | 原始 `fetch()` 调用，无 `useMutation` 封装，无 Zod 验证，无乐观更新 |

### 具体变更

**变更 1：引入 queryClient**

```typescript
// NEW: app/desktop/src/api/queryClient.ts
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, gcTime: 5 * 60_000, retry: 1 },
    mutations: { retry: 0 },
  },
});
```

**变更 2：创建 threadQueries 替代 App.tsx 中的 setInterval 轮询**

```typescript
// NEW: app/desktop/src/api/threadQueries.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchThreads, startRun } from './edgeClient';

export function useThreads(projectId?: string) {
  return useQuery({
    queryKey: ['threads', projectId],
    queryFn: () => fetchThreads(projectId),
    refetchInterval: 10_000,  // 替代 setInterval 轮询
  });
}

export function useCreateRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: startRun,
    onMutate: async (req) => {
      await qc.cancelQueries({ queryKey: ['runs'] });
      const prev = qc.getQueryData(['runs']);
      qc.setQueryData(['runs'], (old: any) =>
        [...(old || []), { ...req, status: 'queued' }]);
      return { prev };
    },
    onError: (_err, _req, ctx) => {
      qc.setQueryData(['runs'], ctx?.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['runs'] });
      qc.invalidateQueries({ queryKey: ['threads'] });
    },
  });
}
```

**变更 3：runStore 拆分 -- 服务端数据移出，仅留客户端 UI 状态**

```typescript
// BEFORE: app/desktop/src/stores/runStore.ts:6-12 -- 混杂服务端+客户端数据
export interface RunState {
  runId: string;
  status: string;
  outputText: string;        // ← 服务端数据（应由 TanStack Query 管理）
  toolCalls: Array<{...}>;   // ← 服务端数据
  changedFiles: Array<{...}>; // ← 服务端数据
}

// AFTER: app/desktop/src/stores/runStore.ts -- 仅客户端 UI 状态
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

export type AgentLoopState =
  | 'NO_TASK'
  | 'RUNNING'
  | 'STREAMING'
  | 'WAITING_FOR_INPUT'
  | 'IDLE'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

interface RunUIStore {
  isStreaming: boolean;
  currentRunId: string | null;
  runState: AgentLoopState;
  loopCount: number;
  errorCount: number;
  abortController: AbortController | null;
  fileReadCache: Map<string, { readCount: number; mtime: number }>;
  // actions
  setRunState: (state: AgentLoopState) => void;
  setStreaming: (v: boolean) => void;
  incrementLoopCount: () => void;
  incrementErrorCount: () => void;
  setAbortController: (ctrl: AbortController | null) => void;
  checkFileReadCache: (path: string, mtime: number) => boolean;
  clear: () => void;
}

export const useRunStore = create<RunUIStore>()(
  subscribeWithSelector((set, get) => ({
    isStreaming: false,
    currentRunId: null,
    runState: 'NO_TASK',
    loopCount: 0,
    errorCount: 0,
    abortController: null,
    fileReadCache: new Map(),
    setRunState: (runState) => set({ runState }),
    setStreaming: (isStreaming) => set({ isStreaming }),
    incrementLoopCount: () => set((s) => ({ loopCount: s.loopCount + 1 })),
    incrementErrorCount: () => set((s) => ({ errorCount: s.errorCount + 1 })),
    setAbortController: (ctrl) => set({ abortController: ctrl }),
    checkFileReadCache: (path, mtime) => {
      const cached = get().fileReadCache.get(path);
      if (cached && cached.mtime === mtime) {
        set((s) => {
          const next = new Map(s.fileReadCache);
          next.set(path, { readCount: cached.readCount + 1, mtime });
          return { fileReadCache: next };
        });
        return true; // cache hit
      }
      return false;
    },
    clear: () => set({
      isStreaming: false, currentRunId: null, runState: 'NO_TASK',
      loopCount: 0, errorCount: 0, abortController: null,
      fileReadCache: new Map(),
    }),
  })),
);
```

**变更 4：useChatMessages 事件处理 -- 从直接写 state 改为 invalidate Query**

```typescript
// BEFORE: app/desktop/src/hooks/useChatMessages.ts:128-503
// processEvent(state, event) 直接将流式输出写入 reducer state
// → run.started: 创建 currentRun 对象在本地 state
// → run.agent.text_delta: 直接拼接到 currentRun.outputText
// → run.finished: 设置 isStreaming = false

// AFTER: 事件 → invalidateQueries，仅保留 isStreaming 在 reducer
import { queryClient } from '@/api/queryClient';

function processEvent(state: State, event: EventEnvelope): State {
  switch (event.type) {
    case 'run.started':
      return { ...state, isStreaming: true, currentRunId: event.payload.runId as string };
    case 'run.agent.text_delta':
      return { ...state, messages: /* 合并文本块逻辑不变 */ };
    case 'run.finished':
      queryClient.invalidateQueries({ queryKey: ['runs', event.payload.runId] });
      return { ...state, isStreaming: false };
    // ... 其他事件类似
  }
}
```

**变更 5：引入 Zod schema 验证所有 API 响应**

```typescript
// NEW: app/desktop/src/api/schemas.ts
import { z } from 'zod';

export const RunInfoSchema = z.object({
  runId: z.string(),
  projectId: z.string(),
  threadId: z.string(),
  status: z.string(),
  createdAt: z.string(),
});

// REFACTOR: app/desktop/src/api/edgeClient.ts -- 从原始类型断言改为 Zod 验证
import { RunInfoSchema } from './schemas';

export async function startRun(req?: StartRunRequest): Promise<RunInfo> {
  const res = await fetch(`${BASE}/v1/runs`, {
    method: 'POST',
    headers: req ? { 'Content-Type': 'application/json' } : undefined,
    body: req ? JSON.stringify(req) : undefined,
  });
  if (!res.ok) throw await parseError(res);
  const raw = await res.json();
  const parsed = RunInfoSchema.safeParse(raw);
  if (!parsed.success) {
    console.error('Schema drift detected:', parsed.error.issues);
    return raw as RunInfo;
  }
  return parsed.data;
}
```

**变更 6：App.tsx 用 TanStack Query hooks 替代 setInterval**

```typescript
// BEFORE: app/desktop/src/App.tsx:154-197
// useEffect + setInterval(poll, 10000) -- 每 10s 无条件拉取

// AFTER:
import { useThreads } from '@/api/threadQueries';
const { data: threadData } = useThreads();
useEffect(() => {
  if (threadData) setThreads(threadData.items);
}, [threadData, setThreads]);
```

### 风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|------|:--:|:--:|------|
| TanStack Query 迁移打破消息流渲染 | 中 | 高 | Feature flag 保护：用 `useQuery` 仅在 `ENABLE_TQ` flag 下启用；旧代码路径保留 1 周 |
| Zod schema 与 Go 服务端类型不匹配 | 中 | 中 | 从 OpenAPI spec 自动生成 Zod schema；CI 步骤对比 schema 和实际 API 响应 |
| 乐观更新回滚后 UI 闪烁 | 低 | 中 | onSettled 必 invalidate；回滚时显示 toast 通知 |
| 流式消息（text_delta）性能退化 | 低 | 低 | text_delta 事件仍然直接写本地消息 state（不做 Query invalidate）；仅 run 元数据走 Query |

### 回滚方案

1. 移除 `<QueryClientProvider>` wrapper → 恢复直接 fetch 模式
2. `git checkout` runStore.ts → 恢复包含服务端字段的版本（提交前备份原文件）
3. 恢复 useChatMessages reducer 中的 `currentRun` 直接赋值逻辑
4. 恢复 App.tsx 中的 setInterval 轮询代码

### 测试要求

| # | 测试 | 方法 |
|---|------|------|
| 1 | `useThreads()` 在 10s 内对同一 queryKey 仅触发 1 次网络请求 | TanStack Query DevTools + Network 面板验证 |
| 2 | WS 事件 `run.started` 触发 Query invalidation 后，UI 在 50ms 内更新 | vitest + mock WS + waitFor |
| 3 | `useCreateRun().mutate()` 调用后，消息即时出现在聊天列表（乐观更新） | vitest: assert UI 在 fetch mock 完成前已显示新消息 |
| 4 | API 返回未知字段时，Zod safeParse 输出警告但不崩溃（白屏） | vitest: mock 返回格式错误的 JSON，assert 页面仍然渲染 |
| 5 | runStore 不再包含 `outputText`、`toolCalls`、`changedFiles` 字段 | vitest: assert `useRunStore.getState()` 不包含服务端字段 |
| 6 | 现有 12 个测试全部通过 | `npx vitest run` |

### 验收标准

- [ ] `useThreads()` 返回缓存数据，不会每次渲染触发网络请求
- [ ] WS 事件驱动 TanStack Query 缓存刷新，UI 在 50ms 内反映变化
- [ ] 乐观更新：用户发送消息后即时看到自己的消息，无论服务器响应快慢
- [ ] Zod schema 捕获服务端字段变更时，显示 toast 而非白屏
- [ ] `runStore` 不再包含 `outputText`、`toolCalls`、`changedFiles` 字段
- [ ] React DevTools Profiler 显示 App.tsx 重渲染次数减少 40%+（setInterval 轮询被 Query 缓存替代）

---

## P0-2: 输入体验修复（4 天）

### 参考模式（command-centers，源码级）

| # | 参考源文件:行 | 模式 |
|---|-------------|------|
| P0#1 | `jean/src/components/chat/ChatInput.tsx:104` | `valueRef` + 直接 DOM `.value` 写入；onChange 仅更新 ref 和边界 empty/non-empty setState |
| P0#2 | `jean/src/components/chat/ChatInput.tsx:106-108` | 1s debounced `setInputDraft` 写入 Zustand `chatStore.inputDrafts[sessionId]` |
| P0#2 | `jean/src/components/chat/ChatInput.tsx:164-184` | session 切换时从 `inputDrafts` 恢复草稿 |

**jean 核心规则**：受控 React 输入会在每次父组件重渲染时（包括流式事件）重渲染整个 PromptInput 及其所有子组件（AgentSelector, ModelDropdown, ReasoningSelect, SendButton）。改为非受控 + DOM ref 后，仅在 empty/non-empty 边界触发一次 setState。

### 当前代码（AgentHub）

| 文件:行 | 问题 |
|------|------|
| `app/desktop/src/components/PromptInput.tsx:49` | `const [prompt, setPrompt] = useState('')` -- 每次流式事件触发父组件重渲染时，PromptInput 全部重新渲染 |
| `app/desktop/src/components/PromptInput.tsx:64-65` | `useEffect` 依赖 `[prompt]` -- 每次按键都执行 `el.style.height` 计算 |
| 无草稿持久化 | 切换线程 → 组件卸载 → `useState` 状态丢失 → 用户输入消失 |

### 具体变更

**变更 1：非受控输入**

```typescript
// BEFORE: app/desktop/src/components/PromptInput.tsx:49, 64, 166-167
const [prompt, setPrompt] = useState('');
useEffect(() => {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}, [prompt]);
<textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} />

// AFTER:
const textareaRef = useRef<HTMLTextAreaElement>(null);
const promptRef = useRef('');
const [isEmpty, setIsEmpty] = useState(true);

function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
  promptRef.current = e.target.value;
  const empty = e.target.value.trim().length === 0;
  setIsEmpty((prev) => prev !== empty ? empty : prev);

  const el = textareaRef.current;
  if (el) {
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }
  scheduleDraftSave(e.target.value);
}

function handleSend() {
  const trimmed = promptRef.current.trim();
  if (!trimmed) return;
  onSend(trimmed, selectedAgentId, opts);
  promptRef.current = '';
  if (textareaRef.current) {
    textareaRef.current.value = '';
    textareaRef.current.style.height = 'auto';
  }
  setIsEmpty(true);
  clearDraft();
}

<textarea ref={textareaRef} defaultValue="" onChange={handleChange} />
```

**变更 2：草稿持久化**

```typescript
// NEW: app/desktop/src/hooks/useInputDraft.ts
import { useCallback, useRef, useEffect } from 'react';

const DRAFT_PREFIX = 'agenthub:draft:';

export function useInputDraft(threadId: string | null) {
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const draftKey = threadId ? `${DRAFT_PREFIX}${threadId}` : null;

  useEffect(() => {
    if (!draftKey) return;
    const saved = localStorage.getItem(draftKey);
    if (saved) promptRef.current = saved;
  }, [draftKey]);

  const scheduleSave = useCallback((value: string) => {
    if (!draftKey) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (value.trim()) {
        localStorage.setItem(draftKey, value);
      } else {
        localStorage.removeItem(draftKey);
      }
    }, 1000);
  }, [draftKey]);

  const clearDraft = useCallback(() => {
    if (!draftKey) return;
    localStorage.removeItem(draftKey);
  }, [draftKey]);

  return { scheduleSave, clearDraft };
}
```

**变更 3：工具调用循环检测**

```typescript
// ADD to: app/desktop/src/hooks/useChatMessages.ts (in processEvent, case 'run.agent.tool_call')

const TOOL_LOOP_WARN_THRESHOLD = 3;
const TOOL_LOOP_BLOCK_THRESHOLD = 5;
const toolCallSignatureMap = new Map<string, number>();

function checkRepeatedToolCall(
  toolName: string,
  input: Record<string, unknown>,
  streamHandle: { send: (data: Record<string, unknown>) => void },
): 'ok' | 'warn' | 'block' {
  const sig = `${toolName}:${JSON.stringify(input)}`;
  const count = (toolCallSignatureMap.get(sig) || 0) + 1;
  toolCallSignatureMap.set(sig, count);

  if (count >= TOOL_LOOP_BLOCK_THRESHOLD) {
    console.error(`[loop-detect] BLOCKED ${toolName} after ${count} identical calls`);
    streamHandle.send({
      type: 'run.agent.permission_decide',
      payload: { requestId: `loop-${toolName}`, decision: 'deny',
                 reason: `Tool "${toolName}" called ${count} times with identical input -- suspected loop` },
    });
    return 'block';
  }
  if (count >= TOOL_LOOP_WARN_THRESHOLD) {
    console.warn(`[loop-detect] WARNING: ${toolName} called ${count} times with identical input`);
    return 'warn';
  }
  return 'ok';
}
```

### 风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|------|:--:|:--:|------|
| 非受控输入破坏粘贴/撤销行为 | 中 | 中 | 非受控 textarea 不改变浏览器默认行为（粘贴/撤销由浏览器管理）；在 handleChange 中仍会读取最新值 |
| 草稿 key 冲突（多 tab） | 低 | 低 | 使用 `threadId` 作为 key，多 tab 共享同一草稿（实际上是期望行为） |
| localStorage 配额超限 | 低 | 低 | 每个草稿 <4KB；浏览器允许 5-10MB；最坏情况旧的草稿被静默删除 |
| 循环检测误判（正常重复工具调用） | 低 | 中 | 使用签名 `toolName:JSON.stringify(input)` 精确匹配；仅相同输入才算重复；阈值可配置 |

### 回滚方案

1. 恢复 `useState(prompt)` + `value={prompt}` → 一行 git revert
2. 移除 `useInputDraft` hook → 不影响核心功能
3. 循环检测的 `TOOL_LOOP_BLOCK_THRESHOLD` 设为一个极高值（如 1000）即可禁用

### 测试要求

| # | 测试 | 方法 |
|---|------|------|
| 1 | 非受控输入：流式渲染期间输入文字，textarea 不会丢失焦点或闪烁 | Cypress/Playwright: 在 SSE 流进行中输入，验证光标保持在 textarea 内 |
| 2 | 草稿持久化：输入文字 → 切换线程 → 返回原线程 → 文字恢复 | vitest: mock localStorage, 模拟 threadId 变化 |
| 3 | 发送成功后草稿被清除 | vitest: assert `localStorage.removeItem` 被调用 |
| 4 | 循环检测：同一工具调用 5 次后触发自动 deny | vitest: mock WS send, 模拟 5 次相同 tool_call 事件 |

### 验收标准

- [ ] 流式渲染期间用户可无延迟输入文字（React DevTools Profiler 显示 PromptInput 不重渲染）
- [ ] 切换线程后返回，输入框恢复上次键入内容
- [ ] 发送消息后草稿立即清除，不会在新线程中出现旧内容
- [ ] 同一工具调用 5 次后自动拒绝并显示警告；3 次后显示提示
- [ ] 现有 12 个测试全部通过

---

## P0-3: 连接健壮性（3 天）

### 参考模式（Kanna，源码级）

| # | Kanna 源文件:行 | 模式 |
|---|---------------|------|
| 1 | `reference/kanna/src/client/app/socket.ts:37-404` | `KannaSocket` 类封装：自动重连（指数退避 750ms-5s）、心跳（15s ping）+ 超时检测（4s timeout, 25s 陈旧连接）、可见性变化时暂停/恢复心跳、`subscribe()`/`command()`/`onStatus()` API、离线消息排队重放 |

**Kanna 核心参数**：
- 心跳间隔：15s ping
- 超时检测：4s 无 pong → 断开 + 重连
- 陈旧连接：25s 无任何消息 → 主动断开重建
- 重连退避：750ms 起始 → 最大 5s
- 离线消息：断线期间入队 → 重连后按序重放

### 当前代码（AgentHub）

| 文件:行 | 问题 |
|------|------|
| `app/desktop/src/api/eventClient.ts:19-111` | `createEventStream()` 有指数退避重连（1s-30s），但**无心跳**、**无离线队列**、**无重连回调** |
| `app/desktop/src/hooks/useChatMessages.ts:535-588` | WebSocket 生命周期管理嵌入在 useEffect 中，无独立类封装 |

### 具体变更

**变更 1：WebSocket 心跳 + 离线队列**

```typescript
// REFACTOR: app/desktop/src/api/eventClient.ts
// 从函数式 createEventStream() 重构为 EdgeSocket 类

interface EdgeSocketOptions {
  cursor?: string;
  heartbeatIntervalMs?: number;    // 默认 10000
  heartbeatTimeoutMs?: number;     // 默认 15000
  reconnectBaseMs?: number;        // 默认 1000
  reconnectMaxMs?: number;         // 默认 30000
}

type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export class EdgeSocket {
  private ws: WebSocket | null = null;
  private handlers = new Set<EventHandler>();
  private statusHandlers = new Set<(state: ConnectionState) => void>();
  private reconnectCallbacks: Array<() => void> = [];
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimeout: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay: number;
  private closed = false;
  private cursor: string | undefined;
  private state: ConnectionState = 'disconnected';

  // 离线队列
  private offlineQueue: Array<Record<string, unknown>> = [];
  private readonly OFFLINE_QUEUE_KEY = 'agenthub:offline-queue';

  constructor(private opts: EdgeSocketOptions = {}) {
    this.cursor = opts.cursor;
    this.reconnectDelay = opts.reconnectBaseMs ?? 1000;
    this.loadOfflineQueue();
  }

  // Heartbeat
  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: 'ping' });
      this.heartbeatTimeout = setTimeout(() => {
        console.warn('[EdgeSocket] Heartbeat timeout -- reconnecting');
        this.ws?.close();
      }, this.opts.heartbeatTimeoutMs ?? 15000);
    }, this.opts.heartbeatIntervalMs ?? 10000);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
    if (this.heartbeatTimeout) { clearTimeout(this.heartbeatTimeout); this.heartbeatTimeout = null; }
  }

  // 离线队列
  private loadOfflineQueue() {
    try {
      const raw = localStorage.getItem(this.OFFLINE_QUEUE_KEY);
      if (raw) this.offlineQueue = JSON.parse(raw);
    } catch { this.offlineQueue = []; }
  }

  private persistQueue() {
    localStorage.setItem(this.OFFLINE_QUEUE_KEY, JSON.stringify(this.offlineQueue));
  }

  private flushOfflineQueue() {
    while (this.offlineQueue.length > 0) {
      const msg = this.offlineQueue.shift()!;
      this.send(msg);
    }
    this.persistQueue();
  }

  // 重连回调
  onReconnect(cb: () => void): () => void {
    this.reconnectCallbacks.push(cb);
    return () => {
      const idx = this.reconnectCallbacks.indexOf(cb);
      if (idx >= 0) this.reconnectCallbacks.splice(idx, 1);
    };
  }

  send(data: Record<string, unknown>) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    } else {
      this.offlineQueue.push(data);
      this.persistQueue();
    }
  }

  private handleVisibilityChange = () => {
    if (document.hidden) {
      this.stopHeartbeat();
    } else if (this.state === 'connected') {
      this.startHeartbeat();
    }
  };
}
```

**变更 2：传输层抽象**

```typescript
// NEW: app/desktop/src/api/transport.ts
export interface Transport {
  connect(url: string): void;
  send(data: Record<string, unknown>): void;
  close(): void;
  onMessage(handler: (data: unknown) => void): () => void;
  onStateChange(handler: (state: TransportState) => void): () => void;
}

export type TransportState = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

export class WebSocketTransport implements Transport { /* ... */ }
export class MockTransport implements Transport { /* ... */ }
// 未来: Tauri IPC
// export class IPCBridgeTransport implements Transport { /* ... */ }
```

**变更 3：架构分离**

```typescript
// REFACTOR: app/desktop/src/hooks/useChatMessages.ts (589 行 → 3 个文件)

// 1. app/desktop/src/events/messageProcessor.ts (~250 行)
export function processEvent(state: State, event: EventEnvelope): State { /* ... */ }

// 2. app/desktop/src/events/eventBus.ts (~50 行)
export const eventBus = new EventEmitter<{
  'run.started': { runId: string };
  'run.finished': { runId: string; usage: TokenUsage };
  'connection.changed': { state: ConnectionState };
}>();

// 3. app/desktop/src/stores/messageStore.ts (~100 行)
```

### 风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|------|:--:|:--:|------|
| 心跳 ping/pong 与服务端协议不兼容 | 低 | 高 | 先确认 Edge Server 支持 ping/pong WebSocket frame 或自定义 JSON ping；若不支持则仅做客户端侧超时检测 |
| 离线队列消息重复发送 | 中 | 中 | 每条消息带 `clientMsgId` UUID；服务端去重（idempotency key） |
| localStorage 离线队列损坏 | 低 | 低 | try/catch 包裹 JSON.parse；损坏时清空队列 |
| EdgeSocket 类重写引入回归 | 中 | 中 | 保留 `createEventStream()` 作为 `EdgeSocket` 的兼容 wrapper；逐步迁移 |

### 回滚方案

1. `EdgeSocket` 类保留 `createEventStream()` 的公开 API → 消费者无需改动
2. 移除心跳特性（设置 `heartbeatIntervalMs = 0` 禁用）
3. 离线队列可通过 `localStorage.removeItem('agenthub:offline-queue')` 清空重置

### 测试要求

| # | 测试 | 方法 |
|---|------|------|
| 1 | 心跳：15s 内无服务端消息 → 客户端发送 ping → 服务端 pong → 连接保持 | vitest: 模拟 WebSocket, 推进 fake timers |
| 2 | 超时：发送 ping 后 4s 无 pong → 触发重连 | vitest: mock send, 不触发 onmessage, 验证 onclose 被调用 |
| 3 | 离线队列：断线期间 send 3 条消息 → 重连后服务端按序收到 3 条 | vitest: 模拟 disconnect → send → reconnect → assert send 调用顺序 |
| 4 | 重连回调：onReconnect 注册 callback → 重连成功后 callback 被执行 | vitest: 注册 callback → 触发 reconnect → assert callback 被调用 |
| 5 | 现有重连逻辑（指数退避）不受影响 | vitest: assert reconnectDelay 在 1s-30s 范围内指数增长 |

### 验收标准

- [ ] WebSocket 连接上 15s 无消息时自动发送心跳 ping
- [ ] 心跳超时（ping 后 4s 无 pong）自动断开并重连
- [ ] 断线期间用户发送的消息在重连后自动发送（不丢失）
- [ ] `Transport` 接口支持 MockTransport 用于测试，无需真实 WebSocket
- [ ] `useChatMessages.ts` 从 589 行拆分为 3 个文件（各 <250 行）
- [ ] 现有 12 个测试全部通过

---

## P0-4: 性能基础（2 天）

### 参考模式（command-centers + LibreChat，源码级）

| # | 参考源文件:行 | 模式 |
|---|-------------|------|
| P0#4 | `emdash/src/renderer/app/view-registry.ts:23-34` | `ViewDefinition` 类型：`WrapView`（可选布局 wrapper）、`TitlebarSlot`（自定义标题栏）、`MainPanel`（主内容）、`commandProvider`（per-view 命令面板）、`canActivate`（守卫/重定向） |
| #15 | LibreChat 使用 `@tanstack/react-virtual` 渲染大量消息 | 虚拟列表：仅渲染视口内 + 缓冲区消息；200+ 消息时不渲染全部 DOM |

### 当前代码（AgentHub）

| 文件:行 | 问题 |
|------|------|
| `app/desktop/src/components/ChatView.tsx:346-478` | 所有消息直接 `.map(renderMessage)` -- 1000 条消息 = 1000 个 DOM 节点 |
| `app/desktop/src/App.tsx:36-568` | 500+ 行单体组件：sidebar + thread panel + chat view + run detail + search + permission + 6 个 useEffect + 多个 callback |

### 具体变更

**变更 1：虚拟滚动**

```typescript
// REFACTOR: app/desktop/src/components/ChatView.tsx
import { useVirtualizer } from '@tanstack/react-virtual';

const VIRTUAL_THRESHOLD = 200;

export default function ChatView({ messages, isStreaming, onRetry, onDelete }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const estimateSize = useCallback((index: number) => {
    const msg = messages[index];
    const hasTool = msg.blocks.some(b => b.kind === 'tool_use');
    return hasTool ? 60 : 80;
  }, [messages]);

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize,
    overscan: 5,
    enabled: messages.length > VIRTUAL_THRESHOLD,
  });

  const visibleMessages = virtualizer.isEnabled
    ? virtualizer.getVirtualItems().map(v => messages[v.index])
    : messages;

  return (
    <div className={styles.root}>
      <div ref={scrollRef} className={styles.stream} role="log" aria-live="polite">
        {virtualizer.isEnabled ? (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((virtualRow) => (
              <div
                key={virtualRow.key}
                style={{
                  position: 'absolute', top: 0, left: 0, width: '100%',
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
              >
                {renderMessage(messages[virtualRow.index])}
              </div>
            ))}
          </div>
        ) : (
          messages.map(renderMessage)
        )}
      </div>
    </div>
  );
}
```

**变更 2：视图注册表**

```typescript
// NEW: app/desktop/src/views/viewRegistry.ts
import type { ComponentType } from 'react';

interface ViewDefinition {
  id: string;
  title: string;
  component: ComponentType<any>;
  canActivate?: (ctx: { online: boolean; hasThread: boolean }) => boolean;
  fallback?: string;
}

const viewRegistry = new Map<string, ViewDefinition>();

export function registerView(def: ViewDefinition) {
  viewRegistry.set(def.id, def);
}

export function getView(id: string): ViewDefinition | undefined {
  return viewRegistry.get(id);
}

export function resolveView(
  ctx: { online: boolean; hasThread: boolean },
): ViewDefinition {
  for (const [, def] of viewRegistry) {
    if (def.canActivate && !def.canActivate(ctx)) continue;
    return def;
  }
  return viewRegistry.get('welcome')!;
}

registerView({ id: 'welcome', title: 'Welcome', component: WelcomeScreen });
registerView({ id: 'chat', title: 'Chat', component: ChatView,
  canActivate: (ctx) => ctx.online && ctx.hasThread, fallback: 'welcome' });
registerView({ id: 'search', title: 'Search', component: SearchDialog });
registerView({ id: 'settings', title: 'Settings', component: SettingsPanel });
```

### 风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|------|:--:|:--:|------|
| 虚拟列表与自动滚动冲突 | 中 | 中 | 流式消息时禁用虚拟列表（isStreaming=true → enabled=false）；流式结束后启用 |
| 虚拟行高度估算不准确导致跳动 | 中 | 低 | 使用 `measureElement` 动态测量实际高度；设置合理的 overscan 值 |
| 视图注册表缺少某个现有视图 | 低 | 中 | 对照 App.tsx 中所有 `lazy()` import 逐一注册；CI 检查注册表完整性 |
| App.tsx 拆分引入 import 循环 | 低 | 中 | 视图注册表文件零依赖（仅导入 ComponentType）；视图组件延迟加载 |

### 回滚方案

1. 设置 `VIRTUAL_THRESHOLD = Infinity` → 永远不启用虚拟列表
2. 恢复 App.tsx 中的内联条件渲染 → `git checkout App.tsx`

### 测试要求

| # | 测试 | 方法 |
|---|------|------|
| 1 | 消息 < 200 条时使用普通渲染（无虚拟列表包装） | vitest: render 50 条消息, assert 无 `position: absolute` style |
| 2 | 消息 > 200 条时仅渲染视口内 + overscan 的消息 DOM 节点 | vitest: render 500 条, assert DOM 节点数 < 30 |
| 3 | 流式渲染期间虚拟列表关闭（isStreaming=true → enabled=false） | vitest: 设置 isStreaming=true, 验证所有消息被渲染 |
| 4 | 视图注册表：`resolveView({online: false})` 返回 welcome view | vitest: assert 返回 WelcomeScreen |
| 5 | 现有 ChatView 功能（复制/重试/删除/滚动到底部）不受影响 | vitest: 现有测试通过 |

### 验收标准

- [ ] 500 条消息的会话，DOM 节点数 < 50（而非 500+）
- [ ] 滚动到顶再到底，消息内容正确显示（无重复或缺失行）
- [ ] 流式消息到达时自动滚动到底部（`useAutoScroll` 与虚拟列表协作正确）
- [ ] App.tsx 从 568 行缩减到 <300 行（视图逻辑移至 viewRegistry）
- [ ] 新增视图只需在 viewRegistry.ts 中注册，无需修改 App.tsx
- [ ] 现有 12 个测试全部通过
