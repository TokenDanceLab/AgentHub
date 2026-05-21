# AgentHub IM 聊天产品层 -- 跨仓库综合设计建议

> 基于 4 份调研报告：`librechat.md` / `cloudcli.md` / `claude-code-viewer.md` / `claude-code-webui.md`
> 分析日期：2026-05-21

---

## 1. 四种产品形态对比

| 维度 | claude-code-webui (sugyan) | CloudCLI (siteboon) | Claude Code Viewer (d-kimuson) | LibreChat (danny-avila) |
|------|---------------------------|---------------------|-------------------------------|-------------------------|
| **定位** | 最轻量 Claude Web 壳 | 多 provider CLI 会话管理器 | 会话历史回放 + 渐进式 UI | 完整 IM 风格 AI 聊天平台 |
| **复杂度** | 最低（~5.6k 行 TS） | 中（插件系统 + Git + 文件树） | 中高（Effect-TS 四层架构 + FTS5） | 高（消息树 + 子代理调度 + MCP 全栈） |
| **IM 属性** | 线性聊天，无分支/多轮管理 | 基础会话列表 + Tab 切换 | 会话列表 + 搜索 + Sidechain，偏只读 | 消息树 + 分支切换 + Fork + SidePanel |
| **多 Agent 能力** | 单 Claude 实例，无编排 | Provider 抽象层（Claude/Cursor/Codex/Gemini），无编排 | Sidechain 可视化子 agent 日志，无调度 | 完整子代理递归调度 + 循环检测 + 深度限制 |
| **后端语言/框架** | Hono (Deno/Node 双运行时) | Express (Node.js) | Hono + Effect-TS | Express + `@librechat/agents` SDK |
| **前端框架** | React + Vite + Tailwind | React + Vite + Tailwind | React 19 + TanStack Router + TanStack Query | React + Recoil + `@radix-ui` |
| **流式协议** | NDJSON over HTTP | SSE + WebSocket 双通道 | SSE（EventBus 驱动） | SSE / WebSocket |
| **持久化** | 无 DB，读 Claude JSONL | SQLite（projects/sessions/scanState） | JSONL 唯一事实源 + `~/.claude-code-viewer/` 缓存 | MongoDB |
| **移动端** | Tailwind 响应式 | 768px 断点 + Drawer + PWA | PWA + MobileSidebar + swipe | 响应式面板 + 拖拽分屏 |
| **认证** | 无（127.0.0.1 本地） | 无（本地工具） | 密码保护（cookie + Bearer 双通道） | OAuth2 + OIDC |
| **核心差异化** | 最小可行 Web 壳，透传 Claude SDK | 插件系统 + Git 面板 + CLI 自动发现 | Progressive Disclosure + Diff 行级评论 + Push 通知 | 完整的 Agent 市场 + MCP 全栈 + 消息树 |

### 1.1 定位光谱

```
最轻包装 ←————————————————————————————————————————————→ 完整 IM 平台

claude-code-webui    CloudCLI    Claude Code Viewer    LibreChat
    (透传 SDK)    (多 CLI 管理)   (历史回放+审查)     (Agent 平台)
```

AgentHub 的目标定位应在 **CloudCLI 与 LibreChat 之间偏右**：即具备 LibreChat 级的多 Agent 调度和 IM 交互能力，但继承 CloudCLI 的 CLI 互操作性和 Claude Code Viewer 的渐进式信息披露设计。

### 1.2 各产品形态对 AgentHub 的适用性拆解

