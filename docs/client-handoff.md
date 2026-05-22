# 客户端交接文档 (HANDOFF)

本文档面向接手 AgentHub 客户端 UI 开发的同学。本文不替代 `AGENTS.md`、`docs/client-roadmap.md` 或 `api/` 契约，只补充客户端特有的本地运行、架构约定和 UI 切图换皮指引。

## 1. 仓库和分支

```powershell
git clone https://github.com/TokenDanceLab/AgentHub.git
cd AgentHub
git checkout feat/client-dev
```

`feat/client-dev` 是客户端集成分支，所有客户端代码在此迭代。该分支有一个 draft PR #26 指向 `master`，本地端到端跑通后合并。

## 2. 本地开发环境

| 工具 | 最低版本 | 检查命令 |
|---|---|---|
| Go | 1.24 | `go version` |
| Node.js | 20+ | `node --version` |
| pnpm | 9+ | `pnpm --version` |
| Rust | 1.80+ | `rustc --version` |
| Tauri CLI | 2.x | `cd app/desktop && pnpm tauri --version` |

首次克隆后运行：

```powershell
.\scripts\setup.ps1          # 启用 git hooks
pnpm install                 # 在 app/desktop 下
```

## 3. 项目结构

```
AgentHub/
├── api/                     # REST + WebSocket 契约
├── edge-server/             # Go Local Edge Server
├── runner/                  # Go Mock Runner
├── app/
│   ├── shared/src/          # @agenthub/shared 共享包
│   │   ├── types.ts         # HealthResponse, Runner, ListResponse, RunInfo
│   │   ├── events.ts        # EventEnvelope + discriminated union
│   │   └── errors.ts        # AppError / parseError（按 conventions.md §5）
│   └── desktop/src/
│       ├── config.ts        # EDGE_URL / WS_URL / 轮询间隔 / 事件上限
│       ├── api/
│       │   ├── edgeClient.ts    # REST fetch 封装
│       │   └── eventClient.ts   # WebSocket 流 + 断线重连 + 状态通知
│       ├── hooks/
│       │   ├── useHealth.ts     # 5s 轮询 → { online, health }
│       │   ├── useRunners.ts    # online 门控 → Runner[]
│       │   └── useEventStream.ts # WebSocket 生命周期 → { events, isConnected, clearEvents }
│       ├── components/
│       │   ├── StatusBar.tsx    # props: online, health, isConnected, error
│       │   ├── RunnerList.tsx   # props: runners[], online
│       │   └── EventLog.tsx     # props: events[], online
│       ├── i18n/
│       │   └── locales/         # zh.json / en.json
│       ├── styles/tokens.css    # CSS 变量
│       └── App.tsx              # 根布局编排（50 行）
└── scripts/
    ├── setup.ps1
    └── client-smoke.ps1         # 26 项自动冒烟
```

## 4. 启动方式

### 4.1 只改 UI（推荐日常开发）

```powershell
# 终端 1: 启动 Edge
cd edge-server
go run ./cmd/agenthub-edge

# 终端 2: 启动 Vite dev server（热更新 UI）
cd app/desktop
pnpm dev --port 5199
```

浏览器打开 `http://localhost:5199`，改 `app/desktop/src/` 下任何文件会自动刷新。

不需要启动 Tauri 壳，浏览器里就是完整功能。

### 4.2 带 Tauri 壳

```powershell
# 先启动 Edge Server
cd edge-server
go run ./cmd/agenthub-edge

# 再启动 Tauri
cd app/desktop
pnpm tauri dev
```

### 4.3 跑 Mock Runner（可选）

```powershell
cd runner
go run ./cmd/agenthub-runner --mock
```

该 Runner 不连接 Edge，独立运行输出模拟日志，用于验证 Runner 状态机。

## 5. 换皮指引：动哪里

### 改颜色 / 字体 / 间距

只改 `app/desktop/src/styles/tokens.css`。所有组件都引用 CSS 变量。

