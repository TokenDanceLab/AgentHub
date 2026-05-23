# AgentHub 研究综合报告

基于 **28 个参考仓库源码 + 30+ 篇架构规格** 的完整研究，覆盖时间：2026-05-23。

## 10 条收敛结论

所有研究独立进行，最终收敛到以下一致结论：

### 1. EventStore = JSONL 追加 + seq 单调 + 2MB 快照压缩
**来源**: Kanna `event-store.ts:1282`、OpCode `checkpoint/storage.rs:460`、OpenHands 事件流

- 追加只写（append-only），永不修改已有行
- Go channel(1) 序列化写入（writeChain），保证 seq 全局单调
- 单文件超过 2MB 触发快照压缩（zstd level 3）
- 启动恢复路径：loadSnapshot → replayLogs → compactIfNeeded
- 去重键：`(edge_id, seq)` 复合键，非 UUID

### 2. 消息树运行时 O(n) 构建，扁平存 DB
**来源**: LibreChat `buildTree()` `messages.ts:51`、CCViewer 会话渲染

- 单遍 O(n) 算法，hashmap O(1) 父节点查找
- 扁平存储（仅 `parentMessageId` 反向指针），树结构纯运行时构建
- `flattenActivePath()` 只渲染活跃分支，不渲染整棵树
- 流式消息 key 用稳定 `localId`，不用 `messageId`（LibreChat 教训）

### 3. 渐进展开 = 条件渲染，不是 CSS display:none
**来源**: CCViewer ConversationList、Cline `ChatRow.tsx:1300` 判别渲染

- L0 文本始终可见；L1 thinking/tool header 折叠时内容不 mount
- L2 tool params+result 仅在 L1 展开后才 mount
- 用 React state（`{expanded && <Content/>}`）而非 `<details>` 元素
- 性能收益：折叠内容零 DOM 节点

### 4. OKLCH 色彩空间 + shadcn 语义 token
**来源**: Multica `design.md`、`tokens.css`、`base.css`

- OKLCH 感知均匀，可计算无障碍对比度，可平滑动画
- 禁止硬编码 Tailwind 色值（`text-red-500`、`bg-gray-100`）
- 只用 3 个字号：`text-xs`/`text-sm`/`text-base`
- 只用 2 个字重：`font-normal`/`font-medium`
- 无阴影：用 `border` + `spacing` 分隔层级
- 颜色仅用于语义（status/risk/identity），不做装饰

### 5. Zustand 工厂模式
**来源**: Multica `createChatStore({api, storage})`、OpCode `subscribeWithSelector`

- Zustand 管客户端状态，TanStack Query 管服务端状态
- `persist` middleware：`partialize` 排除不可序列化字段，`merge` 做 rehydration 默认值
- WebSocket 事件使 Query 失效——绝不直接写入 store
- 工厂模式注入依赖：`createXStore({ api, storage })` 实现跨平台可测试

### 6. Adapter = Start + AttachStream
**来源**: Codex `ThreadItem` 19 枚举、OpenCode 19 Hooks、Kanna AgentCoordinator

- 两方法接口：`Start(ctx, RunConfig) (StreamHandle, error)` + `AttachStream(ctx, StreamHandle) error`
- StreamHandle 管理 stdin/stdout/stderr + cancel signal
- Adapter 负责进程生命周期，不是调用方
- 统一事件类型：所有 CLI 异构输出映射为 AgentHub 12 种事件

### 7. Fork=Clone, Undo=Replace
**来源**: OpCode checkpoint 系统、LibreChat Fork 4 模式

- 不物理删除事件——`turn_undone` 补偿事件标记逻辑状态
- Fork 深度克隆消息树、重新生成 UUID、重新校准时间戳
- P0 只做 DIRECT_PATH + INCLUDE_BRANCHES 两种 Fork 模式
- 内容寻址存储：SHA-256 + zstd + content_pool（自动去重）

### 8. WebSocket 不是前端第二数据库
**来源**: Multica CLI 硬规则、CCViewer 数据流

- 每个持久化对象有且只有一个 owner store
- WebSocket 传递增量和流式 Item——UI 始终从 owner store 校正
- Edge/Hub EventStore 是唯一持久化数据源
- 派生面板从 owner 读取，不从重复的本地副本读取

### 9. PubSub Broker[T] 双投递
**来源**: Crush `pubsub/broker.go` 泛型事件总线

- `Publish()` — lossy 非阻塞（流式 token delta，满了就丢）
- `PublishMustDeliver()` — bounded-blocking + 每订阅者超时（终端事件：tool result、error、run.finished）
- 每服务内嵌 `*pubsub.Broker[T]`，同时实现 `Subscriber[T]` 接口
- 中央 App DI 容器手动组装所有服务

### 10. 权限 ResolveOnce 竞速
**来源**: Claude Code `PermissionContext.ts` 多源竞速

- 多源同时请求权限：本地对话框 + 伴侣 App + 自动审批分类器 + Channel（MCP）
- `createResolveOnce<T>()` 原子 `claim()` 确保首个响应者胜出
- 后续响应者调用 `claim()` 返回 false，成为 no-op
- bash 安全管线：模式检测→AST分析→heredoc提取→shell引号解析

---

## 28 个参考仓库源码发现

### Tier 1: 直接复用的模式

