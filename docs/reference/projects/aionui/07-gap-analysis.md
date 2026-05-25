# 07 - AionUi vs AgentHub 针对性差距报告

> 对照 AgentHub 当前 UI/客户端问题（来源：`docs/roadmaps/client.md`、`docs/handoff/desktop-agent.md`、`docs/handoff/STATE.md`），
> 逐项给出 AionUi 的解决方式和 AgentHub 的具体采纳建议。

---

## 0. 总体判断

AionUi 在**10 个关键问题上领先 AgentHub 6-12 个月**。尤其值得关注的是：

- **Team Mode**：AionUi 已完整实现 Leader-Teammate 编排 + MCP 协调，这是 AgentHub M4 的核心目标
- **Agent 自动发现**：AionUi 的 PATH 扫描 + 配置检测即装即用，AgentHub 仍为手动配置
- **审批分级**：AionUi 的 YOLO/Auto/Manual 三级 + 风险分级 + 白名单，AgentHub 为二元审批
- **Cron 自动化**：AionUi 已完整交付，AgentHub 未排期

但 AgentHub 在以下方面有结构优势：
- **Tauri 更轻量**，资源占用优于 Electron
- **Hub-Edge 分布式架构**天然支持多机协作，AionUi 的远程访问不如
- **后发优势**：可以跳过 AionUi 已踩的坑

---

## 1. P0：状态架构混乱

### AgentHub 当前问题（`docs/roadmaps/client.md` L28-33）

| 问题 | 严重度 |
|------|:--:|
| 服务端/客户端状态混杂，无 TanStack Query | P0 |
| 无正式状态机（RunState 只是 enum，无转换规则） | P0 |
| 无乐观更新，用户操作后等待 round-trip | P0 |
| Zustand store 组件全量订阅，无 selector 粒度 | P0 |

### AionUi 是怎么做的

```
src/renderer/hooks/          # 自定义 hooks 模式
src/renderer/services/       # 业务逻辑层（与 UI 分离）
src/process/services/        # 主进程服务层

状态分层：
  1. 持久化层：SQLite (better-sqlite3) — 会话、消息、Agent 配置
  2. 服务端状态：ACP session state → IPC push → renderer
  3. 客户端状态：React useState/useReducer — 仅 UI 状态
  4. 事件总线：WebSocket + EventEmitter — 实时推送
```

**关键区别**：AionUi **没有用全局状态库**（无 Redux/Zustand）。它用 React Context + hooks + 事件驱动来避免状态混杂：

- 每个 `ConversationPage` 持有自己的 `useConversation` hook
- 消息列表通过 `useReducer` 管理（action: append/update/delete）
- Agent 状态通过 WebSocket 事件推送到 `useEventStream` hook
- 持久化数据通过 IPC 调用主进程，不缓存到 renderer store

```typescript
// AionUi 消息流 hook 模式（简化版）
function useConversation(sessionId: string) {
  const [messages, dispatch] = useReducer(messageReducer, []);
  const [streamState, setStreamState] = useState<'idle'|'streaming'|'done'>('idle');

  useEffect(() => {
    // 订阅 ACP session 事件
    const sub = acpSession.onMessage((msg) => {
      if (msg.type === 'text_delta') {
        dispatch({ type: 'APPEND_TEXT', payload: msg });
      } else if (msg.type === 'tool_call') {
        dispatch({ type: 'APPEND_TOOL_CALL', payload: msg });
      }
    });
    return () => sub.unsubscribe();
  }, [sessionId]);

  return { messages, streamState, send: (text) => acpSession.send(text) };
}
```

### AgentHub 采纳方案

**Phase 1（对齐 AionUi 模式）：**

1. **引入 TanStack Query**（已在路线图中，5 天）
   - 服务端数据（threads, runs, agents）走 TanStack Query
   - 客户端状态（isStreaming, draftText, UI flags）留在 Zustand
   - 参考 AionUi 的"无全局 store"哲学——只把需要共享的放 store

2. **RunState 状态机**（已在路线图中，1 天）
   - 参考 AionUi 的 Agent 会话状态机（`docs/reference/projects/aionui/02-architecture.md#关键状态机`）
   - 状态：`idle → thinking → tool_call/approval/responding → completed/error`
   - 每个状态转换明确触发条件和 side effect

