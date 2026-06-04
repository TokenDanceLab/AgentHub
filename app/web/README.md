# AgentHub Web

`app/web/` 是 AgentHub 浏览器端工作台和页面预览入口。它面向远程查看、审批、协作页面、Agent Square、项目视图和未来 Web/Mobile 体验；真实执行仍由 Edge Server 完成。

## 架构边界

```text
Web UI -> Hub Server -> Edge relay / sync -> Edge Server -> Agent Runtime adapter
```

Web 不直接启动 Codex/OpenCode/Claude Code，也不直接访问本地 Agent CLI。需要本地执行时通过 Hub relay 或已注册 Edge target 路由；需要纯本地开发预览时只运行 Vite 页面。

| 概念 | Web 侧展示方式 |
|---|---|
| Agent Runtime | Codex、OpenCode、Claude Code 等 Runtime 能力标签 |
| Agent Profile | 用户实际选择和管理的 Agent 卡片 |
| Agent Configuration | 模型、Skill、MCP、审批策略、工作目录、上下文来源等配置摘要 |
| Execution Target | Local/Remote/Cloud/Relay target 的位置、在线状态和权限 |

TokenDance ID 登录最终由 Hub Server 完成 OIDC code exchange 并签发 Hub session。Web 入口不得直接集成 GitHub/Google/飞书，也不得保存第三方 provider token。Web 侧所有 Hub session 请求必须使用 `device_type=web`；只有 Desktop/Edge bridge 能使用 `device_type=desktop` 访问 `/edge/*` callback 路由。当前 Web Hub access/refresh token 只保存在 tab-scoped `sessionStorage` 并清理旧 `localStorage` token key；公开 Web 发布前仍应升级为 BFF/HttpOnly cookie 或等价 server-owned session。

Hub Server 的业务 REST 响应使用 `{code,data,message}` envelope。Web `hubClient` 会统一解包 `data`，并把 Hub error envelope 转成 `AppError`；测试 mock 必须覆盖生产 envelope，不能只返回裸 JSON。登录后 Web 的 Agent 列表优先读取 Hub `GET /web/agent-profiles`，把 Agent Profile 映射成可选 Agent；未登录时只保留 preview fallback，不把浏览器本地 mock 当成真实 Runtime 在线状态。

TokenDance ID / Hub OIDC 结构检查：

```powershell
cd D:\Code\TokenDance\AgentHub
.\scripts\verify-oidc-readiness.ps1
```

该检查只证明仓库内端点、示例配置、存储策略、Hub WebSocket upgrade 鉴权和治理文档对齐；它不替代部署态 login -> callback -> Hub session -> WebSocket auth -> logout/reconnect 的真实 smoke。

Web 生产入口不得直连 Local Edge。改 Web transport、runtime/profile、run/task 或 preview fallback 时同时运行：

```powershell
cd D:\Code\TokenDance\AgentHub
.\scripts\verify-web-hub-boundary.ps1
```

该检查会阻断浏览器端重新引入 Local Edge loopback、`/v1/runs`、`/v1/events`、旧 Edge 事件流 hook 或 Desktop-only Hub-Edge bridge。Web 中 `api/edgeClient.ts` 只保留 Hub-only 兼容 stub，用于预览状态和未登录 fallback。

## 目录结构

```text
app/web/
├── src/
│   ├── components/        # Web layout 和页面级组件
│   ├── i18n/              # zh/en 文案
│   ├── lib/               # Web 工具
│   ├── pages/             # Legacy URL bridges; real UI is App -> WebLayout
│   └── styles/            # Web 样式
├── screenshots/           # 视觉检查截图
├── package.json
├── vite.config.ts
├── vitest.config.ts
└── tsconfig.json
```

共享类型、工具和通用 UI 从 `app/shared/` 引入；不要在 Web 内复制一套 `@shared/ui` 组件。

## 本地预览

```powershell
cd D:\Code\TokenDance\AgentHub\app\web
corepack.cmd pnpm install --ignore-scripts
corepack.cmd pnpm dev --host 127.0.0.1
```

浏览器打开：

```text
http://127.0.0.1:5175/
```

`vite.config.ts` 使用固定端口 `5175` 和 `strictPort: true`。Mobile 固定使用 `5174`，Web 不再抢占 Mobile 端口。端口被占用时先关闭旧服务，再重新启动。

## Design Alignment

Web follows the Desktop command-center layout and token direction. Workbench, Private Chats, Project preview, diff tree, run output, and permission surfaces should use dense glass panels, low-contrast borders, and solid semantic fills. Do not add gradient cards or colored left rails to communicate state; use badges, borders, icons, and concise copy instead. The Web token file maps local CSS variables to `@agenthub/shared` `designTokens`, which is also consumed by Mobile docs and tests as the shared Desktop glass baseline. The shell brand mark uses the shared `TokenDanceMark` UI component backed by `app/shared/src/assets/tokendance-icon-rounded.svg`; `AH` text blocks and app-local brand SVG copies are treated as legacy placeholders and should not return to the active shell.

Latest in-app browser evidence:

```text
app/web/screenshots/web-design-workspace-desktop-1440x920.png
app/web/screenshots/web-design-workspace-mobile-390x844.png
app/web/screenshots/web-design-messages-mobile-390x844.png
app/web/screenshots/web-design-settings-mobile-zh-390x844.png
app/web/screenshots/web-design-run-overlay-mobile-390x844.png
app/web/screenshots/web-design-account-sheet-mobile-390x844.png
app/web/screenshots/web-design-agent-square-mobile-390x844.png
app/web/screenshots/web-design-project-mobile-light-390x844.png
app/web/screenshots/web-glass-workbench-i18n-iab-1440x920.png
app/web/screenshots/web-glass-workbench-i18n-iab-390x844.png
app/web/screenshots/web-glass-final-typechecked-workbench-iab-1440x920.png
app/web/screenshots/web-glass-final-typechecked-workbench-iab-390x844.png
app/web/screenshots/web-workbench-desktop-aligned-touch-iab-390x844.png
app/web/screenshots/web-workbench-desktop-aligned-touch-iab-390x844.probe.json
app/web/screenshots/web-shell-messages-route-iab-390x844.png
app/web/screenshots/web-shell-messages-route-iab-390x844.probe.json
app/web/screenshots/web-shell-settings-route-iab-390x844.png
app/web/screenshots/web-shell-settings-route-iab-390x844.probe.json
app/web/screenshots/web-shell-messages-no-rails-pw-390x844.png
app/web/screenshots/web-shell-messages-no-rails-pw-390x844.probe.json
app/web/screenshots/web-mobile-surface-nav-workspace-pw-390x844.png
app/web/screenshots/web-mobile-surface-nav-messages-pw-390x844.png
app/web/screenshots/web-mobile-surface-nav-settings-pw-390x844.png
app/web/screenshots/web-mobile-surface-nav-run-overlay-pw-390x844.png
app/web/screenshots/web-mobile-surface-nav-pw-390x844.probe.json
app/web/screenshots/web-mobile-messages-locked-filled-pw-390x844.png
app/web/screenshots/web-mobile-messages-authenticated-filled-pw-390x844.png
app/web/screenshots/web-mobile-messages-add-contact-pw-390x844.png
app/web/screenshots/web-mobile-messages-filled-pw-390x844.probe.json
app/web/screenshots/web-legacy-agent-square-shell-pw-390x844.png
app/web/screenshots/web-legacy-group-shell-pw-390x844.png
app/web/screenshots/web-legacy-project-shell-zh-pw-390x844.png
app/web/screenshots/web-legacy-shell-routes-pw-390x844.probe.json
app/web/screenshots/web-page-export-converged-agent-square-pw-390x844.png
app/web/screenshots/web-settings-shared-glass-shell-pw-390x844.png
app/web/screenshots/web-settings-shared-glass-shell-pw-390x844.probe.json
app/web/screenshots/web-route-shared-registry-agent-square-pw-390x844.png
app/web/screenshots/web-route-shared-registry-group-pw-390x844.png
app/web/screenshots/web-route-shared-registry-project-pw-390x844.png
app/web/screenshots/web-route-shared-registry-pw-390x844.probe.json
app/web/screenshots/web-settings-shared-desktop-section-pw-390x844.png
app/web/screenshots/web-settings-shared-desktop-section-keyboard-pw-390x844.png
app/web/screenshots/web-settings-shared-desktop-section-pw-390x844.probe.json
app/web/screenshots/web-mobile-account-nav-pw-390x844.png
app/web/screenshots/web-mobile-account-nav-pw-390x844.probe.json
app/web/screenshots/web-mobile-account-sheet-pw-390x844.png
app/web/screenshots/web-mobile-account-sheet-pw-390x844.probe.json
```

`corepack.cmd pnpm --filter agenthub-web visual:qa` is the current repeatable Web visual gate. It starts from `WEB_QA_URL` (default `http://127.0.0.1:5175/`), mocks Hub REST data, captures 8 Desktop/Web/Mobile scenes, and writes matching `.probe.json` files beside the screenshots. The latest probes confirmed `scrollWidth=390`, `gradientCount=0`, `leftOnlyBorderCount=0`, `leftInsetShadowCount=0`, `smallTargets=[]`, shell TokenDance logo present, no shell brand text fallback, and no raw `agent.*` / `welcome.*` / `prompt.*` / `webShell.*` / `settings.*` / `auth.*` i18n keys on Workbench, Messages, Settings zh, Run overlay, Account sheet, Agent Square bridge, and Project bridge states. The mobile Web shell keeps a bottom surface nav for Workspace / Messages / Run / Account. Account is the rightmost phone-first identity entry and uses the shared `surface.mobile.account.*` metadata; the topbar account button is hidden on 390px screens so sign-in is not duplicated. The Account sign-in surface is a mobile bottom sheet rather than a Desktop-centered modal on 390px screens; the sheet probe confirms `width=390`, `bottom=0`, top radius `14px`, 44px+ controls, glass blur, TokenDance brand logo, TokenDance identity button icon, no raw i18n keys, and no hardcoded Chinese copy in the English view. Shared/Web source scanning also returns no `linear-gradient`, `radial-gradient`, `conic-gradient`, `border-left:`, particle canvas references, or `inset Npx 0 0` left-rail selected states under `app/web/src`, `app/mobile/src`, and `app/shared/src`.

