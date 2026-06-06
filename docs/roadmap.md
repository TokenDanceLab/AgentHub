# AgentHub 路线图

> 最后更新：2026-06-07 | 当前主线：Desktop/Web v4 clean rebuild | 历史长版见 [archive/roadmap-pre-5day-cleanup-20260605.md](archive/roadmap-pre-5day-cleanup-20260605.md) 和 [archive/roadmap-full-history-20260605.md](archive/roadmap-full-history-20260605.md)

## 当前目标

AgentHub 要从现有 Desktop/Web 分叉 UI 迁移到一套以 v4 新界面为基准的共享工作台系统。Desktop 和 Web 使用同一个 React UI 架构、同一套 transcript/composer/inspector 合同、同一套设计 token 和可视化验收标准；Desktop 只在 Tauri Host API、Local Edge 启动、文件系统能力和本机凭据等平台边界上有差异。

本轮重构优先级是文档和架构设计先行，开发其次。旧 Desktop 冲刺计划、旧 ChatView/PromptInput 补丁路线、Desktop 先行再迁移 Web 的路线不再作为当前主线。

已确认决策：旧 UI 主路径最终彻底删除；Desktop/Web 同步进入 v4；实现分支允许短期打断旧 UI，但每阶段必须有新 UI 证据。

## 推进规则

- 文档先行：架构、计划、验收和清理边界写清后再进入代码实现。
- v4 UI 壳子的权威参考是 `agenthub-design/index.html` 和 `agenthub-design/desktop/`。其中根 `index.html` 是设计系统入口，`desktop/` 是真正的 Desktop 壳子和交互原型；设计仓库只读，不在 AgentHub 实现分支里修改。
- Desktop/Web 必须共用 UI 工作台。允许在实现分支短期打断旧 UI，但不允许长期保留两套主工作台。
- 旧实现是迁移素材，不是永久架构。`ChatView`、`PromptInput`、`IMBlockRenderer`、`RunDetail`、`ThreadPanel`、旧 `viewRegistry` 和千行 hooks 都是替换或拆除对象。
- 每个阶段必须有可验证证据：typecheck、focused tests、截图、Playwright/视觉 QA、Tauri smoke 或明确的未完成风险。
- 文档不写第二套事实源。当前目标写在本文件；架构边界写在 [architecture.md](architecture.md)；执行计划写在 [desktop-web-v4-clean-rebuild-plan.md](desktop-web-v4-clean-rebuild-plan.md)；待用户确认的问题写在 [v4-clean-rebuild-decision-questions.md](v4-clean-rebuild-decision-questions.md)。
- 分支保持干净：`dev/delicious233` 是开发事实源；协作者分支 `origin/dev/trump` 和 `origin/dev/johnny` 保留但不自动合并。
- subagent 分工按当前目标执行：前端和看图交给 GPT-5.5 low/mid，复杂架构交给 GPT-5.5 xhigh，长文本、找东西、简单文档和架构整理交给 Claude opus（DeepSeek-V4-Pro），代码实现交给 Claude sonnet（GLM-5.1），快速轻量检查交给 Claude haiku。

## 当前最高优先级

