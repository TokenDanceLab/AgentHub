# OpenCode UI 深度分析 — AgentHub 桌面端借鉴报告

> 分析日期：2026-05-23
> 源码：`reference/opencode/`（MIT 协议，164K+ stars）
> 版本：v1.15.10
> 技术栈：Electron 41 + SolidJS + Effect-TS + Vite + Tailwind + Kobalte UI

---

## 1. UI 架构总览

### 1.1 包结构

```
packages/
  app/        # Web App（会话页面、终端、布局）
  ui/         # 185 个共享 UI 组件
  desktop/    # Electron 壳
  console/    # 终端控制台
  core/       # 核心工具库（路径、编码、加密）
  plugin/     # 插件系统（19 hooks）
  sdk/        # 客户端 SDK（REST + WebSocket）
```

### 1.2 与 AgentHub 的对应关系

| OpenCode 模块 | AgentHub 对应 | 技术差异 | 借鉴方式 |
|------|------|------|------|
| `packages/app/src/pages/session.tsx` | `app/desktop/src/components/ChatView.tsx` | SolidJS → React | 布局结构 + 交互模式 |
| `packages/ui/session-diff.ts` | 无（AgentHub 无 Diff 渲染） | 纯逻辑，跨框架 | **直接移植算法** |
| `packages/app/components/terminal.tsx` | AgentHub 无终端嵌入 | ghostty-web | 集成方案参考 |
| `packages/app/components/session/session-context-tab.tsx` | AgentHub 无上下文用量展示 | SolidJS → React | **新增功能** |
| `packages/app/components/session/session-header.tsx` | `StatusBar.tsx` | 功能更丰富 | 工具栏扩展 |
| `packages/ui/` 185 组件 | shadcn/ui 组件 | Kobalte → Radix | 组件设计模式 |

---

## 2. 核心技术亮点逐个分析

### 2.1 Diff 渲染引擎 — 可移植的核心资产

**文件**：`packages/ui/src/components/session-diff.ts`（125 行）

**工作原理**：
1. 统一三种 diff 输入格式（SnapshotFileDiff / VcsFileDiff / LegacyDiff）
2. 用 `diff` 库的 `parsePatch` 解析 unified diff
3. 分离 before/after 行，构建 `FileDiffMetadata`（`@pierre/diffs` 库）
4. 结果缓存（`Map<string, FileDiffMetadata>`），避免重复解析
5. 支持 partial patch（当 hunks 不从第一行开始时）

**AgentHub 移植计划**：

```typescript
// AgentHub 可直接移植的 4 个纯函数：
normalize(diff: ReviewDiff): ViewDiff    // 统一入口
patch(diff: ReviewDiff)                  // parsePatch → before/after 分离
file(name, patch, before, after)         // 构建 FileDiffMetadata + 缓存
text(diff: ViewDiff, side)              // 提取纯文本用于预览
```

**移植难度**：低。这 125 行是纯逻辑，不依赖 SolidJS 或任何框架。`diff` 和 `@pierre/diffs` 是 npm 包，AgentHub 可直接安装。

**优先级**：**P0** — AgentHub 当前 DiffViewer 组件只展示原始文本，无语法高亮、无行号、无 side-by-side。

---

### 2.2 Terminal 嵌入 — WebSocket PTY 模式

**文件**：`packages/app/src/components/terminal.tsx`（667 行）

**架构**：
```
ghostty-web (WASM 终端) → WebSocket → PTY Server → Shell 进程
                           ↑ cursor sync (binary frame[0]=0 → JSON{cursor})
```

**关键设计**：

| 模式 | 实现 | AgentHub 可借鉴 |
|------|------|------|
| 终端引擎 | ghostty-web（WASM，比 xterm.js 性能好 4x） | 考虑 ghostty-web 替代 xterm.js |
| 连接管理 | WebSocket + 指数退避重连（250ms × 2^n，上限 4s） | Edge Server WebSocket 连通性保障 |
| 状态持久化 | SerializeAddon 序列化缓冲区 + cursor 位置 | 终端 Tab 切换时恢复状态 |
| 尺寸同步 | 100ms 防抖 resize → `client.pty.update({size})` | AgentHub 不需要（无远端 PTY） |
| 自适应配色 | OKLCH theme → 终端 16 色调色板自动映射 | 已有 OKLCH 基础设施，直接复用 |
| 复制粘贴 | 原生 clipboard API + 终端选区检测 | 标准模式 |

