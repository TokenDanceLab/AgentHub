# AgentHub 右侧检视面板增强设计

> 2026-06-10 · 设计原则：**不动主聊天流，只增强右侧侧栏**

---

## 0. 设计哲学

**不改动的地方**（绝对不动）：
- 左侧 `GlobalRail`（导航栏）
- 中间 `TranscriptView`（聊天/对话流）
- 底部 `UnifiedComposer`（消息输入框）

**只改这里**：
- **`RightInspector`**（813 行，已存在）—— 三个 tab：`overview` | `browser` | `files`
- 当前结构完全复用，只在每个 tab 内加东西

```
┌────────────┬──────────────────────────────┬──────────────────┐
│ GlobalRail │    TranscriptView            │  RightInspector  │
│ (不动)     │    (不动)                     │  (只改这里)     │
│            │                              │  ┌─ overview ─┐  │
│            │                              │  │ · 运行状态  │  │
│            │                              │  │ · Agent列表 │  │
│            │                              │  │ · 上下文量  │  │
│            │                              │  │ · DAG 进度  │  │
│            │                              │  ├─ browser ──┤  │
│            │                              │  │ · iframe    │  │
│            │                              │  │ · deploy URL│  │
│            │                              │  ├─ files ────┤  │
│            │                              │  │ · PPT/PPTX  │  │
│            │                              │  │ · PDF/DOCX  │  │
│            │                              │  │ · CSV/Excel │  │
│            │                              │  │ · Markdown  │  │
│            │                              │  │ · Code/HTML │  │
│            │                              │  │ · 图片/部署 │  │
│            │                              │  └────────────┘  │
│            │                              │                  │
│  Composer  │  (不动)                       │                  │
└────────────┴──────────────────────────────┴──────────────────┘
```

Insepctor 宽度：默认 `400px`，可拖拽 `48-760px`，可折叠。

---

## 1. Files Tab — 文件预览增强

### 1.1 现状

`ArtifactBrowser.tsx` 已经定义了 `DOCUMENT_EXTENSIONS`：
```typescript
const DOCUMENT_EXTENSIONS = new Set([
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.csv', '.txt',
  '.log', '.rtf',
]);
```

但 `PreviewPanel` 只渲染了 `image` 和 `web` 两种。文档类的 11 种格式虽然能识别归类，但没有实际预览——只显示文件名 + 下载按钮。

### 1.2 目标

Files tab 内每个文件点开 → 按格式类型渲染预览。不需要新 tab，不改变 tab 结构。

### 1.3 格式支持矩阵

| 格式 | 渲染方式 | 依赖 | 复杂度 |
|---|---|---|---|
| **Markdown** `.md` | `MarkdownRenderer`（已存在） | 无 | 0 行 — 直接用 |
| **Code** `.ts/.py/.go/...` | `CodeBlock`（已存在） | 无 | 0 行 — 直接用 |
| **HTML** `.html` | `<iframe srcDoc>` 沙箱 | 无 | 0 行 — 直接用 |
| **图片** `.png/.jpg/.gif/.svg` | `<img>` + lightbox | 无 | 已有基础渲染 |
| **PDF** `.pdf` | `<iframe src>` 原生 PDF viewer | 无（浏览器原生） | 1 行 `<iframe>` |
| **PPT/PPTX** `.ppt/.pptx` | `pptxjs` 解析 → canvas 图片 → slideshow | `pptxjs@3.x`（~100KB gzip） | 新组件 `SlideshowPreview` |
| **Excel/CSV** `.xlsx/.csv` | `xlsx` (SheetJS) → 表格渲染 | `xlsx@0.18.x`（~200KB） | 新组件 `TablePreview` |
| **DOCX** `.docx` | `mammoth.js` → HTML → `<div>` 渲染 | `mammoth@1.x`（~50KB） | 新组件 `DocxPreview` |
| **Deploy URL** | `<iframe src>` | 无 | 0 行 — 直接用 |
| **TXT/LOG** | `<pre>` 文本 | 无 | 0 行 — 直接用 |

### 1.4 具体实现