| Rank | 任务 | 状态 | 下一步 | 验收证据 |
|---:|---|---|---|---|
| P0-1 | v4 clean rebuild 文档架构 | 进行中 | 完成计划、问题清单、架构与 roadmap 同步 | `git diff --check`；活跃文档无旧主线冲突 |
| P0-2 | shared UI 工作台边界 | 进行中 | 补 Hub normalize、block renderer 和 design token bridge | shared focused tests 30 passed；新增模块 targeted tsc 通过；full lint 仍被既有 Storybook/旧组件测试问题阻断 |
| P0-3 | Desktop v4 shell 接入 | 进行中 | 继续替换剩余静态 smoke 数据，并补 inspector resize/collapse | Desktop App v4 focused tests 4 passed；Desktop typecheck/build 通过；1440x920 Playwright smoke 通过，且读取真实 Edge thread 列表、persisted items、live Edge event evidence，可从 v4 composer 提交 Edge run，并在 shared inspector 展示 run/tool/file/artifact evidence；v4 composer approval/workDir/@Agent/浏览器文件附件/Desktop 原生文件附件上下文已传入 Edge `startRun`；files/browser inspector 已通过 platform preview port 打开 evidence target |
| P0-4 | Web v4 shell 接入 | 进行中 | 继续接 Hub sessions/messages/WS 和 remote run submit | Web App focused test 通过；Web typecheck/build 通过；Web Vite/Vitest 已对齐 shared lucide 依赖解析；v4 workbench @Agent 列表已在 Hub session 下读取 `/web/agent-profiles` |
| P0-5 | Tauri Host API 重构 | 未开始 | 把 `commands.rs` 巨石拆为 host 能力模块和 typed invoke facade | Rust tests；Tauri command coverage；路径/权限负测 |
| P0-6 | 旧 UI 清理门禁 | 未开始 | 删除或归档旧 UI 入口，禁止旧文件继续承载活跃路径 | `rg` 旧入口扫描；无双主工作台 |

## P0: 文档与架构冻结

- [x] 清理本地过时分支，只保留 `dev/delicious233` 作为本地主线。
- [x] 清理 `origin` 过时分支，只保留 `dev/delicious233`、`dev/trump`、`dev/johnny`、`master`。
- [ ] 完成 [desktop-web-v4-clean-rebuild-plan.md](desktop-web-v4-clean-rebuild-plan.md)。
- [ ] 完成 [v4-clean-rebuild-decision-questions.md](v4-clean-rebuild-decision-questions.md)。
- [ ] 更新 [architecture.md](architecture.md)，把 Desktop/Web 共享 UI 系统作为当前架构。
- [ ] 更新 README、docs 导航和治理文档，移除旧状态入口和旧分支事实。
- [ ] 确认 active docs 不再表达“Desktop 先行，Web 以后迁移”或“ChatView 重写暂缓”。

## P1: Shared UI 工作台系统

目标：全面参考 `agenthub-design/index.html` 和 `agenthub-design/desktop/`，把真实 UI 壳子拆成 AgentHub 内部可复用 UI 系统，让 Desktop/Web 共用同一套产品工作台。

- [ ] `app/shared/src/ui/`：清理 exports，明确基础组件的 public API。
- [ ] `app/shared/src/workbench/`：已新增 `AgentHubWorkbench` shared shell，并拆出 `GlobalRail`、`ConversationSidebar`、`WorkspaceHeader`、`TranscriptView`、`UnifiedComposer`、`RightInspector`；下一步补 `WorkbenchRoutes` 和 design token bridge。
- [ ] `app/shared/src/transcript/`：首片已定义 `TranscriptBlock` 和 evidence refs，并新增 ThreadItem -> TranscriptBlock、live Edge event -> TranscriptBlock normalize；下一步补 Hub message normalize 与 block renderer。
- [ ] `app/shared/src/composer/`：已定义共享 composer 状态、intent、reducer、v4 modes、approval mode、workDir、结构化 @Agent mention、浏览器文件附件和 Desktop 原生文件附件上下文；下一步补 per-conversation draft persistence。
- [ ] `app/shared/src/inspector/`：首片已建立 evidence 聚合模型，shared workbench 的 overview/browser/files tabs 已显示 run/tool/file/artifact summary、changed files 空/列表状态和 browser capability 状态，并已接入 files/browser evidence preview 打开动作；下一步补 resize/collapse 和更完整 tool timeline。
- [ ] `app/shared/src/platform/`：首片已定义 Desktop/Web 平台 adapter interface、mock platform、附件 picker port 和 preview port；Desktop/Web 已接实际 adapter，下一步接 Hub REST/WS 数据 adapter。
- [ ] 所有共享模块配 focused tests，复杂视觉组件配 stories 或截图场景。

