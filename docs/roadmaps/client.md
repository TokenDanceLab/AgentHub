# AgentHub Desktop Client Roadmap

> 范围：React 19 + Tauri 2 桌面应用 (`app/desktop`) | 最后更新：2026-05-24
> 参考：18 个竞品/参考项目源码级分析 | 基础：68 份报告 / 35,000+ 行分析

---

## 1. 当前状态评估

### 1.1 现状概览

对 `app/desktop/src/` 完整源码审计后，现状总结如下：

| 维度 | 状态 | 详情 |
|------|:--:|------|
| 组件 | 17 个 | ChatView, DiffViewer, PromptInput, ThreadPanel, StatusBar, SearchDialog, ContextUsage, MarkdownRenderer, RunDetail, PermissionDialog, ModelSelector, AgentSelector, ReasoningSelector, SettingsPanel, MobileNav, ErrorBoundary, AppShell |
| Hooks | 7 个 | useChatMessages, useStreamingText, useAutoScroll, useKeyboard, useTheme, useMediaQuery, useDebounce |
| Stores | 5 个 | runStore, threadStore, connectionStore, uiStore, settingsStore |
| Contexts | 2 个 | ThemeContext, I18nContext |
| 设计令牌 | 230 行 | tokens.css：7 级字号、4 层表面色、4 档文字色、3 级字重、动画关键帧、WCAG 减弱动画、移动端防缩放 |
| API 层 | 112 行 | eventClient.ts：WebSocket + cursor 重放 + 指数退避（1s-30s） |
| 事件处理 | 589 行 | useChatMessages reducer：17 种事件类型 |
| 测试 | 12/12 通过 | vitest + Testing Library |

### 1.2 已有且工作正常

- [x] **设计令牌系统** — tokens.css 已完成 Phase 1 beautify（7 级字号 `textXs`-`textXl`，4 层表面色 `surfaceDefault`/`surfaceRaised`/`surfaceSunken`/`surfaceOverlay`，3 级字重，动画关键帧 `fadeIn`/`slideInRight`/`progressIndeterminate`，prefers-reduced-motion，移动端防缩放）
- [x] **ChatView 消息气泡** — 支持 9 种工具图标、相对时间格式化、工具输入摘要、流式文本渲染 (useStreamingText)、自动滚动 (useAutoScroll)、打字指示器
- [x] **DiffViewer** — 文件树侧栏、可折叠 hunks、行号、+/- 计数、按文件 accept/reject、expandAll/collapseAll
- [x] **PromptInput** — Agent 选择器、模型下拉、Reasoning effort 选择器、自适应 textarea、4000 字符限制
- [x] **ThreadPanel** — 内联重命名、删除确认、搜索过滤、相对时间显示
- [x] **StatusBar** — 延迟测量（绿色 <50ms，黄色 <200ms），错误计数，重连脉冲，深色/浅色主题切换
- [x] **SearchDialog** — Ctrl+K 全局搜索、前端文本扫描、消息块搜索（text/code/thinking/tool_use）、片段截断 80 字符
- [x] **ContextUsage** — 5 色分段条（system/user/assistant/tool/other）、Token 计数格式化、费用显示、紧凑模式、70% 警告/90% 危险阈值
- [x] **App.tsx** — 3 面板布局、懒加载 ChatView/RunDetail/SearchDialog、健康检查轮询、移动端响应式
- [x] **WebSocket 客户端** — cursor 重放、指数退避重连、状态/订阅处理器、JSON 发送
- [x] **国际化** — i18next 集成，en/zh 两种语言
- [x] **Tauri 壳** — Rust 侧窗口管理、原生菜单、系统托盘

### 1.3 关键差距

#### 1.3.1 状态架构（最重要）

| 差距 | 当前 | 应有 | 参考 |
|------|------|------|------|
| 服务端/客户端状态混杂 | runStore 混合 outputText + isStreaming | TanStack Query（服务端缓存） + Zustand（客户端 UI 状态） | Multica 分离模式 |
| 无缓存失效 | useChatMessages 直接写入本地状态 | 事件 → invalidate query → 组件自动重渲染 | TanStack Query 模式 |
| 无乐观更新 | 每次操作等服务器响应 | 即时 UI 更新 + 后台同步 | Multica useMutation |
| RunState 只有 5 个字段 | runId, status, outputText, toolCalls, changedFiles | 需 20+ 字段（含流式标志、错误计数、中止跟踪、去重缓存） | cline TaskState (20+ 维度) |
| 无正式状态机 | run.status 是自由字符串 | 正式状态机：NO_TASK → RUNNING ↔ STREAMING → WAITING_FOR_INPUT / IDLE | Roo-Code AgentLoopState |
| 无 Zustand selector | 全 store 订阅 | subscribeWithSelector 粒度订阅 | Roo-Code StateStore.subscribeToAgentState() |

#### 1.3.2 输入体验

| 差距 | 当前 | 应有 | 参考 |
|------|------|------|------|
| 受控输入 | `useState('')` — 每次重渲染触发 | **非受控输入** `useRef + DOM 写入` | 全部 7 个命令中心项目 |
| 无草稿持久化 | 切换线程丢失输入 | localStorage 或线程级 inputDraft | command-centers |
| 无富文本提及 | 纯文本 textarea | `@agent` `@file` `@thread` 提及 + 自动补全 | LibreChat / OpenCode |
| 无斜杠命令 | 无 | `/model`, `/clear`, `/retry`, `/fork` 等 | aider 30+ 命令 / continue pluggable |
| 无模型别名 | 需要完整模型 ID | "sonnet" → "claude-sonnet-4-6" 别名解析 | aider MODEL_ALIASES |

#### 1.3.3 Agent 交互

| 差距 | 当前 | 应有 | 参考 |
|------|------|------|------|
| 无工具调用去重 | Read 同一文件无限制 | fileReadCache Map<path, {readCount, mtime}> | cline TaskState |
| 无循环检测 | 工具可无限重复 | 软阈值 3 次警告 + 硬阈值 5 次升级用户 | cline loop-detection |
| 无子 Agent 视图 | 无 | 内联嵌套子 Agent 消息，树形展示 | Codex CLI AgentTree / LibreChat 消息树 |
| 无权限控制 UI | 硬编码全通过 | 可配置规则：Read 自动批准、Bash 始终询问 | cline CommandPermissionController |
| 无中断/恢复 | 无 | cancel() 当前运行、resume 历史运行 | Roo-Code AgentLoopState |
| 无 token 用量实时 | 仅结果时显示 | 流式过程中实时更新 ContextUsage 条 | OpenCode token meter |

#### 1.3.4 代码审查

| 差距 | 当前 | 应有 | 参考 |
|------|------|------|------|
| 无 side-by-side diff | 仅 unified 视图 | 双栏对比视图 | CCViewer / continue |
| 无行级评论 | 无 | 在 diff 行上添加评论/建议 | CCViewer DiffViewer |
| 无语法高亮 diff | 纯文本 | Shiki 或 highlight.js 语法着色 | continue Shiki 集成 |
| 无增量流式 diff | 预计算后显示 | 实时 myers-diff 流式计算 | continue streamDiff |
| 无 diff 统计面板 | 无 | +N/-M lines, N files changed 摘要条 | OpenCode DiffViewer |

#### 1.3.5 搜索和导航

| 差距 | 当前 | 应有 | 参考 |
|------|------|------|------|
| 仅前端文本扫描 | SearchDialog | FTS5 全文搜索（标题+内容） | CCViewer SQLite FTS5 |
| 无跨会话搜索 | 单线程内 | 全局跨项目/线程搜索 | CCViewer |
| 无搜索结果预览 | 文字片段 | 匹配行高亮 + 上下文 | CCViewer |
| 无快捷键大全 | 仅 Ctrl+K | 快捷键面板 (?) + 自定义 | OpenCode Keyboard Shortcuts |

#### 1.3.6 线程管理

| 差距 | 当前 | 应有 | 参考 |
|------|------|------|------|
| 扁平列表 | 无分组 | 按项目分组 + 按日期分组 | CCViewer / LibreChat |
| 无状态标记 | 无 | 运行中/错误/未读 状态图标 | LobeHub |
| 无归档 | 只有删除 | 归档/取消归档 | CCViewer |
| 无草稿关联 | 无 | threadDraft 持久化输入框内容 | command-centers |
| 无 Fork | 无 | 从任意消息分叉新线程 | LibreChat 4 模式 Fork |

#### 1.3.7 连接和离线

| 差距 | 当前 | 应有 | 参考 |
|------|------|------|------|
| 无心跳 | 依赖 WS 内置 | 10s ping/pong + 断线检测 | Kanna KannaSocket |
| 无离线队列 | 断线消息丢失 | 离线消息队列 + 重连后发送 | Multica WSClient |
| 无重连回调 | 无 | onReconnect / onMaxRetries / onStateChange | Multica |
| 无传输抽象 | 硬编码 WebSocket | 可替换传输层（WebSocket / IPC / Native Messaging） | Roo-Code ExtensionClient |

#### 1.3.8 性能

