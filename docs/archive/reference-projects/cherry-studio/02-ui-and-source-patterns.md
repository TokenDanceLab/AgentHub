# Cherry Studio UI 与源码模式

> 范围：Renderer shell、主题系统、Home/Chat、message blocks、composer、Settings/Provider、E2E。
> 原则：可借鉴交互与结构，不复制单用户本地 trust boundary。

---

## 1. Shell 与主题

Cherry Studio 的桌面感来自一组稳定的系统性选择：

- App provider spine 固定：Redux、React Query、styled-components prop filtering、ThemeProvider、AntdProvider、notification、code style、persist gate、top view、router，见 `src/renderer/src/App.tsx:33-43`。
- Router 提供两套 shell：left sidebar mode 和 top tab mode，见 `src/renderer/src/Router.tsx:60-74`。
- 左侧 icon rail 把 avatar、route icons、pinned apps、theme/settings controls 放在稳定窄列，见 `src/renderer/src/components/app/Sidebar.tsx:67-116`。
- 主题不是散落 props，而是 body attributes：`theme-mode`、`navbar-position`、`os`、`lang`，见 `src/renderer/src/context/ThemeProvider.tsx:54-62`。
- CSS token 由 dark default + light override 组成，见 `src/renderer/src/assets/styles/color.css:1-147`。
- Ant Design 开启 CSS variables、关闭 hashed class，并统一 30px 控件高度、8-10px radius、短 motion，见 `src/renderer/src/context/AntdProvider.tsx:28-116`。

AgentHub 采纳：

| Cherry 模式 | AgentHub 设计 |
|---|---|
| `theme-mode` / `navbar-position` / `os` | `data-theme` / `data-shell` / `data-platform` |
| Sidebar route icon map | Hub、Edge、Runs、Agents、Profiles、Targets、Settings capability nav |
| compact Ant tokens | 映射到 TokenDance `--td-*` token，再适配 shadcn/Ant/Tailwind |
| platform titlebar/window controls | 仅 Desktop shell 使用，Web shell 隔离 |

注意：Cherry 混合 CSS variables、Ant tokens、Tailwind、styled-components。AgentHub 要把 TokenDance Design Contract 作为单一意图层，避免 UI drift。

---

## 2. Home 与 Chat 交互

Cherry 的 Home 是工作台，不是 landing page：

- `HomePage` 挂载 navbar、assistant tabs、chat pane，见 `src/renderer/src/pages/home/HomePage.tsx:120-160`。
- `Chat` 组合 `ChatNavbar`、`Messages`、`ContentSearch`、`ChatNavigation`、`Inputbar` 和可选右侧 Tabs，见 `src/renderer/src/pages/home/Chat.tsx:155`。
- topic list 支持虚拟列表和拖拽，见 `src/renderer/src/pages/home/Tabs/components/Topics.tsx:562`。

AgentHub 两个 Home 的取向：

- 默认首屏应显示 active sessions、recent runs、pending approvals、assigned handoffs、Edge connectivity、failed jobs。
- 不用营销型大卡片堆叠；Home 是重复操作入口。
- Web Home 与 Desktop Home 共用实体模型，但 Desktop 可增加本机 workspace、IDE open、local bridge 状态。

---

## 3. Message Block 模型

Cherry 把一条消息拆成 shell + ordered typed blocks：

- block 类型：text、thinking、image、code、tool、file、error、citation、video、compact，见 `src/renderer/src/types/newMessage.ts:23-151`。
- block 状态：pending、processing、streaming、success、error、paused，见 `src/renderer/src/types/newMessage.ts:39`。
- block store 使用 Redux entity adapter 正规化存储，见 `src/renderer/src/store/messageBlock.ts:40`。
- streaming 先插入 unknown placeholder，再转换为具体 block，见 `src/renderer/src/services/messageStreaming/BlockManager.ts:108`。
- 相邻 image/video/tool blocks 会被 grouped rendering，见 `src/renderer/src/pages/home/Messages/Blocks/index.tsx:69-181`。
- 多模型回答通过同一 `askId` 分组，见 `src/renderer/src/pages/home/Messages/MessageGroup.tsx:298`。

AgentHub 应采用的 block 类型：

| AgentHub block | 用途 |
|---|---|
| `assistant_text` | 普通回复、总结、审查结论 |
| `reasoning` | 可折叠推理/计划摘要，不暴露敏感中间内容 |
| `tool_call` | Codex/Claude/OpenCode tool call、状态、耗时 |
| `terminal_output` | bounded ANSI-aware output |
| `file_diff` | patch/diff preview |
| `approval_request` | allow/deny/always/block、scope、risk |
| `artifact` | screenshot、doc、patch、preview、deployment link |
| `citation` | repo path、web source、issue/PR reference |
| `error` | typed error + retry guidance |
| `handoff` | 等人、等权限、等 reviewer、等外部系统 |

关键差异：AgentHub 的 block 权威来源应是 Hub/Edge 事件流，而不是 renderer 自行推导。

---

## 4. Tool Group 与 Human Handoff

Cherry 的 tool group 值得直接吸收交互逻辑：

