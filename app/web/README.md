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
│   ├── pages/             # Workbench、Agent Square、Chats、Projects 等页面
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
http://127.0.0.1:5174/
```

`vite.config.ts` 使用固定端口 `5174` 和 `strictPort: true`。端口被占用时先关闭旧服务，再重新启动。

## 当前页面

当前 Web 入口包含以下页面：

| 页面 | 文件 |
|---|---|
| Workbench | `src/pages/workbench/WorkbenchPage.tsx` |
| Agent Square | `src/pages/agent-square/AgentSquarePage.tsx` |
| Private Chats | `src/pages/private-chats/PrivateChatsPage.tsx` |
| Group Workspace | `src/pages/group-workspace/GroupWorkspacePage.tsx` |
| Project | `src/pages/projects/ProjectPage.tsx` |

这些页面当前仍以前端预览和交互雏形为主。接入真实 Hub/Edge 数据时，先更新 `api/` 契约和 shared 类型，再接入页面状态。

## 验证

```powershell
cd D:\Code\TokenDance\AgentHub\app\web
corepack.cmd pnpm typecheck
corepack.cmd pnpm build
```

仓库提交前在根目录补充：

```powershell
cd D:\Code\TokenDance\AgentHub
git diff --check
```

## 已知限制

- 页面中仍有从早期 HTML 原型迁移来的静态内容和远程资源引用；网络不可用时视觉效果可能不完整。
- `baseUrl` 的 TypeScript 7.0 弃用提示来自编辑器，不是当前仓内 TypeScript 5.8 编译错误。
- Web 的真实远程执行、审批和多端同步必须通过 Hub session + Edge target，不能绕过 Hub 直接控制任意 Edge。

## 文档入口

- 根入口：[../../README.md](../../README.md)
- API 契约：[../../api/README.md](../../api/README.md)
- Shared 包：[../shared/README.md](../shared/README.md)
- 系统架构：[../../docs/architecture/system-architecture.md](../../docs/architecture/system-architecture.md)