验证记录：
- 2026-06-07：`cd app/shared; corepack.cmd pnpm exec vitest run src\platform\createMockPlatform.test.ts src\transcript\transcriptEvidence.test.ts src\composer\composerReducer.test.ts src\workbench\AgentHubWorkbench.test.tsx --reporter=dot`，4 个文件 / 9 个测试通过。
- 2026-06-07：新增 `composer/platform/transcript/workbench` 模块 targeted TypeScript 编译通过。
- 2026-06-07：`cd app/shared; corepack.cmd pnpm lint` 仍失败，但失败不在新增模块；当前阻塞是既有 Storybook 类型缺失、旧 components 测试引用缺失、部分旧 UI 测试 TS strict 问题和 SVG module declaration 缺失。
- 2026-06-07：补齐 workbench 子组件、workspace tabs、inspector tabs 和 composer modes 后，focused tests 更新为 4 个文件 / 10 个测试通过；新增 workbench 子组件 targeted TypeScript 编译通过。
- 2026-06-07：新增 `normalizeThreadItemsToTranscript`，把 Edge persisted thread items 投影到 shared `TranscriptBlock` 和 `EvidenceRef(kind="run")`；`cd app/shared; corepack.cmd pnpm exec vitest run src\platform\createMockPlatform.test.ts src\transcript\normalizeThreadItems.test.ts src\transcript\transcriptEvidence.test.ts src\composer\composerReducer.test.ts src\workbench\AgentHubWorkbench.test.tsx --reporter=dot`，5 个文件 / 12 个测试通过。
- 2026-06-07：新增 `normalizeEdgeEventsToTranscript`，把 live Edge `run.started`、`run.output(.batch)`、`run.agent.text_*`、`run.agent.tool_*`、`run.agent.file_change`、`run.agent.permission_*`、`artifact.created`、`run.finished/failed/cancelled` 投影到 shared `TranscriptBlock` 和 `EvidenceRef`；`cd app/shared; corepack.cmd pnpm exec vitest run src\platform\createMockPlatform.test.ts src\transcript\normalizeThreadItems.test.ts src\transcript\normalizeEdgeEvents.test.ts src\transcript\transcriptEvidence.test.ts src\composer\composerReducer.test.ts src\workbench\AgentHubWorkbench.test.tsx --reporter=dot`，6 个文件 / 14 个测试通过。
- 2026-06-07：shared workbench submit 失败时保留草稿并退出 submitting 状态，防止 Desktop 无真实 Edge thread 时假提交；focused shared tests 更新为 6 个文件 / 15 个测试通过。
- 2026-06-07：新增 `app/shared/src/inspector/inspectorEvidence.ts`，把 `EvidenceRef` 聚合为 run/tool/file/artifact inspector model；`collectTranscriptEvidence` 现在保留首次出现顺序但更新同一 evidence 的最新状态，避免 live run 状态卡在 pending/running；shared focused tests 更新为 7 个文件 / 19 个测试通过。
- 2026-06-07：shared `UnifiedComposer` 增加 approval mode 和 workDir 控件，`ComposerIntent` 会携带 trim 后的 `workDir`；focused shared tests 仍为 7 个文件 / 19 个测试通过，并覆盖 platform intent 中的 `approvalMode/workDir`。
- 2026-06-07：shared `UnifiedComposer` 增加浏览器文件附件入口、附件 chip、删除动作和文本预览上下文；新增 `composer/attachments.ts`，Desktop submit 会把附件上下文拼进 Edge `startRun.prompt`；focused shared tests 更新为 8 个文件 / 23 个测试通过。
- 2026-06-07：shared `UnifiedComposer` 增加 @Agent 菜单、mention chip、删除动作和结构化 mention intent；新增 `composer/mentions.ts`，Desktop submit 会把 mention 名称、id、模型、runtime 拼进 Edge `startRun.prompt`；focused shared tests 更新为 9 个文件 / 26 个测试通过。
- 2026-06-07：shared platform 新增 `attachments.pickFiles()` port；Desktop 通过 Tauri dialog 和既有 `read_file` command 选择本机文件并生成 desktop attachment preview，Web 继续回退浏览器 file input；focused shared tests 更新为 9 个文件 / 30 个测试通过。
- 2026-06-07：shared platform 新增 `preview.openEvidence()` port，`RightInspector` 的 files/browser tabs 可点击 file/artifact evidence 并交给 platform adapter 打开；`EvidenceRef` 保留 `path/uri/mimeType` preview 元数据；focused shared tests 更新为 9 个文件 / 31 个测试通过。