Messages-specific 390x844 evidence now covers both anonymous and authenticated visual states. `IMView` fills the Hub-locked state with session/surface/realtime cards, and the authenticated no-selection state with sessions/messages/agent-handoff cards. `IMContactList` user-visible strings are localized through `im.contact.*`; mobile add/search/contact controls are at least 44px, with the latest probe recording `addButton=44x44`, `searchInput=348x44`, `smallTargets=[]`, `gradientCount=0`, `leftOnlyBorderCount=0`, `leftInsetShadowCount=0`, and `rawI18nKeys=[]`.

The current production-like Web entry is `src/App.tsx -> layouts/WebLayout.tsx`, which follows the Desktop slot shell (`agent-list`, `thread-panel`, `main-view`, `prompt-input`, `run-detail`, settings, IM). The shell owns the basic URL state: `/` opens Workbench, `/chats` opens Messages, and `/settings` opens Settings; top tabs and mobile bottom tabs update browser history and `popstate` restores the visible shell state. `router.tsx` and the top-level `src/pages/*.tsx` files are legacy URL bridges that render `App`; they are not standalone page systems. If Agent Square, Private Chats, Group Workspace, or Project capabilities need to return, migrate the capability into the Desktop-aligned shell instead of reviving a separate decorative layout.

The legacy public URLs `/agent-square`, `/group/:id`, and `/project/:id` now also resolve inside `WebLayout`, not into the old page prototypes. `router.tsx` routes these URLs to `App`, and `WebLayout` renders a compact route context panel above the shared command-center workspace. That panel reads `@agenthub/shared` `surfaceMetadata` for route label, description, and default state instead of maintaining a local Web-only route copy. The latest probe for those routes confirms `scrollWidth=390`, `gradientCount=0`, `leftOnlyBorderCount=0`, `leftInsetShadowCount=0`, `smallTargets=[]`, `rawI18nKeys=[]`, and no old preview-shell labels.

Web Settings also consumes the shared Desktop section registry. The Settings nav/header now resolves shared Desktop-owned sections through `getSurfaceByDesktopSectionId()` and `getSurfaceStatusMetadata()`, so sections such as Execution Targets and MCP Servers show shared label, description, and status in the Web shell. Web-only sections such as Keyboard Shortcuts remain visible but are explicitly labeled as Web local until they get a shared registry owner. The latest `/settings` 390x844 probe confirms `scrollWidth=390`, no gradients, no left rails, `smallTargets=[]`, `rawI18nKeys=[]`, Execution Targets as `Shared Desktop section` / `Real snapshot`, MCP Servers as `Shared Desktop section` / `Interface gap`, and Keyboard Shortcuts as `Web local section` / `Local shell`.

## 当前页面

当前 Web 入口包含以下页面：

| 页面 | 文件 |
|---|---|
| Desktop-aligned shell | `src/layouts/WebLayout.tsx` |
| Slot registry | `src/viewRegistryConfig.ts` / `src/views/viewRegistry.tsx` |
| Legacy URL bridge | `src/router.tsx` and `src/pages/{Workbench,AgentSquare,PrivateChats,GroupWorkspace,Project}.tsx` -> `src/App.tsx` -> `src/layouts/WebLayout.tsx` |

真实入口当前是 Desktop-aligned shell。顶层 `src/pages/*.tsx` 公开导出也已经收敛到 `App`，避免旧 router 或外部 import 绕过统一 shell；`rg` 检查确认顶层 pages/router 不再引用深层旧原型。深层 `src/pages/*/*Page.tsx` 原型文件已移除，不是可发布入口。接入真实 Hub/Edge 数据或公开路由前，先把能力迁回 shell/slot 架构，再更新 `api/` 契约和 shared 类型。

## 验证

```powershell
cd D:\Code\TokenDance\AgentHub\app\web
corepack.cmd pnpm typecheck
corepack.cmd pnpm build
```

视觉验收（需要 5175 Web preview 已启动）：

```powershell
cd D:\Code\TokenDance\AgentHub\app
corepack.cmd pnpm --filter agenthub-web visual:qa
```

仓库提交前在根目录补充：

```powershell
cd D:\Code\TokenDance\AgentHub
git diff --check
```

## 已知限制

- Web 深层旧页面原型已移除；未迁入 `WebLayout`/slot 的旧能力需要重新按 Desktop shell 架构实现。
- `baseUrl` 的 TypeScript 7.0 弃用提示来自编辑器，不是当前仓内 TypeScript 5.8 编译错误。
- Web 的真实远程执行、审批和多端同步必须通过 Hub session + Edge target，不能绕过 Hub 直接控制任意 Edge。

## 文档入口

- 根入口：[../../README.md](../../README.md)
- API 契约：[../../api/README.md](../../api/README.md)
- Shared 包：[../shared/README.md](../shared/README.md)
- 系统架构：[../../docs/architecture/system-design/system-architecture.md](../../docs/architecture/system-design/system-architecture.md)