```
Files tab 内点击文件
  ↓
判断扩展名
  ├── .md          → <MarkdownRenderer content={...} />
  ├── .ts/.tsx/...  → <CodeBlock code={...} language={ext} />
  ├── .html         → <iframe srcDoc={...} sandbox />
  ├── .png/.jpg/... → <img src={...} /> + lightbox
  ├── .pdf          → <iframe src={...} type="application/pdf" />
  ├── .ppt/.pptx    → <SlideshowPreview file={...} />
  ├── .xlsx/.csv    → <TablePreview file={...} />
  ├── .docx         → <DocxPreview file={...} />
  ├── .txt/.log     → <pre>{content}</pre>
  └── 部署URL       → <iframe src={url} />
```

### 1.5 无需新建 tab

三个新增渲染组件（`SlideshowPreview` / `TablePreview` / `DocxPreview`）都是在 **Files tab 内部** 的选择树中按文件点击触发，不改变 Outside tab 结构。

### 1.6 PPT/PPTX Slideshow 组件设计

```
┌─────────────────────────┐
│  slide 1/12     ⬅️ ➡️  │  ← 顶部控制栏
├─────────────────────────┤
│                         │
│   [canvas: slide]       │  ← pptxjs 渲染的单页
│                         │
├─────────────────────────┤
│  ○ ○ ● ○ ○ ...          │  ← 缩略图导航
└─────────────────────────┘
```

- 用 `pptxjs` 在浏览器端解析 `.pptx` 文件（纯前端，无后端依赖）
- 每页渲染为一个 `<canvas>`
- 左右箭头翻页 + 底部缩略图条
- 导出按钮调用 `downloadSlidesAsPptx`（竞品 DDJH44 有类似实现可参考）

---

## 2. Overview Tab — 运行状态与上下文增强

### 2.1 现状

Overview tab 当前显示：任务进度（TaskItem 列表）、文件列表（FileItem）。

### 2.2 新增内容

```
Overview Tab
  ┌──────────────────────────┐
  │ 🔴 Agent 运行状态条       │  ← 新增：实时 streaming 状态
  │ "2 Agents 正在思考..."    │
  │ [Claude ✨] [Codex 💭]   │
  ├──────────────────────────┤
  │ 📊 上下文用量            │  ← 新增：ContextUsage 数据已存在
  │ ████████░░  78% tokens    │  ContextUsage.tsx 组件已存在
  │ 压缩阈值：70%  [调整]     │
  ├──────────────────────────┤
  │ 📋 任务进度               │  ← 已有
  │ ✅ 代码检查完成           │
  │ ⏳ 文档生成中...           │
  ├──────────────────────────┤
  │ 🔀 DAG 任务依赖           │  ← 新增：AgentTeam route 信息
  │ Orchestrator             │
  │ ├── Worker A (✅)        │
  │ ├── Worker B (⏳)        │
  │ └── Worker C (⏸)        │
  ├──────────────────────────┤
  │ 📄 产物文件               │  ← 已有
  │ app.tsx (已生成)          │
  │ README.md (已生成)        │
  └──────────────────────────┘
```

### 2.3 Agent streaming bar

**数据源**：Hub WS 事件 `agent.dispatch` / `agent.stream` / `agent.done` / `agent.failed`（4 个事件常量已存在于 `hubEvents.ts`）

**UI**：顶部一行，显示当前 active agents 的头像、名字、状态图标（思考中💭/执行中🔧/完成✅/失败❌），带停止按钮入口。

**实现**：新建 `AgentStreamingBar` 组件，放在 Overview tab 顶部。10-20 行 CSS + 状态映射逻辑。复用现有 `StatusBadge`。

### 2.4 Context 用量

**数据源**：`ContextUsage.tsx` 组件**已存在于 Desktop 和 Web 两个 app 里**（`app/desktop/src/components/ContextUsage.tsx`、`app/web/src/components/ContextUsage.tsx`）

**UI**：直接复用这个组件，嵌入 Overview tab 顶部。加一个压缩阈值调整入口（未来功能）。

**实现**：1 行 `<ContextUsage .../>` 声明，0 行新代码。

### 2.5 DAG 任务依赖

**数据源**：Hub `AgentTeam` 有 `route_decisions` POST 端点，`RouteDecisionTranscriptBlock` 已定义。Edge orchestrator 有 `orchestrator_dispatch.go`（141 行）。