| 差距 | 当前 | 应有 | 参考 |
|------|------|------|------|
| 无虚拟滚动 | 所有消息渲染 | 超过 200 条消息时虚拟列表 | CCViewer / LibreChat |
| 无 React.memo 审计 | 未优化 | 关键组件 memo + useMemo/useCallback 审计 | OpenCode |
| 无懒加载图片 | 无 | Mermaid 图表懒加载、代码块展开/折叠 | OpenCode |
| App.tsx 500+ 行 | 单体 | 视图注册表 + 动态面板 | command-centers viewRegistry |

---

## 2. 竞争差距分析

对比 6 个关键 UX 维度与最佳参考项目：

### 2.1 综合对比

| UX 维度 | AgentHub 当前 | 最佳参考 | 差距 | 核心缺失 |
|------|:--:|------|:--:|------|
| **聊天/消息** | 7/10 | LibreChat (10/10) | -3 | 消息树、Fork、子 Agent 嵌套、消息反应、编辑/重新生成 |
| **Agent 可观测性** | 4/10 | OpenCode (9/10) | -5 | Token 实时用量、工具调用时间线、Agent 状态机可视化、任务列表 |
| **Diff/代码审查** | 5/10 | CCViewer (9/10) | -4 | side-by-side、语法高亮、行级评论、增量流式 diff、diff 统计面板 |
| **Agent 管理** | 3/10 | LobeHub (8/10) | -5 | Agent 市场/发现、实例仪表盘、角色配置、对话历史分析 |
| **布局/Shell** | 6/10 | CCViewer (8/10) | -2 | 可调整面板大小、多面板布局预设、标签面板、命令面板 |
| **主题/设计系统** | 6/10 | LobeHub (9/10) | -3 | 主题市场、自定义主题编辑器、OKLCH 高级色彩、动画库 |

### 2.2 各维度详细对比

#### 2.2.1 聊天/消息体验

| 功能 | AgentHub | LibreChat | OpenCode | LobeHub | cline |
|------|:--:|:--:|:--:|:--:|:--:|
| Markdown 渲染 | x | x | x | x | x |
| 代码语法高亮 | x | x | x | x | x |
| 流式文本渲染 | x | x | x | x | x |
| 工具调用展示 | x | x | x | x | x |
| 消息操作（复制/重试/删除） | x | x | — | x | x |
| 消息编辑 | — | x | — | x | — |
| 消息重新生成 | — | x | x | x | — |
| 消息分支/Fork | — | x | — | — | — |
| 消息反应（点赞/踩） | — | — | — | x | — |
| 子 Agent 内联嵌套 | — | x | — | — | — |
| 消息树形视图 | — | x | — | — | — |
| 滚动到底部按钮 | x | x | x | x | x |
| 打字指示器 | 三点 | 三点+头像 | 脉冲条 | 三点+头像 | 脉冲条 |
| 消息搜索（会话内） | — | x | x | — | — |

#### 2.2.2 Agent 可观测性

| 功能 | AgentHub | OpenCode | Kanna | LobeHub | cline |
|------|:--:|:--:|:--:|:--:|:--:|
| 实时 Token 用量 | 结果时 | x（实时） | — | x（实时） | x（实时） |
| Token 费用显示 | x | x | — | x | x |
| 工具调用时间线 | — | x | x | — | — |
| Agent 状态机显示 | — | — | x | x | — |
| 工具调用次数统计 | — | x | — | — | — |
| 上下文窗口百分比 | x | x | — | x | x |
| 任务/TODO 列表 | — | x | — | — | — |
| 子 Agent 层级视图 | — | — | — | — | x |
| 权限请求历史 | x | — | — | — | — |
| 错误/重试跟踪 | — | — | — | — | x |

#### 2.2.3 Diff/代码审查

| 功能 | AgentHub | CCViewer | OpenCode | continue | aider |
|------|:--:|:--:|:--:|:--:|:--:|
| Unified Diff | x | x | x | x | x |
| Side-by-Side | — | x | — | x | — |
| 行号 | x | x | x | x | — |
| 文件树侧栏 | x | x | x | — | — |
| 语法高亮 diff 行 | — | x | — | x | x |
| 折叠 hunks | x | x | x | — | — |
| Accept/Reject 按文件 | x | — | — | — | — |
| Accept/Reject 按 hunk | — | x | — | x | — |
| 行级评论 | — | x | — | — | — |
| 增量流式 diff | — | — | — | x | x |
| Diff 统计面板 | — | — | x | — | — |
| Git commit UI | — | x | — | — | x |

---

## 3. 实施阶段

### Phase 0: 基础打磨（~14 天）

> 目标：修复核心架构债务，达到"可靠可用"标准

#### P0-1: 状态架构重构（5 天）

- [ ] **引入 TanStack Query 服务端状态管理**（3 天）
  - 文件：`app/desktop/src/api/queryClient.ts`（新建）
  - 文件：`app/desktop/src/api/threadQueries.ts`（新建）— useThreads, useThread, useThreadMessages
  - 文件：`app/desktop/src/api/runQueries.ts`（新建）— useRun, useRuns, useCreateRun
  - 改造：`app/desktop/src/hooks/useChatMessages.ts` — 事件 → queryClient.invalidateQueries
  - 改造：`app/desktop/src/stores/runStore.ts` — 删除服务端数据，仅保留 isStreaming 客户端标志
  - 改造：`app/desktop/src/stores/threadStore.ts` — 移至 TanStack Query 缓存
  - 参考：Multica `03-source-adoption-map.md` TanStack Query+Zustand 分离模式

- [ ] **RunState 正式状态机**（1 天）
  - 文件：`app/desktop/src/stores/runStore.ts` — 重构为状态机
  - 状态：`NO_TASK → RUNNING ↔ STREAMING → WAITING_FOR_INPUT / IDLE / COMPLETED / FAILED / CANCELLED`
  - 新增字段：`loopCount`, `errorCount`, `abortController`, `fileReadCache: Map<string, {readCount, mtime}>`
  - 参考：Roo-Code `AgentLoopState` + cline `TaskState`（20+ 维度）

- [ ] **Zustand selector 粒度优化**（1 天）
  - 改造：所有 store 使用 `subscribeWithSelector` 中间件
  - 改造：组件使用 selector 而非全 store 订阅
  - 文件：`app/desktop/src/stores/uiStore.ts`, `connectionStore.ts`, `runStore.ts`
  - 参考：Roo-Code `StateStore.subscribeToAgentState()`

<details>
<summary><b>P0-1 实施详情：参考模式、当前代码、具体变更、风险评估、验收标准</b></summary>

##### 参考模式（Multica，源码级）

| # | Multica 源文件:行 | 模式 |
|---|---|------|
| 13 | `packages/core/` Zustand stores (view-store, draft-store, create-mode-store) | Zustand 只存纯客户端状态（UI selections, filters, drafts, modal state, navigation） |
| 14 | `CLAUDE.md` "WS events invalidate queries — they never write to stores directly" | WebSocket 事件 → TanStack Query 缓存失效，绝不直接写 store |
| 22 | `packages/core/api/schema.ts` `parseWithFallback` with Zod | 所有 API 响应经过 Zod schema 验证，schema drift 不会导致白屏 |
| 23 | `CLAUDE.md` "Mutations are optimistic by default" | useMutation → onMutate (apply locally) → onError (rollback) → onSettled (invalidate) |

**Multica 核心规则**：服务端数据（threads, runs, agents, messages）全部由 TanStack Query 管理；Zustand 仅管理 UI 状态（sidebar width, theme, streaming flag, modal state）。**绝不**将服务端数据复制到 Zustand。

##### 当前代码（AgentHub）

| 文件:行 | 问题 |
|------|------|
| `app/desktop/src/stores/runStore.ts:6-12` | `RunState` 混用服务端数据（outputText, toolCalls, changedFiles）和客户端标志（isStreaming） |
| `app/desktop/src/hooks/useChatMessages.ts:128-503` | `processEvent()` 直接将流式输出写入本地 reducer state，不经过缓存层 |
| `app/desktop/src/App.tsx:154-197` | 以 10s `setInterval` 轮询 agents 和 threads，无缓存去重 |
| `app/desktop/src/api/edgeClient.ts:28-104` | 原始 `fetch()` 调用，无 `useMutation` 封装，无 Zod 验证，无乐观更新 |

##### 具体变更

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

**变更 3：runStore 拆分 —— 服务端数据移出，仅留客户端 UI 状态**

