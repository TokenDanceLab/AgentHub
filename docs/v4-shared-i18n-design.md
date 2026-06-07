# AgentHub v4 Shared i18n 设计

> 日期：2026-06-07
> 范围：Desktop/Web v4 shared workbench、transcript、composer、inspector、workbench pages

## 目标

AgentHub v4 的 Desktop 和 Web 使用同一套 shared UI。对应的用户可见文案也必须同源，不能继续让 Desktop `zh.json/en.json` 和 Web `locales/*` 各自复制一份 workbench 文案。

本设计只处理产品 UI 文案和状态文案，不处理后端返回的用户内容、Agent 输出、文件内容、运行日志、用户输入、模型名、路径和代码片段。

## 当前事实

- Desktop 已有 `app/desktop/src/i18n/locales/zh.json` 和 `en.json`，默认 namespace 是 `translation`。
- Web 已有 `app/web/src/i18n/locales/{zh,en}` 多 namespace 字典，包含 `common/status/workbench/...`。
- v4 主 UI 已迁到 `app/shared/src/workbench`，但 shared workbench 内仍有大量硬编码中文。
- `app/shared` 已依赖 `react-i18next` 作为 peer dependency，因此 shared 组件可以使用宿主 app 初始化的 i18next 实例。
- TokenDance 根规范要求 AgentHub Desktop/Web 的 zh/en 字典、错误/空状态、Agent Runtime/Profile/Configuration/Execution Target 术语保持 parity。

## 决策

1. shared workbench 使用独立 namespace：`sharedWorkbench`。
2. shared 字典源放在 `app/shared/src/i18n/workbench.ts`，由 shared 包导出。
3. Desktop/Web app 初始化 i18next 时加载同一份 `sharedWorkbench` 资源，不再复制这些 key。
4. shared 组件使用 `useTranslation('sharedWorkbench')`，但迁移按组件分批进行。
5. Agent/user 消息内容不翻译。只有 UI chrome、按钮、状态标签、空状态、系统占位文案、可访问标签和 prototype demo 文案进入字典。
6. 真实 runtime evidence 的 label/path/toolName/modelName 不翻译，只翻译状态、栏目名和动作。
7. zh/en key parity 是门禁，新增 key 必须同时加双语。

## 资源结构

当前 shared 字典第一批覆盖：

- `nav.*`：global rail 页面名。
- `header.*`：workspace header tab 和 inspector toggle。
- `inspector.*`：overview/browser/files tab、任务/产物标题、空状态、preview 动作。
- `transcript.*`：运行时间线、状态、只读、推理块标题。
- `composer.*`：输入框 placeholder 和发送动作。
- `actions.*`：复制、转发、导出、删除、关闭等通用动作。

后续迁移页面文案时增加：

- `contacts.*`
- `docs.*`
- `agents.*`
- `tasks.*`
- `projects.*`
- `settings.*`
- `contextMenu.*`
- `multiSelect.*`
- `toast.*`

## 迁移顺序

1. 字典和 parity 测试先行：已新增 `app/shared/src/i18n/workbench.ts` 和 `workbench.test.ts`。
2. Desktop/Web 初始化加载 `sharedWorkbench` namespace。
3. 先迁移稳定 chrome：GlobalRail、WorkspaceHeader、RightInspector tabs、UnifiedComposer placeholder。
4. 再迁移 transcript block 状态：RunStepGroup、AgentTimeline、ThinkingBlock、ToolCardBlock、ApprovalCardBlock。
5. 最后迁移 demo pages：Contacts、Docs、Agents、Tasks、Projects、Settings。

## 不做

- 不把 Agent 输出、用户消息、文件名、路径、运行日志翻译。
- 不为了英文切换改变 design demo 的中文截图基线；视觉对齐截图仍以中文设计稿为主。
- 不在 Desktop/Web 各自新增一套 v4 workbench 文案。
- 不把 TokenDanceID、TokenDance API key、Feishu/Lark 身份边界写成局部随意翻译；这些关键术语必须遵守根 i18n parity 文档。

## 验收

- `cd app/shared; corepack.cmd pnpm exec vitest run src\i18n\workbench.test.ts --reporter=dot`
- Desktop/Web typecheck 通过。
- `.\scripts\verify-i18n-parity.ps1` 在正式接入 Desktop/Web 字典后加入 shared namespace 检查。
- 中英文切换后没有按钮文字溢出、重叠或破坏 1180px 工作台布局。
