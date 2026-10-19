# app/ — 前端 monorepo

AgentHub 的全部前端代码，pnpm workspace 管理。Go 后端在 `../hub-server/`、`../edge-server/`，跨语言契约在 `../api/`。

权威边界见 `../AGENTS.md` 的“架构与产品边界”和“前端边界”；本文件只做快速索引，不重复规则。

## 子包

| 目录 | 定位 | Owner 文档 |
|---|---|---|
| `web/` | 浏览器工作台（Vite，端口 5174 strict） | `web/README.md` |
| `desktop/` | Tauri 桌面端 + Local Edge 宿主（Vite，5173 strict） | `desktop/README.md` |
| `mobile-rn/` | Expo/RN 移动端（Hub-only，5177） | `mobile-rn/README.md` |
| `shared/` | **`@agenthub/shared` SSOT**：通用 UI、`hubClient`、transcript/composer/inspector、platform contract、design token | `shared/README.md` |
| `workbench/` | **`@agenthub/workbench`**：端级工作台 shell；依赖方向 workbench → shared 单向 | `workbench/README.md` |
| `e2e/` | 真实全栈 E2E（`chat-real.spec.ts` 等，需 live Hub+Edge；仅 dispatch-only L3 lane 运行） | `web/playwright.real.config.ts` |
| `test-config/` | 前端 coverage 契约 factory（生产源码全量进分母） | `test-config/coverage.ts` |

## SSOT 边界

包边界、依赖方向与 Hub client 分叉规则见 [`AGENTS.md`](AGENTS.md)；shared 组件验收见 [`../docs/component-acceptance.md`](../docs/component-acceptance.md)。设计 token 在 `shared/src/styles/` 与 `shared/src/designTokens.ts`（`--td-*`）。

## 常用命令

本地命令由根目录 `../Makefile` 定义；CI 实际执行以 workflow 为准：

```bash
make fe-install    # pnpm install
make fe-dev        # 启动 Desktop Vite（Web 用 pnpm dev:web）
make fe-test          # 全部前端包（单 Vitest 进程）
make fe-test-changed  # 只跑受 git 变更影响的用例
make fe-typecheck  # tsc --noEmit
make fe-build      # 构建
make fe-lint       # eslint
```

路径筛选、job 结构与门槛以 `.github/workflows/checks.yml` 为准。