## P2: Desktop v4 接入

目标：Desktop 只保留平台能力、Local Edge 和 Tauri shell；主 UI 由 shared workbench 驱动。

- [x] 建立 `app/desktop/src/platform/desktopPlatform.ts` 首片 adapter，声明 Local Edge、本机文件和浏览器预览能力；当前 fallback transcript 只在没有 Edge thread 数据时使用。
- [x] 用 `AgentHubWorkbench` 替换旧 `App.tsx` 主 shell，旧 Desktop 巨石 UI 不再控制 active route。
- [ ] 迁移真实 Edge event/message/run 数据到 shared transcript contract；首片已接 Edge persisted thread list、thread item normalize 和 live WebSocket run/tool/file/approval/artifact event normalize。
- [ ] 迁移右侧 inspector 的真实 run、tool、changed file、artifact 数据；首片已通过 shared `EvidenceRef` 聚合 live run/tool/file/artifact evidence，并在 overview/files/browser tab 展示聚合后的运行、工具、文件、产物与平台 preview 状态；files/browser evidence 已可通过 Desktop platform preview port 打开。
- [ ] 替换旧 composer，保留 Enter/Shift+Enter、附件、workdir、approval mode、@Agent 和 pending/error 体验；首片已把 v4 composer submit 接到当前 Edge thread 的 `startRun`，并把 approval mode、workDir、@Agent、浏览器文件附件和 Desktop 原生文件附件上下文传入 Edge run request。
- [ ] 删除旧 Desktop 主路径，旧组件只允许在迁移 commit 中短期存在，最终不得作为 active route。