```css
:root {
  --color-bg:        #0f1117;   /* 主背景 */
  --color-surface:   #161b22;   /* 卡片/按钮 */
  --color-border:    #21262d;   /* 分割线 */
  --color-text:      #e1e4e8;   /* 正文 */
  --color-accent:    #79c0ff;   /* 强调色（事件类型） */
  --color-success:   #3fb950;   /* 在线/成功 */
  --color-danger:    #f85149;   /* 离线/错误 */
  --font-ui: system-ui, -apple-system, sans-serif;
  --font-mono: 'SF Mono', 'Cascadia Code', 'Fira Code', monospace;
}
```

### 改布局

每个组件的 CSS Module 文件（`*.module.css`）是隔离的，改一个组件不影响其他：

- `StatusBar.module.css` — 顶栏高度、dot 大小
- `RunnerList.module.css` — 侧栏宽度、item 间距
- `EventLog.module.css` — 事件行高、字体

### 改文案

只改 `app/desktop/src/i18n/locales/zh.json` 和 `en.json`。组件里只用 `t('key')`。

### 加面板

1. 在 `app/desktop/src/components/` 新建组件（纯 props 驱动）
2. 如需新数据源，在 `app/desktop/src/hooks/` 新建 hook
3. 在 `App.tsx` 的 `<div className={styles.body}>` 里加入新组件

### 加 API 调用

如需新接口，先在 `api/openapi.yaml` 登记，然后在 `edgeClient.ts` 加函数。错误处理用 `parseError(res)` 获得结构化的 `AppError`。

## 6. 不要动的东西

| 层 | 原因 |
|---|---|
| `hooks/` | 业务逻辑层，hook 的输入输出接口已稳定。如需新 hook，新建文件不要改现有 |
| `api/eventClient.ts` | WebSocket 重连/去重/退避已测试通过 |
| `edge-server/` | Go 后端，客户端的 UI 工作不涉及 |
| `runner/` | Go 后端，同上 |
| `api/openapi.yaml` | 改契约先和三条线（前端/后端/客户端）通气 |

## 7. 验收命令

```powershell
# 前端
cd app/desktop
pnpm test       # 30 个单元测试
pnpm build      # TypeScript + Vite 构建

# 全链路冒烟
.\scripts\client-smoke.ps1

# Go 后端（如果你动了 edge-server）
cd edge-server
go test ./...
```

## 8. 数据流速查

```
config.ts → api/ → hooks/ → App → components(props)
                                ↑
                           i18n/locales/
```

- `useHealth()` — 每 5s 调 `GET /v1/health`，返回 `{ online, health }`
- `useRunners(online)` — 仅 online 时每 5s 调 `GET /v1/runners`，离线时清空
- `useEventStream(online)` — 仅 online 时建 WebSocket 连 `/v1/events`，离线时关闭
  - 返回 `{ events[], isConnected, clearEvents() }`
  - 断线自动重连（1s → 2s → 4s → max 30s），cursor 用 seq 去重
  - 事件日志上限 1000 条
- 组件**零状态逻辑**，所有数据通过 props 传入

## 9. 事件类型速查

WebSocket 推送的事件（`api/events.md` 定义，`@shared/events` 有 TypeScript 类型）：

| type | 含义 |
|---|---|
| `runner.online` / `runner.offline` | Runner 上下线 |
| `run.queued` / `run.started` / `run.finished` / `run.failed` | Run 生命周期 |
| `run.output` / `run.output.batch` | stdout/stderr 聚合输出 |
| `error` | 事件流错误 |

## 10. 后续任务

- 把 `app/desktop/src-tauri/icons/` 里的占位图标换成正式图标
- UI 组件加 a11y 属性（`aria-label` 等）
- 补 Playwright 端到端测试
- 完成 D. Integration Smoke 的 `feat/client-local-smoke` → 合入 `master`
