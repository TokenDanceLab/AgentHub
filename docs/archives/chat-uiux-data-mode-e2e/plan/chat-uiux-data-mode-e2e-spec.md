# Chat UIUX Data Mode and E2E SPEC

> Version: v0.3 framework-hardening SPEC
> Status: Phase 6 frameworkization under verification
> Branch: `fix/chat-flow-uiux-contract`
> Tracking: `docs/progress/MASTER.md`
> Primary visual viewport for this task: `1440x810`

## 1. Purpose

本 SPEC 定义 AgentHub Desktop/Web 聊天流、数据模式和前端 E2E 验收合同。目标不是增加测试数量，而是让少量高信号测试保护真实用户体验和真实工程边界：

1. 用户可见 UIUX：用户消息提交后立即可见、不消失后再出现、重复消息独立显示、聊天流按时间线线性排序、自动跟随到底部、卡片合并、markdown/table 渲染正常、响应式宽度不溢出。
2. 前后端边界：Web 只通过 Hub；Desktop Local/Observed/Approved Real 才访问 Local Edge；mock/fixture workbench runtime 不静默触碰 Hub/Edge。
3. 数据模式诚实性：mock、fixture、stubbed Hub replay、observed、approved-real 必须显式区分；stubbed replay 和 manifest-only 结果不得冒充真实登录、真实 CLI、真实模型/API 调用。

## 2. Evidence Findings

本轮先写 v0.1 SPEC，再从源码、架构文档、设计文档、现有测试和复现命令反证修订。以下是 v0.3 的依据。

| Original Assumption | Verdict | Evidence | SPEC Change |
|---|---|---|---|
| Desktop/Web 主聊天 UI 应共享 `app/shared` 实现 | Confirmed | `docs/architecture.md` 明确 `app/shared` 是 shared workbench、transcript、composer、inspector 的权威位置；`app/shared/src/chatview` 是唯一卡片渲染系统 | 后续实现只改 shared contract 或平台 adapter，不 fork Desktop/Web 聊天流 |
| `dataMode` 混合表达数据源、执行路径和登录状态 | Confirmed | `app/shared/src/demo/dataMode.ts` 同时暴露 mock/fixture/hub/local-edge/auth/fallback 能力位；Desktop/Web model 根据这些能力位分支 | SPEC 采用三轴模型：surface、data source、auth/execution |
| Entry preflight 和 Workbench runtime 应分相 | Revised, critical | Desktop `App.tsx` 在 entry 阶段启用 `useHealth`；`chat-flow-ui.spec.ts` 当前在进入 Demo 前开始记录请求，导致 mock runtime contract 把入口 `/v1/health` 判成违规 | E2E 合同必须 phase-aware：`entry-preflight` 与 `workbench-runtime` 分开验证 |
| Web approved-real replay E2E 可以 stub Hub，但必须写清楚不是实测登录/模型执行 | Confirmed | Web E2E 使用 Hub route stub 和 sessionStorage token；manifest 已有 `real_tested=false`，但测试名仍容易让人误读为 real mode | SPEC 要求命名和 manifest 使用 `stubbed-hub-session`，真实路径另设 approval gate |
| 有效测试应保护行为/边界/集成，而非重复实现 | Confirmed | AgentHub AGENTS 测试红线禁止 judge+jury；当前有部分纯函数 contract 测试有价值，但不能让 Playwright 只证明 route stub 自己工作 | 测试矩阵只保留 UIUX 可见行为、网络边界、纯排序/规范化合同 |
| 设计默认 viewport 是 1440x900 | Revised by user instruction | cross-repo visual QA 默认 desktop wide 是 `1440x900`，但本任务用户明确要求按 16:9 `1440x810` 看 | `1440x810` 是本 SPEC 的主验收；narrow 只做回归 |
| 半自动视觉检查可以停留在 `.tmp` 脚本 | Rejected | `.tmp` 被 gitignore，不能作为长期可复用测试框架入口 | 半自动脚本必须进入版本化 `scripts/`，截图和 metrics 仍输出到 `.tmp/` |

### Historical Baseline Closed