验证记录：
- 2026-06-07：`cd app/desktop; corepack.cmd pnpm exec vitest run --config vitest.desktop-tsx-ci.config.ts src\__tests__\App.v4.test.tsx --reporter=dot`，1 个文件 / 1 个测试通过，确认 Desktop 根入口渲染 shared v4 workbench、`data-surface="desktop"` 和 Desktop browser preview capability。
- 2026-06-07：`cd app/desktop; corepack.cmd pnpm typecheck` 通过。
- 2026-06-07：`cd app/desktop; corepack.cmd pnpm build` 通过。
- 2026-06-07：Desktop 1440x920 临时 Playwright visual smoke 通过，截图写入 `.tmp/visual-smoke-desktop.png`；同时修复 shared sidebar 标题/副标题 grid 自动放置导致的文本粘连。
- 2026-06-07：Desktop `App` 新增 `useDesktopWorkbenchModel`，通过 `useThreads` / `useThreadMessages` 读取真实 Edge thread 列表和 persisted thread items，投影到 shared workbench；fallback 只在无 Edge thread 数据时使用。
- 2026-06-07：Desktop 1440x920 Playwright visual smoke 复测通过，并确认 long thread list 在 sidebar 内部滚动、document 高度锁定到 viewport。
- 2026-06-07：`sonnet` 代码审查 subagent 对当前 diff 返回 `NO_FINDINGS`。
- 2026-06-07：新增 `useDesktopEdgeEvents`，Desktop root 通过 `createEventStream` 订阅当前 thread live Edge events，并合并 persisted transcript 与 live transcript；`cd app/desktop; corepack.cmd pnpm exec vitest run --config vitest.desktop-tsx-ci.config.ts src\__tests__\App.v4.test.tsx --reporter=dot`，1 个文件 / 3 个测试通过。
- 2026-06-07：`cd app/desktop; corepack.cmd pnpm typecheck` 通过；`cd app/desktop; corepack.cmd pnpm build` 通过；`cd app/desktop; node .\.tmp\visual_smoke_desktop.mjs http://127.0.0.1:5173` 通过，截图 `app/desktop/.tmp/visual-smoke-desktop.png` 大小 51480 bytes。
- 2026-06-07：Desktop `App` 通过 `useCreateRun().mutateAsync` 注入 v4 platform，`submitComposerIntent` 会向当前 Edge `projectId/threadId` 提交 `startRun({ prompt })`，并且没有真实 Edge thread 时不再本地假提交；Desktop App v4 focused tests 更新为 1 个文件 / 4 个测试通过。
- 2026-06-07：shared `RightInspector` 不再只显示占位 evidence list，已按 design desktop 的 overview/browser/files 模式展示 run/tool/artifact summary、changed files list/empty state 和 browser preview capability；Desktop 1440x920 Playwright smoke 通过，截图 `app/desktop/.tmp/visual-smoke-desktop.png` 大小 53898 bytes，DOM 检查确认 inspector tabs 可切换、无横向/文档级纵向 overflow、浏览器 tab 无 console/page error。
- 2026-06-07：Desktop v4 composer 的 `approvalMode=workspace-write` 映射为 Edge `permissionMode=acceptEdits`，`workDir` 原样传入 `startRun`；Desktop App focused tests 仍为 1 个文件 / 4 个测试通过，1440x920 Playwright smoke 通过，截图 `app/desktop/.tmp/visual-smoke-desktop.png` 大小 57029 bytes，DOM 检查确认权限/目标目录控件可操作且无页面级 overflow。
- 2026-06-07：Desktop v4 composer 的浏览器文件附件会读取文本预览并拼接为 prompt 附件上下文，继续通过真实 Edge `startRun(prompt)` 发送；Desktop App focused tests 仍为 1 个文件 / 4 个测试通过，1440x920 Playwright smoke 通过，截图 `app/desktop/.tmp/visual-smoke-desktop.png` 大小 57703 bytes，DOM 检查确认附件 chip 可添加/删除且无页面级 overflow。
- 2026-06-07：Desktop v4 composer 的 @Agent 结构化 mention 会随 prompt 上下文发送到真实 Edge `startRun(prompt)`；Desktop App focused tests 仍为 1 个文件 / 4 个测试通过，1440x920 Playwright smoke 通过，截图 `app/desktop/.tmp/visual-smoke-desktop.png` 大小 58526 bytes，DOM 检查确认 @Agent 菜单可添加/删除 chip 且无页面级 overflow。
- 2026-06-07：Desktop v4 composer 接入原生文件选择，`desktopPlatform` 暴露 `attachments.pickFiles()` 并复用 Tauri dialog/read_file 生成 desktop attachment；Desktop App focused tests 仍为 1 个文件 / 4 个测试通过，Desktop/Web typecheck/build 通过，1440x920 Playwright smoke 通过，截图 `app/desktop/.tmp/visual-smoke-desktop.png` 大小 58526 bytes，DOM 检查确认“添加本机附件”可见且无页面级 overflow。
- 2026-06-07：Desktop `desktopPlatform` 暴露 `preview.openEvidence()`，通过 Tauri shell open 打开 shared inspector 传入的 file/artifact evidence target；Desktop App focused tests 仍为 1 个文件 / 4 个测试通过，Desktop/Web typecheck/build 通过，Desktop 1440x920 Playwright visual smoke 通过，截图 `app/desktop/.tmp/visual-smoke-desktop.png` 大小 58526 bytes，DOM 检查确认 files/browser tabs 可切换、空态/列表状态稳定且无页面级 overflow。

## P3: Web v4 接入

目标：Web 使用同一套工作台，只替换 platform adapter 和数据来源。

