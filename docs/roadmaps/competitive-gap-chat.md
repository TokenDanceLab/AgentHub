# Chat 交互竞品差距分析

> 分析时间：2026-06-03
> 分析范围：AgentHub Desktop + Web vs 10 个竞品（基于 reference/ 源码 + Web 调研）

## 功能对比矩阵

### 消息类型支持

| 功能 | AgentHub | Cursor | Windsurf | Claude Code | Codex | Devin | OpenHands | Cline | Aider | Copilot Chat |
|------|----------|--------|----------|-------------|-------|-------|-----------|-------|-------|-------------|
| 文本/流式输出 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 代码块 + 语法高亮 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ |
| Thinking/推理折叠 | ✅ | ⚠️ | ❌ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| 内联 Diff 预览 | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ | ✅ | ✅ | ⚠️ |
| 图片/文件附件 | ✅ | ✅ | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ |
| Artifact 预览 (iframe) | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ⚠️ | ❌ | ❌ |
| Token 用量展示 | ✅ | ⚠️ | ❌ | ✅ | ⚠️ | ❌ | ❌ | ✅ | ❌ | ❌ |
| 错误分类展示 | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ⚠️ | ❌ | ❌ |
| Subagent 任务卡片 | ✅ | ❌ | ⚠️ | ✅ | ⚠️ | ✅ | ✅ | ⚠️ | ❌ | ❌ |
| 路由决策展示 | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Deployment 卡片 | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Citation/引用来源 | ✅ | ❌ | ❌ | ⚠️ | ⚠️ | ❌ | ❌ | ❌ | ❌ | ⚠️ |
| 消息操作 (copy/retry/fork/delete) | ✅ | ✅ | ⚠️ | ⚠️ | ✅ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ✅ |

### 多轮对话能力

| 功能 | AgentHub | Cursor | Windsurf | Claude Code | Codex | Devin | OpenHands | Cline | Aider | Copilot Chat |
|------|----------|--------|----------|-------------|-------|-------|-----------|-------|-------|-------------|
| 多轮对话 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Thread/会话管理 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ | ⚠️ | ✅ |
| 对话历史搜索 | ❌ | ✅ | ⚠️ | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ |
| Fork 分支 | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Context 窗口可视化 | ✅ | ⚠️ | ❌ | ✅ | ⚠️ | ❌ | ❌ | ✅ | ❌ | ❌ |
| 上下文压缩提示 | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Conversation resume | ❌ | ⚠️ | ⚠️ | ✅ | ⚠️ | ⚠️ | ❌ | ❌ | ❌ | ❌ |
| 对话 auto-continue | ❌ | ❌ | ❌ | ⚠️ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

### @引用/Mention 系统

| 功能 | AgentHub | Cursor | Windsurf | Claude Code | Codex | Devin | OpenHands | Cline | Aider | Copilot Chat |
|------|----------|--------|----------|-------------|-------|-------|-----------|-------|-------|-------------|
| @agent 引用 | ✅ | ⚠️ | ❌ | ⚠️ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| @file 引用 | ✅ | ✅ | ✅ | ⚠️ | ❌ | ❌ | ⚠️ | ✅ | ✅ | ✅ |
| @thread 引用 | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| @symbol 引用 | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| @folder 引用 | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ |
| @web / @docs | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Slash 命令面板 | ✅ | ⚠️ | ❌ | ⚠️ | ❌ | ❌ | ❌ | ⚠️ | ✅ | ✅ |
| File picker 附件 | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ | ⚠️ | ❌ | ⚠️ |

### 代码交互

| 功能 | AgentHub | Cursor | Windsurf | Claude Code | Codex | Devin | OpenHands | Cline | Aider | Copilot Chat |
|------|----------|--------|----------|-------------|-------|-------|-----------|-------|-------|-------------|
| Inline Diff 卡片 | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ | ✅ | ✅ | ⚠️ |
| Apply Diff 按钮 | ⚠️ | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ | ✅ | ✅ | ⚠️ |
| Full diff viewer | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ | ✅ | ⚠️ | ⚠️ |
| "Apply All" 批量 | ❌ | ✅ | ✅ | ⚠️ | ⚠️ | ❌ | ✅ | ✅ | ⚠️ | ⚠️ |
| 文件变更分组 | ✅ | ⚠️ | ⚠️ | ✅ | ⚠️ | ❌ | ✅ | ⚠️ | ❌ | ❌ |
| Code generation 预览 | ❌ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Review Changes 按钮 | ✅ | ⚠️ | ⚠️ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| Lint/Diagnostic 内联 | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

