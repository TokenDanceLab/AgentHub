<!--
  ⚠ ARCHIVED — HISTORICAL REFERENCE ONLY
  This document has been archived from docs/reference/.
  It represents completed research/analysis and is NOT actively maintained.
  The information here may be outdated. Refer to docs/reference/ for current reference material.
  Archived: 2026-06-17
-->

# 02 — 轻 UI 接线（复用现有组件）

> 现有 @shared/ui 和 transcript 合同已能承载，改动在 normalize 层 + 渲染分支 + 少量 CSS。
> **Agent 主导实现，需要你做少量 UI review。**

---

## 核心原则

不动三样东西：
- GlobalRail（左侧导航栏）
- TranscriptView（中间聊天消息流）
- UnifiedComposer（底部输入框）

只改两个地方：
- Transcript 渲染层（`app/shared/src/transcript/`）——给已有 block 类型补渲染分支
- RightInspector Overview tab 内容区（`app/shared/src/workbench/RightInspector.tsx`）

对于消息引用/回复/图片附件——这些确实需要碰 Composer 边界（回复模式、attachment 按钮），但改动量极小（30-90 分钟），不影响主聊天流结构。具体见下方 #9-13。

---

| # | 功能 | 竞品对标 | 验收标准 | 复用组件 | 预计 |
|---|---|---|---|---|---|
| 1 | **Agent streaming bar** — Overview tab 顶部"N 个 Agent 正在思考"状态条 | SeiyunSky · GuqierMcl | 2 个 Agent 并发执行 → 状态条显示 2 个头像 + 状态图标（💭/🔧/✅/❌）→ Agent 完成时自动消失 | StatusBadge + Hub WS agent.* 事件 | 30 分钟 |
| 2 | **消息搜索跳转** — 搜索结果点击 → 聊天区滚动到对应消息 + 高亮 | — | 搜索"部署"→ 点结果 → 聊天流滚动到含"部署"的消息 → 高亮 3 秒 | 现有 SearchDialog + transcript 滚动 | 30 分钟 |
| 3 | **未读计数自动清零** — 进入会话后自动 markRead | — | 进会话 → 3 秒内未读标记消失 → Hub `markRead` API 被调用 | 现有 `messageHandler.MarkRead` REST 端点 | 15 分钟 |
| 4 | **WS 连接状态指示** — StatusBar 显示 WS 状态灯 | — | WS 连接中→黄灯、已连接→绿灯、断开→红灯 | 现有 ConnectionStatus 组件 + workbenchState | 15 分钟 |
| 5 | **StepCard 可视化** — `RunStepGroupTranscriptBlock` 渲染为可折叠步骤卡片，含 plan/tool/skill/artifact/text/error 图标 | Queena1021 · DDJH44 | Orchestrator 任务 → 聊天流出现步骤卡片 → 点击展开看子步骤 → 完成后自动折叠 | RunStepGroupTranscriptBlock（已定义 22+ block 类型中） | 90 分钟 |
| 6 | **逐 hunk Diff 交互** — 点 accept → `applyHunks` → 更新 diff block 状态 | Queena1021 | Diff 卡片显示 accept/reject 按钮 → 点 accept → diff block 状态变为 applied → 文件真实变更（需 #2 管线配合） | DiffViewer.tsx（已有骨架） + shared diff.ts | 60 分钟 |
| 7 | **Artifact Workspace topic 分组** — `ArtifactBrowser` 按 topic 聚合产物卡片 | DDJH44 · Queena1021 | 一个 topic 下多个产物 → 按 topic 分组展示 → 每组显示产物数和类型标签 | ArtifactBrowser + collectTranscriptEvidence（已有） | 60 分钟 |
| 8 | **Context 用量可见** — Overview tab 显示当前上下文用量进度条 | 多竞品 | 对话进行中 → Overview 显示 "78% tokens 已用" → 接近阈值时变黄 | ContextUsage.tsx（Desktop + Web 均已存在！） | 5 分钟 |
| 9 | **消息回复** — 长按/右键消息 → 点"回复"→ Composer 进入回复模式 → 发送后引文渲染在消息气泡上方 | — | 长按某条消息 → 点回复 → Composer 上方出现"回复至 xxx"条 → 发送后原消息下方出现缩进引用 + 新回复 | Composer 回复模式（复用现有 `IMMessageInput`）+ Transcript 引用渲染 | 30 分钟 |
| 10 | **消息引用** — 选中聊天文本 → 点"引用"→ 带引用格式的发消息 | — | 拖动选中一段 Agent 回复 → 点"引用"→ Composer 自动填入 `> 原文...` → 发送后带 blockquote 渲染 | Composer mention bar + MarkdownRenderer blockquote | 20 分钟 |
| 11 | **图片附件** — Composer 加照片/文件按钮，Hub attachment 管线已完整（probe/upload/download 9 个 handler） | — | 点 Composer 旁的 📎 → 选图片 → 上传到 Hub → 消息气泡内嵌缩略图 → 点开原图 | Composer 加一个 button + Hub attachment API 接线 + 消息气泡图片渲染 | 60 分钟 |
| 12 | **Agent 能力标签** — 联系人列表中每个 Agent 显示其能力标签（如"Code Review""前端开发"） | — | 通讯录/Agent 列表 → 每个 Agent 名称旁显示 1-3 个彩色能力标签 | `WorkbenchAgent` 类型已有字段，补 ContactRow/AgentList 渲染 | 15 分钟 |
| 13 | **重新生成 UI** — 长按 Agent 消息 → 点"重新生成"→ 触发管线 #12 → 流式渲染新回复 | — | Agent 回复不满意 → 长按 → 重新生成 → 旧消息变灰 → 新消息流式出现 → 可切回旧版 | 长按菜单加一项 + 流式替换状态 | 20 分钟 |

## 验收门

每项 Mock 模式跑通即可标完成。因为都是 UI 层变动，不需要真实 API。
Mock 验收 = Desktop dev server (5173) 打开 + demo data + 功能路径手走。

## 关于 AgentStreamingBar 的位置

注意：这个组件放 **Overview tab 顶部**（不改 Composer 下方的聊天流区域）。
竞品 SeiyunSky 放的是输入框上方，我们不放那里——会干扰 Composer 的交互。
正确位置是右侧栏 overview tab 的第一行，和其他运行状态信息在一起。