```typescript
// BEFORE: app/desktop/src/stores/runStore.ts:6-12 — 混杂服务端+客户端数据
export interface RunState {
  runId: string;
  status: string;
  outputText: string;        // ← 服务端数据（应由 TanStack Query 管理）
  toolCalls: Array<{...}>;   // ← 服务端数据
  changedFiles: Array<{...}>; // ← 服务端数据
}

// AFTER: app/desktop/src/stores/runStore.ts — 仅客户端 UI 状态
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

**变更 4：useChatMessages 事件处理 —— 从直接写 state 改为 invalidate Query**

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
      // 仅设置流式标志；run 数据由 TanStack Query 管理
      return { ...state, isStreaming: true, currentRunId: event.payload.runId as string };
    case 'run.agent.text_delta':
      // 消息仍存储在本地（高频事件，直接写缓存开销过大）
      // 但 run 元数据（outputText/toolCalls）不再存在于此 reducer 中
      return { ...state, messages: /* 合并文本块逻辑不变 */ };
    case 'run.finished':
      // 通知 TanStack Query 刷新
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
  // ... 所有字段严格定义
});

// REFACTOR: app/desktop/src/api/edgeClient.ts — 从原始类型断言改为 Zod 验证
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
    // 发送告警但不崩溃 —— 返回 raw 作为降级方案
    return raw as RunInfo;
  }
  return parsed.data;  // 类型安全的返回值
}
```

**变更 6：App.tsx 用 TanStack Query hooks 替代 setInterval**

```typescript
// BEFORE: app/desktop/src/App.tsx:154-197
// useEffect + setInterval(poll, 10000) — 每 10s 无条件拉取

// AFTER:
import { useThreads } from '@/api/threadQueries';
// 删除 useEffect+setInterval 代码块（~44 行）
// 替换为：
const { data: threadData } = useThreads();
useEffect(() => {
  if (threadData) setThreads(threadData.items);
}, [threadData, setThreads]);
```

##### 风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|------|:--:|:--:|------|
| TanStack Query 迁移打破消息流渲染 | 中 | 高 | Feature flag 保护：用 `useQuery` 仅在 `ENABLE_TQ` flag 下启用；旧代码路径保留 1 周 |
| Zod schema 与 Go 服务端类型不匹配 | 中 | 中 | 从 OpenAPI spec 自动生成 Zod schema；CI 步骤对比 schema 和实际 API 响应 |
| 乐观更新回滚后 UI 闪烁 | 低 | 中 | onSettled 必 invalidate；回滚时显示 toast 通知 |
| 流式消息（text_delta）性能退化 | 低 | 低 | text_delta 事件仍然直接写本地消息 state（不做 Query invalidate）；仅 run 元数据走 Query |

##### 回滚方案

1. 移除 `<QueryClientProvider>` wrapper → 恢复直接 fetch 模式
2. `git checkout` runStore.ts → 恢复包含服务端字段的版本（提交前备份原文件）
3. 恢复 useChatMessages reducer 中的 `currentRun` 直接赋值逻辑
4. 恢复 App.tsx 中的 setInterval 轮询代码

##### 测试要求

| # | 测试 | 方法 |
|---|------|------|
| 1 | `useThreads()` 在 10s 内对同一 queryKey 仅触发 1 次网络请求 | TanStack Query DevTools + Network 面板验证 |
| 2 | WS 事件 `run.started` 触发 Query invalidation 后，UI 在 50ms 内更新 | vitest + mock WS + waitFor |
| 3 | `useCreateRun().mutate()` 调用后，消息即时出现在聊天列表（乐观更新） | vitest: assert UI 在 fetch mock 完成前已显示新消息 |
| 4 | API 返回未知字段时，Zod safeParse 输出警告但不崩溃（白屏） | vitest: mock 返回格式错误的 JSON，assert 页面仍然渲染 |
| 5 | runStore 不再包含 `outputText`、`toolCalls`、`changedFiles` 字段 | vitest: assert `useRunStore.getState()` 不包含服务端字段 |
| 6 | 现有 12 个测试全部通过 | `npx vitest run` |

##### 验收标准
- [ ] `useThreads()` 返回缓存数据，不会每次渲染触发网络请求
- [ ] WS 事件驱动 TanStack Query 缓存刷新，UI 在 50ms 内反映变化
- [ ] 乐观更新：用户发送消息后即时看到自己的消息，无论服务器响应快慢
- [ ] Zod schema 捕获服务端字段变更时，显示 toast 而非白屏
- [ ] `runStore` 不再包含 `outputText`、`toolCalls`、`changedFiles` 字段
- [ ] React DevTools Profiler 显示 App.tsx 重渲染次数减少 40%+（setInterval 轮询被 Query 缓存替代）

</details>

#### P0-2: 输入体验修复（4 天）

- [ ] **非受控输入迁移**（1 天）
  - 文件：`app/desktop/src/components/PromptInput.tsx:49` — `useState('')` → `useRef + DOM 写入`
  - 原因：受控输入在每次流式渲染时触发不必要的重渲染
  - 参考：全部 7 个命令中心项目（crush, eca, emdash, jean, orca, picoclaw, ruflo）

- [ ] **草稿持久化**（1 天）
  - 文件：`app/desktop/src/hooks/useInputDraft.ts`（新建）
  - 逻辑：localStorage 按 threadId 存储输入草稿，切换线程自动保存/恢复
  - 文件：`app/desktop/src/components/PromptInput.tsx` — 集成 useInputDraft
  - 参考：command-centers `01-source-adoption-map.md`

- [ ] **工具调用循环检测**（1 天）
  - 文件：`app/desktop/src/hooks/useChatMessages.ts` — 在 `run.agent.tool_call` 事件处理中新增 `checkRepeatedToolCall` 逻辑
  - 逻辑：`Map<string, number>` 跟踪 `toolName:JSON.stringify(input)` 签名 → 出现 3 次注入警告 → 出现 5 次硬拦截
  - 参考：cline `loop-detection.ts:21-68`

- [ ] **文件读取去重缓存**（1 天）
  - 文件：`app/desktop/src/hooks/useChatMessages.ts` — 在 Read 工具调用时检查缓存
  - 逻辑：`Map<filePath, {readCount, mtime}>` — 同一文件且 mtime 未变 → 跳过
  - 参考：cline `TaskState.ts:50-52` fileReadCache

<details>
<summary><b>P0-2 实施详情：参考模式、当前代码、具体变更、风险评估、验收标准</b></summary>

##### 参考模式（command-centers，源码级）

| # | 参考源文件:行 | 模式 |
|---|-------------|------|
| P0#1 | `jean/src/components/chat/ChatInput.tsx:104` | `valueRef` + 直接 DOM `.value` 写入；onChange 仅更新 ref 和边界 empty/non-empty setState |
| P0#2 | `jean/src/components/chat/ChatInput.tsx:106-108` | 1s debounced `setInputDraft` 写入 Zustand `chatStore.inputDrafts[sessionId]` |
| P0#2 | `jean/src/components/chat/ChatInput.tsx:164-184` | session 切换时从 `inputDrafts` 恢复草稿 |

**jean 核心规则**：受控 React 输入会在每次父组件重渲染时（包括流式事件）重渲染整个 PromptInput 及其所有子组件（AgentSelector, ModelDropdown, ReasoningSelect, SendButton）。改为非受控 + DOM ref 后，仅在 empty/non-empty 边界触发一次 setState。

##### 当前代码（AgentHub）

| 文件:行 | 问题 |
|------|------|
| `app/desktop/src/components/PromptInput.tsx:49` | `const [prompt, setPrompt] = useState('')` — 每次流式事件触发父组件重渲染时，PromptInput 全部重新渲染 |
| `app/desktop/src/components/PromptInput.tsx:64-65` | `useEffect` 依赖 `[prompt]` — 每次按键都执行 `el.style.height` 计算 |
| 无草稿持久化 | 切换线程 → 组件卸载 → `useState` 状态丢失 → 用户输入消失 |

##### 具体变更

**变更 1：非受控输入**

```typescript
// BEFORE: app/desktop/src/components/PromptInput.tsx:49, 64, 166-167
const [prompt, setPrompt] = useState('');
// ...
useEffect(() => {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}, [prompt]);
// ...
<textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} />

// AFTER:
const textareaRef = useRef<HTMLTextAreaElement>(null);
const promptRef = useRef('');
const [isEmpty, setIsEmpty] = useState(true); // 仅边界触发

// Auto-resize 改为在 onChange 中直接操作 DOM
function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
  promptRef.current = e.target.value;
  const empty = e.target.value.trim().length === 0;
  setIsEmpty((prev) => prev !== empty ? empty : prev); // 仅边界变化触发 setState

  // Auto-resize: 直接操作 DOM，不通过 React state
  const el = textareaRef.current;
  if (el) {
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }

  // Debounced draft save (see Change 2)
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

// Textarea 不再受控——value 由 DOM 自身管理
<textarea
  ref={textareaRef}
  defaultValue=""   // 初始值；后续由 DOM 管理
  onChange={handleChange}
  // 移除 value={prompt}
/>
```

**变更 2：草稿持久化**

```typescript
// NEW: app/desktop/src/hooks/useInputDraft.ts
import { useCallback, useRef, useEffect } from 'react';

const DRAFT_PREFIX = 'agenthub:draft:';

export function useInputDraft(threadId: string | null) {
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const draftKey = threadId ? `${DRAFT_PREFIX}${threadId}` : null;

  // 恢复草稿
  useEffect(() => {
    if (!draftKey) return;
    const saved = localStorage.getItem(draftKey);
    if (saved) promptRef.current = saved;
  }, [draftKey]);

  // 保存草稿（1s debounce）
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

  // 清除草稿（发送成功后）
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
                 reason: `Tool "${toolName}" called ${count} times with identical input — suspected loop` },
    });
    return 'block';
  }
  if (count >= TOOL_LOOP_WARN_THRESHOLD) {
    console.warn(`[loop-detect] WARNING: ${toolName} called ${count} times with identical input`);
    // 注入系统消息提示用户
    return 'warn';
  }
  return 'ok';
}
```