### 审批流

| 功能 | AgentHub | Cursor | Windsurf | Claude Code | Codex | Devin | OpenHands | Cline | Aider | Copilot Chat |
|------|----------|--------|----------|-------------|-------|-------|-----------|-------|-------|-------------|
| 风险等级 (low/medium/high/critical) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Approve/Deny + Reason | ✅ | ✅ | ⚠️ | ✅ | ✅ | ❌ | ✅ | ✅ | ⚠️ | ⚠️ |
| 二次确认 | ⚠️ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| Timeout 处理 | ✅ | ❌ | ❌ | ⚠️ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| 团队审批 (TeamApproval) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 审批历史追溯 | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Auto-approve 策略 | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |

### 实时流式输出

| 功能 | AgentHub | Cursor | Windsurf | Claude Code | Codex | Devin | OpenHands | Cline | Aider | Copilot Chat |
|------|----------|--------|----------|-------------|-------|-------|-----------|-------|-------|-------------|
| Token-by-token 流式 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| RAF 批处理渲染 | ✅ | ❌ | ❌ | ⚠️ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 流式取消/中断 | ✅ | ✅ | ✅ | ⚠️ | ✅ | ⚠️ | ✅ | ✅ | ⚠️ | ✅ |
| Tab 隐藏时暂停 | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Virtual scrolling | ✅ | ⚠️ | ❌ | ❌ | ⚠️ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Streaming 指示器 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

### IM 集成

| 功能 | AgentHub | Cursor | Windsurf | Claude Code | Codex | Devin | OpenHands | Cline | Aider | Copilot Chat |
|------|----------|--------|----------|-------------|-------|-------|-----------|-------|-------|-------------|
| 群聊/私聊 | ✅ | ❌ | ❌ | ❌ | ❌ | ⚠️ | ❌ | ❌ | ❌ | ❌ |
| 在线状态 | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 消息已读/撤回 | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Agent ↔ 人混合对话 | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ⚠️ | ❌ | ❌ | ❌ |
| 联系人管理 | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 好友请求 | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

（✅ 完善 / ⚠️ 有但不完善 / ❌ 缺失 / 🌟 领先）

## 改进清单（按优先级排序）

### P0 — 必须补齐（比赛评审关键项）

1. **对话历史搜索**
   - 当前状态：AgentHub 完全没有对话历史搜索功能。ChatView 只渲染当前 thread 消息，无跨会话检索能力。
   - 竞品做法：Cursor 支持全局对话搜索（Cmd+Shift+F 搜索所有历史 chat），Copilot Chat 支持按关键词搜索历史对话。Codex Web 端有完整的 thread 列表 + 搜索栏。
   - 改进建议：新增 `SearchDialog` 组件（Web 端已有 `SearchDialog.tsx`，Desktop 端缺失），支持按关键词搜索所有 thread 的消息内容，结果高亮展示匹配文本。Shared 层抽取 `MessageSearchPanel`。
   - 涉及文件：`app/desktop/src/components/SearchDialog.tsx`（新建）、`app/web/src/components/SearchDialog.tsx`（已有，需增强）、`app/shared/src/ui/`（新增 `MessageSearchPanel`）
   - 预估工作量：M

2. **Apply All 批量应用 Diff**
   - 当前状态：`DiffCard` 和 `FileChangeBlock` 只展示单个 diff、Review Changes 按钮丢给外部处理，无"一键应用所有变更"能力。`ArtifactPreview` 的 `onApplyDiff` 是 single-use 模式。
   - 竞品做法：Cursor "Apply All" 一键应用 agent 生成的所有文件变更到工作区；Cline 提供 Accept/Reject per-file + "Accept All"；OpenHands 同样。
   - 改进建议：在 `ChatView` 的 `FileChangeBlock` 或 `ToolGroup` 底部新增"Apply All" action bar，聚合当前 message 中所有 `file_change` 和 `write_result/edit_result` blocks，一次性应用。需要与 `agenthub:apply-diff` 事件体系打通。
   - 涉及文件：`app/desktop/src/components/ChatView.tsx`（新增 ApplyAll action bar）、`app/desktop/src/components/ChatView.types.ts`（新增 `applyAll` action）、`app/shared/src/ui/FileChangeGroup.tsx`（已有组件，可能需要增强）
   - 预估工作量：M