3. **Zustand selector 优化**（已在路线图中，1 天）
   ```typescript
   // 坏：全量订阅
   const store = useRunStore();
   // 好：selector
   const isStreaming = useRunStore(s => s.isStreaming);
   ```

**AionUi 没有但我们该加的**：AionUi 无全局状态库导致跨组件状态传递靠 props drilling。AgentHub 的 Zustand + TanStack Query 方案更优——用 AionUi 的 hooks 模式但保留状态库。

---

## 2. P0：输入体验问题

### AgentHub 当前问题

| 问题 | 原因 |
|------|------|
| 流式渲染时输入框闪烁 | 受控输入 `useState` + 频繁 re-render |
| 无草稿持久化 | 未实现 `useInputDraft` |
| 无工具调用循环检测 | 签名重复触发死循环 |
| 无文件读取去重 | 同一文件被 Agent 反复读取 |

### AionUi 是怎么做的

```typescript
// AionUi ChatInput: 非受控模式
// src/renderer/components/chat/ChatInput.tsx (简化)

function ChatInput() {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 草稿自动保存到 localStorage
  useEffect(() => {
    const saved = localStorage.getItem(`draft:${threadId}`);
    if (saved && textareaRef.current) {
      textareaRef.current.value = saved;
    }
  }, [threadId]);

  // 输入时保存草稿（debounced）
  const handleInput = useMemo(() =>
    debounce(() => {
      const text = textareaRef.current?.value ?? '';
      localStorage.setItem(`draft:${threadId}`, text);
    }, 500),
  [threadId]);

  const handleSend = () => {
    const text = textareaRef.current?.value.trim();
    if (!text) return;
    textareaRef.current.value = '';  // 直接操作 DOM，不触发 re-render
    localStorage.removeItem(`draft:${threadId}`);
    sendMessage(text);
  };

  return <textarea ref={textareaRef} onInput={handleInput} onKeyDown={...} />;
}
```

**AionUi 的防闪烁策略**：
1. 输入框用 **非受控组件**（`useRef` + 直接 DOM 操作）
2. 消息列表和输入框在 React 树中**完全独立**——消息渲染不触发输入框 re-render
3. 草稿用 `localStorage` 按 threadId 存储（非 Zustand store）

**AionUi 的工具调用循环防护**：
```
src/process/agent/acp/AcpSession.ts:
  - 连续 3 次相同工具调用 → 警告用户
  - 连续 5 次相同工具调用 → 自动中断 + 标记循环检测
  - 跟踪 (toolName, argsHash) 组合，不是只跟踪 toolName
```

### AgentHub 采纳方案

全部已在路线图 P0-2（4 天），AionUi 验证了这些模式的有效性：

1. **非受控输入** — 直接照抄 AionUi 的 `useRef + DOM` 模式
2. **草稿持久化** — AionUi 的 `localStorage[threadId]` 方案
3. **循环检测** — AionUi 的 `(toolName, argsHash)` 签名去重 + 3/5 阈值
4. **文件去重缓存** — `Map<path, {readCount, mtime}>` + 路径在缓存中且 mtime 未变 → 跳过读取

---

## 3. P0：连接健壮性

### AgentHub 当前问题

| 问题 | 影响 |
|------|------|
| 无 WebSocket 心跳 | 连接断开静默，用户不知道 Agent 已失联 |
| 无离线消息队列 | 断线期间消息丢失 |
| 无传输层抽象 | WebSocket 和 IPC 混用，测试困难 |
| `useChatMessages` 职责过重 | 消息处理 + 状态 + 事件总线混在一起 |

### AionUi 是怎么做的

```
src/renderer/services/websocket/   # 独立 WebSocket 服务
src/process/services/webserver/    # WebSocket 服务端

连接管理层次:
  1. WebSocketService (singleton)
     - 10s heartbeat ping/pong
     - 15s 无响应 → 触发重连
     - 断线自动重连: 1s → 4s → 16s → 30s (exponential backoff, max 5 retries)

  2. Transport 抽象
     // AionUi 有统一的 transport 接口:
     interface ChannelTransport {
       send(channel: string, data: unknown): void;
       on(channel: string, handler: Function): () => void;
     }
     // IPC 和 WebSocket 都实现此接口

  3. 离线队列 (process layer)
     - 断线时消息入队 (SQLite 持久化)
     - 重连后按序回放 (基于 cursor/seq 去重)
     - 队列上限: 1000 条
```