| 仓库 | 文件 | 行数 | 模式 | AgentHub 文件 |
|------|------|------|------|-------------|
| `opcode` | `process/registry.rs` | 537 | ProcessRegistry 多进程管理 | `src-tauri/src/process_registry.rs` |
| `opcode` | `apiAdapter.ts` | 444 | Tauri invoke vs HTTP 回退 | `src/lib/apiAdapter.ts` |
| `claude-code-webui` | `UnifiedMessageProcessor.ts` | 543 | 统一流式/批量消息处理 | `src/utils/messageProcessor.ts` |
| `kanna` | `event-store.ts` | 1282 | JSONL + 2MB 快照 | `edge-server/internal/events/bus.go` |
| `kanna` | `agent.ts` | 1610 | AgentCoordinator dual-Map | `edge-server/internal/agent_coordinator.go` |
| `LibreChat` | `messages.ts` | 51 | buildTree() O(n) | `src/lib/message-tree.ts` |
| `LibreChat` | `SiblingSwitch.tsx` | 69 | 分支导航 | `src/components/SiblingSwitch.tsx` |
| `multica` | `tab-store.ts` | 845 | Zustand 标签管理 | `src/stores/uiStore.ts` |
| `multica` | `tokens.css` + `base.css` | — | OKLCH token 系统 | `src/styles/tokens.css` |
| `claude-code-viewer` | `DiffViewer.tsx` | 530 | Unified diff 渲染 | `src/components/DiffViewer.tsx` |
| `cline` | `DiffEditRow.tsx` | — | 内联 diff 双格式解析 | `src/components/DiffCard.tsx` |
| `crush` | `pubsub/broker.go` | — | 泛型双投递事件总线 | `edge-server/internal/pubsub/` |

### Tier 2: 适配后使用

| 仓库 | 模式 | 适配说明 |
|------|------|---------|
| `codex` | ThreadItem 19 枚举 | 定义 AgentHub 自己的事件分类（12 种） |
| `codex` | Context 30+ fragments | 每个 context 模块独立可测试 |
| `aider` | RepoMap 双层上下文 | map 概览 + 选中文件详情 |
| `goose` | MCP cancel_token | 所有异步操作必须支持取消 |
| `emdash` | WorktreeHost 抽象 | LocalWorktreeHost + 路径安全校验 |
| `OpenHands` | Session API Key | 会话级密钥，仅运行态有效 |
| `OpenHands` | Pending Message Queue | SQL 离线消息（最多 10 条） |
| `claude-code-source` | ResolveOnce 权限竞速 | 多源同时请求，原子 claim |
| `claude-code-source` | bashSecurity 分层管线 | 模式→AST→heredoc→引号→危险命令 |
| `cline` | ChatRow 判别渲染 | 每工具类型独立渲染函数 |
| `cline` | CommandOutputCard | 状态点 + 输出展开 + Cancel 按钮 |
| `continue` | ChatMessage 多部分模型 | 类型化判别联合 |

### Tier 3: 长期参考

| 仓库 | 模式 | 何时用 |
|------|------|--------|
| `multica` | NavigationAdapter 310行 | 多路由需求时 |
| `kanna` | WebSocket 16ms debounce | 多客户端时 |
| `LibreChat` | Fork.tsx 447行 | 分支功能时 |
| `opcode` | checkpoint SHA-256+zstd | 需要快照时 |
| `codex` | CollabAgentToolCall | 多Agent通信时 |
| `LangFlow` `Flowise` `Dify` `ChatDev` | 可视编排 | P2+ |

---

## 禁止事项（所有参考仓库的反模式共识）

- [ ] 硬编码颜色（`text-red-500`、`bg-gray-100`）→ 用语义 token
- [ ] 任意像素（`text-[11px]`、`w-[137px]`）→ 用内置 scale
- [ ] `font-bold` / `font-semibold` → `font-medium` + `text-foreground`
- [ ] `text-lg` / `text-xl` / `text-2xl` → `text-base` 是上限
- [ ] `shadow-sm` / `shadow-md` → `border` + `spacing` 分隔
- [ ] hover 时 `scale-105` → `hover:bg-muted`
- [ ] Skeleton loading → Spinner 或内联 loading 文字
- [ ] 固定宽度 dropdown `w-52` → `w-auto`
- [ ] Active 被 hover 覆盖样式 → 显式 `data-active:hover:` 复合态
- [ ] CSS `display:none` 做折叠 → React 条件渲染（不 mount）
- [ ] React `key={messageId}` 用于流式消息 → 稳定 `localId`
- [ ] 多个 `useState` 联动管理 → Zustand store
- [ ] 一个视图多个 primary 按钮 → 每个视图最多 1 个
- [ ] Toast 做操作确认 → 内联状态文字（转瞬即逝用户容易错过）
- [ ] 纯黑背景 `#000` / `oklch(0 0 0)` → Dark 模式用深灰

---

## 研究完成矩阵

```
docs/reference/
├── 01-learn/repos/          14/14 ✅  (源码分析)
├── 01-learn/deep-dive/      12/12 ✅  (报告 + 源码对照)
├── 01-learn/web-research/    4/4  ✅
├── 02-decide/                7/7  ✅
├── 03-build/backend/         8/16 ✅  (P0 核心已覆盖)
├── 03-build/frontend/      12/12 ✅  (含源码对照)
└── 04-plan/                  2/2  ✅

reference/ (28 个源码仓库)
├── opcode, claude-code-webui, kanna              ✅
├── LibreChat, claude-code-viewer, multica        ✅
├── claude-code-source, codex, aider, goose       ✅
├── crush, emdash, OpenHands, cline, continue     ✅
├── LangFlow, Flowise, Dify, ChatDev              ✅ (报告)
├── Roo-Code, ruflo, eca, jean, orca, picoclaw   ✅ (报告)
├── langflow (178MB), continue (273MB), goose (351MB) — 过大，抽样关键文件
└── claudecodeui, Roo-Code, orca — 报告已覆盖
```