3. **Code Generation 预览（生成前预览）**
   - 当前状态：AgentHub 只在文件变更完成后展示 diff，无"生成前预览模式"。
   - 竞品做法：Cursor 的 Apply 分两步——先在 chat 中展示 diff 预览，用户确认后才 apply；Windsurf 同样。Codex 的 artifact preview 可先预览再 apply。
   - 改进建议：在 `ToolResultRenderer` 中为 `write_result` / `edit_result` 增加"Preview before apply"模式。tool 完成后不立即应用，先在 chat 中展示完整 diff viewer + Apply/Reject 按钮。这需要 runtime 层配合——tool 结果先标记为 `preview` 状态。
   - 涉及文件：`app/desktop/src/components/ChatView.tsx`（ToolResultRenderer 增强）、`app/desktop/src/components/ChatView.types.ts`（新增 preview 状态）、runtime 层（agent loop 增加 preview mode）
   - 预估工作量：L

4. **@symbol / @folder 引用**
   - 当前状态：`useMention` + `MentionPopover` 支持 @agent、@file（触发附件选择器）、@thread。但不支持 @symbol（函数/类名）和 @folder。
   - 竞品做法：Cursor 的 @-mention 最全面——@file、@folder、@symbol、@docs、@web、@git。Copilot Chat 的 @workspace 和 participants 也很完善。
   - 改进建议：扩展 `useMention` 支持 `kind: 'symbol'` 和 `kind: 'folder'`。symbol 需要 LSP/TS server 集成（可参考 reference/cline 的 `SymbolSearchProvider`）；folder 可通过 `FileSearchDialog` 已有的文件系统能力实现。MentionPopover 增加对应图标。
   - 涉及文件：`app/desktop/src/hooks/useMention.ts`（扩展 MentionItem kind）、`app/desktop/src/components/MentionPopover.tsx`（新增 icon）、`app/desktop/src/components/PromptInput.tsx`（注入 symbol/folder items）
   - 预估工作量：M

### P1 — 强烈建议（产品化必备）

5. **对话 Auto-Continue（长任务自动继续）**
   - 当前状态：AgentHub 无自动重连或自动继续机制。context compaction 提示虽有展示，但 compaction 后需用户手动继续。
   - 竞品做法：Claude Code 在 compaction 后自动继续（`experimental.compaction.autocontinue` hook — 见 reference/opencode 报告）；OpenCode 同样支持。
   - 改进建议：在 `ContextUsageInline` (ChatView.tsx:511) 的 compaction 事件后，自动发送 continue 指令。需要 runtime 层配合，chat UI 层只需展示"自动继续中"状态。
   - 涉及文件：`app/desktop/src/components/ChatView.tsx`（新增 auto-continue 指示器）、runtime 层（agent loop 增加 auto-continue）
   - 预估工作量：M

6. **Conversation Resume（中断恢复）**
   - 当前状态：AgentHub 无断线恢复对话能力。`useStreamRecovery` (Web 端) 只恢复 WebSocket 连接，不恢复对话上下文。
   - 竞品做法：Claude Code 支持 `--resume` 恢复上次会话。Codex 的 session 持久化在云端，刷新页面自动恢复。
   - 改进建议：在 thread 级别持久化最近 N 条消息的完整 blocks。断线重连后自动拉取，渲染到 ChatView。Web 端的 `useHubMainChat` 已有消息拉取能力，Desktop 端需补齐。
   - 涉及文件：`app/desktop/src/hooks/useHubMainChat.ts`（新建，对齐 Web 端）、`app/desktop/src/components/ChatView.tsx`（恢复状态展示）
   - 预估工作量：L

7. **内联 Lint/Diagnostic 展示**
   - 当前状态：AgentHub ChatView 无 lint/diagnostic 信息展示。
   - 竞品做法：Cursor 在应用 diff 后内联显示新引入的 linter 错误。Windsurf 同样。这极大提升代码变更的信任感。
   - 改进建议：在 `FileChangeBlock` 或 `DiffCard` 底部，展示 LSP diagnostic 信息（如果有）。可通过 `agenthub:diagnostics` 事件注入。初期可只展示 ESLint/TS 的 error/warning counts + 前 3 条。
   - 涉及文件：`app/desktop/src/components/ChatView.tsx`（FileChangeBlock 增强）、`app/desktop/src/components/ChatView.types.ts`（新增 diagnostic 类型）
   - 预估工作量：M

