# app/ AGENTS.md — 前端子项目规则

前端 monorepo 的 agent 入口（nearest-file-wins）。通用项目规则、红线、分支与证据纪律见根 [`../AGENTS.md`](../AGENTS.md)。子包定位与 SSOT 边界见 [`README.md`](README.md)。

## 快速命令

均从仓库根执行：

```bash
pnpm --dir app install                # 装依赖（pnpm workspace）
make fe-test                          # 前端 vitest（L0）
pnpm --dir app --filter @agenthub/shared test   # shared 包单测（含 design-token surface gate）
pnpm --dir app dev                    # Desktop Vite (:5173)
pnpm --dir app dev:web                # Web Vite (:5174)
```

## 前端边界（速查，权威在根 AGENTS 的“架构与产品边界 / 验证与证据”）

- 通用 UI 只在 `shared/src/ui/`；Desktop/Web 从 shared 导入，禁止复制本地副本。Mobile 只复用 RN-safe 的 shared 模块（hub client、transcript 等），不导入 Web/Desktop UI 或 CSS。
- 端级 workbench shell 只在 `workbench/src/`（`@agenthub/workbench`）；web/desktop 从 `@agenthub/workbench` 导入，mobile-rn 不依赖。依赖方向 workbench → shared 单向，由 `pnpm lint:boundaries` 阻塞。
- `app/shared/src/hub/hubClient.ts` 是 Hub REST/WS 唯一 SSOT；各平台 `api/hubClient.ts` 只做 thin shell，禁止分叉 REST 实现。
- Desktop 原生能力只在 `app/desktop/src-tauri/`；Web/Mobile 是 Hub-only，不直连 Local Edge。
- CSS Modules + OKLCH tokens，避免硬编码颜色。
- 主聊天流只放用户消息 / Agent 回复 / 工具 / 审批 / 产物卡片；调试、mock、mode 信息不进主流程。

## 改动交付门禁

- 新 shared 组件的测试、stories 与验收要求见 [`../docs/component-acceptance.md`](../docs/component-acceptance.md)。
- UI 行为改动用 Playwright + Visual QA 证明，不只截图；视口与入口见 `../docs/architecture/07-design-system-ssot.md` §7。
- 前端 coverage 配置由 `app/test-config/coverage.ts` factory 统一定义，阈值在各 package `vitest.config.ts`；当前 coverage 只在本地/按需运行，不在 PR required 门禁中执行。
- 异步等待用测试框架工具，不裸 `sleep` 轮询。

## 易踩坑

测试分层见根 [`../AGENTS.md`](../AGENTS.md) 的“测试分层（L0-L4）”；CI job 映射见 [`../docs/architecture/github-actions-ci-cd-policy.md`](../docs/architecture/github-actions-ci-cd-policy.md)。