##### 风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|------|:--:|:--:|------|
| 非受控输入破坏粘贴/撤销行为 | 中 | 中 | 非受控 textarea 不改变浏览器默认行为（粘贴/撤销由浏览器管理）；在 handleChange 中仍会读取最新值 |
| 草稿 key 冲突（多 tab） | 低 | 低 | 使用 `threadId` 作为 key，多 tab 共享同一草稿（实际上是期望行为） |
| localStorage 配额超限 | 低 | 低 | 每个草稿 <4KB；浏览器允许 5-10MB；最坏情况旧的草稿被静默删除 |
| 循环检测误判（正常重复工具调用） | 低 | 中 | 使用签名 `toolName:JSON.stringify(input)` 精确匹配；仅相同输入才算重复；阈值可配置 |

##### 回滚方案

1. 恢复 `useState(prompt)` + `value={prompt}` → 一行 git revert
2. 移除 `useInputDraft` hook → 不影响核心功能
3. 循环检测的 `TOOL_LOOP_BLOCK_THRESHOLD` 设为一个极高值（如 1000）即可禁用

##### 测试要求

| # | 测试 | 方法 |
|---|------|------|
| 1 | 非受控输入：流式渲染期间输入文字，textarea 不会丢失焦点或闪烁 | Cypress/Playwright: 在 SSE 流进行中输入，验证光标保持在 textarea 内 |
| 2 | 草稿持久化：输入文字 → 切换线程 → 返回原线程 → 文字恢复 | vitest: mock localStorage, 模拟 threadId 变化 |
| 3 | 发送成功后草稿被清除 | vitest: assert `localStorage.removeItem` 被调用 |
| 4 | 循环检测：同一工具调用 5 次后触发自动 deny | vitest: mock WS send, 模拟 5 次相同 tool_call 事件 |

##### 验收标准
- [ ] 流式渲染期间用户可无延迟输入文字（React DevTools Profiler 显示 PromptInput 不重渲染）
- [ ] 切换线程后返回，输入框恢复上次键入内容
- [ ] 发送消息后草稿立即清除，不会在新线程中出现旧内容
- [ ] 同一工具调用 5 次后自动拒绝并显示警告；3 次后显示提示
- [ ] 现有 12 个测试全部通过

</details>

#### P0-3: 连接健壮性（3 天）

- [ ] **WebSocket 心跳**（0.5 天）
  - 文件：`app/desktop/src/api/eventClient.ts` — 添加 10s ping/pong + 15s 超时检测
  - 参考：Kanna `04-source-adoption-map.md` KannaSocket

- [ ] **离线消息队列**（1 天）
  - 文件：`app/desktop/src/api/offlineQueue.ts`（新建）
  - 逻辑：断线时消息入队 localStorage → 重连后按序发送
  - 文件：`app/desktop/src/api/eventClient.ts` — 集成离线队列
  - 参考：Multica `03-source-adoption-map.md` WSClient

- [ ] **传输层抽象**（1 天）
  - 文件：`app/desktop/src/api/transport.ts`（新建）— Transport 接口
  - 实现：`WebSocketTransport`, `MockTransport`（测试用）
  - 未来：`IPCBridgeTransport`（Tauri 原生）
  - 参考：Roo-Code `ExtensionClient` transport-agnostic 模式

- [ ] **架构分离：MessageProcessor / StateStore / EventEmitter**（0.5 天）
  - 文件：`app/desktop/src/hooks/useChatMessages.ts` — 拆分为：`messageProcessor.ts`（事件→动作），`stateStore.ts`（immutable state + 订阅），`eventBus.ts`（typed events）
  - 当前：589 行单文件混杂处理
  - 参考：Roo-Code `MessageProcessor → StateStore → EventEmitter` 三层分离

<details>
<summary><b>P0-3 实施详情：参考模式、当前代码、具体变更、风险评估、验收标准</b></summary>

##### 参考模式（Kanna，源码级）

| # | Kanna 源文件:行 | 模式 |
|---|---------------|------|
| 1 | `reference/kanna/src/client/app/socket.ts:37-404` | `KannaSocket` 类封装：自动重连（指数退避 750ms-5s）、心跳（15s ping）+ 超时检测（4s timeout, 25s 陈旧连接）、可见性变化时暂停/恢复心跳、`subscribe()`/`command()`/`onStatus()` API、离线消息排队重放 |

**Kanna 核心参数**：
- 心跳间隔：15s ping
- 超时检测：4s 无 pong → 断开 + 重连
- 陈旧连接：25s 无任何消息 → 主动断开重建
- 重连退避：750ms 起始 → 最大 5s
- 离线消息：断线期间入队 → 重连后按序重放

##### 当前代码（AgentHub）

| 文件:行 | 问题 |
|------|------|
| `app/desktop/src/api/eventClient.ts:19-111` | `createEventStream()` 有指数退避重连（1s-30s），但**无心跳**、**无离线队列**、**无重连回调** |
| `app/desktop/src/hooks/useChatMessages.ts:535-588` | WebSocket 生命周期管理嵌入在 useEffect 中，无独立类封装 |

##### 具体变更

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

  // ── 离线队列 ──
  private offlineQueue: Array<Record<string, unknown>> = [];
  private readonly OFFLINE_QUEUE_KEY = 'agenthub:offline-queue';

  constructor(private opts: EdgeSocketOptions = {}) {
    this.cursor = opts.cursor;
    this.reconnectDelay = opts.reconnectBaseMs ?? 1000;
    this.loadOfflineQueue();
  }

  // ── Heartbeat ──
  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: 'ping' });
      this.heartbeatTimeout = setTimeout(() => {
        console.warn('[EdgeSocket] Heartbeat timeout — reconnecting');
        this.ws?.close();
        // onclose will trigger reconnect
      }, this.opts.heartbeatTimeoutMs ?? 15000);
    }, this.opts.heartbeatIntervalMs ?? 10000);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
    if (this.heartbeatTimeout) { clearTimeout(this.heartbeatTimeout); this.heartbeatTimeout = null; }
  }

  // ── 离线队列 ──
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

  // ── 重连回调 ──
  onReconnect(cb: () => void): () => void {
    this.reconnectCallbacks.push(cb);
    return () => {
      const idx = this.reconnectCallbacks.indexOf(cb);
      if (idx >= 0) this.reconnectCallbacks.splice(idx, 1);
    };
  }

  // ── 连接生命周期 （与现有 createEventStream 逻辑合并） ──
  // ... connect(), scheduleReconnect(), notifyState() 等

  send(data: Record<string, unknown>) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    } else {
      // 离线：入队
      this.offlineQueue.push(data);
      this.persistQueue();
    }
  }

  // 可见性变化时暂停/恢复心跳
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

// 实现 1: 浏览器 WebSocket（当前路径，提取为独立类）
export class WebSocketTransport implements Transport { /* ... */ }

// 实现 2: Mock（测试用）
export class MockTransport implements Transport { /* ... */ }

// 未来: Tauri IPC
// export class IPCBridgeTransport implements Transport { /* ... */ }
```

**变更 3：架构分离**

```typescript
// REFACTOR: app/desktop/src/hooks/useChatMessages.ts (589 行 → 3 个文件)

// 1. app/desktop/src/events/messageProcessor.ts (~250 行)
//    事件 → 动作的纯函数，易测试
export function processEvent(state: State, event: EventEnvelope): State { /* ... */ }

// 2. app/desktop/src/events/eventBus.ts (~50 行)
//    类型安全的事件总线
import { EventEmitter } from '@/lib/eventEmitter';
export const eventBus = new EventEmitter<{
  'run.started': { runId: string };
  'run.finished': { runId: string; usage: TokenUsage };
  'connection.changed': { state: ConnectionState };
  // ... 所有事件类型
}>();

