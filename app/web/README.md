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
corepack.cmd pnpm dev --host 127.0.0.1
```

浏览器打开：

```text
http://127.0.0.1:5174/
```

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