- [ ] 建立 `app/web/src/platform/webPlatform.ts`，首片已提供 static Web adapter 和 `preview.openEvidence()` 浏览器打开 port，并补齐 Web Vite/Vitest 的 `lucide-react` alias 以支持 shared workbench 图标双端解析；v4 workbench 的 @Agent 列表已接 Hub `GET /web/agent-profiles`，未登录或无数据时才使用 preview fallback；下一步接入 Hub sessions/messages、Hub WS 和远程 run submit。
- [ ] 用 `AgentHubWorkbench` 替换 Web 旧 `ChatView`、`PromptInput`、`ThreadPanel`、`RunDetail`；首片已让 Web App 根入口渲染 shared workbench。
- [x] Web transcript 与 Desktop transcript 使用同一 block renderer。
- [x] Web inspector 与 Desktop inspector 使用同一组件，差异只来自 adapter capability。
- [ ] Web build/typecheck 和核心 UI tests 进入验收门禁；首片证据：`cd app/web; corepack.cmd pnpm exec vitest run src\App.test.tsx --reporter=dot`、`corepack.cmd pnpm typecheck`、`corepack.cmd pnpm build` 均通过；Playwright visual smoke 通过并生成 `.tmp/visual-smoke-web.png`。
- 2026-06-07：Web `App` 在 `QueryClientProvider` 内通过 `useAgentList(true)` 读取 Hub Agent Profiles，并把 Hub `AgentInfo` 映射为 shared `WorkbenchAgent` 供 v4 composer @Agent 菜单使用；未登录或 Hub 无 profile 数据时保留 preview fallback；同时恢复 `app/web/src/api/edgeClient.ts` Hub-only/stubbed 兼容面，保证浏览器端不重新引入 Local Edge；`cd app/web; corepack.cmd pnpm exec vitest run src\App.test.tsx src\platform\webPlatform.test.ts src\api\agentQueries.test.ts --reporter=dot`，3 个文件 / 7 个测试通过，`corepack.cmd pnpm typecheck` 通过，`.\scripts\verify-web-hub-boundary.ps1` 12/12 通过。

## P4: Tauri Host API 重构

目标：把 Desktop host 能力从巨石 command 文件拆成可测试、可审计的能力模块。

- [ ] `src-tauri/src/host/edge.rs`：Edge start/stop/status/auth token。
- [ ] `src-tauri/src/host/fs.rs`：文件树、读写、复制、重命名、删除、路径 allowlist。
- [ ] `src-tauri/src/host/dialog.rs`：选择文件/目录、保存路径。
- [ ] `src-tauri/src/host/auth.rs`：TokenDance ID loopback、session/keyring。
- [ ] `src-tauri/src/host/window.rs`：窗口、托盘、通知、外链打开。
- [ ] `src-tauri/src/commands.rs` 只保留 command 注册和向后兼容 shim，最终再删除 shim。
- [ ] 为 path validation、allowlist、危险操作、Edge lifecycle 写 Rust 单测或集成测试。

## P5: 清理与发布门禁

- [ ] 删除旧 UI 主入口和重复组件。
- [ ] 删除旧 active docs 入口，不再要求读不存在或已归档的状态文件。
- [ ] 更新 `docs/governance/branch-governance.md` 的远端分支事实。
- [ ] 更新 README 的项目结构和文档导航。
- [ ] 建立截图矩阵：Desktop 1440x920、1280x800、390x844；Web 1440x920、1280x800、390x844。
- [ ] 建立旧路径扫描命令并写入计划验收：`ChatView`、`PromptInput`、`IMBlockRenderer`、`RunDetail`、`ThreadPanel`、旧 `viewRegistry`、旧 hooks。

## 暂不做

- 不在文档分支实现大规模代码改造。
- 不修改 `agenthub-design`。
- 不把旧 Desktop UI 当成长期 fallback。
- 不为了快速截图复制一套 Web UI。
- 不做 Mobile v4 重构。Mobile 后续只消费 shared workbench 的稳定子集，当前不作为重构阻塞项。

## 已完成基线

- Edge/Hub/Adapter 核心运行链路已经具备可用基础。
- `app/shared/src/ui/` 已有 Button、Modal、MessageBubble、ToolTimeline、DiffReviewPanel、ArtifactCard、DeployCard 等基础组件和测试/故事素材。
- Desktop/Web 已经通过 `@shared` 共享一部分类型、API 和 UI，但主工作台仍是分叉实现。
- 当前最大工程风险是旧 UI 组件和 hooks 继续扩写，导致 Desktop/Web 共享 UI 迁移失败。
