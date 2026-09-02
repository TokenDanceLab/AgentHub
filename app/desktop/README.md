# AgentHub Desktop

最后更新：2026-09-02

`app/desktop/` 是 AgentHub Tauri 桌面端入口，负责本地工作台、Hub 登录、多端 IM、设置、Agent/Profile 管理、Diff/Preview/Approval 和 Local Edge 可见状态。旧长版 README 见 [../../docs/history.md](../../docs/history.md)。

## Boundary

```text
Desktop UI -> Local Edge Server -> Agent Runtime adapter -> Claude Code / Codex / OpenCode
```

- Desktop renderer 不直接启动 Agent CLI；执行由 Local Edge 和 Tauri host typed API 承担。
- 本地执行不依赖 Hub 登录；Hub 登录用于云端 IM、多端同步、远程查看/审批、设备路由和中继。
- Hub 认证状态机（OIDC PKCE、token 生命周期、refresh fallback、logout 清理）共享自 `../shared/src/api/auth/`；`src/api/hubAuth.ts` 只注入 Desktop Port（Tauri credential store、本地 callback server、系统浏览器跳转）。
- Desktop/Web 共享工作台、chat、transcript、composer、inspector 和 design contract；不要复制 shared UI。
- Vite renderer 证据不等于 packaged Desktop。sidecar、sqlite、icon、installer、WebView2 等打包结论必须走 packaged-release 或 approved-real 证据。

## Source Map

| Area | Owner |
|---|---|
| Desktop shell | `src/AppShell.tsx` -> `src/App.tsx`（挂载 `@agenthub/workbench` 的 `AgentHubWorkbench`） |
| Platform adapter / diagnostics | `src/components/`, `src/api/` |
| Views and slots | 视图由共享工作台 `../workbench/src/`（`WorkbenchRoutes.tsx` 各 route view）承担；本包无 `src/views/` |
| State/hooks | `src/stores/`, `src/hooks/` |
| Tauri host | `src-tauri/` |
| Shared UI/workbench/chat | `../shared/src/ui/`, `../workbench/src/`, `../shared/src/chatview/` |

## Local Preview

Start Local Edge when testing online local execution:

```powershell
go run ./edge-server/cmd/agenthub-edge --addr 127.0.0.1:3210 --agent-default claude-acp
```

Start Desktop renderer:

```powershell
corepack.cmd pnpm --dir app/desktop install --ignore-scripts
corepack.cmd pnpm --dir app/desktop dev
```

`vite.config.ts` owns strict port `5173`.

## Tauri Development

```powershell
corepack.cmd pnpm --dir app/desktop build
corepack.cmd pnpm --dir app/desktop tauri dev
```

`pnpm build` only builds the renderer. `tauri dev` and packaged-release claims require Rust/Tauri prerequisites and separate evidence.

## Verification

```powershell
corepack.cmd pnpm --dir app/desktop typecheck
corepack.cmd pnpm --dir app/desktop test:ci
corepack.cmd pnpm --dir app/desktop test:e2e:chat-flow
```

Local Edge smoke:

```powershell
Invoke-RestMethod http://127.0.0.1:3210/v1/health
Invoke-RestMethod http://127.0.0.1:3210/v1/agents
```

Real E2E, Visual QA, observed-local, approved-real, and packaged-release evidence rules are enforced by `scripts/verify/verify-real-e2e-contract.py`.

## Links

- Root README: [../../README.md](../../README.md)
- API contract: [../../api/README.md](../../api/README.md)
- Edge Server: [../../edge-server/README.md](../../edge-server/README.md)
- Hub Server: [../../hub-server/README.md](../../hub-server/README.md)
- Architecture: [../../docs/architecture.md](../../docs/architecture.md), [../../docs/architecture/04-frontend-data-flow.md](../../docs/architecture/04-frontend-data-flow.md)
