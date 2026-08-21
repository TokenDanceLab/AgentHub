# AgentHub Web

最后更新：2026-07-26

`app/web/` 是 AgentHub 浏览器端工作台。它负责 Hub 登录后的远程查看、审批、IM、项目视图、Agent/Profile 展示和 Web 预览；真实执行仍由 Edge Server 完成。旧长版 README 见 [../../docs/history.md](../../docs/history.md)。

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
| App entry | `src/App.tsx` -> `src/layouts/WebLayout.tsx` |
| Shell slots | `src/viewRegistryConfig.ts`, `src/views/viewRegistry.tsx` |
| Hub client | `src/api/hubClient.ts`, `src/api/` |
| i18n | `src/i18n/`, `src/i18n/README.md` |
| Shared UI/workbench/chat | `../shared/src/ui/`, `../workbench/src/`, `../shared/src/chatview/` |
| Legacy route bridge | `src/router.tsx`, `src/pages/*` -> `App` |

Shared components must come from `app/shared/`; do not copy Desktop/shared UI locally in Web.

## Current Routes

| Route | Current behavior |
|---|---|
| `/` | Desktop-aligned Workbench shell |
| `/chats` | Messages/IM shell |
| `/settings` | Settings shell |
| `/agent-square`, `/group/:id`, `/project/:id` | Legacy public URLs bridged into `WebLayout` route context |

If Agent Square, Private Chats, Group Workspace, or Project features return, migrate them into the shell/slot architecture instead of reviving standalone decorative page prototypes.

## Local Preview

```powershell
corepack.cmd pnpm --dir app/web install --ignore-scripts
corepack.cmd pnpm --dir app/web dev --host 127.0.0.1
```

`vite.config.ts` owns strict port `5174`. Desktop/Tauri Vite uses `5173`; Mobile RN Expo Web preview uses `5177`.

## Verification

```powershell
corepack.cmd pnpm --dir app/web typecheck
corepack.cmd pnpm --dir app/web build
corepack.cmd pnpm --dir app/web test:e2e:stubbed-hub
python scripts/verify/verify-web-hub-boundary.py
```

Visual QA:

```powershell
corepack.cmd pnpm --filter agenthub-web visual:qa:shell
```

Evidence from fixture/stub/visual runs must not claim real login, real model/API execution, packaged Desktop, or production behavior. Evidence labels are enforced by `scripts/verify/verify-real-e2e-contract.py`.

## Links

- Root README: [../../README.md](../../README.md)
- API contract: [../../api/README.md](../../api/README.md)
- Architecture: [../../docs/architecture.md](../../docs/architecture.md), [../../docs/architecture/04-frontend-data-flow.md](../../docs/architecture/04-frontend-data-flow.md)
- Shared package: [../shared/README.md](../shared/README.md)