| 形态要素 | 来源 | 适合 AgentHub? | 理由 |
|---------|------|:---:|------|
| 透传 Claude SDK | claude-code-webui | 部分适用 | Hub 作为调度层不应完全透传，需在 Hub 端做 context compaction 后再分发 |
| 多 Provider CLI 自动发现 | CloudCLI | **高** | AgentHub 需统一发现 Claude Code / Codex / 其他 CLI agent 的 session |
| 插件系统（Manifest + RPC） | CloudCLI | **高** | AgentHub 的 Panel 扩展、自定义工具渲染、IM 功能扩展均适用 |
| Progressive Disclosure | Claude Code Viewer | **最高** | Agent 执行日志天然信息密集，渐进展开是唯一可维护方案 |
| Diff 行级评论 | Claude Code Viewer | **高** | AgentHub 的代码审查场景核心交互 |
| 消息树 + 分支 + Fork | LibreChat | **最高** | AgentHub 的 IM 层核心竞争力 —— 分支探索 + 会话分叉 |
| 子代理递归调度 | LibreChat | **最高** | AgentHub Runner 的调度层核心参考 |
| MCP 全栈客户端 | LibreChat | **高** | AgentHub 需工具服务层，MCP 是最优协议 |
| Provider Adapter Dispatch | LibreChat | **中高** | 统一模型接入层 |
| 消息树数据模型与渲染 | LibreChat | **最高** | 核心 UI 数据模型 |
| Agent 市场 (Marketplace) | LibreChat | **中** | AgentHub 长期可做 Agent 发现/共享 |
| 响应式单断点 768px | CloudCLI | **高** | 简化组件逻辑，足够覆盖手机/平板/桌面 |
| visualViewport 键盘适配 | CloudCLI | **高** | iOS 必选项，仅 13 行代码 |
| PWA manifest + SW | CloudCLI / CC Viewer | **中** | 初期加入成本低 |

---

## 2. AgentHub IM 界面的具体组件设计建议

### 2.1 整体布局架构

借鉴 CloudCLI 的 **Project > Session 二级侧边栏** + Claude Code Viewer 的 **Right Panel 多 Tab** + LibreChat 的 **SidePanel 功能面板**，形成三栏式桌面布局：

```
+------------------+---------------------------+------------------+
|  Sidebar (256px) |    Main Chat Area         |  Right Panel     |
|                  |                           |  (collapsible)   |
| + Search         | + Message Tree           | + Diff Viewer    |
| + Project List   | + SiblingSwitch          | + File Explorer  |
| + Session List   | + ChatInput              | + Artifacts      |
| |-- Today        | + Permission Panel       | + Git Panel      |
| |-- Yesterday    |                          | + Terminal       |
| |-- Older        |                          |                  |
| + Archived       |                          |                  |
+------------------+---------------------------+------------------+
```

移动端：Sidebar → Drawer overlay（借鉴 CloudCLI），Right Panel → bottom sheet（借鉴 LibreChat 拖拽分屏）。

### 2.2 Sidebar（会话列表侧边栏）

**核心借鉴**：

| 功能 | 来源 | 实现要点 |
|------|------|---------|
| Project > Session 二级结构 | CloudCLI | 按项目分组，展开后可折叠。已归档独立分区。 |
| 按日期分组 | LibreChat | `groupConversationsByDate()` 模式：Today / Yesterday / Older |
| 虚拟化大列表 | LibreChat | `react-virtualized` 的 AutoSizer + List + CellMeasurer |
| Session 卡片：title + 最后消息 + 时间 | LibreChat Convo.tsx | 模型 icon + 标题 + 摘要 + 相对时间 |
| 搜索跳转 | Claude Code Viewer | FTS5 全局搜索 + 页内高亮双层互补 |
| Active job 状态指示 | LibreChat | 正在运行的 session 显示 spinner/进度条 |
| 归档分离 | CloudCLI | `archivedProjects` / `archivedSessions` 独立视图 |

**AgentHub 特有增强**：
- 显示每条 session 的 **Authority 类型 badge**（hub / edge / hybrid），和 Edge 位置 label（见 `docs/authority.md`）
- 支持按 Authority / Edge / Active Agent 过滤

### 2.3 消息流（Message Flow）

**核心借鉴**：