初始 Desktop Playwright 失败来自测试把 `entry-preflight` 的 `/v1/health` 计入 mock workbench runtime。当前合同已改为 phase-aware：入口健康探测和 workbench runtime 分开验证，mock/fixture runtime 仍禁止静默访问 Hub/Edge。

## 3. Mode Taxonomy

### 3.1 Three Independent Axes

| Axis | Values | Meaning |
|---|---|---|
| Surface | `desktop-vite`, `desktop-tauri`, `web-vite` | UI 运行壳和可用平台能力 |
| Data Source | `local-mock`, `deterministic-fixture`, `local-edge`, `stubbed-hub-session`, `hub-real`, `observed-replay` | transcript/workbench 数据来源 |
| Auth/Execution | `anonymous`, `local-only`, `hub-signed-in`, `approved-real` | 是否登录、是否允许真实执行或真实外部消耗 |

`WorkbenchDataMode` 可以继续保留为产品选择值，但测试和文档必须显式拆出三轴，否则 Demo、Local、Login、Approved Real 会继续互相污染。

### 3.2 Product Modes

| Product Mode | Product `dataMode` | Data Source | Auth/Execution | Allowed Runtime Network | Must Not Claim |
|---|---|---|---|---|---|
| Demo Mode | `mock` | `local-mock` | `anonymous` | Workbench runtime 不访问 Hub/Edge | real login, real CLI, real model/API |
| Fixture Mode | `fixture` | `deterministic-fixture` | `anonymous` | Workbench runtime 不访问 Hub/Edge | real replay, real user data |
| Auto Dev Mode | `auto` | mock/fixture or Local Edge fallback | development only | 可按 fallback 合同访问 Local Edge | production, strict real |
| Local Mode | Desktop `observed` or future explicit local | `local-edge` | `local-only` | Desktop Local Edge `127.0.0.1:3210` | Hub auth, cloud sync |
| Login Mode | Web/Desktop real Hub session | `hub-real` | `hub-signed-in` | Hub API/WS；Web 不直连 Local Edge | raw local execution unless routed by Hub |
| Observed Mode | `observed` | `observed-replay` | read-only real-ish | SPEC 明确的 observed Hub/Edge endpoint | mock fallback, real execution |
| Approved Real | `approved-real` | real Hub/Edge/CLI/API as approved | `approved-real` | 只允许被 SPEC 明确批准的真实路径 | silent fallback, stubbed real |

### 3.3 E2E Phases

| Phase | Purpose | Backend Contract |
|---|---|---|
| `entry-preflight` | Desktop entry gate 可显示 Local Edge 是否可连接 | Desktop 可访问 `/v1/health`；Web 不适用 |
| `workbench-runtime` | 用户进入具体工作台后的运行期 | mock/fixture 禁止 Hub/Edge；Local/Observed/Approved Real 按模式允许 |
| `manifest-preflight` | 生成测试或审批 manifest | 只记录事实，不把 stub/manifest-only 写成 real tested |

## 4. S.U.P.E.R Design Constraints

| Principle | Constraint For This Work |
|---|---|
| S - Single Purpose | `dataMode` 产品合同、E2E 请求分类、聊天渲染、平台 adapter 各自只承担一个职责 |
| U - Unidirectional Flow | Hub/Edge/runtime event 先 normalize 到 `TranscriptBlock`，再进入 shared `ChatViewTranscript`；UI 不能反向读取平台细节 |
| P - Ports over Implementation | E2E scenario 是纯 typed contract；Playwright 只提供 observed requests 和 visible assertions |
| E - Environment-Agnostic | 端口、Hub origin、viewport 通过 config/env 明确；真实 secret 和生产环境不进入测试 |
| R - Replaceable Parts | Web Hub stub、Desktop Vite、未来 Tauri packaged gate 可以替换，不影响 shared transcript tests |

## 5. Test Value Policy

保留测试必须至少保护下面一项：

| Test Class | Keep If It Proves | Reject If It Only Proves |
|---|---|---|
| Playwright UIUX | visible behavior, geometry, scroll, ordering, markdown/table rendering | 页面能打开或截图存在 |
| Playwright Boundary | network/data-mode contract, no hidden fallback, Web/Local separation | route stub 自己能返回数据 |
| Shared Unit | pure normalization/order/schema behavior | 常量等于自身或 switch 镜像实现 |
| Component Unit | semantic rendering and accessibility-visible state | 私有 className，除非 CSS contract 是真实 API |
| Manifest/Preflight | honest declaration of what was and was not real | 没有 live evidence 却写 real tested |