// 3. app/desktop/src/stores/messageStore.ts (~100 行)
//    Immutable state + 订阅（替代 useReducer）
```

##### 风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|------|:--:|:--:|------|
| 心跳 ping/pong 与服务端协议不兼容 | 低 | 高 | 先确认 Edge Server 支持 ping/pong WebSocket frame 或自定义 JSON ping；若不支持则仅做客户端侧超时检测 |
| 离线队列消息重复发送 | 中 | 中 | 每条消息带 `clientMsgId` UUID；服务端去重（idempotency key） |
| localStorage 离线队列损坏 | 低 | 低 | try/catch 包裹 JSON.parse；损坏时清空队列 |
| EdgeSocket 类重写引入回归 | 中 | 中 | 保留 `createEventStream()` 作为 `EdgeSocket` 的兼容 wrapper；逐步迁移 |

##### 回滚方案

1. `EdgeSocket` 类保留 `createEventStream()` 的公开 API → 消费者无需改动
2. 移除心跳特性（设置 `heartbeatIntervalMs = 0` 禁用）
3. 离线队列可通过 `localStorage.removeItem('agenthub:offline-queue')` 清空重置

##### 测试要求

| # | 测试 | 方法 |
|---|------|------|
| 1 | 心跳：15s 内无服务端消息 → 客户端发送 ping → 服务端 pong → 连接保持 | vitest: 模拟 WebSocket, 推进 fake timers |
| 2 | 超时：发送 ping 后 4s 无 pong → 触发重连 | vitest: mock send, 不触发 onmessage, 验证 onclose 被调用 |
| 3 | 离线队列：断线期间 send 3 条消息 → 重连后服务端按序收到 3 条 | vitest: 模拟 disconnect → send → reconnect → assert send 调用顺序 |
| 4 | 重连回调：onReconnect 注册 callback → 重连成功后 callback 被执行 | vitest: 注册 callback → 触发 reconnect → assert callback 被调用 |
| 5 | 现有重连逻辑（指数退避）不受影响 | vitest: assert reconnectDelay 在 1s-30s 范围内指数增长 |

##### 验收标准
- [ ] WebSocket 连接上 15s 无消息时自动发送心跳 ping
- [ ] 心跳超时（ping 后 4s 无 pong）自动断开并重连
- [ ] 断线期间用户发送的消息在重连后自动发送（不丢失）
- [ ] `Transport` 接口支持 MockTransport 用于测试，无需真实 WebSocket
- [ ] `useChatMessages.ts` 从 589 行拆分为 3 个文件（各 <250 行）
- [ ] 现有 12 个测试全部通过

</details>

#### P0-4: 性能基础（2 天）

- [ ] **虚拟滚动**（1.5 天）
  - 依赖：`@tanstack/react-virtual`
  - 文件：`app/desktop/src/components/ChatView.tsx` — 消息列表 >200 条时启用虚拟滚动
  - 参考：CCViewer / LibreChat 虚拟列表

- [ ] **App.tsx 视图注册表拆分**（0.5 天）
  - 文件：`app/desktop/src/views/viewRegistry.ts`（新建）
  - 文件：`app/desktop/src/App.tsx` — 从 500+ 行拆分为 viewRegistry + 动态面板
  - 参考：command-centers `01-source-adoption-map.md` viewRegistry

<details>
<summary><b>P0-4 实施详情：参考模式、当前代码、具体变更、风险评估、验收标准</b></summary>

##### 参考模式（command-centers + LibreChat，源码级）

| # | 参考源文件:行 | 模式 |
|---|-------------|------|
| P0#4 | `emdash/src/renderer/app/view-registry.ts:23-34` | `ViewDefinition` 类型：`WrapView`（可选布局 wrapper）、`TitlebarSlot`（自定义标题栏）、`MainPanel`（主内容）、`commandProvider`（per-view 命令面板）、`canActivate`（守卫/重定向） |
| #15 | LibreChat 使用 `@tanstack/react-virtual` 渲染大量消息 | 虚拟列表：仅渲染视口内 + 缓冲区消息；200+ 消息时不渲染全部 DOM |

##### 当前代码（AgentHub）

| 文件:行 | 问题 |
|------|------|
| `app/desktop/src/components/ChatView.tsx:346-478` | 所有消息直接 `.map(renderMessage)` — 1000 条消息 = 1000 个 DOM 节点 |
| `app/desktop/src/App.tsx:36-568` | 500+ 行单体组件：sidebar + thread panel + chat view + run detail + search + permission + 6 个 useEffect + 多个 callback |

##### 具体变更

**变更 1：虚拟滚动**

```typescript
// REFACTOR: app/desktop/src/components/ChatView.tsx
// 添加 @tanstack/react-virtual（已在 roadmap 4.5 中作为依赖）

import { useVirtualizer } from '@tanstack/react-virtual';

const VIRTUAL_THRESHOLD = 200; // 超过此数量启用虚拟列表

export default function ChatView({ messages, isStreaming, onRetry, onDelete }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // 计算每行估计高度（文本行 80px，工具调用行 60px）
  const estimateSize = useCallback((index: number) => {
    const msg = messages[index];
    const hasTool = msg.blocks.some(b => b.kind === 'tool_use');
    return hasTool ? 60 : 80;
  }, [messages]);

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize,
    overscan: 5,           // 视口外预渲染 5 条
    enabled: messages.length > VIRTUAL_THRESHOLD,
  });

  // 当虚拟列表启用时，只渲染可见行
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
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
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
  /** 激活条件：返回 false 时重定向到 fallback */
  canActivate?: (ctx: { online: boolean; hasThread: boolean }) => boolean;
  /** canActivate 失败时的重定向目标 */
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
  return viewRegistry.get('welcome')!; // fallback
}

// 注册所有视图
registerView({ id: 'welcome', title: 'Welcome', component: WelcomeScreen });
registerView({ id: 'chat', title: 'Chat', component: ChatView,
  canActivate: (ctx) => ctx.online && ctx.hasThread, fallback: 'welcome' });
registerView({ id: 'search', title: 'Search', component: SearchDialog });
registerView({ id: 'settings', title: 'Settings', component: SettingsPanel });
```

##### 风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|------|:--:|:--:|------|
| 虚拟列表与自动滚动冲突 | 中 | 中 | 流式消息时禁用虚拟列表（isStreaming=true → enabled=false）；流式结束后启用 |
| 虚拟行高度估算不准确导致跳动 | 中 | 低 | 使用 `measureElement` 动态测量实际高度；设置合理的 overscan 值 |
| 视图注册表缺少某个现有视图 | 低 | 中 | 对照 App.tsx 中所有 `lazy()` import 逐一注册；CI 检查注册表完整性 |
| App.tsx 拆分引入 import 循环 | 低 | 中 | 视图注册表文件零依赖（仅导入 ComponentType）；视图组件延迟加载 |

##### 回滚方案

1. 设置 `VIRTUAL_THRESHOLD = Infinity` → 永远不启用虚拟列表
2. 恢复 App.tsx 中的内联条件渲染 → `git checkout App.tsx`

##### 测试要求

| # | 测试 | 方法 |
|---|------|------|
| 1 | 消息 < 200 条时使用普通渲染（无虚拟列表包装） | vitest: render 50 条消息, assert 无 `position: absolute` style |
| 2 | 消息 > 200 条时仅渲染视口内 + overscan 的消息 DOM 节点 | vitest: render 500 条, assert DOM 节点数 < 30 |
| 3 | 流式渲染期间虚拟列表关闭（isStreaming=true → enabled=false） | vitest: 设置 isStreaming=true, 验证所有消息被渲染 |
| 4 | 视图注册表：`resolveView({online: false})` 返回 welcome view | vitest: assert 返回 WelcomeScreen |
| 5 | 现有 ChatView 功能（复制/重试/删除/滚动到底部）不受影响 | vitest: 现有测试通过 |

##### 验收标准
- [ ] 500 条消息的会话，DOM 节点数 < 50（而非 500+）
- [ ] 滚动到顶再到底，消息内容正确显示（无重复或缺失行）
- [ ] 流式消息到达时自动滚动到底部（`useAutoScroll` 与虚拟列表协作正确）
- [ ] App.tsx 从 568 行缩减到 <300 行（视图逻辑移至 viewRegistry）
- [ ] 新增视图只需在 viewRegistry.ts 中注册，无需修改 App.tsx
- [ ] 现有 12 个测试全部通过

</details>

---

### 3.5 P0 依赖图和关键路径

#### 任务依赖关系

```
P0-1 (状态架构, 5d)
  ├── 阻塞: P0-2 中的循环检测和去重缓存（依赖 runStore 重构后的新字段）
  ├── 阻塞: P0-4 中的视图注册表（依赖 TanStack Query 数据源替代 setInterval）
  └── 可并行: P0-2 中的非受控输入 + 草稿持久化（不依赖 P0-1 完成）

P0-2 (输入体验, 4d)
  ├── 前置: P0-1 完成（循环检测依赖 runStore 的 fileReadCache 和 loopCount）
  ├── 可提前做: 非受控输入 + 草稿持久化（独立于 P0-1，可立即开始）
  └── 可并行: P0-3 中的心跳和离线队列（完全不相关）

P0-3 (连接健壮性, 3d)
  ├── 前置: 无（完全独立，可第一时间开始）
  ├── 阻塞: P0-4 无直接依赖
  └── 可并行: 与 P0-1/P0-2 同时进行

P0-4 (性能基础, 2d)
  ├── 前置: P0-1 完成（视图注册表需要 Query 数据源；虚拟滚动需要稳定的消息数据结构）
  └── 阻塞: Phase 1 的 ChatView 消息树（虚拟滚动是前提）
```

#### 关键路径

```
Day 1-2:  │ P0-1 (TanStack Query) │  │ P0-3 (心跳+离线队列) │  │ P0-2 (非受控输入+草稿) │
           │ ← 最长路径，决定总工期      │                        │ ← 可提前独立开始         │
Day 3-5:  │ P0-1 继续 (状态机+selector) │  │ P0-3 (传输层抽象)     │  │ P0-2 (循环检测+去重)   │
           │                            │                        │ ← 依赖 P0-1 runStore 重构 │
