# Desktop UI QA SOP

> 范围：只覆盖 `app/desktop/**`。最后更新：2026-05-29。

本 SOP 面向接手 Desktop UI/UX 修复的 Agent。除非任务明确要求，否则不要改 Mobile、Hub、Edge 的无关内容。

## 0. 完成定义

Desktop UI 修复不能只停在“看起来好了”。满足以下条件后，才可以写成已完成：

1. 已复现问题，或用具体观察界定了问题边界。
2. 修复落在 `app/desktop/**`，或明确记录为 Desktop-only 阻塞。
3. 至少有一个聚焦单元测试、Playwright 交互脚本或 DOM probe 覆盖本次变化。
4. 修复后截一张客户端 viewport 图，不用整屏系统截图验收普通 UI。
5. `docs/handoffs/STATE.md` 记录脱敏证据：截图路径、命令结果、手动点击路径和剩余风险。
6. 所有启用按钮都必须真实有效；未接线功能必须禁用、隐藏或展示明确不可用/恢复态，不能保留 no-op 控件。

## 1. 接手检查

1. 先读 `AGENTS.md`、`docs/handoffs/STATE.md`、`docs/roadmap.md` 和本文件。
2. 在 AgentHub 仓库根目录检查分支和脏工作区：

```powershell
git status --short --branch
git diff --cached --name-status
```

不要回退自己没创建的 staged 或 unstaged 变更。当前 Desktop 工作经常和其他 Agent 留下的 docs、Mobile、Hub、Edge 改动共用同一棵脏工作树。

## 2. 本地入口和证据位置

- Desktop dev URL：`http://localhost:5173/`
- Desktop 源码：`app/desktop/src/`
- Tauri Desktop 源码：`app/desktop/src-tauri/`
- Desktop UI 任务不要修改 `app/mobile/**`。
- 临时 Playwright 脚本、截图、raw JSON 放在仓库 ignored 的 `.tmp/`。
- 截图只截客户端 viewport。除非 bug 是原生窗口 chrome，否则不要用 OS 全屏截图。
- 证据文件使用稳定命名，例如：
  - `.tmp/desktop-chat-overlap-20260527.png`
  - `.tmp/desktop-thread-actions-qa.cjs`
  - `.tmp/desktop-top-menu-audit.json`
- tracked docs 只写 `.tmp/...` 相对路径，不写用户机器绝对路径。

## 3. 真实 QA 要求

聊天、渲染、滚动、runtime/thread 相关修复，必须至少做以下检查：

1. 打开或刷新 `http://localhost:5173/`。
2. 尽量使用真实 runtime thread，优先 Claude Code 或 Codex。
3. 发送唯一 synthetic prompt，验证出现非用户回复行，而不是只验证 prompt 出现在 UI。
4. 截一张最终客户端状态图。
5. 用 `GET /v1/threads/<threadId>/items` 或等价只读接口确认同一个 thread 同时存在 `user_message` 和 `agent_message`；如果 UI 没显示但 items 已存在，优先查前端 replay/merge/render，不要先判定 runtime 没回复。
6. 跑 DOM 几何 probe：
   - 所有 `[data-message-id]` 行应是 `position: relative`；
   - 消息行不能带 virtualizer `translateY(...)`；
   - 相邻消息矩形不能重叠；
   - 新消息后容器应保持在底部或接近底部，除非用户手动滚离底部。
7. 在 `docs/handoffs/STATE.md` 写脱敏证据：
   - `.tmp/...` 截图路径；
   - runtime 名称和 thread 状态；
   - row count、overlap、transform、console error 摘要；
   - 验证命令，以及是 focused 还是 full。

2026-05-27 Desktop pass 的本地证据示例：

```text
.tmp/desktop-live-qa-530-reply.png
.tmp/desktop-context-qa-final.png
.tmp/desktop-qa-bottom.png
.tmp/desktop-qa-scrolled-up.png
.tmp/desktop-sop-current-client.png
.tmp/desktop-sop-thread-current-client.png
```

这些是本地 QA artifact，不是 release asset。

## 4. 聊天渲染规则