| 功能 | 来源 | 实现要点 |
|------|------|---------|
| 消息树数据模型 `{message, children[]}` | LibreChat `buildTree()` | 根节点为首消息，branching 形成兄弟节点 |
| SiblingSwitch 分支导航 | LibreChat | `siblingIdx / siblingCount` + 左右箭头，siblingCount > 1 时才显示 |
| Fork 四种模式 | LibreChat Fork.tsx | DIRECT_PATH / INCLUDE_BRANCHES / TARGET_LEVEL / DEFAULT。AgentHub 优先实现 DIRECT_PATH + INCLUDE_BRANCHES |
| Progressive Disclosure 层次 | Claude Code Viewer | Thinking (default collapsed) → Tool Use (collapsed) → Subagent (collapsed) → Tool Result (展开 tool 时才可见) |
| Streaming 文本拼接 | claude-code-webui UnifiedMessageProcessor | `addMessage` 首次 + `updateLastMessage` 追加，同一处理器服务 streaming 和 batch history |
| NDJSON 流式协议 | claude-code-webui | `JSON.stringify(chunk) + "\n"`，比 SSE 更简洁 |
| WebSocket 双向流 | CloudCLI | 客户端 → 服务端不需新 HTTP 请求，用户体验更好 |

**AgentHub 特有增强**：
- **Authority 可视化**：每条消息标注产生此消息的 Authority（如 `[Hub]` / `[Edge:us1]`），用色带标识
- **消息所有权线条**：按 authority 文档定义的三种模式（hub-owned / edge-owned / hybrid）在 message tree 中用连线颜色区分
- **消息右键菜单**：Fork from here / Retry / Copy to different Edge / Delete subtree

### 2.4 Diff 面板

**核心借鉴**：

| 功能 | 来源 | 实现要点 |
|------|------|---------|
| Diff 渲染器 | Claude Code Viewer DiffViewer.tsx | 左右分栏（行号 gutter + 代码内容）、颜色方案（green/red/bg-50）、collapsible 文件头 |
| 行级评论系统 | Claude Code Viewer CommentButton/CommentForm | 行内评论按钮 + Popover 表单 + Markdown textarea |
| Git 操作 UI | Claude Code Viewer DiffModal.tsx | Ref 选择器（working/HEAD/branch:/commit:）、文件选择 checkbox 列表、commit message textarea、Commit/Push/Commit+Push 三按钮 |
| AI 生成 Commit Message | CloudCLI | conventional commit 格式 + Claude SDK 生成 + 响应清洗（去 markdown 包装、截取模式行） |
| 错误分类 | CloudCLI + CC Viewer 双重借鉴 | 细分错误类型按码返回（NO_UPSTREAM / NON_FAST_FORWARD / AUTH_FAILED / NETWORK_ERROR / TIMEOUT / HOOK_FAILED），按类型显示不同 UI |
| 完整 Git API | CloudCLI | 14 端点覆盖：status / diff / file-with-diff / commit / revert / branches / checkout / create-branch / delete-branch / commits / commit-diff / remote-status / fetch / pull / push / publish / discard / delete-untracked |

**AgentHub 特有增强**：
- Agent 产出的 diff 自动关联到当时的 tool_use 消息，点击跳转到对应会话位置
- 多 Agent 对同一文件的 diff 对比（side-by-side agent diff comparison）

### 2.5 产物预览（Artifacts / Work Results）

**核心借鉴**：

| 功能 | 来源 | 实现要点 |
|------|------|---------|
| Tab 系统（Code + Preview） | LibreChat Artifacts.tsx | `@radix-ui/react-tabs`、Code 编辑器（Sandpack）、Preview（iframe/HTML 渲染） |
| 多格式渲染 | LibreChat | React/HTML → Sandpack 实时预览、Mermaid → 独立图表渲染 |
| 分屏拖拽 | LibreChat | `setIsDragging` 拖拽手柄调整面板高度/宽度 |
| 版本管理 | LibreChat ArtifactVersion.tsx | 多版本切换（Agent 多次迭代的产物） |
| 下载 | LibreChat DownloadArtifact.tsx | 导出 artifact 为文件 |
| RightPanel 多 Tab | Claude Code Viewer | Explorer / Git / Review / Browser 四 tab 布局 |