### AgentHub 采纳方案

全部已在路线图 P0-3（3 天），AionUi 方案完全匹配：

1. **心跳**：AionUi 的 10s ping + 15s timeout 可以直接采用
2. **离线队列**：AionUi 用 SQLite，AgentHub 可用 localStorage（前端）或 Edge Server 缓存（后端）
3. **传输抽象**：AionUi 的 `ChannelTransport` 接口设计可以直接参考
4. **职责拆分**：AionUi 把 messageProcessor / eventBus 分开，在 `src/process/agent/acp/` 中有明确边界

---

## 4. P0：性能基础

### AgentHub 当前问题

| 问题 | 影响 |
|------|------|
| 无虚拟滚动 | 长对话（500+ 消息）渲染卡顿 |
| App.tsx 500+ 行单体 | 架构腐化，每次改动风险高 |

### AionUi 是怎么做的

**虚拟滚动**：
- AionUi 消息列表**没有用虚拟滚动库**
- 策略：CSS `overflow-anchor: auto` + 只渲染可见消息 + 旧消息懒加载
- 消息列表用 React `memo` + `useMemo` 控制 re-render 范围
- 当前端会话超过 200 条消息时，默认只显示最近 100 条，向上滚动时加载更多

**App 拆分**：
- AionUi 用 `viewRegistry` 模式（`src/renderer/pages/`）
- 每个 page 独立，互不引用
- 页面切换：条件渲染（无 Router）

```
AionUi 页面拆分:
  conversation/  — 独立 page，含自己的 ChatInput + MessageList + Sidebar
  team/          — 独立 page，含 TeamDashboard + TaskBoard + MailboxView
  cron/          — 独立 page
  settings/      — 独立 page
  login/         — 独立 page
```

### AgentHub 采纳方案

1. **虚拟滚动**：用 `@tanstack/react-virtual`（已在路线图中），对 AionUi 的"懒加载旧消息"策略可以作为补充
2. **App 拆分**：AionUi 的 page 模式 + `viewRegistry` 已在路线图 P0-4 中规划
3. **额外建议**：引入 React `memo` + `useMemo` 作为虚拟滚动的补充（AionUi 的防御策略）

---

## 5. P1：消息/Agent 交互体验

### AgentHub 当前问题

| 问题 | 说明 |
|------|------|
| 无消息树 | 消息是扁平的，无法表示 Fork/Branch |
| 无子 Agent 视图 | Team/子 Agent 的输出无法内联查看 |
| 无 @提及 | 输入框不支持 `@agent` / `@file` |
| 无斜杠命令 | 不支持 `/search` `/diff` 等快捷命令 |

### AionUi 是怎么做的

**消息 Fork**（`src/process/acp/session/AcpSession.ts`）：
- `AcpSession.fork(messageId)` 从任意消息创建分支会话
- 分支消息在 UI 中显示为缩进/不同背景色
- 支持切回主分支

**子 Agent 视图**（Team Mode）：
- Teammate 的实时输出在 Team Dashboard 中以卡片形式展示
- 点击卡片可展开完整对话

**斜杠命令**（`src/common/slash/` + `src/renderer/hooks/`）：
```typescript
// AionUi 内置斜杠命令:
// /search <query>  → Web 搜索
// /file <path>     → 读取文件
// /agent <name>    → 切换到指定 Agent
// /model <name>    → 切换模型
// /clear           → 清除上下文
// /fork            → 从当前位置 fork
```

**@提及实现**：输入框中 `@` 触发自动补全弹窗，选项来自当前 Team 成员 + 工作区文件

### AgentHub 采纳方案

1. **消息树 + Fork**：路线图 P1-1（5 天）。AionUi 的 `fork()` API + 消息分支 UI 可直接参考
2. **子 Agent 视图**：AionUi 的 `SubAgentCard` 模式——点击展开内联对话
3. **@提及**：路线图 P1-2（4 天）。AionUi 的 `@agent/@file` 自动补全模式
4. **斜杠命令**：路线图 P1-2。AionUi 的 `slash/` 命令注册模式（`/search`, `/file`, `/agent`, `/model`, `/clear`, `/fork`）