- 不要在 variable-height 聊天消息上恢复 `@tanstack/react-virtual` 的绝对定位行。长 Markdown、tool group、code block 必须保持普通文档流，除非后续实现能用截图和 overlap probe 证明测量正确。
- 命令/tool group 默认折叠，避免普通文档流被长输出拖垮。
- 用户离开最新消息时必须显示“滚动到底部”入口；运行完成但用户滚在上方时也要显示。
- 点击消息行不能出现浏览器默认蓝色 focus ring；搜索命中可以保留显式 search-hit 样式。
- 用户 prompt 必须有两条链路同时成立：发送后的 optimistic user bubble 立即进入 `allMessages`，Edge `type=user_message` thread item 重新拉取后能投影成右侧用户气泡并替换重复 optimistic bubble。
- `MainView.resolveViewMode` 不能在已有用户气泡时用 loading skeleton 覆盖聊天区；run starting/streaming 状态下也必须保持 ChatView 可见。
- 真实发送 QA 要确认 run 请求携带当前 `activeThreadId`。如果 runtime click 刚创建 thread，但 thread list 查询还没刷新，也不能让 run 回落到 `thread_local`。
- WebSocket 在未选择具体 thread 时只从 live tail 订阅未来事件；选择具体 thread 后可以使用 Edge event bus replay，但必须按 selected thread 过滤，再与 persisted `user_message` items 合并。不要把未过滤的全历史 replay 直接当作当前 ChatView 消息源，否则旧 run 输出会混进新会话。
- replay/live 合并必须按 `runId` 去重：同一 run 的 live agent row 应替代 persisted `agent_message` transcript，不要把同一回复渲染两遍；不同 run 的 live agent 输出不能因为中间没有 live user event 就合并成同一条 agent row。
- `session_init`、standalone success `run.agent.result`、空文本块不能渲染成聊天行；历史 thinking 应默认折叠，不要留下只有时间戳或只有空 padding 的 agent 行。
- “正在思考 / 思考过程”属于正文辅助信息，字体必须继承 Desktop sans token；不要在中文思考区使用 mono 或会退到宋体/衬线的字体栈。
- 很长的 agent 文本输出必须默认折叠，按钮文案使用 `展开完整输出` / `Collapse output` 一类明确动作；QA 截图要证明最新输出不会把 composer 顶出视口，也不会在发送后把用户新消息滚到错误位置。
- 短会话也要验证最新回复位置：消息很少时聊天列表应贴近 composer 上方，而不是把最新输出留在视口上半部并在其后留下大块空白；长会话仍按普通文档流滚动，不得恢复 absolute virtual row。

## 5. Runtime 和 Thread 连续性

Desktop 同一个 thread 内继续对话时必须保留 runtime route：

- 点击 runtime 应打开该 runtime 的新草稿/新对话，不能静默改写当前 thread runtime。
- 点击已有 thread 时，应优先从本地绑定恢复 runtime。
- fresh browser context 或 reload 后，如果本地绑定缺失，应从 replayed agent messages 的 model/runtime 标签推断 runtime。
- Continue、Retry、Home quick start、PromptInput 都必须使用 effective runtime，不能退回过期或空 runtime selection。
- Edge/adapter 连续性必须用 runtime 可接受的 session id。Claude Code 不接受 Desktop `thread_*` 作为 `--session-id`，Edge 需要把 thread 派生为 UUID-shaped runtime session；首次同线程 run 用 `--session-id <uuid>`，已有 assistant history 后用 `--resume <uuid>`。
- Desktop WebSocket client 会发送应用层 `{type:"ping"}`；Edge `/v1/events` 必须回 `{type:"pong"}`，否则 UI 会反复 `WebSocket pong timeout` 并导致 live output/replay 体验不稳。

2026-05-27 的真实 context QA 路径：

```text
1. 启动 Claude Code thread，请它输出唯一 synthetic QA marker。
2. 用 fresh browser context 重开同一 thread。
3. 确认 header 和 composer 仍显示 Claude Code。
4. 不在 prompt 中重复 marker，只要求 runtime 回忆上一轮 marker。
5. 验证新的非用户回复包含上一轮 marker。
```

tracked docs 不写真实 marker。统一使用 `<qa-marker>`。

