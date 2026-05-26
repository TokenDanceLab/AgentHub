# AgentHub Desktop — 前端 UI/UX 交接文档

最后更新：2026-05-25 | 分支：dev/delicious233 | 作者：Ding (UI/UX lead)

---

## 1. 设计哲学

AgentHub Desktop 的目标质感是 **Claude Desktop / Codex App 级别的 Pro 工具**，不是开发者后台。

### 核心原则（7 条）

1. **无边框文档流** — AI 回复纯文本渲染在主背景上，不用气泡包裹
2. **幽灵控件** — 操作按钮默认无背景，hover 才显形
3. **微光边框** — 所有 `border` 使用 `rgba(255,255,255,0.04~0.08)`，禁用 `#333` 实线
4. **温暗底色** — `#141418`（紫灰情绪），不用 `#000` 纯黑；字体 `#E8E8ED`，不用 `#FFF`
5. **高透底+高亮字** — 状态 tag 用 `rgba(色, 0.12)` + 霓虹色文字，禁用暗脏底色
6. **左侧 accent 线** — 选中态用 `box-shadow: inset 3px 0 0 var(--primary)` + 微弱背景，禁用描边框
7. **留白优先** — 间距 1.5x 起步，用空间区分信息而不是线框

### 设计 token 来源

- `app/desktop/src/styles/tokens.css` — 非主题 token（字号、间距、圆角、动画）
- `app/desktop/src/styles/themes.css` — 主题变量（暗色/亮色）+ 语义 token

---

## 2. 关键文件地图

### 全局基础

| 文件 | 职责 | 小心 |
|------|------|------|
| `styles/tokens.css` | 7 字号、3 字重、间距 4px grid、圆角、动画、z-index | 不存颜色 |
| `styles/themes.css` | 暗/亮主题所有颜色 + 语义 token | `:root` = 暗色默认，`[data-theme='light']` = 亮色 |

### 核心组件（交互层级）

| 文件 | 视觉层级 | 关键约束 |
|------|---------|----------|
| `components/PromptInput.tsx` + `.module.css` | 最高 — 用户每步操作都碰 | 幽灵标签、玻璃面板、`backdrop-filter` |
| `components/ChatView.tsx` + `.module.css` | 最高 — AI 回复核心渲染 | 无气泡文档流、thinking 手风琴、行内代码微亮底 |
| `components/AgentList.tsx` + `.module.css` | 高 — 左侧栏 Agent 选择 | 选中态无边框、状态圆点替代文字、卡片无底色 |
| `components/MarkdownRenderer.tsx` + `.module.css` | 高 — 所有 AI 文本渲染 | 行内代码 `rgba(255,255,255,0.08)`、代码块无边框 |
| `components/SettingsPage.tsx` + `.module.css` | 中 — 设置工作台 | 卡片无 inset 高光阴影、chip 用微光边框非实心底、左侧导航胶囊 |
| `components/RunDetail.tsx` + `.module.css` | 中 — 右侧运行面板 | 状态 tag 高透底+霓虹字、控制台 monospace、左侧状态线 |
| `components/ThreadPanel.tsx` | 中 — 线程列表 | Phase 2 需加参与 agent 头像 |

### 状态管理

| Store | 职责 | 改动记录 |
|-------|------|---------|
| `stores/threadStore.ts` | 线程选择 + agent-thread 映射 | 新增 `agentThreadMap`、`selectedAgentId`、`selectAgentThread` |
| `stores/uiStore.ts` | 面板宽度/折叠 | persist 到 localStorage |
| `stores/modelSettingsStore.ts` | 模型/Provider/推理配置 | `resolveRunRequestOptions` 解析链 |
| `stores/runStore.ts` | 当前 run 状态机 | RunStateMachine 验证转换 |

### API 层

| 文件 | 新增函数 | 用途 |
|------|---------|------|
| `api/edgeClient.ts` | `createThread(title, threadId)` | 显式创建线程（不再依赖隐式创建） |
| `api/edgeClient.ts` | `fetchThreadItems(threadId)` | 加载线程消息历史 |
| `api/threadQueries.ts` | `useCreateThread()` | TanStack Query mutation |
| `api/threadQueries.ts` | `useThreadMessages(threadId)` | 按需加载消息历史 |

---

## 3. 本次改动清单

### 已完成（写入代码）