- tool blocks 连续出现时合并成一个组，见 `src/renderer/src/pages/home/Messages/Blocks/index.tsx:100-181`。
- group header 显示 running/waiting 状态，内部列表可滚动。
- `waiting` 由 pending tool status 和 approval state 推导，用于突出需要人工处理的状态。

AgentHub 改造：

- 把 tool group 扩展为 run step group：tool、terminal、patch、approval、artifact 都能进入同一 step group。
- waiting 状态统一用于：needs approval、needs human answer、blocked on reviewer、handoff requested、credential missing。
- 高风险动作按钮保持常驻可见，不只 hover 显示。

---

## 5. Composer 与 Scope Registry

Cherry 的输入栏是复用组件，不是页面内临时拼装：

- `InputbarCore` 是纯 UI frame，见 `src/renderer/src/pages/home/Inputbar/components/InputbarCore.tsx:106`。
- `InputbarToolsProvider` 管理附件、提及模型、知识库、展开状态、quick panel。
- `registry.ts` 按 chat/session/mini-window 定义 scope config，见 `src/renderer/src/pages/home/Inputbar/registry.ts:7-51`。
- 支持 drag/drop、paste、附件预览、mention/model panel、slash/quick panel、token/context count、pause send。

AgentHub 采纳：

- 为 `home-chat`、`run-session`、`agent-handoff`、`review-comment`、`quick-command` 定义 composer scopes。
- scope 决定附件类型、允许的 commands、可提及对象、提交目标、是否需要 workspace/target。
- pause/abort 要连接 Edge/Hub 控制协议，而不是前端只改 loading 状态。

---

## 6. Settings / Provider / Model

Cherry Settings 的信息架构成熟：

- `SettingsPage` 是 routed shell，左侧分组 nav，右侧 route pages，见 `src/renderer/src/pages/settings/SettingsPage.tsx:60-194`。
- `SettingContainer`、`SettingGroup`、`SettingRow` 等 shared primitives 保证页面一致，见 `src/renderer/src/pages/settings/index.tsx:7-90`。
- Provider 管理是两栏：可搜索/拖拽 provider list + provider detail，见 `src/renderer/src/pages/settings/ProviderSettings/ProviderList.tsx:349-448`。
- API key 输入本地缓冲 + debounce 再写全局状态，见 `src/renderer/src/pages/settings/ProviderSettings/ProviderSetting.tsx:151-195`。
- multi-key popup 支持 CRUD、去重、单 key 检测、批量检测、移除失败 key，见 `src/renderer/src/components/Popups/ApiKeyListPopup/hook.ts`。
- Model management 支持搜索、远端 fetch、批量添加、provider-specific handling，见 `src/renderer/src/pages/settings/ProviderSettings/ModelList/ManageModelsPopup.tsx`。

AgentHub 采纳：

| Cherry 页面 | AgentHub 页面 |
|---|---|
| Provider list/detail | Provider Profile、Relay route、model routing |
| API server settings | Desktop local bridge、Edge endpoint、Hub endpoint |
| MCP settings | Tool registry、adapter capability、approval policy |
| Channels | Feishu/Lark、Slack、Webhook Gateway |
| Tasks | Cron、heartbeat、watcher、workflow automation |
| Memory | RAG/memory policy、retention、visibility、opt-in |

安全差异：Provider secret 不能把 renderer persisted Redux/localStorage 当主存储。AgentHub 应放在服务端安全存储或 OS-secured store，前端只持有 masked metadata 和健康状态。

---

## 7. Artifact 与 Code Preview

Cherry 对 HTML artifact 有完整体验：

- markdown/code block renderer 可识别 code fences，见 `src/renderer/src/pages/home/Markdown/CodeBlock.tsx:54`。
- `CodeBlockView` 支持 source/special/split view、copy/download/run/wrap/expand，见 `src/renderer/src/components/CodeBlockView/view.tsx:43`。
- `HtmlArtifactsCard` 提供 inline preview/open/download，见 `src/renderer/src/components/CodeBlockView/HtmlArtifactsCard.tsx:57`。
- `HtmlArtifactsPopup` 提供 fullscreen split/code/preview 和截图，见 `src/renderer/src/components/CodeBlockView/HtmlArtifactsPopup.tsx:99`。

AgentHub 不应只识别 HTML fenced code。Artifact 要成为一等实体：

- patch/diff artifact
- Playwright screenshot artifact
- generated doc/deck artifact
- deployment preview artifact
- terminal/log artifact
- benchmark/report artifact

---

## 8. QA Pattern

Cherry 的 Electron E2E 结构值得借鉴：

- custom fixture 启动 Electron，并暴露 `electronApp` 与 `mainWindow`，见 `tests/e2e/fixtures/electron.fixture.ts:13-50`。
- Playwright 配置保留失败 trace/screenshot/video，见 `playwright.config.ts:19-55`。
- wait helpers 编码 Electron/React/PersistGate/HashRouter 的 ready 条件，见 `tests/e2e/utils/wait-helpers.ts:8-91`。

AgentHub 采纳：

- Desktop: 启动 app 后检查 Hub/Edge connection、Settings、Run、Approval、Artifact、OIDC login 状态。
- Web: Playwright 覆盖两套 Home、TokenDance ID redirect/callback、权限失败、session resume。
- 避免固定 sleep，优先 route、selector、event、network assertion。