## 5.1 模型目录和发送路由 QA

模型选择不能只验证下拉框文字。涉及 PromptInput、Settings 模型配置、Edge adapter、Codex/Claude Code 本机配置时，必须覆盖：

1. 模型来源只能由 Edge/local trusted layer 读取，例如 `/v1/model-catalog`；浏览器 UI 不直接请求 TokenDance Gateway `/v1/models`，也不读取或输出 API key。
2. catalog 响应可以展示 source/status/host 摘要，但不能包含 bearer token、provider secret、cookie、refresh token 或真实 provider id。
3. 下拉框至少显示一个真实来源：`Claude Code settings`、`Codex config`、`Edge adapter mappings` 或 `Claude provider mappings`。
4. 选择 catalog item 后抓 `/v1/runs` 请求体，确认 `model` 是 resolved model，不是仅供 UI 显示的 alias；如果 UI 传了 provider/modelAlias，`resolveRunRequestOptions` 必须保留它们。
5. 选择 Claude Code 映射时，发送请求应能区分 `provider=claude-code` 与 TokenDance Gateway 默认 provider；选择 `newapi/...` 或 Codex config 的 Gateway 模型时，provider 应归一为 `tokendance-gateway`。
6. 没有有效 selected thread 时发送消息，Desktop 必须先创建真实 Edge thread，再把该 threadId 带入 `/v1/runs`；不要允许请求静默落到 `thread_local`。
7. 证据写入 `.tmp/desktop-model-catalog-probe.json` 一类本地 JSON，只在 tracked docs 摘要关键字段：selected scenario、request model/provider、是否非 `thread_local`、console 摘要和截图路径。

参考命令：

```powershell
cd app/desktop
corepack.cmd pnpm exec vitest run src/__tests__/PromptInput.test.tsx src/__tests__/modelSettingsStore.test.ts src/__tests__/threadStore.test.ts
cd ..\..\edge-server
go test ./internal/api -run "TestPostRunsAcceptsDesktopModelRoutingMetadata|TestGetModelCatalogRedactsLocalConfigSecrets" -count=1
cd ..
node .tmp/desktop-model-catalog-qa.mjs
```

## 5.2 附件按钮 QA

Composer 的 `+` 是唯一可见附件入口。涉及附件、file picker 或 composer 样式时，必须覆盖：

1. 浏览器 fallback 的原生 `input[type=file]` 必须隐藏；客户端截图里不能出现“选择文件 / 未选择任何文件 / Choose File / No file chosen”。
2. 点击 `+` 在 Tauri runtime 下走 `@tauri-apps/plugin-dialog`；浏览器 QA 下可以通过 hidden input 注入 synthetic fixture，但 UI 只能显示自定义附件 chip。
3. 附件 chip 必须可移除，长文件名和大小信息不能撑破 composer。
4. 发送时 `/v1/runs` prompt 必须包含 `Attached files:`、文件名和允许预览的小文本内容；二进制或过大内容只传文件元数据，不能把真实私有文件内容写入 tracked docs。
5. 聊天里的用户气泡只展示原始用户指令和紧凑附件摘要；不能把 `Attached files:`、`Content preview:` 或真实文件内容作为聊天正文渲染出来。
6. 证据使用 synthetic fixture，例如 `.tmp/desktop-attachment-fixture.txt`；tracked docs 只记录 `hasFixtureContent=true` / `hasFixtureContentInBubble=false`，不粘贴完整 prompt 或用户真实文件内容。
7. 附件 QA 结束后检查 `/v1/runs`，取消 synthetic run，避免 composer 停留在停止按钮状态。

## 5.3 工作区和环境 QA

Composer 的 `工作区和环境` 必须影响真实运行请求，不能只改 UI label：

