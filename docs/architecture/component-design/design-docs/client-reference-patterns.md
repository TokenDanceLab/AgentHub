# AgentHub Desktop Client -- 参考项目模式与采纳映射

> 从 `docs/roadmaps/client.md` 提取的参考项目模式、竞品对比、采纳映射表。
> 原文路线图仅保留任务清单和依赖关系，详见 `docs/roadmaps/client.md`。

---

## 1. 竞争差距分析

对比 6 个关键 UX 维度与最佳参考项目：

### 综合对比

| UX 维度 | AgentHub 当前 | 最佳参考 | 差距 | 核心缺失 |
|------|:--:|------|:--:|------|
| **聊天/消息** | 7/10 | LibreChat (10/10) | -3 | 消息树、Fork、子 Agent 嵌套、消息反应、编辑/重新生成 |
| **Agent 可观测性** | 4/10 | OpenCode (9/10) | -5 | Token 实时用量、工具调用时间线、Agent 状态机可视化、任务列表 |
| **Diff/代码审查** | 5/10 | CCViewer (9/10) | -4 | side-by-side、语法高亮、行级评论、增量流式 diff、diff 统计面板 |
| **Agent 管理** | 3/10 | LobeHub (8/10) | -5 | Agent 市场/发现、实例仪表盘、角色配置、对话历史分析 |
| **布局/Shell** | 6/10 | CCViewer (8/10) | -2 | 可调整面板大小、多面板布局预设、标签面板、命令面板 |
| **主题/设计系统** | 6/10 | LobeHub (9/10) | -3 | 主题市场、自定义主题编辑器、OKLCH 高级色彩、动画库 |

### 聊天/消息体验

| 功能 | AgentHub | LibreChat | OpenCode | LobeHub | cline |
|------|:--:|:--:|:--:|:--:|:--:|
| Markdown 渲染 | x | x | x | x | x |
| 代码语法高亮 | x | x | x | x | x |
| 流式文本渲染 | x | x | x | x | x |
| 工具调用展示 | x | x | x | x | x |
| 消息操作（复制/重试/删除） | x | x | -- | x | x |
| 消息编辑 | -- | x | -- | x | -- |
| 消息重新生成 | -- | x | x | x | -- |
| 消息分支/Fork | -- | x | -- | -- | -- |
| 消息反应（点赞/踩） | -- | -- | -- | x | -- |
| 子 Agent 内联嵌套 | -- | x | -- | -- | -- |
| 消息树形视图 | -- | x | -- | -- | -- |
| 滚动到底部按钮 | x | x | x | x | x |
| 打字指示器 | 三点 | 三点+头像 | 脉冲条 | 三点+头像 | 脉冲条 |
| 消息搜索（会话内） | -- | x | x | -- | -- |

### Agent 可观测性

| 功能 | AgentHub | OpenCode | Kanna | LobeHub | cline |
|------|:--:|:--:|:--:|:--:|:--:|
| 实时 Token 用量 | 结果时 | x（实时） | -- | x（实时） | x（实时） |
| Token 费用显示 | x | x | -- | x | x |
| 工具调用时间线 | -- | x | x | -- | -- |
| Agent 状态机显示 | -- | -- | x | x | -- |
| 工具调用次数统计 | -- | x | -- | -- | -- |
| 上下文窗口百分比 | x | x | -- | x | x |
| 任务/TODO 列表 | -- | x | -- | -- | -- |
| 子 Agent 层级视图 | -- | -- | -- | -- | x |
| 权限请求历史 | x | -- | -- | -- | -- |
| 错误/重试跟踪 | -- | -- | -- | -- | x |

### Diff/代码审查

| 功能 | AgentHub | CCViewer | OpenCode | continue | aider |
|------|:--:|:--:|:--:|:--:|:--:|
| Unified Diff | x | x | x | x | x |
| Side-by-Side | -- | x | -- | x | -- |
| 行号 | x | x | x | x | -- |
| 文件树侧栏 | x | x | x | -- | -- |
| 语法高亮 diff 行 | -- | x | -- | x | x |
| 折叠 hunks | x | x | x | -- | -- |
| Accept/Reject 按文件 | x | -- | -- | -- | -- |
| Accept/Reject 按 hunk | -- | x | -- | x | -- |
| 行级评论 | -- | x | -- | -- | -- |
| 增量流式 diff | -- | -- | -- | x | x |
| Diff 统计面板 | -- | -- | x | -- | -- |
| Git commit UI | -- | x | -- | -- | x |

---

## 2. 参考项目索引（按引用频率）

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

---

## 3. P0 各任务参考模式速查

### P0-1: 状态架构（参考 Multica）

| # | Multica 源文件:行 | 模式 |
|---|---|------|
| 13 | `packages/core/` Zustand stores | Zustand 只存纯客户端状态 |
| 14 | `CLAUDE.md` | WS 事件 → TanStack Query 缓存失效，绝不直接写 store |
| 22 | `packages/core/api/schema.ts` | Zod `parseWithFallback`，schema drift 不白屏 |
| 23 | `CLAUDE.md` | useMutation 默认乐观更新 |

### P0-2: 输入体验（参考 command-centers / cline）

| # | 参考源文件:行 | 模式 |
|---|-------------|------|
| P0#1 | `jean/src/components/chat/ChatInput.tsx:104` | `valueRef` + DOM `.value` 写入；onChange 仅更新 ref 和 empty/non-empty setState |
| P0#2 | `jean/src/components/chat/ChatInput.tsx:106-108` | 1s debounced `setInputDraft` 写入 Zustand |
| P0#2 | `jean/src/components/chat/ChatInput.tsx:164-184` | session 切换时恢复草稿 |
| P0#3 | cline `loop-detection.ts:21-68` | 工具调用签名去重 + 循环检测 |
| P0#4 | cline `TaskState.ts:50-52` | fileReadCache Map<path, {readCount, mtime}> |

### P0-3: 连接健壮性（参考 Kanna / Multica / Roo-Code）

| # | 参考源文件:行 | 模式 |
|---|---------------|------|
| 1 | `kanna/src/client/app/socket.ts:37-404` | KannaSocket：心跳 15s、超时 4s、离线队列、可见性暂停 |
| 2 | Multica `03-source-adoption-map.md` | WSClient 离线队列 + 重连回调 |
| 3 | Roo-Code `ExtensionClient` | transport-agnostic 模式，可替换传输层 |

### P0-4: 性能基础（参考 command-centers / LibreChat）

| # | 参考源文件:行 | 模式 |
|---|-------------|------|
| P0#4 | `emdash/src/renderer/app/view-registry.ts:23-34` | ViewDefinition：WrapView、TitlebarSlot、MainPanel、canActivate 守卫 |
| #15 | LibreChat | `@tanstack/react-virtual` 虚拟列表，200+ 消息时不渲染全部 DOM |

---

## 4. 跨项目对比文档索引

| 文档 | 用途 |
|------|------|
| `cross-comparison/00-synthesis.md` | 6 大收敛模式、P0 优先列表（6 items, ~21d）、组件到项目映射表 |
| `cross-comparison/02-im-ux.md` | IM/UX 设计、3 栏布局、渐进式信息披露 4 级、Authority 可视化 |
| `cross-comparison/08-ui-beautify-plan.md` | 3 轮美化计划（~18d）、设计令牌升级、组件逐个美化、空状态模板 |
| `cross-comparison/10-best-practices-playbook.md` | 8 组件区最佳实践、优先级/引用计数/工作量/依赖表 |

---

## 5. 不构建的内容（基于 21 个参考项目验证）

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
