# 测试放置约定（frontend monorepo）

本文件是 `app/{shared,web,desktop,mobile-rn}` 前端测试放置的事实约定（#1678 测试系统收敛）。

## 当前布局

| 位置 | 约定 | 现状 |
|---|---|---|
| 各包 `src/**/__e2e__/` | Playwright E2E spec（`.spec.ts`），由各包 `playwright.config.ts` 驱动（web/desktop/mobile 各一份） | ✅ 统一完成（#1678） |
| `app/e2e/`（monorepo 根） | 已退役：smoke/chat-real 迁入 `web/src/__e2e__/`，真实栈入口 `web/playwright.real.config.ts` | ✅ 已删 |
| 各包 `src/__tests__/setup.ts` | 每包唯一 vitest setup 入口 | ✅ 统一完成 |
| shared | 单元测试**与源码同目录**（`src/**/*.test.ts(x)`）；`src/__tests__/` 只放 setup | ✅ 现行 |
| web | 单元测试**与源码同目录**；`src/__tests__/` 只放 setup | ✅ 现行 |
| desktop | **混用**：39 个测试在 `src/__tests__/`（+`integration/`），23 个与源码同目录 | ⚠️ 历史债 |

## desktop `src/__tests__/` 迁移债务（未做，理由）

39 个文件批量迁到源码同目录需要一次性移动 + 修 import 路径 + 全量回归，
收益是纯布局一致性、不改变任何断言。按 #1678 指令：面大则先立约定、收敛
孤儿/重复；批量迁移留待后续专项。

本轮已做的收敛：

- **无孤儿**：39 个文件的全部 `@/`、`../` 导入逐条核对，均解析到存在模块。
- **无重复**：`__tests__/` 与同目录测试文件按 basename 求交为空集；
  `errors.test.ts`（测 `@shared/errors` 的 `isErrorResponse`/`parseError`）与
  shared 同目录 `errors.test.ts`（测 409 turn_in_progress 判别）覆盖不同函数，
  互补而非重复，均保留。
- **共享模块测试暂居 desktop**：`context-breakdown.test.ts`（`@shared/context/breakdown`）、
  `tree.test.ts`（`@shared/tree`）实际测 shared 模块，因 shared 侧无同目录测试。
  迁移时随 `__tests__` 一起归位到 shared，属同一笔债。

## 各层归属速查

- L0 单元：`src/**/*.test.ts(x)`，vitest；desktop 例外见上。
- Playwright E2E：各包 `src/__e2e__/*.spec.ts`；
  - web 常规/CI：`playwright.config.ts`（stubbed hub，fail-closed env）；
  - web 真实栈（本地 L3）：`playwright.real.config.ts`（chat-real.spec.ts，需 live Hub+Edge）；
  - mobile E2E 仅 workflow_dispatch（成本节流，故意决策）。
- 测试 setup：`@shared/testing/*` 为共享 mock/polyfill 单源（i18n、lobehubIcons、jsdomPolyfills），
  各包 `src/__tests__/setup.ts` 复用，禁止再复制一份清单。
