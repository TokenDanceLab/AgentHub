# app/ — 前端 monorepo

AgentHub 的全部前端代码，pnpm workspace 管理。Go 后端在 `../hub-server/`、`../edge-server/`，跨语言契约在 `../api/`。

权威地图与分工边界见 `../AGENTS.md` 的“根级目录地图”和“项目分工和边界”；本文件只做快速索引，不重复规则。

## 子包

| 目录 | 定位 | Owner 文档 |
|---|---|---|
| `web/` | 浏览器工作台（Vite，端口 5174 strict） | `web/README.md` |
| `desktop/` | Tauri 桌面端 + Local Edge 宿主（Vite，5173 strict） | `desktop/README.md` |
| `mobile-rn/` | Expo/RN 移动端（Hub-only，5177） | `mobile-rn/README.md` |
| `shared/` | **`@agenthub/shared` SSOT**：通用 UI、`hubClient`、transcript/composer/inspector、platform contract、design token | `shared/README.md` |
| `workbench/` | **`@agenthub/workbench`**：端级工作台 shell（#1759 从 shared 独立）；依赖方向 workbench → shared 单向 | `workbench/README.md` |
| `e2e/` | 真实全栈 E2E（`chat-real.spec.ts` 等，需 live Hub+Edge，CI 沙箱不跑） | `e2e/playwright.config.ts` |
| `test-config/` | 前端 coverage 契约 factory（生产源码全量进分母） | `test-config/coverage.ts` |

## SSOT 边界

- 通用 UI 只在 `shared/src/ui/`，web/desktop 从 shared 导入，禁止复制本地 UI 副本。
- 端级 workbench shell 只在 `workbench/src/`（`@agenthub/workbench`）；web/desktop 从 `@agenthub/workbench` 导入，mobile-rn 不依赖本包。依赖方向 workbench → shared 单向，shared 禁止 import workbench（机器门禁：`scripts/verify/verify-frontend-package-boundary.py`）。
- Hub REST/WS 方法与 DTO 的 SSOT 是 `shared/src/hub/hubClient.ts`；web/desktop/mobile 的 `api/hubClient.ts` 只能是 thin shell（平台胶水），禁止分叉 REST 实现。
- 设计 token 在 `shared/src/styles/` 与 `shared/src/designTokens.ts`（`--td-*`）。
- 新 shared 组件三件套：`.test.tsx` + `.stories.tsx` + 对照 `../docs/component-acceptance.md` 验收表。

## 常用命令

根目录 `../Makefile` 提供薄封装（CI 才是 SSOT，Makefile 只做引用）：

```bash
make fe-install    # pnpm install
make fe-dev        # 启动 web/desktop dev
make fe-test       # vitest
make fe-typecheck  # tsc --noEmit
make fe-build      # 构建
make fe-lint       # eslint
```

路径筛选、job 结构与门槛以 `.github/workflows/checks.yml` 为准。