| 类别 | 文件 | 改动 |
|------|------|------|
| **线程模型** | `threadStore.ts` | agent-thread 映射、点击 agent 自动创建/打开线程 |
| **线程模型** | `edgeClient.ts` | `createThread`、`fetchThreadItems` |
| **线程模型** | `threadQueries.ts` | `useCreateThread`、`useThreadMessages` |
| **线程模型** | `App.tsx` | `selectedAgentId` 迁移到 threadStore、`handleSelectAgent` 异步创建线程 |
| **滚动修复** | `App.module.css` | `.chatArea` overflow `auto→hidden`（消除双滚动） |
| **滚动修复** | `ChatView.module.css` | `overflow-anchor: auto`、`.root` 加 `position: relative` |
| **滚动修复** | `ChatView.tsx` | `estimateSize` 动态估算（system=80, tool=300, 其他=160） |
| **滚动修复** | `useAutoScroll.ts` | flag timer 1500→300ms |
| **输入框** | `PromptInput.module.css` | 玻璃面板 + 幽灵标签 + `backdrop-filter` + 隐藏 route label |
| **聊天渲染** | `ChatView.module.css` | AI 消息无背景、用户消息微底色、thinking 手风琴 monospace |
| **聊天渲染** | `MarkdownRenderer.module.css` | 行内代码微亮底、代码块无边框 |
| **Agent 列表** | `AgentList.module.css` | 选中态无边框仅 accent 线、状态圆点发光、隐藏文字状态 |
| **设置页** | `SettingsPage.module.css` | 删除 0.38 inset 高光、chip 微光边框、左侧导航胶囊 |
| **控制台** | `RunDetail.module.css` | 状态 tag 高透底+霓虹字、monospace、左侧状态线 |
| **主题** | `themes.css` | +18 语义 token（chat 表面、输入面板、ghost 按钮、agent 卡片） |

### 未提交（5 个 CSS 文件）

```
app/desktop/src/components/AgentList.module.css
app/desktop/src/components/MarkdownRenderer.module.css
app/desktop/src/components/PromptInput.module.css
app/desktop/src/components/RunDetail.module.css
app/desktop/src/components/SettingsPage.module.css
```

---

## 4. 尚未实现（Phase 2—3）

### Phase 2：多 Agent 群聊

- `ThreadInfo` 需加 `participants: ThreadParticipant[]` + `isGroup`
- `threadStore` 需加 `createGroupThread(agentIds)`、`addParticipant`、`removeParticipant`
- `ThreadPanel` 需显示参与 agent 头像堆叠
- `PromptInput` 群聊中 @mention 支持多 agent
- `ChatView` 消息气泡增加 agent 颜色区分
- 新建 `CreateGroupChat` 组件（选择多 agent + 群名弹窗）

### Phase 3：统一 Agent 聊天和 IM

- 消除 `viewMode` 分叉（agent/im 合并）
- `IMView` 废弃，统一进 `ChatView`
- `useIMChat` 消息流合并进 `useChatMessages`
- 线程列表可筛 "Agent 对话" / "联系人对话" / "群聊"

### Edge Server 适配器改进（来自审计报告）

- Codex P0-P2 共 15 项 gap（详见 `docs/reference/codex-cli-audit.md`）
- Claude Code P0-P2 多项（详见 `docs/reference/claude-code-cli-audit.md`）
- OpenCode schema 已对齐 v1.15.10（详见 `docs/reference/opencode-cli-audit.md`）

---

## 5. 开发约定

### CSS 规则

- 颜色只用 `var(--xxx)` token，绝不用硬编码 `#xxx`
- 边框用 `rgba(255,255,255,0.04~0.08)`，绝不用 `#333` 或 `var(--border)` 
- `box-shadow` 禁用于模拟高光（`inset 0 1px 0` 是劣质塑料感）
- 新组件先读 `themes.css` 看有没有现成 token

### TSX 规则

- 状态用 Zustand `useShallow` 选择器避免不必要渲染
- 异步回调中读取 store 用 `getState()` 不触发重渲染
- 所有用户可见字符串走 `t('key')` i18n

### 验收命令

```bash
cd app/desktop
pnpm typecheck          # 必须零错误
pnpm vitest run         # 604 通过
pnpm tauri dev          # 实际看效果
```

---

## 6. 参考文档

- `docs/architecture/product-requirements.md` — 产品需求
- `docs/architecture/system-architecture.md` — 系统架构
- `docs/roadmap.md` — 全局路线图
- `docs/reference/competitor-master-report.md` — 8 竞品对标 + Borrow/Adapt/Ignore
- `docs/reference/design-systems-master-report.md` — 设计系统完整报告
- `docs/reference/desktop-fix-redesign-master-plan.md` — 66 项修复清单
- `docs/reference/codex-cli-audit.md` — Codex CLI 审计
- `docs/reference/claude-code-cli-audit.md` — Claude Code CLI 审计
- `docs/reference/opencode-cli-audit.md` — OpenCode CLI 审计
- `docs/reference/competitor-jean-analysis.md` — Jean（同技术栈竞品）深度分析
- `docs/reference/lobehub-icon-audit.md` — LobeHub 图标使用清单