1. 默认 `本地 Edge` 表示不发送 `run.workDir`，由当前 Edge 进程工作目录决定。
2. 本地文件夹路径应用后，下一次 `/v1/runs` 必须携带 `workDir`，并且截图要显示 composer 上的文件夹 label。
3. Tauri Desktop 下目录选择按钮必须调用系统目录选择器；浏览器 QA 下如果没有 Tauri runtime，该按钮必须 disabled 并带明确不可用说明，手填路径仍可用于验证请求。
4. 已注册 `local_edge` target 只有在线、非 offline、且有 `workspace_root` 或 allowlist 时才能成为可点击选项；不可用 target 必须 disabled 并展示原因。
5. 容器、SSH/Tailscale、Hub Relay、Cloud Edge 等 target-bound dispatch 未接线前必须 disabled，不得以普通 enabled 按钮展示。
6. 证据使用 synthetic path，例如 `D:\Code\TokenDance\AgentHub`；tracked docs 只记录路径和请求字段，不记录用户私有目录清单。
7. 工作区 QA 结束后检查 `/v1/runs`，取消 synthetic run。

## 5.4 字体、颜色和视觉细节 QA

字体粗细、颜色明度、圆角、阴影、卡片厚度这类高频迭代细节，不要新增脆弱的 DOM 文案或 CSS 数值单元测试；保留 Chat/Prompt/Settings 的逻辑测试，用真实客户端截图和 computed-style probe 做视觉验收。

必须记录：

1. 一张无弹层客户端 viewport 截图，覆盖 sidebar、message、composer。
2. 一张相关弹层截图，例如模型/权限/工作区菜单。
3. probe 中至少包含 `--foreground`、`--muted-foreground`、关键按钮/菜单行的 `fontSize`、`fontWeight`、`color`、`lineHeight`。
4. 检查 `ClaudeClaude`、`选择文件/未选择任何文件/No file chosen`、明显 raw i18n key 这类渲染污染不可见。
5. 记录 console error 摘要；历史 warning 可以说明为既有，但刷新后的新增 error 不能忽略。
6. tracked docs 只写 `.tmp/...` 相对路径和摘要结论，不写本机绝对路径、真实用户 prompt、账号、token、cookie 或 provider secret。
7. Composer 视觉改动要同时截图 inactive、active-send、模型下拉和工作区下拉；模型下拉 probe 必须检查只有一个选中行、无同名可见重复行、无 `newapi` 前缀和无未接线 target 占位。
8. 弹层标题、section label、按钮文案必须走 i18n；中文界面里不能出现硬编码 `REASONING`、`MODEL ROUTE` 这类英文原型标签。
9. 深色玻璃面板不要用 `color-mix(... transparent)` 生成卡片底色；实测会把冷灰面板带成暖色/红褐色。用明确的 rgba 冷灰值，并用截图读图确认没有偏色。
10. 微调暗色主题时同时截一张 light 主题关键页面，确认黑色边框/阴影没有污染浅色主题。
11. 对照 Codex composer 时，优先用低对比圆胶囊、黑色层级边缘、430-460 字重和统一 icon stroke；不要把“默认权限 / 本地 Edge / 模型选择”做成厚重独立卡片，也不要让发送按钮接近纯白刺眼。
12. 用户消息气泡和 composer 的暗色边界必须是极弱层级：优先使用约 `rgba(0,0,0,.06-.12)` 的发丝边和低 alpha 黑影，不要用 `rgba(0,0,0,.3+)` 的明显黑框，也不要用白色内描边模拟玻璃高光。
13. 顶栏下拉菜单必须像原生应用菜单：暗色态使用冷黑灰底、弱黑边和黑色投影；禁止白色描边、强内高光和厚卡片感。QA probe 至少记录 panel `borderColor`、`boxShadow`、item 高度和无横向溢出。
14. 侧栏 Agent/Thread row 的常态和选中态保持 32-36px 高、12.5-13px 字号、13-15px 圆角；选中态用弱整面 tint，不要恢复厚卡片、白描边或大阴影。

## 6. 会话隔离 QA

Thread/session 修复必须证明选择、新建、重命名、删除和 runtime routing 不会串会话：

1. 新建或选择 synthetic QA thread，标题可用 `Desktop Thread Action QA <date>`，测试后尽量删除。
2. 左侧 runtime list 的选择行为应是“用该 runtime 新开草稿/新对话”，不是改变当前已选 thread 的 runtime。
3. 点击已有 thread 必须加载该 thread 的消息和 effective runtime。
4. Rename/Delete 只允许作用于选中的 synthetic QA thread。不要重命名或删除用户真实 thread。
5. 记录本次验证用的是 draft-only thread 还是 server-backed Edge thread。
6. 如果改动触及 thread 控件，截图覆盖选中行、rename 状态、delete confirmation 和最终恢复态。