**AgentHub 特有增强**：
- **产物与会话关联**：每个 artifact 追溯到产生它的 message + session，支持"查看此产物的完整生成过程"
- **产物对比**：同一 prompt 下不同 Agent 的产物 side-by-side
- **产物类型注册**：通过插件系统注册新的产物类型渲染器（类似 CloudCLI plugin slot 模式）

---

## 3. 四大核心区域的交互设计

### 3.1 会话列表

```
设计原则：可扫描 > 可搜索 > 可操作

┌─────────────────────────────┐
│ 🔍 Search sessions...      │  ← FTS5 全局搜索 bar（C.C. Viewer 模式）
│ [All] [Hub] [Edge:us1] [MCP]│  ← Authority/Edge 过滤标签
├─────────────────────────────┤
│ TODAY                       │
│ ┌─────────────────────────┐ │
│ │ 🤖 claude-4.5 🟢        │ │  ← 模型名 + 运行中状态指示
│ │ Deploy k8s manifests    │ │  ← AI 生成的 session 标题（CloudCLI 反向扫描 title 事件）
│ │ 4 messages · 2m ago     │ │  ← 消息数 + 相对时间
│ │ [Hub] [Edge:us1]        │ │  ← Authority/Edge badge
│ └─────────────────────────┘ │
│ ┌─────────────────────────┐ │
│ │ 🔧 codex · 已归档       │ │  ← 归档状态
│ │ Refactor auth module    │ │
│ │ 12 messages · yesterday │ │
│ └─────────────────────────┘ │
│ ...                         │
│ YESTERDAY                   │
│ ...                         │
│ OLDER                       │
│ ...                         │
├─────────────────────────────┤
│ [Archived Sessions]   (3)   │  ← 归档独立分区（CloudCLI 模式）
└─────────────────────────────┘
```

**交互细节**：

| 操作 | 行为 |
|------|------|
| 点击 session | 进入消息流，自动加载 JSONL/DB 历史 |
| 右键 session | [Rename] [Archive] [Duplicate to new Edge] [Delete] |
| 拖拽 session | 拖到不同 Project/Authority 分组 → 迁移 |
| 悬停 session | 显示 HoverToggle（可隐藏/显示敏感标题，借鉴 LibreChat） |
| Ctrl+K | 打开全局搜索 Dialog（C.C. Viewer 模式），跨所有 session 搜索 |

**数据来源**（借鉴 CloudCLI Session Store 的三层模型）：
```
ServerMessages(REST) + RealtimeMessages(WS) → Merged(去重)
```
去重策略：按 `id` 去重 + 相邻相同文本的 assistant echo 合并。流式消息用 `__streaming_<sessionId>` ID 实时更新。

### 3.2 消息流

