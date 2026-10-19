# 前端测试放置约定

适用于 `app/{shared,web,desktop,workbench,mobile-rn}`。

| 位置 | 约定 |
|---|---|
| 各包 `src/**/__e2e__/` | Playwright E2E spec，由各包 `playwright.config.ts` 驱动 |
| `app/e2e/` | 真实栈 E2E spec，由 `app/web/playwright.real.config.ts` 驱动（需 live Hub + Edge） |
| shared / web / desktop / workbench 的 `src/__tests__/setup.ts` | 每包唯一 Vitest setup 入口；mobile-rn 无 Vitest setup 文件 |
| shared / web / workbench | 单元测试优先与源码同目录（`src/**/*.test.ts(x)`）；workbench 与 web 仍有少量集中在 `src/__tests__/` 的用例 |
| desktop | 单元测试混用 `src/__tests__/` 与源码同目录；新测试优先放源码同目录 |

- L0 单元测试使用 Vitest；共享 mock/polyfill 放 `@shared/testing/*`，各包 setup 复用，不再复制清单。
- web 常规 E2E 用 `playwright.config.ts`（stubbed hub）；真实栈用 `playwright.real.config.ts`。
- mobile E2E 仅 `workflow_dispatch` 触发。
