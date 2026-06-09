# 前端审计交接清单 — 致 v4 前端重构负责人

> 来源：AgentHub 全项目只读审计（2026-06-07）
> 你当前分支：`feat/desktop-web-v4-clean-rebuild`（工作树）
> 完整审计报告：`docs/review-2026-06-07-glm-5.1/`

以下问题涉及的文件**你正在改**，建议在 v4 重构过程中一并处理。不需要单独开分支。

---

## 🟡 P1：重构时顺便处理

### 1. v4 新组件零测试（33 个文件）

**区域**：
- `app/shared/src/workbench/blocks/` — 16 组件，0 测试
- `app/shared/src/workbench/floating/` — 5 组件，0 测试
- `app/shared/src/workbench/inspector/` — 3 组件，0 测试
- `app/shared/src/workbench/pages/` — 6 组件，0 测试

**建议**：随组件接入 workbench 时补 smoke test。至少每个组件测"渲染不崩 + props 可传"。可以用 `createMockPlatform()` 模式。

### 2. Desktop/Web 重复代码（会在迁移到 shared 时消除）

**重复 hooks（10 个）**：
`useAuth`、`useAutoScroll`、`useDeviceRegistration`、`useHealth`、`useHubEventStream`、`useInputDraft`、`useMediaQuery`、`useMention`、`useStreamingText`、`useToast`

**重复 stores（10 个）**：
`connectionStore`、`hubStore`、`modelSettingsStore`、`notificationStore`、`runStore`、`searchStore`、`taskBridgeStore`、`threadStore`、`toastStore`、`uiStore`

**重复 API 文件（17 个）**：
`hubClient`、`hubAuth`、`hubWS`、`transport` 等

**建议**：v4 迁移到 shared 时，只保留 shared 版本，Desktop/Web 侧删除重复文件。

### 3. 废弃组件清理（~5,500 行）

**Desktop 孤儿组件（9 个）**：
ContextUsage、MarkdownRenderer、ApprovalCard、WorkspacePicker、ModelReasoningPicker、ShellIconButton、FileSearchDialog、DesktopHubTaskBridge、ModelDropdown

**Web 孤儿组件（15+ 个）**：
`app/web/src/components/` 中几乎所有文件都已废弃（Web 现在通过 shared AgentHubWorkbench 渲染）

**⚠️ 注意**：`app/shared/src/ui/index.ts` 中有约 16 个导出实际上被 `app/mobile/` 使用（EmptyState、ActionList、SegmentedControl、BottomSheet、ActivityCard 等）。**不要删除 mobile 仍在用的 shared UI 导出**。真正未使用的只有 12 个。

**建议**：v4 清理阶段，确认每个组件没有 mobile 消费者后再删除。

### 4. CSS token 迁移遗留

- **9 处硬编码 hex 颜色**：需要替换为 CSS 变量
- **z-index 硬编码 8+ 处**（含 `zIndex: 9999`）：需要统一到 z-index scale
- **--text-3 对比度**：Dark theme 约 2.1:1，WCAG AA 要求 4.5:1

**建议**：在当前 token 迁移 commit 中一并处理。

---

## 🟢 做得好的地方

- Desktop/Web/Mobile 单向依赖 shared，架构干净
- Platform adapter 模式一致性好
- ARIA 覆盖率优秀
- TranscriptView 14/15 个 block 已接入
- CSS 命名几乎 100% camelCase
- TypeScript `any` 仅 1 处

---

## 附：不在你范围内的（别动）

| 区域 | 处理者 |
|---|---|
| hub-server / edge-server 后端代码 | 后端负责人 |
| edge-server env_sanitizer、CORS | 独立修复分支 |
| hub-server repository 层 | 独立修复分支 |
| package.json 依赖版本 | 独立修复分支 |
| tsconfig / tauri 版本对齐 | 独立修复分支 |