```
设计原则：信息密度可控 > 实时流式 > 可分支探索

┌────────────────────────────────────────────────────┐
│ [Hub] User  (2 min ago)                            │
│ "Optimize the auth flow in src/auth/"              │
│                                                    │
│ ┌─ [Edge:us1] Claude · Tool Use: Read ─────────┐  │
│ │  ┌──────────────────────────────────────────┐ │  │
│ │  │ Read src/auth/login.ts            [展开]│ │  │
│ │  │ 40 lines read                         ▼ │ │  │
│ │  └──────────────────────────────────────────┘ │  │
│ └──────────────────────────────────────────────┘  │
│                                                    │
│ ┌─ [Edge:us1] Claude · Thinking ────────────────┐ │
│ │  (default collapsed, 点击展开)                 │ │
│ └──────────────────────────────────────────────┘  │
│                                                    │
│ ┌─ [Edge:us1] Claude · Tool Use: Edit ──────────┐ │
│ │  Diff: src/auth/login.ts (+12 / -8)           │ │
│ │  [📝 查看完整 Diff → 打开 Right Panel]        │ │
│ └──────────────────────────────────────────────┘  │
│                                                    │
│ [Edge:us1] Claude                                  │
│ "I've optimized the auth flow by..."               │
│                                                    │
│ ┌─ Subagent: code-reviewer ─────────────────────┐ │
│ │  (default collapsed, 显示 subagent 数量)       │ │
│ │  🔧 code-reviewer: 3 tool calls, 2 findings   │ │
│ │  [展开 subagent 完整日志]                      │ │
│ └──────────────────────────────────────────────┘  │
│                                                    │
│ ←┘  2 / 3  ←── 分支导航 (SiblingSwitch)         │
│ [📋 Fork this branch] [🔄 Retry] [📤 Copy]       │
└────────────────────────────────────────────────────┘
```

**Progressive Disclosure 层次**（完全继承 Claude Code Viewer 的设计层次）：

```
L0: User/Assistant 消息文本（始终可见）
  └─ L1: Tool Use block（默认折叠，显示 tool name + 参数摘要）
       └─ L2: Tool Result（L1 展开后才可见）
            └─ L3: Subagent Session（Task tool 展开后才可见 sidechain）
                 └─ L4: Subagent 内部的 tool 详情（二度展开）
```

**分支探索交互**（核心借鉴 LibreChat）：

| 操作 | 行为 |
|------|------|
| 点击某条消息的 "Retry" | 创建新 sibling 节点，从该消息重新生成 |
| 左右箭头切换 Sibling | 在同一层级的多个响应间切换（显示 2/3 导航指示器） |
| Fork | 弹出 Fork 模式选择（DIRECT_PATH / INCLUDE_BRANCHES / TARGET_LEVEL / DEFAULT）→ 创建新 conversation |
| Delete subtree | 删除某条消息及其所有 children |

**Authority 可视化**（AgentHub 特有）：

每条消息左侧有色带标识其产生来源：
- 蓝色边框 → Hub 端消息（用户输入、Hub 端处理结果）
- 绿色边框 → Edge 端消息（远程 Agent 执行输出）
- 橙色边框 → Hybrid（Hub+Edge 协作产生）

消息内部标注 Authority 来源标签 `[Hub]` / `[Edge:us1]` / `[Hybrid]`。

**流式渲染**（借鉴 claude-code-webui + CloudCLI 双通道）：

```
WebSocket → JSON.parse → UnifiedMessageProcessor.processMessage()
  ├─ 首次 content_block_start → addMessage(newMsg)
  ├─ 后续 content_block_delta → updateLastMessage(textAppend)
  └─ 最终 content_block_stop / result → finalizeLastMessage()
```

同一条 pipeline 处理 streaming（isStreaming=true）和 batch history（isStreaming=false）。

### 3.3 Diff 面板（Right Panel Tab 1）

