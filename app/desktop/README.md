# AgentHub Desktop

`app/desktop/` 是 AgentHub 的 Tauri 桌面端入口。它承载本地工作台、Hub 登录、多端 IM、设置、Agent/Profile 管理、Diff/Preview/Approval 和 Edge 事件调试。

Desktop 不直接启动 Agent CLI。真实执行链路是：

```text
Desktop UI -> Local Edge Server -> Agent Runtime adapter -> Claude Code / Codex / OpenCode
```

## 职责边界

| 概念 | Desktop 责任 |
|---|---|
| Agent Runtime | 展示 Edge `/v1/agents` 暴露的 Runtime adapter 能力，不把 Codex/OpenCode/Claude Code 直接称为用户配置好的 Agent |
| Agent Profile | 提供用户选择、管理和运行 Profile 的 UI；Profile 持久化权威后续归 Hub/Edge profile store |
| Agent Configuration | 展示和编辑模型参数、审批策略、Skill、MCP、工作目录、上下文来源等配置入口 |
| Execution Target | 展示 Local Edge、Remote Edge、Cloud Edge、Hub Relay target 的位置、在线状态和审批策略 |

本地执行不依赖 Hub 登录。Hub 登录只用于云端 IM、多端同步、远程查看/审批、设备路由和中继。

## 目录结构

```text
app/desktop/
├── src/
│   ├── api/             # Edge / Hub REST 和 WebSocket client
│   ├── components/      # Desktop 专用组件
│   ├── views/           # 主视图 registry 和 IM view
│   ├── stores/          # Zustand 状态
│   ├── hooks/           # 数据和交互 hooks
│   ├── i18n/            # zh/en 文案
│   ├── styles/          # OKLCH tokens 和主题
│   ├── __tests__/       # Vitest 单元测试
│   └── __e2e__/         # Playwright smoke
├── src-tauri/           # Tauri shell
├── .storybook/          # shared/ui storybook 入口
├── vite.config.ts
├── vitest.config.ts
└── playwright.config.ts
```

通用组件必须放在 `app/shared/src/ui/` 并通过 `@shared/ui` 导入；不要在 Desktop 内复制一套本地 shared UI。

## 本地运行

终端 1：启动 Local Edge。

```powershell
cd D:\Code\TokenDance\AgentHub\edge-server
go run ./cmd/agenthub-edge --addr 127.0.0.1:3210 --agent-default claude-code
```

终端 2：启动 Desktop Web UI。

```powershell
cd D:\Code\TokenDance\AgentHub\app\desktop
pnpm install
pnpm dev --port 5199
```

浏览器打开：

```text
http://localhost:5199
```

Desktop 默认连接：

| 配置 | 默认 |
|---|---|
| Edge REST | `http://127.0.0.1:3210` |
| Edge WebSocket | `ws://127.0.0.1:3210/v1/events` |
| Hub REST | `VITE_HUB_URL` 或 `http://localhost:8080` |
| Hub WebSocket | `VITE_HUB_WS_URL` 或 `ws://localhost:8080/client/ws` |

## Tauri 开发

```powershell
cd D:\Code\TokenDance\AgentHub\app\desktop
pnpm build
pnpm tauri dev
```

`pnpm build` 只构建前端，不需要 Rust；`pnpm tauri dev` 需要 Rust 和 Tauri 系统依赖。

## 验证

```powershell
cd D:\Code\TokenDance\AgentHub\app\desktop
pnpm test
pnpm build
pnpm typecheck
pnpm test:e2e
```

Playwright 配置会自动启动 `pnpm dev --port 5199`，baseURL 是 `http://localhost:5199`。需要完整在线链路时先启动 Edge 并确认：

```powershell
Invoke-RestMethod http://127.0.0.1:3210/v1/health
Invoke-RestMethod http://127.0.0.1:3210/v1/agents
```

Storybook：

```powershell
pnpm storybook
```

打开 `http://localhost:6006`。

## 已知限制

- `app/shared/src/ui` 的 React 类型解析和 pnpm 跨包虚拟存储会影响部分 shared-ui 测试/typecheck。改动说明里必须区分既有 shared-ui 限制和本次新增错误。
- `scripts/client-smoke.ps1` 仍包含已删除 `runner/` 目录的历史检查，修复脚本前不要作为 Desktop/Edge 验收依据。
- TokenDance ID 目标路径是 Hub Server 完成 OIDC code exchange 并签发 Hub session；现有 Desktop 端入口不得保存第三方 provider token，也不得直接集成 GitHub/Google/飞书。

## 文档入口

- 根入口：[../../README.md](../../README.md)
- API 契约：[../../api/README.md](../../api/README.md)
- Edge Server：[../../edge-server/README.md](../../edge-server/README.md)
- Hub Server：[../../hub-server/README.md](../../hub-server/README.md)
- 系统架构：[../../docs/architecture/system-architecture.md](../../docs/architecture/system-architecture.md)