**AgentHub 评估**：终端嵌入对 AgentHub **不是 P0**，但 M5+ 如果要内置终端，OpenCode 的 ghostty-web 方案比 xterm.js 更优。当前阶段重点借鉴其 **WebSocket 连接健壮性模式**（指数退避、gone() 检测、优雅关闭）。

---

### 2.3 上下文用量可视化 — AgentHub 缺失的核心功能

**文件**：`packages/app/src/components/session/session-context-tab.tsx`（341 行）
**依赖**：`session-context-breakdown.ts`（132 行）、`session-context-metrics.ts`、`session-context-format.ts`

**功能矩阵**：

| 功能 | OpenCode 实现 | AgentHub 状态 |
|------|------|:--:|
| Session 统计（消息数、耗时、费用） | `stats[]` 17 维度 | ❌ 无 |
| 上下文用量百分比 + 进度条 | `ctx().usage` → 百分比 + 彩色条 | ❌ 无 |
| 按角色分解：system/user/assistant/tool | 5 色分段条 + 百分比图例 | ❌ 无 |
| Model/Provider 信息 | `ctx().providerLabel` + `modelLabel` | ❌ 无 |
| 单条消息原始 JSON 查看 | Accordion 展开 → JSON 渲染 | ❌ 无 |
| System Prompt 展示 | Markdown 渲染 | ❌ 无 |
| 费用追踪（USD） | `Intl.NumberFormat(currency: USD)` | ❌ 无 |

**核心算法** — `estimateSessionContextBreakdown`（132 行纯逻辑）：

```typescript
// 字符数 → token 估算（经验值：≈4 chars/token）
estimateTokens(chars) = Math.ceil(chars / 4)

// 5 类分区：system | user | assistant | tool | other
// 如果估算值 > 实际 input → 等比缩放
if (estimated > input) {
  scale = input / estimated
  // 等比缩放到 input 上限
}
```

**AgentHub 移植建议**：**P0**。AgentHub ChatView 当前完全不展示 token 用量，这是 Agent 对话场景的核心体验缺失。算法纯逻辑可直接移植，UI 用 React 重写（约 2 天）。

---

### 2.4 Session Header — IDE 集成 + 项目管理

**文件**：`packages/app/src/components/session/session-header.tsx`（503 行）

**核心功能**：

1. **"Open In" 按钮** — 用本地 IDE 打开项目目录
   - macOS: VS Code / Cursor / Zed / TextMate / Xcode / Terminal / iTerm / Ghostty / Warp / Finder
   - Windows: VS Code / Cursor / Zed / PowerShell / Sublime
   - Linux: VS Code / Cursor / Zed / Sublime
   - 自动检测已安装应用（`platform.checkAppExists`）
   - 记住用户偏好（`Persist.global("open.app")`）

2. **路径复制** — 一键复制项目路径到剪贴板

3. **Titlebar 集成**：
   ```
   [搜索框] ........................................ [Open In ▼] [Status] [Terminal] [Review] [FileTree]
     ↑ 居中                                          ↑ 右侧 Portal
   ```

4. **Portal 渲染** — `createPortal` 将按钮渲染到 Electron titlebar 的 `#opencode-titlebar-center` / `#opencode-titlebar-right`

**AgentHub 借鉴**：
- **P1** — "在 VS Code 中打开"按钮（Tauri 已有 `shell.open`）
- **P2** — Titlebar 集成（Tauri 有原生 titlebar，不需要 Portal 模式）
- **P2** — 多 IDE 检测和偏好记忆

---

### 2.5 Session 页面布局 — Drag-Drop + Resize + Tab

**文件**：`packages/app/src/pages/session.tsx`（1832 行）

**布局结构**：

```
┌────────────────────────────────────────────────────┐
│ SessionHeader (搜索 + Open In + 工具栏)             │
├──────────┬─────────────────────┬───────────────────┤
│ SidePanel│   MessageTimeline   │  ReviewPanel      │
│ (文件树) │   (对话消息流)       │  (Diff 查看器)    │
│          │                     │                   │
│ [可拖拽] │   [自动滚动]         │  [Tab: Git]       │
│ Resize   │                     │  [Tab: Branch]    │
│ Handle   │                     │  [Tab: Turn]      │
├──────────┴─────────────────────┴───────────────────┤
│ TerminalPanel (可折叠)                              │
│ [Tab1: server] [Tab2: client] [+ New Terminal]     │
└────────────────────────────────────────────────────┘
```

**关键交互**：