禁止把用户圈出的 mock/debug metadata 放进主聊天流。模式信息可以留在 status/settings/manifest 中，不能污染每条消息气泡。

## 6. Implementation Plan

### Phase 1: SPEC and Evidence Baseline

Goal: 让计划先通过，不在未分清模式前继续写实现。

Acceptance:

- `docs/analysis/project-overview.md`、`docs/analysis/module-inventory.md`、`docs/analysis/risk-assessment.md` 存在且聚焦本任务。
- 本 SPEC 标出 confirmed/revised/rejected assumptions。
- `docs/progress/MASTER.md` 记录初始 Desktop Playwright 失败的历史基线，并在修复后记录 fresh evidence。
- 不改实现代码。

### Phase 2: Phase-Aware Data Mode Contract

Goal: 修复当前失败的根因，让 E2E 能区分 entry preflight 和 workbench runtime。

Tasks:

| Task | Priority | Effort | S.U.P.E.R | Test Expectation | Acceptance |
|---|---|---:|---|---|---|
| Extend E2E scenario/request contract with phase | P0 | M | S, P, R | Update `e2eDataModeContract.test.ts` | mock runtime rejects Hub/Edge; Desktop entry preflight can allow health only |
| Update Desktop Playwright request logging | P0 | S | U, E | `chat-flow-ui.spec.ts` passes | Requests after workbench visible are validated as runtime; entry requests are recorded separately |
| Keep explicit mock/fixture isolated from Local Edge model probes | P0 | S | U, E | Existing `useDesktopWorkbenchModel.test.tsx` plus focused assertion | Explicit `mock` and `fixture` do not call `fetchHealth` or Edge queries in workbench runtime |

### Phase 3: Chat Flow UIUX Contract

Goal: 保留真正有用的 UIUX E2E，让用户消息、Agent 回复和卡片按线性聊天流稳定展示。

Required Playwright coverage:

| Surface | Viewport | Required Behaviors |
|---|---|---|
| Desktop Vite | `1440x810` primary | user message immediate visibility, no disappear/reappear, repeated message count, auto-follow, no horizontal overflow, approval/preview merged stack |
| Desktop Vite | narrow regression | no horizontal overflow or incoherent overlap |
| Web Vite | `1440x810` primary | Hub messages + runtime events in one transcript, chronological order, markdown/table render, same-name tool call/result pairing, inspector-only subagent/route details |
| Web Vite | optional/narrow regression | only if shared layout changes make risk visible |

Acceptance:

- Playwright asserts user-visible behavior and boundary, not implementation internals.
- Semi-automated visual pass captures screenshot and metrics under `.tmp/`.
- Debug/mock/data-mode labels remain outside main chat body.

### Phase 4: Naming and Documentation Cleanup

Goal: 减少“real smoke 但其实 stubbed replay”这类误导。

Tasks:

| Task | Priority | Effort | S.U.P.E.R | Test Expectation | Acceptance |
|---|---|---:|---|---|---|
| Rename comments/manifests around stubbed Hub replay | P1 | S | S, P | Manifest tests | `real_tested=false` remains explicit; no doc claims real login/CLI when not run |
| Update visible status only where user needs mode context | P1 | S | S, R | Existing Playwright body assertions | Main transcript remains clean |
| Record packaged Desktop gap | P1 | S | E | Docs-only validation | SPEC says Vite renderer E2E is not Tauri sidecar/icon/package verification |

### Phase 5: Acceptance and End-to-End Verification

Required gates:

1. Shared data-mode contract unit tests.
2. Focused Desktop model/health tests.
3. Focused Web model tests.
4. Desktop Playwright chat/data-boundary E2E.
5. Web Playwright chat-flow and stubbed Hub replay E2E.
6. Semi-automated 16:9 visual pass at `1440x810` for Desktop and Web, with screenshot and metrics.
7. Desktop typecheck/build.
8. Web typecheck/build.
9. `git diff --check`.
10. `docs/progress/MASTER.md` updated with command output summaries and known gaps.