---

## 6. P1：Agent 可观测性

### AgentHub 当前问题

| 缺失 |
|------|
| 无实时 Token 用量显示 |
| 无工具调用时间线 |
| 无任务列表（Agent 当前在做什么） |

### AionUi 是怎么做的

**实时 Token 用量**：
```
src/process/acp/metrics/AcpMetrics.ts:
  - 每次 ACP 请求后更新 token usage
  - UI: 侧边栏 StatusBar 常驻显示 {input}/{output} tokens
  - 设置页面显示历史用量图表

src/process/acp/types.ts:
  interface ContextUsage {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  }
```

**工具调用时间线**：
```
Renderer: MessageList 中的 ToolCallCard 组件:
  - 每次工具调用渲染为时间线条目
  - 显示: tool_name | 开始时间 | 耗时 | 状态(执行中/成功/失败)
  - 失败的工具调用显示为红色，可展开查看错误
  - YOLO 模式自动批准的工具标注为"自动"标记
```

**任务列表**（Team Mode）：
```
Team Dashboard → TaskBoard:
  - 列视图: TODO | IN_PROGRESS | DONE | FAILED
  - 每张卡片显示: Task 描述、Assignee、创建时间、状态
  - Leader 可拖拽重新分配
```

### AgentHub 采纳方案

1. **Token 用量**：在 `useEventStream` 中新增 `context.usage` 事件类型，StatusBar 常驻显示
2. **工具时间线**：AionUi 的 `ToolCallCard` 组件模式——时间线 + 状态色 + 可展开
3. **任务看板**：AionUi 的 `TaskBoard` 可用于 AgentHub M4 Team Mode

---

## 7. P1：线程管理

### AgentHub 当前问题

| 问题 |
|------|
| 线程列表扁平，无状态标记（运行中/等待输入/完成/失败） |
| 无归档功能 |
| 无快捷键面板 |

### AionUi 是怎么做的

**线程列表**（`ConversationList` sidebar 组件）：
- 每条线程显示：标题 + 最后消息预览 + 状态色点 + 时间
- 状态色：绿=活跃 / 灰=空闲 / 黄=等待审批 / 红=错误
- 支持搜索 / 固定 / 删除

**快捷键**：
- `Ctrl+K`：命令面板（切换 Agent、搜索会话、执行斜杠命令）
- `Ctrl+N`：新建会话
- `Ctrl+W`：关闭当前会话
- `Ctrl+/`：显示快捷键帮助

### AgentHub 采纳方案

1. **状态标记**：AionUi 的色点系统（绿/灰/黄/红）直接可用
2. **归档**：软删除 → `archived: true` + 隐藏但可恢复
3. **快捷键面板**：`Ctrl+/` 调出 Cheatsheet 弹窗

---

## 8. P2：Diff/代码审查

### AgentHub 当前问题

| 缺失 |
|------|
| 无 side-by-side diff |
| 无行级评论 |
| 无语法高亮 diff |
| 无增量流式 diff |

### AionUi 是怎么做的

**DiffViewer 组件**（AionUi）：
- 使用 Monaco Editor 的 diff 模式（懒加载）
- 支持 unified (上下) 和 split (左右) 两种视图
- 文件变更事件实时推送 → 增量更新 diff
- 不支持行级评论（与 AgentHub 一样缺失）

### AgentHub 采纳方案

AionUi 的 Monaco DiffEditor 方案与 AgentHub 路线图一致。但 AgentHub 可根据自身 Tauri + WebView2 环境选择更轻的方案（如 CodeMirror 6）。

AionUi 的增量 diff 更新模式值得采纳：每次 `file_change` 事件带完整 diff，前端增量应用到已有 diff view。

---

## 9. 跨领域：Agent 协作与 Team Mode

### AgentHub 当前状态

**M4 已交付**但 Team Mode 尚未实现。当前进度：
- 多 Agent 协调基础（M3b 6/6）
- Edge 多 adapter 支持
- 但无真正的多 Agent 对话编排