8. **消息引用/Reply 可视化**
   - 当前状态：`ChatMessage` 类型支持 `parentId` 和 `threadId`，IM 支持 `replyToId`，但 ChatView 不渲染消息之间的 reply 关系。
   - 竞品做法：Cursor/Codex 均以引用的方式展示 reply 关系——被引用的消息以缩略卡片形式出现在回复上方。
   - 改进建议：在 `MessageCard` 中，如果 `msg.parentId` 存在，渲染一个 `ReplyPreview` banner 展示被引用消息的摘要。Web 端已有 `ReplyPreviewBar.tsx` 组件可复用。
   - 涉及文件：`app/desktop/src/components/ChatView.tsx`（MessageCard 增强）、复用 `app/web/src/components/ReplyPreviewBar.tsx` 到 shared 层
   - 预估工作量：S

9. **模型切换快捷键/面板**
   - 当前状态：AgentHub Desktop 的 PromptInput 有模型选择器（ModelReasoningPicker），但切换模型需要点击下拉菜单，无快捷键。
   - 竞品做法：Aider 支持 `/model` 命令在对话中切换模型。Copilot Chat 支持 `/model` slash 命令。
   - 改进建议：AgentHub Desktop 已有 slash 命令系统（`/model` 在 `slashCommands` 中已经实现！——见 PromptInput.tsx:988-1001）。但需要增强：1) 在 ChatView 中展示当前 model 切换事件，2) Web 端也加入 slash 命令。
   - 涉及文件：`app/web/src/components/PromptInput.tsx`（Web 端加入 slash 命令）、`app/desktop/src/components/ChatView.tsx`（展示 model switch block）
   - 预估工作量：S

10. **长文本折叠优化**
    - 当前状态：`AgentTextBlock` 有 `LONG_AGENT_TEXT_MAX_LINES=24` 的折叠机制。但折叠阈值只按行数/字符数，不区分内容类型（代码 vs 文本 vs 日志）。
    - 竞品做法：Claude Code 对不同类型的输出使用不同的折叠策略——代码块不折叠、日志折叠、markdown 正常渲染。
    - 改进建议：`AgentTextBlock` 增加内容分类检测——如果包含 >=3 个 code fence，不折叠代码块部分，只折叠文本部分。实现 `smartCollapse` 逻辑。
    - 涉及文件：`app/desktop/src/components/ChatView.tsx`（AgentTextBlock/previewAgentText 增强）
    - 预估工作量：S

### P2 — 锦上添花（差异化竞争力）

11. **Stream Token 计数实时展示**
    - 当前状态：Token 使用量在 message footer 中展示，但只在消息完成后更新（`formatTokenUsageFooter`）。
    - 竞品做法：Claude Code 实时更新 token 计数。Cline 同样。
    - 改进建议：在 streaming 期间，实时累加 counted tokens 并在 footer 中展示。需要 runtime 层在 streaming 事件中持续推送 token count。
    - 涉及文件：`app/desktop/src/components/ChatView.tsx`（formatTokenUsageFooter 流式更新）、runtime 层（token count events）
    - 预估工作量：S

12. **键盘导航增强**
    - 当前状态：ChatView 无键盘快捷键。IM 消息列表可以用 Arrow keys 导航（通过 `role="log"`），但 Chat 消息无此能力。
    - 竞品做法：Cursor 支持 Cmd+Up/Down 在消息间导航。Claude Code 终端支持 j/k 导航。
    - 改进建议：为 ChatView 消息添加 `tabIndex` 和 arrow key navigation。在 `MessageCard` 上加 `onKeyDown` handler。配合 `keyboardShortcuts.ts` 已有的快捷键系统。
    - 涉及文件：`app/desktop/src/components/ChatView.tsx`（MessageCard 增强）、`app/desktop/src/utils/keyboardShortcuts.ts`
    - 预估工作量：S

13. **Markdown 表格增强**
    - 当前状态：`MarkdownRenderer` 使用 `remarkGfm` 渲染 markdown，表格基本可用。但长表格无横向滚动。
    - 竞品做法：Claude Code 终端中的表格渲染非常精确。Codex Web 的表格有 sticky header + 排序。
    - 改进建议：`MarkdownRenderer.module.css` 中增加 `overflow-x: auto` 和 `max-height`。可选：表格 >5 行时自动折叠。
    - 涉及文件：`app/desktop/src/components/MarkdownRenderer.tsx`（组件增强）、`app/desktop/src/components/MarkdownRenderer.module.css`
    - 预估工作量：S