Verification commands:

```powershell
cd app/desktop
corepack.cmd pnpm exec vitest run ../shared/src/testing/e2eDataModeContract.test.ts --config vitest.shared-ci.config.ts
corepack.cmd pnpm exec vitest run src/__tests__/useHealth.test.ts src/platform/useDesktopWorkbenchModel.test.tsx --config vitest.config.ts
corepack.cmd pnpm run test:e2e:chat-flow
corepack.cmd pnpm run test:visual:chat-flow
corepack.cmd pnpm typecheck
corepack.cmd pnpm build

cd ..\web
corepack.cmd pnpm exec vitest run src/platform/useWebWorkbenchModel.test.ts --config vitest.config.ts
corepack.cmd pnpm run test:e2e:chat-flow
corepack.cmd pnpm run test:e2e:stubbed-hub
corepack.cmd pnpm run test:visual:chat-flow
corepack.cmd pnpm typecheck
corepack.cmd pnpm build

cd ..\..
git diff --check
```

Versioned visual commands live in `app/desktop/scripts/manual-chat-flow-check.mjs` and `app/web/scripts/manual-chat-flow-check.mjs`. Screenshots and metrics remain under `.tmp/`; the scripts must block live backends unless explicitly pointed at an approved local/stubbed target.

### Phase 6: Framework Hardening

Goal: 把已经验证有效的 E2E 和半自动调试入口变成长期可复用框架，而不是依赖 `.tmp` 临时脚本或手写命令。

Tasks:

| Task | Priority | Effort | S.U.P.E.R | Test Expectation | Acceptance |
|---|---|---:|---|---|---|
| Promote manual chat-flow checks into versioned Desktop/Web scripts | P0 | M | S, E, R | Run scripts through package entries | `app/desktop/scripts/manual-chat-flow-check.mjs` and `app/web/scripts/manual-chat-flow-check.mjs` can start/attach to Vite, block live backends, save screenshot/metrics under `.tmp/` |
| Add focused package scripts for chat-flow E2E and visual check | P0 | S | S, P | Run focused scripts | Desktop and Web both have `test:e2e:chat-flow` and `test:visual:chat-flow`; Web stubbed-hub script includes chat-flow contract |
| Update progress/docs with framework commands and remaining approved-real limits | P0 | S | E | `git diff --check` | `docs/progress/MASTER.md` records durable commands and still separates Vite renderer, stubbed Hub, packaged Tauri, and approved-real evidence |

Additional framework verification commands:

```powershell
cd app/desktop
corepack.cmd pnpm run test:e2e:chat-flow
corepack.cmd pnpm run test:visual:chat-flow

cd ..\web
corepack.cmd pnpm run test:e2e:chat-flow
corepack.cmd pnpm run test:e2e:stubbed-hub
corepack.cmd pnpm run test:visual:chat-flow

cd ..\..
git diff --check
```

## 7. Not In Scope For This SPEC

- Packaged Tauri sidecar bundling, Windows installer behavior, app icon verification, and native Edge/sqlite packaging. Those need a separate Desktop packaged E2E/package gate.
- Real TokenDance ID login, real CLI/model execution, real Gateway spend, deploy/signing/release upload. Those require explicit approved-real authorization and separate evidence.
- Broad UI redesign beyond chat flow, transcript layout, and mode/status clarity.

## 8. SPEC Review Checklist

- [x] Every mode has a clear network allowance.
- [x] Entry preflight and workbench runtime are separate.
- [x] Web never directly depends on Local Edge.
- [x] Desktop Local/Observed/Approved Real are distinct from Demo/Fixture.
- [x] Stubbed Hub replay is not called real login/model execution.
- [x] Tests are mapped to user-visible behavior or integration boundary.
- [x] Each implementation phase has acceptance commands.
- [x] `1440x810` is the primary visual viewport for this task.
- [x] `docs/progress/MASTER.md` will reflect the active phase before code execution.
- [x] Semi-auto visual checks have versioned framework entries, not only `.tmp` scripts.