Day 6-7:  │ P0-4 (虚拟滚动+viewRegistry) │ ← 依赖 P0-1 完成
           │                             │ ← 与 P0-3 收尾并行

总工期: ~7 天 (并行执行) vs ~14 天 (串行)
关键路径: P0-1 (5d) → P0-4 (2d) = 7d
```

#### 并行化建议

| 组合 | 工作日 | 说明 |
|------|:--:|------|
| **Stream A**: P0-1（状态架构） | 5d | 一人专注，最长路径 |
| **Stream B**: P0-2 前半（非受控输入 + 草稿）+ P0-3（连接健壮性） | 4d | 独立于 P0-1，可同时进行 |
| **Stream C**: P0-4（性能基础） | 2d | 依赖 P0-1 完成，Day 6-7 执行 |

---

### 3.6 Quick Wins（<1 天/项，高可见影响）

以下 5 项任务可独立完成，不依赖其他 P0 任务，每项预计 0.5-1 天：

| # | 任务 | 时间 | 影响 | 变更范围 |
|---|------|:--:|------|------|
| **QW-1** | **非受控输入迁移** | 0.5d | 流式渲染时 PromptInput 不再闪烁/丢焦点；用户可直接感知 | `PromptInput.tsx:49` 1 行变更 + handleChange 重写（~30 行） |
| **QW-2** | **草稿持久化** | 0.5d | 切换线程不再丢失输入；用户最常抱怨的问题之一 | 新文件 `useInputDraft.ts` (~40 行) + `PromptInput.tsx` 集成 (~10 行) |
| **QW-3** | **WebSocket 心跳** | 0.5d | 断线检测从"用户发现无响应"变为 15s 自动检测 | `eventClient.ts` 添加 startHeartbeat/stopHeartbeat (~40 行) |
| **QW-4** | **Zustand selector 粒度** | 0.5d | 减少不必要重渲染，改善性能感知 | 审计 `App.tsx` 中所有 `useXStore(s => s.xxx)` 调用（~10 处） |
| **QW-5** | **Toast 反馈** | 0.5d | 操作（创建线程/启动 run/取消）有明确成功/失败反馈 | 将现有 `ToastContext` 接入 `handleCreateThread`、`handleSend`、`handleCancel`（~20 行） |

**QW 实施建议**：QW-1 和 QW-2 可同一天完成（同一文件 PromptInput.tsx）；QW-3 和 QW-4 互不依赖，可同时进行。

---

### Phase 1: 竞争 UX（~15 天）

> 目标：在关键 UX 维度上达到或超越参考项目水平

#### P1-1: 多 Agent 聊天（5 天）

- [ ] **消息树形数据模型**（2 天）
  - 文件：`app/desktop/src/lib/messageTree.ts`（新建）
  - 函数：`buildTree<T>(messages: T[], getParentId) → TreeNode<T>[]`
  - 函数：`flattenTree<T>(tree: TreeNode<T>[]) → FlatNode<T>[]`
  - 文件：`app/desktop/src/components/ChatView.tsx` — 使用 flattenTree 渲染
  - 参考：LibreChat `03-source-adoption-map.md` buildTree + siblingIndex

- [ ] **子 Agent 内联视图**（2 天）
  - 文件：`app/desktop/src/components/SubAgentCard.tsx`（新建）— 嵌套子 Agent 消息卡片
  - 文件：`app/desktop/src/hooks/useChatMessages.ts` — 处理 `run.agent.child_spawn` / `run.agent.child_result` 事件
  - 文件：`app/desktop/src/components/ChatView.tsx` — children 递归渲染
  - 参考：Codex CLI `AgentTree/AgentPath` + LibreChat 子代理调度

- [ ] **消息 Fork 支持**（1 天）
  - 文件：`app/desktop/src/components/MessageActions.tsx`（新建）
  - 功能：从任意 agent 消息分叉新对话
  - 文件：`app/desktop/src/api/threadQueries.ts` — forkThread mutation
  - 参考：LibreChat Fork 4 模式算法

#### P1-2: 富文本输入（4 天）

- [ ] **@提及 + 自动补全**（2 天）
  - 文件：`app/desktop/src/components/MentionInput.tsx`（新建）
  - 类型：`@agent` — Agent 列表 | `@file` — 工作区文件 | `@thread` — 历史线程
  - 文件：`app/desktop/src/components/MentionDropdown.tsx`（新建）— 自动补全下拉
  - 参考：LibreChat / OpenCode 提及系统

- [ ] **斜杠命令系统**（1.5 天）
  - 文件：`app/desktop/src/commands/registry.ts`（新建）— 可插拔命令注册表
  - 内建命令：`/model`, `/agent`, `/clear`, `/retry`, `/fork`, `/search`, `/help`, `/export`
  - 文件：`app/desktop/src/components/PromptInput.tsx` — 集成命令补全
  - 参考：aider 30+ slash commands + continue 可插拔命令

- [ ] **模型别名解析**（0.5 天）
  - 文件：`app/desktop/src/lib/modelAliases.ts`（新建）— MODEL_ALIASES 映射表
  - 文件：`app/desktop/src/components/ModelSelector.tsx` — 集成别名
  - 参考：aider `models.py:92-116` MODEL_ALIASES

#### P1-3: Agent 可观测性（3 天）

- [ ] **Token 用量实时更新**（1 天）
  - 文件：`app/desktop/src/components/ContextUsage.tsx` — 订阅流式 token 事件，实时更新进度条
  - 文件：`app/desktop/src/hooks/useChatMessages.ts` — 在 `run.agent.text_delta` 中提取 token 计数
  - 参考：OpenCode token meter / LobeHub 实时费用

- [ ] **工具调用时间线面板**（1 天）
  - 文件：`app/desktop/src/components/ToolTimeline.tsx`（新建）
  - 功能：按时间排列工具调用、显示耗时、成功/失败状态、展开查看输入/输出
  - 参考：OpenCode `03-ui-adoption.md` 工具调用时间线

- [ ] **Agent 任务列表**（1 天）
  - 文件：`app/desktop/src/components/TaskList.tsx`（新建）
  - 功能：显示当前运行的任务列表、进度指示、完成/失败状态、摘要
  - 文件：`app/desktop/src/hooks/useChatMessages.ts` — 处理 `task_started/task_progress/task_notification` 事件（已存在事件处理，仅需 UI 组件）
  - 参考：OpenCode task tracking

#### P1-4: 线程管理升级（3 天）

- [ ] **按项目+日期分组**（1 天）
  - 文件：`app/desktop/src/components/ThreadPanel.tsx` — 添加分组逻辑
  - 分组：Today / Yesterday / This Week / Older + 嵌套项目分组
  - 参考：CCViewer / LibreChat 分组模式

- [ ] **线程状态标记**（0.5 天）
  - 文件：`app/desktop/src/components/ThreadPanel.tsx` — 状态图标
  - 状态：running（绿色脉冲）| failed（红色）| completed（灰色）| archived（隐藏）
  - 参考：LobeHub 线程状态

- [ ] **线程归档**（0.5 天）
  - 文件：`app/desktop/src/api/threadQueries.ts` — archiveThread / unarchiveThread
  - 文件：`app/desktop/src/components/ThreadPanel.tsx` — 归档 UI

- [ ] **快捷键面板**（1 天）
  - 文件：`app/desktop/src/components/ShortcutPanel.tsx`（新建）— `?` 快捷键大全
  - 文件：`app/desktop/src/hooks/useKeyboard.ts` — 扩展快捷键注册
  - 参考：OpenCode Keyboard Shortcuts

---

### Phase 2: 差异化功能（~20 天）

> 目标：构建 AgentHub 独有的差异化能力

#### P2-1: 进阶 Diff/代码审查（5 天）

- [ ] **Side-by-side diff 视图**（2 天）
  - 文件：`app/desktop/src/components/DiffViewer.tsx` — 添加 side-by-side 模式切换
  - 文件：`app/desktop/src/components/DiffSideBySide.tsx`（新建）
  - 参考：CCViewer / continue side-by-side

- [ ] **行级评论**（1.5 天）
  - 文件：`app/desktop/src/components/DiffLineComment.tsx`（新建）
  - 功能：在 diff 行上添加评论/建议
  - Store：扩展 diffViewerStore
  - 参考：CCViewer DiffViewer 行评论

- [ ] **Diff 语法高亮**（1 天）
  - 文件：`app/desktop/src/components/DiffViewer.tsx` — 集成 Shiki 或 highlight.js
  - 参考：continue Shiki 代码渲染 / CCViewer

- [ ] **Diff 统计面板**（0.5 天）
  - 文件：`app/desktop/src/components/DiffStats.tsx`（新建）
  - 内容：文件变更数、+N/-M 行数摘要、变更语言分布
  - 参考：OpenCode DiffViewer 统计

#### P2-2: 多 Agent 协作可视化（5 天）

- [ ] **Agent 通信图可视化**（3 天）
  - 文件：`app/desktop/src/components/AgentGraph.tsx`（新建）— D3/ReactFlow 渲染 Agent 间消息传递
  - 功能：节点 = Agent，边 = 消息，实时动画
  - 参考：Codex CLI AgentTree / Kanna AgentCoordinator

- [ ] **Agent 市场/发现**（2 天）
  - 文件：`app/desktop/src/components/AgentMarket.tsx`（新建）
  - 功能：浏览预置 Agent、安装/卸载、角色配置
  - 参考：LobeHub Agent 市场 / `projects/lobehub/02-full-borrow-list.md`

#### P2-3: 实时协作（4 天）

- [ ] **多光标/实时协作**（3 天）
  - 文件：`app/desktop/src/hooks/useCollaboration.ts`（新建）
  - 依赖：Yjs / PartyKit 或 WebSocket 广播
  - 功能：多人同时查看同一会话、实时看到他人输入
  - 参考：LibreChat 多用户

- [ ] **会话共享链接**（1 天）
  - 文件：`app/desktop/src/components/ShareDialog.tsx`（新建）
  - 功能：生成只读/可写分享链接、权限控制

#### P2-4: 工作区集成（3 天）

- [ ] **文件树侧栏**（1.5 天）
  - 文件：`app/desktop/src/components/FileTree.tsx`（新建）
  - 功能：显式工作区文件树、点击打开 diff、右键菜单（add to context / ignore）
  - 参考：OpenCode file explorer

- [ ] **Git 集成面板**（1.5 天）
  - 文件：`app/desktop/src/components/GitPanel.tsx`（新建）
  - 功能：变更文件列表、stage/unstage、commit message 生成、diff review
  - 参考：CCViewer Git commit UI / aider auto-commit

#### P2-5: 性能和可访问性（3 天）

- [ ] **React.memo 全面审计**（1 天）
  - 文件：所有组件 — 添加 React.memo + useMemo/useCallback 审计
  - 工具：React DevTools Profiler
  - 参考：OpenCode 性能优化

- [ ] **代码块懒加载**（0.5 天）
  - 文件：`app/desktop/src/components/MarkdownRenderer.tsx` — 大代码块折叠 + 按需展开
  - Mermaid 图表懒加载
  - 参考：OpenCode 懒加载

- [ ] **完整的 a11y 审计**（1 天）
  - 标准：WCAG 2.1 AA
  - 内容：键盘导航、屏幕阅读器、焦点管理、对比度检查
  - 文件：所有交互组件

- [ ] **E2E 测试覆盖**（0.5 天）
  - 工具：Playwright + Tauri driver
  - 覆盖：消息流、线程 CRUD、设置、主题切换

---

## 4. 技术架构决策

### 4.1 组件树

```
App.tsx（视图注册表）
├── AppShell.tsx
│   ├── Sidebar
│   │   ├── ThreadPanel.tsx
│   │   │   ├── ThreadGroup（Today/Yesterday/This Week/Older）
│   │   │   └── ThreadItem（status icon + title + time + actions）
│   │   ├── AgentMarket.tsx [P2]
│   │   └── SettingsPanel.tsx
│   ├── MainPanel
│   │   ├── ChatView.tsx
│   │   │   ├── MessageBubble
│   │   │   │   ├── AgentAvatar
│   │   │   │   ├── MessageBlocks
│   │   │   │   │   ├── TextBlock → MarkdownRenderer
│   │   │   │   │   ├── CodeBlock（语法高亮 + 复制）
│   │   │   │   │   ├── ThinkingBlock（折叠）
│   │   │   │   │   ├── ToolUseBlock → ToolResultRenderer
│   │   │   │   │   ├── FileChangeBlock
│   │   │   │   │   ├── SessionInitBlock
│   │   │   │   │   └── ResultBlock
│   │   │   │   ├── SubAgentCard [P1]
│   │   │   │   ├── MessageActions（Copy/Retry/Delete/Fork） [P1]
│   │   │   │   └── Timestamp（relative + exact tooltip）
│   │   │   ├── ScrollToBottomButton
│   │   │   └── TypingIndicator
│   │   ├── PromptInput.tsx
│   │   │   ├── MentionInput [P1]
│   │   │   ├── MentionDropdown [P1]
│   │   │   ├── SlashCommandCompleter [P1]
│   │   │   ├── AgentSelector
│   │   │   ├── ModelSelector（with aliases） [P1]
│   │   │   └── ReasoningSelector
│   │   └── EmptyState
│   ├── RightPanel（多标签）
│   │   ├── RunDetail
│   │   │   ├── OutputTab
│   │   │   ├── ToolCallsTab → ToolTimeline [P1]
│   │   │   └── FilesTab
│   │   ├── DiffViewer
│   │   │   ├── FileTreeSidebar
│   │   │   ├── DiffSideBySide [P2]
│   │   │   ├── DiffUnified
│   │   │   ├── DiffStats [P2]
│   │   │   └── DiffLineComment [P2]
│   │   ├── TaskList [P1]
│   │   ├── AgentGraph [P2]
│   │   ├── ContextUsage（实时）
│   │   └── GitPanel [P2]
│   ├── StatusBar.tsx
│   ├── SearchDialog.tsx（Ctrl+K）
│   └── ShortcutPanel.tsx [P1]
```

### 4.2 状态管理拆分

```
┌─────────────────────────────────────────────────────────┐
│  TanStack Query（服务端状态 — 缓存 + 同步）              │
│                                                         │
│  queryClient                                            │
│  ├── ["threads"]         → useThreads()                 │
│  ├── ["threads", id]     → useThread(id)                 │
│  ├── ["threads", id, "messages"] → useThreadMessages()  │
│  ├── ["runs"]            → useRuns()                    │
│  ├── ["runs", id]        → useRun(id)                   │
│  └── ["agents"]          → useAgents()     [P2]         │
│                                                         │
│  Mutations:                                              │
│  ├── useCreateRun       (乐观更新)                       │
│  ├── useForkThread      (乐观更新)          [P1]         │
│  ├── useArchiveThread                      [P1]         │
│  └── useDecidePermission                                   │
│                                                         │
│  Events → queryClient.invalidateQueries                  │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  Zustand + subscribeWithSelector（客户端 UI 状态）       │
│                                                         │
│  runStore                                               │
│  ├── isStreaming: boolean                               │
│  ├── currentRunId: string | null                        │
│  ├── runState: AgentLoopState  [P0]                     │
│  ├── loopCount: number          [P0]                     │
│  ├── errorCount: number         [P0]                     │
│  ├── abortController: AbortController | null  [P0]       │
│  └── fileReadCache: Map<string, {count, mtime}>  [P0]   │
│                                                         │
│  uiStore                                                │
│  ├── sidebarWidth: number                               │
│  ├── rightPanelTab: string                              │
│  ├── theme: 'dark' | 'light' | 'system'                 │
│  └── mobileMenuOpen: boolean                            │
│                                                         │
│  connectionStore                                        │
│  ├── isOnline: boolean                                  │
│  ├── isConnected: boolean                               │
│  ├── latency: number                                    │
│  ├── errorCount: number                                 │
│  └── reconnectAttempt: number                           │
│                                                         │
│  settingsStore                                          │
│  ├── defaultModel: string                               │
│  ├── defaultAgent: string                               │
│  ├── permissionMode: string                             │
│  └── language: string                                   │
│                                                         │
│  diffViewerStore  [P1/P2]                               │
│  ├── viewMode: 'unified' | 'side-by-side'               │
│  ├── expandAll: boolean                                 │
│  ├── lineComments: Map<filePath, Comment[]>              │
│  └── acceptedFiles: Set<string>                         │
│                                                         │
│  inputDraftStore  [P0]                                  │
│  └── drafts: Map<threadId, string>  → localStorage      │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  React Context（全局基础设施）                           │
│                                                         │
│  ThemeContext → 主题切换 + CSS 变量                      │
│  I18nContext  → i18next 翻译                            │
│  QueryClientProvider → TanStack Query                    │
│  EventBus Context → typed event bus        [P0]          │
└─────────────────────────────────────────────────────────┘
```

### 4.3 事件流

```
Edge Server                Desktop App
──────┬──                  ──────┬────
     │                          │
     │  WebSocket NDJSON        │
     ├─────────────────────────►│ eventClient.ts
     │  (cursor replay)         │   │
     │                          │   ├── Transport.send()  [P0]
     │                          │   │   ├── WebSocketTransport
     │                          │   │   └── MockTransport (test)
     │                          │   ├── Heartbeat  [P0]
     │                          │   │   └── 10s ping/pong
     │                          │   ├── OfflineQueue  [P0]
     │                          │   │   └── localStorage
     │                          │   └── Reconnect (exponential backoff)
     │                          │
     │                          │   ▼
     │                          │ messageProcessor.ts  [P0]
     │                          │   ├── 类型路由
     │                          │   ├── 循环检测  [P0]
     │                          │   ├── 去重缓存  [P0]
     │                          │   └── 状态机转换  [P0]
     │                          │
     │                          │   ▼
     │                          │ queryClient.invalidateQueries
     │                          │   ├── threadQueries
     │                          │   ├── runQueries
     │                          │   └── agentQueries  [P2]
     │                          │
     │                          │   ▼
     │                          │ Zustand（客户端状态更新）
     │                          │   ├── runStore（isStreaming, runState）
     │                          │   ├── connectionStore（latency, connected）
     │                          │   └── diffViewerStore（lineComments）[P2]
     │                          │
     │                          │   ▼
     │                          │ React 组件树（selector 重渲染）[P0]
     │                          │   ├── ChatView
     │                          │   ├── RightPanel
     │                          │   ├── ContextUsage
     │                          │   └── StatusBar
     │                          │
     │  ◄────────────────────────┤ Transport.send()
     │  (user message,           │   ├── permission_decide
     │   permission decision,    │   ├── cancel
     │   model change)           │   └── user_message
     │                          │