| 交互 | 实现 | AgentHub 状态 |
|------|------|:--:|
| 面板拖拽 resize | `ResizeHandle` 组件 + CSS Grid | ❌ |
| Tab 拖拽排序 | `@thisbeyond/solid-dnd` | ❌ |
| 终端 Tab | 多 Tab + 关闭确认 + 状态保持 | ❌ |
| 消息自动滚动 | `createAutoScroll` hook | ❌ |
| 用户滚动检测 | 200px 阈值 + 滚动位置跟踪 | ❌ |
| Hash 定位 | `useSessionHashScroll` → 消息锚点 | ❌ |

**AgentHub 借鉴优先级**：
- **P0** — 消息自动滚动 + 用户滚动检测
- **P1** — 面板 resize（ChatView ↔ DiffViewer ↔ Terminal）
- **P2** — Tab 拖拽排序

---

### 2.6 Session Context Metrics — Token 统计引擎

**文件**：`session-context-metrics.ts`、`session-context-format.ts`

**核心数据结构**：

```typescript
type SessionMetrics = {
  context: {
    total: number        // 总 token
    input: number        // 输入 token
    output: number       // 输出 token
    reasoning: number    // 推理 token
    cacheRead: number    // 缓存读取
    cacheWrite: number   // 缓存写入
    limit: number        // 上下文窗口上限
    usage: number        // 使用率 %
    message: { id, time } // 最后一条消息
    providerLabel: string
    modelLabel: string
  }
  totalCost: number      // 总费用 USD
}
```

**AgentHub 移植**：**P0** — 这些统计在 Go 端（Edge Server）已经可以通过 `AgentAdapter` 的 NDJSON 流解析获得。需要在 Go 端新增 `SessionMetrics` 结构体，前端展示即可。

---

### 2.7 UI 组件设计模式（185 组件）

**关键设计模式**：

1. **复合组件模式**（Compound Components）：
   ```tsx
   <DropdownMenu>
     <DropdownMenu.Trigger />
     <DropdownMenu.Portal>
       <DropdownMenu.Content>
         <DropdownMenu.Item />
         <DropdownMenu.RadioGroup>
           <DropdownMenu.RadioItem />
         </DropdownMenu.RadioGroup>
       </DropdownMenu.Content>
     </DropdownMenu.Portal>
   </DropdownMenu>
   ```
   AgentHub 的 shadcn/ui 已支持此模式（Radix 原生支持），无需额外工作。

2. **图标系统**：`AppIcon` 组件，3 种尺寸（small/medium/large），SVG sprite sheet。AgentHub 可直接借鉴。

3. **国际化分层**：`@solid-primitives/i18n` + 翻译 key（如 `session.header.open.app.vscode`）。AgentHub 已有 i18n，直接扩展。

4. **主题系统**：OKLCH + CSS 变量 + 明暗自动切换。AgentHub 已有相同基础设施。

---

## 3. 横向对比：OpenCode vs AgentHub Desktop

| 维度 | OpenCode Desktop | AgentHub Desktop | 差距 |
|------|:--:|:--:|:--:|
| **Diff 展示** | ✅ GitHub 风格 + 行级评论 | ⚠️ 基础 DiffViewer | **大** |
| **终端嵌入** | ✅ ghostty-web WebSocket PTY | ❌ 无 | 大（非 P0） |
| **Token 用量** | ✅ 5 色分区 + 17 维度统计 | ❌ 无 | **大** |
| **多面板布局** | ✅ 拖拽 resize + Tab | ⚠️ 固定布局 | 中 |
| **自动滚动** | ✅ 200px 阈值 + scroll 检测 | ❌ 无 | **大** |
| **IDE 集成** | ✅ 14 个 IDE 检测 + 一键打开 | ❌ 无 | 中 |
| **消息树/分支** | ❌ 不支持 | ✅ P1 已规划（LibreChat 参考） | AgentHub 领先 |
| **IM 群聊** | ❌ 单 Agent 会话 | ✅ 多 Agent @mention | AgentHub 领先 |
| **权限审批** | ✅ 工具级 allow/deny | ✅ 已实现 | 持平 |
| **主题系统** | ✅ OKLCH + 自动切换 | ✅ OKLCH + CSS 变量 | 持平 |
| **键盘快捷键** | ✅ 全面覆盖 | ✅ 7 层键盘导航 | 持平 |

---

## 4. 采纳优先级 + 工作量估算

### P0 — 立即采纳（M3b 阶段，共 ~10 天）