```
设计原则：可审查 > 可操作 > 可比较

┌────────────────────────────────────────┐
│ [Diff] [Files] [Preview] [Git] [Term]  │  ← Tab 切换（CC Viewer 模式）
├────────────────────────────────────────┤
│ Branch: main  ▼  Compare: working ▼    │  ← Ref 选择器（CC Viewer 模式）
│                                         │
│ ┌─ src/auth/login.ts ─── +12 / -8 ────┐│  ← Collapsible 文件头 + sticky
│ │  1  1  │ import { Auth } from ...   ││
│ │    2   │+import { cache } from ...  ││  ← 绿色添加行
│ │  3  2  │                           ││
│ │  4   3 │-const OLD_CONFIG = {...}  ││  ← 红色删除行
│ │        │                           ││
│ │  5  4  │ const newConfig = (...) => ││
│ │      💬│ + Add comment (Ctrl+Enter) ││  ← 行级评论（CC Viewer 模式）
│ └────────┴────────────────────────────┘│
│                                         │
│ ┌─ src/auth/session.ts ─ +3 / -1 ─────┐│
│ │  ...                                 ││
│ └──────────────────────────────────────┘│
│                                         │
│ ┌──────── Commit Area (仅 compareTo=───┐│
│ │  [✓] src/auth/login.ts               ││  ← 文件选择 checkbox
│ │  [✓] src/auth/session.ts             ││
│ │  [Select All] [Deselect All]         ││
│ │  ┌─────────────────────────────────┐ ││
│ │  │ refactor(auth): optimize login  │ ││  ← AI 生成 commit msg（CloudCLI 模式）
│ │  │ flow with caching layer         │ ││
│ │  └─────────────────────────────────┘ ││
│ │  [Commit] [Push] [Commit + Push]     ││  ← 三按钮（CC Viewer 模式）
│ └──────────────────────────────────────┘│
└────────────────────────────────────────┘
```

**关键交互**：

| 操作 | 行为 |
|------|------|
| 点击 diff 行号 | 添加/查看行级评论 |
| 从消息流中的 "View Diff" 按钮跳转 | 自动展开对应文件、滚动到对应 hunk |
| 切换 Compare from/to | 比较任意两个 branch/commit/working |
| Commit + Push 失败 | 区分 commit 成功/push 失败，提供 Retry Push（CC Viewer 模式） |
| AI 生成 commit message | 点击 Generate 按钮 → Claude 生成 → 用户编辑 → 提交 |

**AgentHub 特有**：
- Diff 上方显示是哪个 Agent 的哪个 tool_use 产生的变更
- 支持 side-by-side Agent Diff（两个 Agent 对同一文件的修改并列对比）

### 3.4 产物预览（Right Panel Tab 3 / Standalone Panel）

```
设计原则：所见即所得 > 可版本回溯 > 可分屏

┌────────────────────────────────────────────────┐
│ [Diff] [Files] [Preview] [Git] [Term]           │
├────────────────────────────────────────────────┤
│ [Code] [Preview]  ← Artifact v3 ▼              │  ← Tab + 版本选择（LibreChat 模式）
│                                                 │
│ ┌─ Code View ────────────────────────────────┐  │
│ │  import React from 'react';               │  │
│ │  const App = () => {                       │  │
│ │    return <Dashboard data={...} />;        │  │
│ │  };                                        │  │
│ │                                           │  │
│ │  [Copy] [Download] [Open Sandpack]        │  │
│ └───────────────────────────────────────────┘  │
│                                                 │
│ ┌─ Preview (Sandpack) ───────────────────────┐  │
│ │  ┌──────────────────────────────────────┐  │  │
│ │  │                                      │  │  │
│ │  │    Rendered React Component          │  │  │
│ │  │                                      │  │  │
│ │  └──────────────────────────────────────┘  │  │
│ └───────────────────────────────────────────┘  │
│                                                 │
│ ←→ (拖拽调整分屏比例)                           │
│                                                 │
│ Generated by [Edge:us1] Claude · Session #42   │  ← 可追溯性
│ "Build a dashboard component"                   │
│ [View full session →]                           │
└────────────────────────────────────────────────┘
```

**核心交互**：

| 功能 | 来源 | 实现 |
|------|------|------|
| Code + Preview 双 Tab | LibreChat | `@radix-ui/react-tabs` |
| 代码编辑器 | LibreChat Sandpack | Monaco 编辑 + 实时代码预览 |
| Mermaid 图表独立渲染 | LibreChat Mermaid.tsx | `mermaid` 库独立渲染 |
| 多版本切换 | LibreChat ArtifactVersion | 迭代 artifact 版本下拉选择 |
| 分屏拖拽 | LibreChat `setIsDragging` | 水平和垂直方向均可拖拽 |
| 下载 artifact | LibreChat DownloadArtifact | 导出为文件 |