```

### 4.4 设计令牌系统

#### 当前已完成（tokens.css Phase 1）

```css
/* 已完成 — 不做修改 */
--fontSizeXs: 0.75rem    /* 12px — caption, tooltip */
--fontSizeSm: 0.8125rem  /* 13px — secondary text */
--fontSizeBase: 0.875rem /* 14px — body */
--fontSizeMd: 0.9375rem  /* 15px — title, input */
--fontSizeLg: 1.125rem   /* 18px — heading */
--fontSizeXl: 1.5rem     /* 24px — hero */
--fontSizeXxl: 2rem      /* 32px — banner */

/* 表面色 4 层 */
--surfaceDefault / --surfaceRaised / --surfaceSunken / --surfaceOverlay

/* 文字色 4 档 + 2 链接 */
--textPrimary / --textSecondary / --textTertiary / --textDisabled
--textLink / --textLinkHover

/* 动画 */
--animFadeIn / --animSlideInRight / --animProgressIndeterminate
```

#### Phase 2 planned additions

```css
/* P2: OKLCH 高级色系 */
--oklch-accent-base: oklch(65% 0.22 260);  /* 主色调 */
--oklch-accent-hover: oklch(72% 0.22 260);
--oklch-success: oklch(65% 0.18 145);      /* 成功绿 */
--oklch-danger: oklch(58% 0.22 25);        /* 危险红 */
--oklch-warning: oklch(75% 0.15 85);       /* 警告黄 */

