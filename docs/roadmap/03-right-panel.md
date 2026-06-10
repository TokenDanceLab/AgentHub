# 03 — 右侧栏增强（需要新 UI 面）

> 全在 `RightInspector`（813 行，已有 overview/browser/files 三个 tab）内加内容。
> **不动主聊天流。** 详细设计见 [right-panel-enhancement-design.md](../right-panel-enhancement-design.md)。

---

## 架构约束

```
GlobalRail (不动)  |  TranscriptView (不动)  |  RightInspector ← 只改这里
         ─          |       Composer (不动)    |  overview / browser / files
```

Inspector 宽度：默认 400px，可拖拽 48-760px，可折叠。

---

## Files tab — 文件预览格式增强

| # | 格式 | 渲染方式 | 依赖 | 复杂度 | 验收标准 | 预计 |
|---|---|---|---|---|---|---|
| 1 | PDF `.pdf` | `<iframe>` 浏览器原生 PDF viewer | 无 | 1 行 | Agent 生成 PDF → Files tab 点击 → iframe 内正确渲染 | 5 分钟 |
| 2 | Markdown `.md` | `MarkdownRenderer`（已存在） | 无 | 0 行 — 直接用 | Agent 生成 .md → 点击 → 正确渲染标题/代码块/表格 | 0 |
| 3 | Code `.ts/.py/.go/...` | `CodeBlock`（已存在） | 无 | 0 行 — 直接用 | Agent 生成代码 → 点击 → 语法高亮正确 | 0 |
| 4 | HTML `.html` | `<iframe srcDoc>` 沙箱 | 无 | 1 行 | Agent 生成 HTML → 点击 → iframe 内正确渲染 | 5 分钟 |
| 5 | 图片 `.png/.jpg/.gif/.svg` | `<img>` + lightbox zoom | 无 | 已有基础 | 点击图片 → 放大查看 → 可缩放 | 0 |
| 6 | **PPT/PPTX** `.ppt/.pptx` | `pptxjs` 纯浏览器端解析 → canvas slideshow（左右翻页 + 缩略图条） | `pptxjs@3.x`（~100KB gzip） | 🎨 中 | Agent 生成 .pptx → Files tab 点击 → canvas 渲染 slide 1 → 左右箭头翻页 → 缩略图导航条 | 60 分钟 |
| 7 | **Excel/CSV** `.xlsx/.csv` | SheetJS 解析 → 可排序表格 | `xlsx@0.18`（~200KB） | 🎨 中 | Agent 生成 .xlsx/.csv → 点击 → 表格渲染正确 → 可按列排序 | 45 分钟 |
| 8 | **DOCX** `.docx` | `mammoth.js` 转 HTML → `<div>` 渲染 | `mammoth@1.x`（~50KB） | 🎨 低 | Agent 生成 .docx → 点击 → 格式化文本正确渲染（标题/段落/列表） | 30 分钟 |
| 9 | Deploy URL | `<iframe src>` | 无 | 0 行 — 直接用 | Agent 部署成功 → Browser tab 自动切换到部署 URL | 0 |
| 10 | TXT/LOG `.txt/.log` | `<pre>` 纯文本 | 无 | 0 行 — 直接用 | 点击 → 等宽字体渲染，保留换行 | 0 |

## Overview tab — 运行状态增强

| # | 组件 | 验收标准 | 预计 | 对应 roadmap |
|---|---|---|---|---|
| 11 | **AgentStreamingBar** | 2+ Agent 并发 → 显示头像+状态图标 → 完成后消失 | 30 分钟 | [02 #1](02-light-ui.md) |
| 12 | **ContextUsage** | 对话进行中 → 显示 tokens 用量 → 接近阈值变色 | 5 分钟 | [02 #8](02-light-ui.md) |
| 13 | **DagTree** — 简单 `<ul>` 缩进树，不是力导向图 | AgentTeam 任务 → 树状显示节点 + 状态图标（✅⏳⏸❌）→ 每节点显示用时 | 30 分钟 | — |

## Browser tab — 部署预览

| # | 功能 | 验收标准 | 预计 |
|---|---|---|---|
| 14 | **部署 URL 自动切换** | Agent 部署成功 → Browser tab 自动切换到部署 URL → iframe 加载 | 15 分钟 |

## 新依赖安装

```
pnpm add pptxjs xlsx mammoth
```

总计 ~350KB gzip（仅浏览器端，不影响 Edge/Hub 后端）。

## 不需要做的（保持简单）

- ❌ 不加力导向 DAG 图 → 用 `<ul>` 树就够了
- ❌ 不新建 tab → 保持 overview/browser/files 三个
- ❌ 不加 ContextBus 面板 → Overview 里已有的 ContextUsage 够了
- ❌ 不加对话式创建 Agent 向导 → 需要新聊天交互流，等下个版本