| # | 采纳项 | 来源文件 | 移植方式 | 天数 |
|---|--------|------|------|:--:|
| 1 | **Diff 渲染引擎** | `ui/session-diff.ts` (125 行) | 直接移植纯函数 → `app/shared/src/diff/` | 1d |
| 2 | **Token 用量展示** | `session-context-tab.tsx` + `breakdown.ts` (473 行) | 算法移植 + React 重写 UI | 3d |
| 3 | **消息自动滚动** | `session.tsx` createAutoScroll 逻辑 | React hook 重写 | 1d |
| 4 | **Session Metrics（Go 端）** | `session-context-metrics.ts` | Go struct + NDJSON 解析扩展 | 3d |
| 5 | **Context Budget 前端展示** | `breakdown.ts` 进度条组件 | React + shadcn 重写 | 2d |

### P1 — M4 阶段（共 ~8 天）

| # | 采纳项 | 天数 |
|---|--------|:--:|
| 1 | 面板 Resize（ChatView ↔ DiffViewer） | 2d |
| 2 | "在 IDE 中打开"按钮（Tauri shell.open） | 1d |
| 3 | Session 统计面板（17 维度） | 3d |
| 4 | 费用追踪展示 | 2d |

### P2 — M5+ 阶段

| # | 采纳项 | 天数 |
|---|--------|:--:|
| 1 | ghostty-web 终端嵌入 | 5d |
| 2 | Tab 拖拽排序 + 多 Tab 布局 | 3d |
| 3 | Titlebar 集成（Portal 模式） | 2d |
| 4 | 多 IDE 自动检测 | 2d |

---

## 5. 关键代码片段（可直接参考）

### 5.1 token 估算（Go 端实现参考）

```go
// OpenCode 算法：token ≈ charCount / 4
func EstimateTokens(charCount int) int {
    return int(math.Ceil(float64(charCount) / 4))
}

type ContextBreakdown struct {
    System    int     // system prompt tokens
    User      int     // user message tokens
    Assistant int     // assistant response tokens
    Tool      int     // tool call/output tokens
    Other     int     // remaining budget
}

func (b ContextBreakdown) Percentages(input int) map[string]float64 {
    if input == 0 { return nil }
    return map[string]float64{
        "system":    float64(b.System) / float64(input) * 100,
        "user":      float64(b.User) / float64(input) * 100,
        "assistant": float64(b.Assistant) / float64(input) * 100,
        "tool":      float64(b.Tool) / float64(input) * 100,
        "other":     float64(b.Other) / float64(input) * 100,
    }
}
```

### 5.2 Diff 引擎移植（TypeScript → AgentHub shared）

```typescript
// 直接复用 `diff` 和 `@pierre/diffs` npm 包
// app/shared/src/diff/normalize.ts
import { parsePatch } from "diff";
import { parseDiffFromFile } from "@pierre/diffs";

export interface ViewDiff {
  file: string;
  patch: string;
  additions: number;
  deletions: number;
  status?: "added" | "deleted" | "modified";
  fileDiff: FileDiffMetadata;
}

// 核心：统一三种 diff 输入格式
export function normalize(diff: SnapshotDiff | VcsDiff | LegacyDiff): ViewDiff {
  // ... 参见 session-diff.ts 完整实现
}
```

### 5.3 消息自动滚动 Hook（React 移植）

```typescript
// app/desktop/src/hooks/useAutoScroll.ts
function useAutoScroll(containerRef: RefObject<HTMLDivElement>, messages: Message[]) {
  const [userScrolled, setUserScrolled] = useState(false);
  const SCROLL_THRESHOLD = 200;

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setUserScrolled(distanceFromBottom > SCROLL_THRESHOLD);
  };

  useEffect(() => {
    if (!userScrolled && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messages, userScrolled]);

  return { userScrolled, handleScroll };
}
```

---

## 6. 不采纳的项

| 模式 | 理由 |
|------|------|
| SolidJS → React 直接复制 UI 代码 | 框架不同，需重写，但逻辑可移植 |
| Electron 壳 | AgentHub 已选 Tauri 2，不换 |
| ghostty-web 终端（当前阶段） | AgentHub 用户不需要内置终端，M5+ 再评估 |
| `@thisbeyond/solid-dnd` 拖拽 | React 生态用 `@dnd-kit/core` |
| Effect-TS 状态管理 | AgentHub 已选 Zustand |
| Kobalte UI → shadcn/ui 替换 | 组件库不同但模式一致，不迁移 |