**AgentHub 特有**：
- **产物溯源**：每个 artifact 下方显示完整溯源信息（哪个 Agent、哪个 session、哪个 tool_use、哪个 prompt）
- **多 Agent 产物对比**：同一 prompt 的不同 Agent 产出并列展示
- **产物注册扩展**：通过插件系统注册自定义产物类型渲染器（如 Canvas/SVG/3D 模型预览等）

---

## 4. 全局交互模式与工程建议

### 4.1 移动端策略

综合 CloudCLI 和 Claude Code Viewer 的经验：

1. **单断点 768px**：覆盖手机/平板/桌面，不引入 md/lg/xl 多级断点（CloudCLI 已证明足够）
2. **Sidebar → Drawer overlay**：Backdrop blur + touch 关闭 + translate 动画（CloudCLI 模式，20 行代码）
3. **Right Panel → Bottom Sheet**：移动端将侧边面板转为底部弹出，借鉴 LibreChat 拖拽手柄
4. **visualViewport 键盘适配**：iOS 必选项，`--keyboard-height` CSS 变量（CloudCLI 模式，13 行代码）
5. **PWA ready**：manifest.json + sw.js 骨架，初期加入成本低

### 4.2 实时数据同步模式

综合三种产品的经验，推荐双通道架构：

```
WebSocket (双向实时)
  ├─ 客户端 → 服务端: sendMessage, abort, approvePermission
  └─ 服务端 → 客户端: streaming chunks, permission requests, sessionChanged

REST (持久化回填)
  └─ GET /api/sessions/:id/messages  ← 历史消息 batch 加载
```

前端与 C.C. Viewer 对齐：后端事件 → EventBus → 前端 TanStack Query `invalidateQueries` 自动失效。

### 4.3 消息处理器架构

直接复刻 claude-code-webui 的 `UnifiedMessageProcessor` 模式：

- 单一处理器同时服务 streaming 和 batch history 两种场景
- `ProcessingOptions.isStreaming` 区分行为（流式逐块追加 vs 批量收集后统一排版）
- 同一套 `processSystemMessage` / `processAssistantMessage` / `processResultMessage` / `processUserMessage` 方法

### 4.4 插件扩展点

AgentHub 的 IM 界面应内置以下扩展 slot（在 CloudCLI 仅有 `tab` 的基础上扩展）：

| Slot | 位置 | 用途 | 来源灵感 |
|------|------|------|---------|
| `tab` | Right Panel Tab 条 | 自定义面板（如监控面板、数据库查询） | CloudCLI (已有) |
| `sidebar` | Sidebar 底部区域 | 自定义工具入口、状态指示器 | 新增 |
| `toolbar` | 消息流顶部工具栏 | 会话操作按钮、Agent 切换 | 新增 |
| `overlay` | 模态层 | 自定义对话框、向导 | 新增 |
| `artifact-renderer` | 产物预览区域 | 注册新产物类型渲染器 | 新增（AgentHub 特有） |

### 4.5 技术选型建议

| 层 | 推荐 | 避免 | 理由 |
|----|------|------|------|
| 前端框架 | React + Vite + TailwindCSS | Vue (Nuxt) | 生态成熟度最高，四个仓库中三个用 React |
| 状态管理 | Zustand / Jotai | Recoil | Recoil 已停维护（LibreChat 技术债） |
| 后端框架 | Hono | Express | 轻量 + Deno/Node/Bun 多运行时 + Effect-TS 兼容 |
| 流式协议 | WebSocket + NDJSON | 纯 SSE | SSE 单向，IM 场景需要双向流 |
| 数据层 | PostgreSQL + JSONL 归档 | MongoDB | 关系型更适合多租户 + 权限模型 |
| 虚拟化 | `@tanstack/react-virtual` | `react-virtualized` | 更活跃维护，TanStack 生态 |
| UI 组件 | Radix UI + TailwindCSS | 自研组件库 | 无样式绑定，灵活度高（LibreChat 已验证） |

