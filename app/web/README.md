<<<<<<< HEAD
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

TokenDance ID 登录最终由 Hub Server 完成 OIDC code exchange 并签发 Hub session。Web 入口不得直接集成 GitHub/Google/飞书，也不得保存第三方 provider token。

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
=======
# AgentHub Web 页面预览说明

本文档说明如何在本地预览 `app/web` 下的前端页面雏形。当前预览壳用于快速查看 5 个页面效果，后续正式路由、导航和业务状态可以在此基础上继续演进。

## 前置条件

- 已在仓库根目录完成代码同步。
- 本机可以使用 Node.js / Corepack。
- 在 Windows PowerShell 中执行命令时，优先使用 `corepack.cmd pnpm`。

## 启动预览

进入 Web 前端目录：

```powershell
cd E:\AgentHub\app\web
```

首次启动或依赖变更后安装依赖：

```powershell
corepack.cmd pnpm install --ignore-scripts
```

启动本地预览服务：

```powershell
>>>>>>> origin/dev/trump
corepack.cmd pnpm dev --host 127.0.0.1
```

浏览器打开：

```text
http://127.0.0.1:5174/
```

<<<<<<< HEAD
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
- `baseUrl` 的 TypeScript 7.0 弃用提示来自编辑器，不是当前编译错误。
- Web 的真实远程执行、审批和多端同步必须通过 Hub session + Edge target，不能绕过 Hub 直接控制任意 Edge。

## 文档入口

- 根入口：[../../README.md](../../README.md)
- API 契约：[../../api/README.md](../../api/README.md)
- Shared 包：[../shared/README.md](../shared/README.md)
- 系统架构：[../../docs/system-architecture.md](../../docs/system-architecture.md)
=======
## 预览页面

页面顶部提供 5 个切换入口：

- `Workbench`
- `Agent Square`
- `Private Chats`
- `Group Workspace`
- `Project`

点击对应按钮后，会在同一个预览壳中加载对应页面。当前页面文件位置：

```text
app/web/src/pages/workbench/WorkbenchPage.tsx
app/web/src/pages/agent-square/AgentSquarePage.tsx
app/web/src/pages/private-chats/PrivateChatsPage.tsx
app/web/src/pages/group-workspace/GroupWorkspacePage.tsx
app/web/src/pages/projects/ProjectPage.tsx
```

## 验证命令

修改页面后，至少运行 TypeScript 检查：

```powershell
corepack.cmd pnpm typecheck
```

需要确认 Vite 能正常打包时运行：

```powershell
corepack.cmd pnpm build
```

仓库提交前建议在根目录检查空白字符问题：

```powershell
cd E:\AgentHub
git diff --check
```

## 常见问题

### 端口被占用

`app/web/vite.config.ts` 当前使用端口 `5174`。如果启动时报端口占用，先关闭占用该端口的旧服务，再重新运行：

```powershell
corepack.cmd pnpm dev --host 127.0.0.1
```

### 页面样式没有完全加载

当前 5 个页面保留了原始 HTML 雏形中的外部资源，例如 Tailwind CDN、Google Fonts 和远程图片。网络不可用或资源访问较慢时，页面视觉效果可能不完整。

### `baseUrl` 显示 TypeScript 7.0 弃用警告

这是编辑器对未来 TypeScript 版本的提示，不是当前编译错误。`app/web/tsconfig.json` 当前与仓库已有的 `app/desktop/tsconfig.json` 保持一致，因此暂不为了消除这个警告单独改配置。

### 不要提交本地生成目录

`node_modules/` 和 `dist/` 是本地依赖与构建产物，不需要提交到仓库。
>>>>>>> origin/dev/trump