/* P1: 微交互动画 */
--animScaleIn: scale-in 150ms ease-out;
--animShimmer: shimmer 2s infinite;
--animCollapse: collapse 200ms ease-out;
--animHighlight: highlight-flash 600ms ease-out;

/* P1: 更细粒度阴影 */
--shadowTooltip / --shadowDropdown / --shadowModal / --shadowSidebar
```

### 4.5 性能策略

| 策略 | 实施阶段 | 方法 | 参考 |
|------|:--:|------|------|
| 虚拟滚动 | P0 | @tanstack/react-virtual，>200 消息时启用 | CCViewer / LibreChat |
| React.memo 审计 | P2 | 关键路径组件 memo + Profiler 验证 | OpenCode |
| Zustand selector | P0 | subscribeWithSelector + 细粒度 selector | Roo-Code |
| 代码块懒加载 | P2 | IntersectionObserver + 按需展开 | OpenCode |
| TanStack Query 缓存 | P0 | staleTime 30s, gcTime 5min, 乐观更新 | Multica |
| 图片/图表懒加载 | P2 | Mermaid 延迟渲染 + loading="lazy" | OpenCode |
| Bundle 分割 | P0 | React.lazy + Suspense 路由级分割 | 现有实现 |
| 流式文本 16ms 批处理 | 现有 | useStreamingText 已实现字符级 batch | Kanna 16ms debounce |

---

## 5. 不构建的内容

基于对比 21 个参考项目的架构验证：

| 决定 | 原因 | 参考验证 |
|------|------|------|
| 不用 protobuf（保持 JSON） | protobuf 对桌面客户端过重 | cline proto → AgentHub 规模用 JSON 足够 |
| 不用自研编辑器（保持 CodeMirror/Monaco？） | 当前 textarea 够用；P1 MentionInput 是轻量增强 | OpenCode Monaco → 过于复杂 |
| 不用 Service Worker 离线 | Tauri 原生离线能力替代 | CCViewer PWA → Tauri 不需要 |
| 不用 WebRTC P2P | Yjs WebSocket 协议足够 | LibreChat → 不需要 |
| 不构建 ChatView 永不卸载 | cline 模式为 VSCode webview 约束 | AgentHub Tauri 没有此限制 |
| 不构建多窗口 | Tauri 多窗口是未来可选功能 | OpenCode → 推迟到 P3+ |
| 不用 CSS Module（仅 Tailwind） | tokens.css + Tailwind 足够；CSS Module 增加维护成本 | LobeHub / OpenCode Tailwind 策略 |
| 不急于 OKLCH 全量迁移 | 当前设计令牌已覆盖 80% 需求 | P2 作为增强 |
| 不引入 Redux/Zustand 之外的状态库 | Zustand + TanStack Query 覆盖全部场景 | Multica 验证 |
| 不构建插件系统（当前） | 先完成核心 UX 打磨 | OpenCode 19 Hook → 6 Hook 提炼 |

---

## 6. 参考引用索引

### 主要参考（按引用频率）

| 项目 | 主要价值 | 文件 |
|------|------|------|
| **cline** | TaskState、loop detection、file dedup、permission controller | `projects/ai-coding-tools/01-source-adoption-map.md` |
| **Roo-Code** | AgentLoopState 状态机、三层架构分离、transport-agnostic、9 ask types | `projects/ai-coding-tools/01-source-adoption-map.md` |
| **Multica** | TanStack Query+Zustand 分离、WSClient 离线队列、Task 生命周期 | `projects/multica/03-source-adoption-map.md` |
| **command-centers** (7 projects) | 非受控输入、草稿持久化、视图注册表 | `projects/command-centers/01-source-adoption-map.md` |
| **LibreChat** | 消息树 buildTree、Fork 4 模式、子代理调度、3 栏布局 | `projects/librechat/03-source-adoption-map.md` |
| **OpenCode** | Token 用量、工具时间线、185 组件 UI、DiffViewer | `projects/opencode/03-ui-adoption.md` + `04-source-adoption-map.md` |
| **aider** | 编辑格式协商、模型别名、prompt caching、斜杠命令 | `projects/ai-coding-tools/01-source-adoption-map.md` |
| **CCViewer** | FTS5 搜索、side-by-side diff、行评论、Git commit UI | `projects/claude-code-viewer/01-overview.md` |
| **Kanna** | KannaSocket 心跳、16ms debounce、AgentCoordinator | `projects/kanna/04-source-adoption-map.md` |
| **LobeHub** | Agent 市场、模型选择器、主题系统、消息类型 | `projects/lobehub/02-full-borrow-list.md` + `03-source-adoption-map.md` |

### 跨项目对比

| 文档 | 用途 |
|------|------|
| `cross-comparison/00-synthesis.md` | 6 大收敛模式、P0 优先列表（6 items, ~21d）、组件到项目映射表 |
| `cross-comparison/02-im-ux.md` | IM/UX 设计、3 栏布局、渐进式信息披露 4 级、Authority 可视化 |
| `cross-comparison/08-ui-beautify-plan.md` | 3 轮美化计划（~18d）、设计令牌升级、组件逐个美化、空状态模板 |
| `cross-comparison/10-best-practices-playbook.md` | 8 组件区最佳实践、优先级/引用计数/工作量/依赖表 |

---

## 7. 总结

### 工作量总计

| 阶段 | 天数 | 任务数 | 核心交付 |
|------|:--:|:--:|------|
| Phase 0: 基础打磨 | 14 | 12 | TanStack Query 基础、非受控输入、循环检测、连接健壮性、虚拟滚动 |
| Phase 1: 竞争 UX | 15 | 12 | 消息树、子 Agent 视图、@提及、斜杠命令、Token 实时、工具时间线、线程分组 |
| Phase 2: 差异化 | 20 | 13 | side-by-side diff、行评论、Agent 通信图、Agent 市场、实时协作、Git 集成、a11y |
| **总计** | **49** | **37** | |

### 关键路径

```
P0 状态架构 (5d) → P0 输入体验 (4d) → P0 连接健壮 (3d) → P0 性能 (2d)
                                            ↓
                    P1 多 Agent 聊天 (5d) → P1 富文本 (4d) → P1 可观测性 (3d) → P1 线程管理 (3d)
                                                                                       ↓
                    P2 Diff 进阶 (5d) → P2 Agent 协作 (5d) → P2 实时协作 (4d) → P2 工作区 (3d) → P2 性能 (3d)
```

### 优先级速查

| 优先级 | 数量 | 代表项 |
|:--:|:--:|------|
| **P0** | 12 | TanStack Query、非受控输入、循环检测、去重、心跳、虚拟滚动、状态机 |
| **P1** | 12 | 消息树、@提及、斜杠命令、子 Agent 视图、Token 实时、时间线、线程分组 |
| **P2** | 13 | side-by-side diff、行评论、Agent 通信图、Agent 市场、协作、Git 集成、a11y |