### 4.6 不推荐借鉴的部分

| 来源 | 不推荐项 | 原因 |
|------|---------|------|
| LibreChat | Recoil 状态管理 | 已停维护 |
| LibreChat | CJS/ESM 双模块 | AgentHub 新项目全 ESM |
| LibreChat | Monolithic 客户端 SPA | AgentHub 三端分离需模块化 UI |
| claude-code-webui | 零认证 | AgentHub 是多用户平台 |
| claude-code-webui | CORS 全开 `origin: "*"` | AgentHub 需严格 CORS |
| Claude Code Viewer | Agent SDK 直接发消息 | 合规风险（Anthropic TOS 限制），AgentHub 应 loose coupling |
| CloudCLI | 纯内存 Session Store | AgentHub 需持久化到 PostgreSQL |
| CloudCLI | 无认证 | AgentHub 需 OAuth2/OIDC |

### 4.7 实施优先级路线

```
Phase 1: 基础 IM 骨架
  ├─ Drawer Sidebar (CloudCLI 模式, 1d)
  ├─ Linear Chat Message Flow (claude-code-webui NDJSON 流式, 3d)
  ├─ basic Session List (CloudCLI Project>Session 二级, 2d)
  └─ ChatInput + Permission Panel (claude-code-webui 模式, 2d)

Phase 2: Agent 可视化与分支
  ├─ Message Tree 数据模型 + SiblingSwitch (LibreChat 模式, 5d)
  ├─ Progressive Disclosure 层次 (C.C. Viewer 模式, 3d)
  ├─ Fork 功能 (LibreChat DIRECT_PATH + INCLUDE_BRANCHES, 3d)
  └─ Authority 可视化 (色带 + badge, 2d)

Phase 3: 代码与产物面板
  ├─ DiffViewer + 行级评论 (C.C. Viewer 模式, 5d)
  ├─ Right Panel 多 Tab 架构 (C.C. Viewer 模式, 3d)
  ├─ Artifacts Code+Preview+版本 (LibreChat 模式, 4d)
  └─ Subagent Sidechain 展开 (C.C. Viewer 模式, 3d)

Phase 4: 高级功能
  ├─ 全局搜索 FTS5 (C.C. Viewer 模式, 5d)
  ├─ Git Panel + AI Commit (CloudCLI + C.C. Viewer 融合, 5d)
  ├─ 插件系统 (CloudCLI Manifest+RPC 模式 + 扩展 slot, 7d)
  ├─ 移动端完整适配 (PWA + visualViewport + BottomSheet, 5d)
  └─ Agent 产物对比 (AgentHub 特有, 5d)
```

---

## 5. 关键差异点总结

AgentHub IM 产品层相对于四个竞品的**独有优势**：

1. **从 CLI 到 IM 的天然桥接**：不像 LibreChat 是独立平台、不像 CloudCLI/CC Viewer 只是 CLI 的 Web 包装，AgentHub 是 Hub -- 既是 IM 界面又是 CLI agent 的调度中枢
2. **Authority 可视化**：消息来源的 Hub/Edge/Hybrid 归属是四个仓库都不具备的
3. **跨 Agent 会话对比**：同一 prompt 下不同 Agent 的 side-by-side 对比，Claude Code Viewer 有 sidechain 但限于单 Agent 的子代理
4. **产物溯源链路**：完整的 artifact → tool_use → message → session → Agent 溯源链
5. **多 CLI 工具的即插即用**：CloudCLI 支持 Claud/Cursor/Codex/Gemini 但无编排，AgentHub 的 Runner 层可实现真正的多 Agent 协作 + 统一 IM 界面