## 7. 按钮和菜单审计

每个可见 Desktop 控件必须真实可用或诚实禁用：

- Window chrome、顶栏菜单、sidebar actions、runtime row、thread row、composer chips、picker button、settings action、destructive action 都要有一次手动点击路径。
- Sidebar 或 toolbar 的全局搜索入口必须打开真实 SearchDialog，并至少能搜索 thread 与 message。没有真实联系人数据源前，搜索入口和空态不得写“联系人 / contacts”。
- 如果按钮打开菜单，验证菜单在客户端 viewport 内、焦点行为正常，且每个启用项会触发真实状态变化或 API 调用。
- 如果功能尚未接线，展示 disabled、unavailable 或 recovery state，不保留假开关。
- 未解决控件写入 `docs/handoffs/STATE.md`，标清文件 owner 和下一步验证方式。
- Settings 导航搜索不能出现空白导航区；无结果时必须显示明确空态，并用 probe 记录 `navButtonCount=0`、空态文案、无 raw i18n key、无全局水平溢出。
- 不要用只有 chevron 的 `SettingRow action` 表示“以后可进入”。如果某行看起来像二级入口，必须提供真实编辑器、导航或 disabled 状态说明。典型例子：`个性化 / 自定义指令` 必须能保存本地设置，并在 `/v1/runs.appendSystemPrompt` 中验证，不得只显示箭头。
- 顶栏 `文件 / 编辑 / 查看 / 窗口 / 帮助` 必须像应用菜单一样可打开下拉；每个 enabled 菜单项要触发真实 UI 状态、API 或剪贴板动作。浏览器 QA 无法执行的 Tauri 窗口命令必须 disabled 并显示 Desktop-only 说明。参考 QA 脚本：`.tmp/desktop-top-menu-qa.mjs`；参考证据：`.tmp/desktop-top-menu-qa.json` 与 `.tmp/desktop-top-menu-*-pw.png`。

## 8. 账号和同步入口 QA

登录、账号、Hub sync、远程目标、任务桥接相关 UI 不能只看 localStorage 状态。至少覆盖：

1. 未登录：点击 app 左下角 Hub 图标必须打开登录 modal；不应把“退出登录”作为左下角常驻按钮。
2. 已登录：点击 app 左下角 Hub 图标必须进入 Settings 的账号页，而不是重新打开登录 modal。
3. Settings 左侧底部只做账号入口，展示 `未登录` 或账号昵称；退出登录只放在账号页主内容中。
4. 用 synthetic Hub session 测已登录路径时，只 mock `/client/auth/me`、必要的只读列表 endpoint 和 synthetic user；不要把真实账号、user id、org id、token、cookie 写进截图说明或 tracked docs。
5. console / network 证据写入 docs 前必须脱敏，尤其是 WebSocket URL query 中的 `access_token`。
6. 云同步开关如果还没有真实 Hub/Edge 读写链路，必须 disabled 或展示 `not configured` / `unavailable` 状态；不能把仅 localStorage 的开关包装成已打通云同步。

2026-05-28 Settings 控件审计补充：

- 真实 Settings 渲染路径目前仍是 `app/desktop/src/components/SettingsPage.tsx`；拆出的 `components/settings/sections/*` 不能视为线上 UI，除非 `SettingsPage.tsx` 已接入。
- 未接线能力必须同时满足：视觉 disabled、`aria-disabled=true`、点击后不改变 `aria-checked`、不写入 `agenthub-settings.*` localStorage。
- 参考 QA 脚本：`.tmp/desktop-settings-controls-qa.cjs`；参考证据：`.tmp/desktop-settings-controls-qa.json` 与 `.tmp/desktop-settings-*-disabled.png`。
- 使用 synthetic Hub token 做 signed-in UI 路径时，console 和 JSON 中的 WebSocket query `access_token` 必须写成 `REDACTED`。

## 9. Handoff 模板

Desktop 证据建议按这个结构写入 `docs/handoffs/STATE.md`：