**UI**：简单树形缩进列表，不需要复杂的力导向图。每个节点显示 Agent 名字、当前状态（完成/进行中/等待/失败）、用时。

**实现**：新建 `DagTree` 组件——`<ul>` + `<li>` + 缩进 + 状态图标。不依赖任何图形库。

**注意**：这里不需要复杂的 DAG 图组件（那是竞品 Toufumind 的 WorkflowArch 组件 233 行），因为我们只需要在 overview tab 里给一个轻量概览。**不是主界面不需要力导向图**。

---

## 3. Browser Tab — 网页预览与部署预览

### 3.1 现状

已有 `browser` tab，基于 `<iframe>` 的网页预览。

### 3.2 增强

部署预览：Agent 部署成功后，Browser tab 自动切换到 deploy URL。复用现有 `<iframe>` 逻辑，新增 deploy URL 检测和自动切换。

**实现**：0 行新 UI 代码——pipeline 层：Edge emit deploy URL → 前端接收 → 自动创建 browser tab with URL。

---

## 4. 新增 UI 面汇总

| 组件 | 位置 | 复杂度 | 依赖 | 说明 |
|---|---|---|---|---|
| **`SlideshowPreview`** | Files tab | 中 | `pptxjs`（~100KB） | 纯浏览器端解析 PPTX → canvas slideshow |
| **`TablePreview`** | Files tab | 中 | `xlsx`（~200KB） | Excel/CSV → 可排序表格 |
| **`DocxPreview`** | Files tab | 低 | `mammoth`（~50KB） | DOCX → HTML 渲染 |
| **`AgentStreamingBar`** | Overview tab | 低 | 无（复用 StatusBadge） | 实时 Agent 状态条，~30 行 TSX |
| **`DagTree`** | Overview tab | 低 | 无（纯 HTML `<ul>`） | 任务依赖树，~40 行 TSX |
| **Deploy preview 自动切换** | Browser tab | 极低 | 无 | 已有 iframe + URL 检测 |

### 不做的事（保持简单）

- ❌ 不改 GlobalRail（导航栏）
- ❌ 不改 TranscriptView（聊天流）
- ❌ 不改 Composer（输入框）
- ❌ 不新建 tab（保持 overview/browser/files 3 tab 结构）
- ❌ 不加力导向 DAG 图（Toufumind WorkflowArch 233 行）——只用 `<ul>` 树
- ❌ 不加 ContextBus 面板（doloveplayer ContextBusPersistence）——概览 tab 里现有的 `ContextUsage` 就够了
- ❌ 不加对话式创建 Agent 向导——这个确实需要设计新的对话流，暂时跳过
- ❌ 不加模型预算/部署闭环面板——这些需要新 settings 页面，暂缓
- ❌ 不加多模态聊天——需要改 Composer，违反"不动聊天流"原则

---

## 5. 实现优先级

```
P0 — 立即（今天，共 3-5 小时）
  1. AgentStreamingBar              Overview tab · 30 分钟
  2. PDF/图片/HTML/MD/Code 预览     Files tab · 30 分钟（全原生，无需库）
  3. SlideshowPreview (PPT/PPTX)    Files tab · 60 分钟
  4. TablePreview (Excel/CSV)       Files tab · 45 分钟
  5. DocxPreview (DOCX)             Files tab · 30 分钟
  6. DagTree (AgentTeam 进度)       Overview tab · 30 分钟
  7. ContextUsage 嵌入 Overview     Overview tab · 5 分钟（组件已存在）
  8. Deploy preview 自动切换         Browser tab · 15 分钟

P1 — 短期（明天，共 2-3 小时）
  9. 对话式创建 Agent               新交互模式（需要 UI 方向确认）
  10. 模型预算/部署面板              新 settings 页

P2 — 规划中
  11. 完整 ContextBus 面板           需要设计 + 新 UI
  12. 多模态聊天                    需要改 Composer
```

---

## 6. 一句话总结

> **右边侧栏已经有 overview/browser/files 三个 tab，每个 tab 内容都是空的或只有骨架。把对应内容填进去——overview 加运行状态+上下文+DAG，browser 加部署自动切换，files 加各格式预览——不改任何主聊天流代码。**
