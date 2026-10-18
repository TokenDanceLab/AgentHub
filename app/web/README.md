# AgentHub Web

最后更新：2026-10-19

`app/web/` 是 AgentHub 浏览器端工作台。它负责 Hub 登录后的远程查看、审批、IM、项目视图、Agent/Profile 展示和 Web 预览；真实执行仍由 Edge Server 完成。

## Boundary

```text
Web UI -> Hub Server -> Edge relay / sync -> Edge Server -> Agent Runtime adapter
```

- Web 不直接启动 Codex/OpenCode/Claude Code，也不直连 Local Edge。
- Web 生产路径只通过 Hub session、Hub REST/WS、Edge target routing 访问执行能力。
- 未登录 preview fallback 只能表示演示状态，不能冒充真实 Runtime 在线。
- Web token 当前为 tab-scoped `sessionStorage` fallback；公开 Web 发布前应升级为 BFF/HttpOnly cookie 或等价 server-owned session。
- TokenDance ID 第三方 provider、账号绑定和 OIDC client 归 TokenDance ID；Web 只消费 Hub session。
- Hub 认证状态机（OIDC PKCE、token 生命周期、refresh fallback、logout 清理）共享自 `../shared/src/api/auth/`；`src/api/hubAuth.ts` 只注入 Web Port（sessionStorage token、浏览器 callback 路由、当前窗口跳转）。

## Source Map

| Area | Owner |
|---|---|
| App entry | `src/main.tsx` -> `src/App.tsx`（挂载 `@agenthub/workbench` 的 `AgentHubWorkbench`） |
| Platform adapter / workbench 数据映射 | `src/platform/`（`webPlatform.ts`、`useWebWorkbenchModel.ts`、`webWorkbenchProjects.ts` 等） |
| Hub client / queries | `src/api/`（`hubClient.ts`、`hubAuth.ts`、各 `*Queries.ts`） |
| Auth/UI components | `src/components/`（`AuthPage`、`StartConversationModal` 等） |
| State/hooks | `src/stores/`, `src/hooks/` |
| i18n | `src/i18n/`, `src/i18n/README.md` |
| Shared UI/workbench/chat | `../shared/src/ui/`, `../workbench/src/`, `../shared/src/chatview/` |

Shared components must come from `app/shared/`; do not copy Desktop/shared UI locally in Web.

## Current Routes

Web 没有 react-router 路由表：`App.tsx` 只渲染 `AgentHubWorkbench`，页面/分区切换由工作台内部状态驱动（`../workbench/src/WorkbenchRoutes.tsx`：chats、agents、contacts、devices、docs、projects、settings、tasks、usage 等视图）。新增页面放进 workbench shell，不恢复独立页面原型。

## Local Preview

```bash
corepack pnpm --dir app/web install --ignore-scripts
corepack pnpm --dir app/web dev --host 127.0.0.1
```

`vite.config.ts` owns strict port `5174`. Desktop/Tauri Vite uses `5173`; Mobile RN Expo Web preview uses `5177`.

## Verification

```bash
corepack pnpm --dir app/web typecheck
corepack pnpm --dir app/web build
corepack pnpm --dir app/web test:e2e:stubbed-hub
corepack pnpm --dir app lint
```

Visual QA:

```bash
corepack pnpm --dir app/web visual:qa:shell
```

Evidence from fixture/stub/visual runs must not claim real login, real model/API execution, packaged Desktop, or production behavior. Evidence labels are enforced by `scripts/verify/verify-real-e2e-contract.py`.

## Links

- Root README: [../../README.md](../../README.md)
- API contract: [../../api/README.md](../../api/README.md)
- Architecture: [../../docs/architecture.md](../../docs/architecture.md), [../../docs/architecture/04-frontend-data-flow.md](../../docs/architecture/04-frontend-data-flow.md)
- Shared package: [../shared/README.md](../shared/README.md)