```markdown
- **Desktop QA `<topic>` (2026-05-27)**:
  - Scope: `app/desktop/src/<owner-file>` and related tests.
  - Manual path: `<client route or control path>`.
  - Real runtime: `Claude Code` / `Codex` / `OpenCode` / `not rerun, reason: ...`.
  - Screenshots: `.tmp/<client-only-screenshot>.png`.
  - DOM/probe: `rows=<n>`, `overlaps=[]`, `transform=none`, `console=<summary>`.
  - Commands: `corepack.cmd pnpm ...` with pass/fail result.
  - Redaction: `<qa-marker>` only; no account IDs, tokens, cookies, raw private prompts, or absolute secret paths.
  - Remaining risk: `<next concrete defect or none>`.
```

交接记录保持短、准、可复验。不要把 raw Playwright JSON、完整终端日志或完整聊天 transcript 粘进 tracked docs。

## 10. 验证命令

迭代时跑 focused checks：

```powershell
cd app/desktop
corepack.cmd pnpm typecheck
corepack.cmd pnpm exec vitest run src/__tests__/ChatView.test.tsx src/__tests__/threadRuntime.test.ts
```

交接或声称 commit-ready 前跑：

```powershell
cd app/desktop
corepack.cmd pnpm exec vitest run
corepack.cmd pnpm build
cd ..\..
git diff --check
```

`pnpm lint` 当前仍有既有 Desktop lint debt。没有 fresh zero-error run 时，不能声称 lint clean。

## 11. 脱敏和证据治理

- 不提交 `.tmp/` 脚本、截图、local database、log、generated bundle。
- 不把 token、cookie、私有账号标识、邮箱、account ID、生产 credential、本地 secret-store path、用户私有 prompt 写进 docs。
- raw screenshot 和 raw Playwright JSON 留在 `.tmp/`。如果截图包含 secret 或私有 workspace 内容，删除并用 synthetic prompt 重新 QA。
- tracked docs 只写相对路径、sanitized localhost URL、`<qa-marker>`、console 摘要和精确命令。
- public endpoint 只有在仓库架构文档已经公开记录时才可复述；secret、bearer value、refresh token、cookie、one-time code 永远不能进入 tracked docs。
- 交接前运行 `git status --short -- .tmp app/desktop/screenshots`，确认本地 QA artifact 没被 staged 或跟踪。

脱敏替换表：

| Raw evidence | Tracked-doc replacement |
|---|---|
| 可能包含用户/项目数据的真实 prompt | `<qa-marker>` 加一行行为摘要 |
| Token、cookie、refresh token、one-time code | `REDACTED`，如果泄漏到 `.tmp` 之外还要旋转 |
| 个人账号、邮箱、user ID、org ID | `synthetic account` 或 `Hub session present/absent` |
| 仓库外绝对本地路径 | repo-relative path 或 `<local workspace>` |
| 私有生产 host/IP/SSH alias | 已在 repo docs 公开的产品 endpoint，否则写 `<deployment endpoint>` |
| 原始 log dump | error class、第一行脱敏错误和产生它的命令 |
| 含私有内容截图 | 删除，改用 synthetic prompt 重截 |

staging 前对 changed tracked files 做一次定向扫描，并人工判断命中项：

```powershell
git diff --name-only -- docs app/desktop | % { Select-String -Path $_ -Pattern "token|cookie|authorization|refresh|secret|password|Bearer|[A-Z]:\\\\Users|[A-Z]:\\\\[^\\\\]+\\\\secret" -ErrorAction SilentlyContinue }
```

这个扫描只是护栏，不替代读 diff。策略文本里的 false positive 可以接受；真实凭据、私有 prompt、个人标识不能接受。

## 12. 交接清单

停止或交接 Desktop UI 工作前，更新 `docs/handoffs/STATE.md`：

- 当前分支和 dirty-tree 边界；
- 本轮有意触碰的 Desktop 文件；
- 本轮测试和截图；
- 真实发送/runtime 证据，或没有重跑真实发送的具体原因；
- 下一位 Agent 应优先处理的 UI/逻辑缺陷；
- 哪些控件是有意 disabled，而不是假按钮。