14. **消息 Pin/收藏**
    - 当前状态：消息操作只有 copy/retry/fork/delete，无 pin/收藏。
    - 竞品做法：Cursor 不支持，Slack/Devin 支持消息 pin。这是差异化竞争点。
    - 改进建议：在 `MessageCard` action bar 增加 pin 按钮。Pinned 消息在 ChatView 顶部以 banner 形式展示，点击可滚动到该消息。持久化到 thread 元数据。
    - 涉及文件：`app/desktop/src/components/ChatView.tsx`、`app/desktop/src/components/ChatView.types.ts`
    - 预估工作量：S

15. **多 Agent 对话视图**
    - 当前状态：`IMView` 支持多 agent + 人混合对话（senderType: 'agent' | 'user'），但 ChatView 是单一 agent ↔ user 模式。
    - 竞品做法：AionUi 的 Cowork 模式支持多 agent 同时回复。OpenHands 支持 multi-agent 协作展示。
    - 改进建议：这是我方差异化优势——IMView 已经实现了多 agent 混合对话。建议将 IMView 的 agent 消息样式（authority band、sender avatar、agent name）迁移到 ChatView，使其天然支持同一 thread 中多个 agent 的消息区分。
    - 涉及文件：`app/desktop/src/components/ChatView.tsx`（merge IMView styling patterns）、`app/desktop/src/components/IM/IMMessageView.tsx`（提取 shared AgentMessageBubble）
    - 预估工作量：M

## AgentHub 独有优势

以下功能是 AgentHub 有但竞品没有、或 AgentHub 做得明显更好的。比赛答辩时应重点强调：

1. **团队审批流（TeamApprovalPanel + ApprovalCard）** — 独有风险等级分类（low/medium/high/critical）+ reason + timeout + 团队审批 + 冲突解决。竞品只有简单的 approve/deny 二元开关。

2. **IM 集成（群聊/私聊/已读/撤回/在线状态）** — 唯一将 AI agent 完全嵌入 IM 系统的工作台。Agent 和人平等参与群聊，支持消息已读回执、撤回、转发。Devin 有 Slack 集成但仅限于通知，不是原生 IM。

3. **Fork 分支机制** — 独有功能。允许用户从任一 agent 消息 fork 出新的对话分支，保留完整上下文。竞品都只有简单的"retry"。

4. **路由决策可视化（RouteDecisionBlock）** — 在多 agent 协作场景中，AgentHub 显式展示 supervisor 的"路由决策"——哪个 agent 被选中、为什么、是否有阻塞。竞品完全缺失此维度。

5. **Context 窗口可视化（ContextUsageInline + 进度条 + 百分比）** — 比 Claude Code 的 token count 更直观。展示 model/provider/limit/remaining/threshold/usage bar。竞品中只有 Claude Code 和 Cline 有简化的 token 显示。

6. **RAF 批渲染流式输出（useStreamingText）** — 使用 requestAnimationFrame 批处理流式文本更新，Tab 隐藏时自动暂停、恢复时立即 flush。竞品使用简单的 setInterval 或直接 setState。

7. **18 种 MessageBlock 类型的判别渲染** — 最丰富的消息类型系统。完整的 TypeScript discriminated union，涵盖 text/code/thinking/tool_use/file_change/agent_task/child_agent/route_decision/context_usage/artifact/approval/error/citation 等。参考 Codex 的 thread item 19 枚举，实际 AgentHub 的类型系统在可扩展性上更具优势。

8. **Virtual scrolling + 智能 auto-scroll** — 基于 @tanstack/react-virtual + 自定义 `useAutoScroll`（200 行），支持用户手动滚动历史时不自动追底、新消息时自动滚动、streaming 期间的精细滚动控制。竞品中只有 Cursor 有类似质量的 infinite scroll。

9. **工具调用自动分组（ToolGroup）** — 连续的 tool_use blocks 自动按类别（read/edit/command）折叠成可展开组，避免刷屏。竞品多为列表式逐个展示。

10. **统一 Desktop + Web 架构** — ChatView 类型定义在 Desktop，但 shared 层有完整的 UI 组件体系（ArtifactCard/ArtifactPreview/DeployCard/FileChangeGroup/DiffReviewPanel/CodePreviewCard/MessageBubble 等），Web 端通过 Slot 系统复用。竞品多为单平台。

11. **WorkDir + PermissionMode + ReasoningEffort + Model 选择器的统一 PromptInput** — Desktop 端 PromptInput 集成了附件、@mention、slash 命令、模型选择器、推理强度选择、权限模式选择、工作目录选择，形成统一的"命令面板"。代码 1511 行，功能密集度远超竞品输入框。