### AionUi Team Mode 完整方案

已在 `04-agent-model.md` 中详细分析。对 AgentHub 最关键的参考：

1. **TeamSession 架构**：Leader-Teammate 模式 + MCP 协调
2. **Mailbox**：Agent 间异步消息，基于 SQLite 持久化
3. **TaskManager**：任务 CRUD + 状态追踪 + 看板视图
4. **TeamMcpServer**：提供 `assign_task`/`send_message`/`read_mailbox`/`report_result`/`get_status` 等 MCP tools
5. **团队级隔离 workspace**：所有 Agent 共享同一个工作区目录

**AgentHub M4 实现建议**（具体到文件）：

| AionUi 源文件 | AgentHub 目标位置 | 改动量 |
|---------------|-------------------|--------|
| `TeamSession.ts` | `hub-server/orchestration/team_session.go` | 新建 ~400 行 |
| `TaskManager.ts` | `hub-server/orchestration/task_manager.go` | 新建 ~300 行 |
| `Mailbox.ts` | `hub-server/orchestration/mailbox.go` | 新建 ~200 行 |
| `TeamMcpServer.ts` | `hub-server/orchestration/team_mcp.go` | 新建 ~500 行 |
| `TeammateManager.ts` | `hub-server/orchestration/teammate_manager.go` | 新建 ~250 行 |
| Team Page 前端 | `app/desktop/src/pages/TeamPage.tsx` | 新建 ~800 行 |

---

## 10. 跨领域：Cron 定时自动化

### AgentHub 当前状态

未排期，路线图中无此条。

### AionUi Cron 系统（可直接参考）

```
src/process/services/cron/
├── CronService.ts          # 定时任务引擎（cron 表达式解析 + 触发）
├── CronStore.ts            # 任务 CRUD + 持久化
├── CronBusyGuard.ts        # 执行锁（30min 超时硬限制）
├── SqliteCronRepository.ts # SQLite 存储实现
└── WorkerTaskManagerJobExecutor.ts  # 触发 Agent 执行

src/renderer/pages/cron/    # 前端配置界面
```

### AgentHub 采纳建议

**优先级提升到 P1**，理由：
- AionUi 验证了 Cron+Agent 是高频使用场景
- AgentHub 用户需要"每天定时检查项目"等自动化能力
- 改动量不大：Hub Server 新增 `scheduler/` 包 + 前端 Cron 配置页

---

## 总结：优先行动清单

对照 AionUi，AgentHub 客户端方向的优先级建议（覆盖路线图已有 + 新增）：

| 序号 | 任务 | 路线图状态 | AionUi 参考 | 工作量 | 建议排序 |
|------|------|:--:|------|:--:|:--:|
| 1 | 状态架构重构（TanStack Query + 状态机） | 已有 P0-1 | hooks 模式 | 5d | **立即** |
| 2 | 输入体验修复（非受控 + 草稿 + 循环检测） | 已有 P0-2 | ChatInput 实现 | 4d | **立即** |
| 3 | 连接健壮性（心跳 + 离线队列 + 传输抽象） | 已有 P0-3 | WebSocket 架构 | 3d | **立即** |
| 4 | 性能基础（虚拟滚动 + App 拆分） | 已有 P0-4 | page 模式 | 2d | **立即** |
| 5 | Agent 自动发现 | 新增 | AcpDetector | 3d | 高 |
| 6 | 审批分级（YOLO/Auto/Manual + 白名单） | 新增 | ApprovalStore | 3d | 高 |
| 7 | 文件面板 UI | 新增 | FilePanel | 2d | 中 |
| 8 | 消息树 + Fork + @提及 + 斜杠命令 | 已有 P1-1/P1-2 | 全套已实现 | 9d | 中 |
| 9 | Team Mode | 已有 M4 | TeamSession 全套 | 10d | M4 核心 |
| 10 | Cron 自动化 | 新增（建议提升） | CronService | 5d | M5 |
| 11 | IM 通道集成 | 新增 | Channels | 5d | M5 |

AgentHub 的路线图已经相当准确。AionUi 的主要价值在于：**为路线图中的每一项提供了经过 26K stars 项目验证的参考实现**，可以减少试错成本。
