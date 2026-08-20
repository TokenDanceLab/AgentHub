# app/ AGENTS.md — 前端子项目规则

本文件是前端 monorepo 的 agent 入口（nearest-file-wins）。通用项目规则、红线、分支与证据纪律见根 [`../AGENTS.md`](../AGENTS.md)（SSOT，不在此重复）。子包定位与 SSOT 边界见 [`README.md`](README.md)。

## 快速命令

```bash
cd app && corepack pnpm install       # 装依赖（pnpm workspace）
make fe-test                          # 前端 vitest（L0）
cd app && pnpm --filter @agenthub/shared test   # shared 包单测
pnpm dev                              # Desktop Vite (:5173)
pnpm dev:web                          # Web Vite (:5174)
python scripts/verify/verify-design-token-ssot.py   # 设计 token 门禁（改 styles/designTokens 必跑）
```

## 前端边界（速查，权威在根 AGENTS §2/§5）

- 通用 UI 只在 `shared/src/ui/`；Desktop/Web/Mobile 从 shared 导入，禁止复制本地副本。
- `app/shared/src/hub/hubClient.ts` 是 Hub REST/WS 唯一 SSOT；各平台 `api/hubClient.ts` 只做 thin shell，禁止分叉 REST 实现。
- Desktop 原生能力只在 `app/desktop/src-tauri/`；Web/Mobile 是 Hub-only，不直连 Local Edge。
- CSS Modules + OKLCH tokens，避免硬编码颜色。
- 主聊天流只放用户消息 / Agent 回复 / 工具 / 审批 / 产物卡片；调试、mock、mode 信息不进主流程。

## 改动交付门禁

- 新 shared 组件三件套：`<组件>.test.tsx` + `<组件>.stories.tsx` + 对照 [`../docs/component-acceptance.md`](../docs/component-acceptance.md) 验收表逐项勾选；缺件不合入。
- UI 行为改动用 Playwright + Visual QA（视口 `1440x810` light+dark，入口 `app/{desktop,web}/scripts/visual-qa-shell.mjs`）证明，不只截图。
- 前端 coverage 契约由 `app/test-config/coverage.ts` factory 强制生产源码全量进分母；阈值在各 package `vitest.config.ts`，禁止 CI/本地两套。
- 异步等待用测试框架工具，不裸 `sleep` 轮询。

## 易踩坑

前端 CI 易踩坑（exactOptionalPropertyTypes / noUncheckedIndexedAccess / CSS helper 类型 / DesignNavIcon / 11px CJK 下限 / changes job）见 [`../docs/architecture/04-frontend-data-flow.md`](../docs/architecture/04-frontend-data-flow.md) §前端 CI 易踩坑。测试分层 L0-L4 与 CI job 映射见根 [`../AGENTS.md`](../AGENTS.md) §5.5。
