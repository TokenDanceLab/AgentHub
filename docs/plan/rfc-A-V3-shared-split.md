# RFC A-V3 — `@agenthub/shared` 拆 hub/edge 边界评估

> 状态: **已裁决 2026-08-03** — 驳回全量三分；quick-wins 已落地；软门禁硬化独立任务 #1525
> 作者: senior-architect agent · 日期: 2026-07-30 · 更新: 2026-08-03（#1523 事实对齐）
> 权威: `docs/progress/MASTER.md`；裁决由审核 leader 拍板
> 证据: 实际 `grep` 导入路径、`wc -l` 行数、消费者 package.json 与 tsconfig path 别名；Go 侧零 TS 依赖（仅 `hub-server/internal/ws/frame.go:11` 注释引用 `app/shared/src/hubEvents.ts` 作为 SSOT 镜像）

## 0. 摘要（先读）

- **审计高估了 shared 的 hub/edge 混杂度。** 实测 `app/shared/src/` 37.6k 非测试行 / 578 文件，其中**真正"hub-only"且会污染 edge-only 消费者**的只有两类：`hubClient*.ts`（32 文件 / ~9.3k 行）与 `hubEvents.ts`（Hub WS 事件名常量，1:1 镜像 `hub-server/internal/ws/frame.go`）。**真正"edge-only"的只有 `apiClient.ts`（Edge REST thin client）、`eventClient.ts`（Edge WS 客户端）、`transcript/edge*.ts`（12 文件）与 `stores/queryKeys.ts` 中的 `edgeQueryKeys` 段。** 其余 ~70% 的 shared 模块（`types.ts`、`errors`、`transport`、`tree`、`diff`、`composer`、`platform`、`inspector`、`demo`、`workbench`、`ui`、`chatview`、`theme`、`i18n`、`agentSpec`、`surfaceMetadata`、`transcript` 的 hub/normalize 部分）是**真正三方共用的**（web/desktop/mobile-rn 都用）。
- **建议：不做 shared-core / shared-hub / shared-edge 三分，而是做一次定向的「edge 表面剔除 + hubClient 边界硬化」。** 全量三分会牵动 ~578 文件 + 三套 path 别名 + 三个 pnpm workspace 包，churn ≈ A-V1 adapters/orchestrator 的 8–10 倍，而收益在既有 14 层门禁下已被大量捕获（`#1463 shared-boundary`、`#1467 shared-rest-contract`、`#1468 shared-ui-hubclient` 已守住 shared 不泄漏 Edge 客户端、shared UI 不 runtime-import hubClient 的两条关键边）。
- **诚实结论：A-V3 是个"边界已 mostly closed，剩下的拆分包不划算"的 case**，类似 A-V1 对 lifecycle 的裁决。**建议 DEFER 全量三分，只采纳两个 quick-win**（见 §6）。

## 1. shared 包现状盘点

### 1.1 体量

- `app/shared/src/`：**578 个 .ts/.tsx 文件**，非测试源 **37.6k 行**（含 `hubClient*.ts` 32 文件 9.3k、`transcript/` 28 文件、`workbench/` ~100 文件、`ui/` 173 文件、`chatview/` 一组）。
- `package.json` 导出 35 个子路径（`./types` `./events` `./hubClient` `./hubEvents` `./composer` `./workbench` `./ui` `./transcript` `./apiClient` `./eventClient` 等），别名 `@agenthub/shared`（workspace 包）+ `@shared`（web/desktop 的 tsconfig/vite path 别名）。
- 消费者：仅 web、desktop、mobile-rn 三个 workspace 包；Go 侧（hub-server / edge-server）**不 import TS**——`hub-server/internal/ws/frame.go:11` 只是一行注释，声明 Hub WS 事件名常量与 `app/shared/src/hubEvents.ts` 1:1 镜像（这是 SSOT 约束，不是依赖）。

### 1.2 按归属分类（grep 实测消费点）

下表"消费点"列来自 `grep -rln '@shared/<sub>' app/{web,desktop,mobile-rn}/src`，去重后的文件数。

| shared 模块 | 归属 | web | desktop | mobile-rn | 备注 |
|---|---|---:|---:|---:|---|
| `types.ts` `types/chat.ts` | **truly-shared** | ✓ | ✓ | ✓ | OpenAPI 镜像 + chat block 类型；三端都用 |
| `events.ts` (EventEnvelope) | **truly-shared** | ✓ | ✓ | (via hubClient) | Edge/Hub 事件包络，desktop useEventStream 直用 |
| `errors.ts` `errorReporting` | **truly-shared** | ✓ | ✓ | ✓ | parseError/AppError，全端 |
| `transport.ts` | **truly-shared** | ✓ | ✓ | — | WS 传输抽象；web/desktop 都经 hubClient 间接用 |
| `tree.ts` `diff.ts` | **truly-shared** | ✓ | ✓ | — | 纯函数，无 hub/edge 倾向 |
| `theme` `themePresets` `styles` `designTokens` | **truly-shared** | ✓ | ✓ | — | 设计 token，三端共享视觉 |
| `i18n` `chatview/i18n` | **truly-shared** | ✓ | ✓ | — | 文案资源 |
| `composer` | **truly-shared** | ✓ | ✓ | ✓ | composer 类型/附件/reducer；mobile 直用 `ComposerIntent`/`ComposerSubmitResult` |
| `platform` `transcript`(hub/normalize 部分) `inspector` `demo` `agentSpec` `surfaceMetadata` `workbench` `ui` `components` `chatview` | **truly-shared** | ✓ | ✓ | ✓(部分) | workbench/ui/chatview 是三端共渲染主表面；mobile-rn 用 `platform`/`transcript` 类型 |
| `stores/queryKeys.ts` (hubQueryKeys) | **hub-side** | ✓ | ✓ | ✓ | mobile-rn 也用 hubQueryKeys（mobile 是 hub-only） |
| `hubEvents.ts` | **hub-side** | ✓ | ✓ | ✓ | Hub WS 事件名常量；mobile-rn 6 文件用（mobile 走 Hub WS） |
| `hubClient.ts` + 31 个 `hubClient*.ts` 子模块 | **hub-side** | ✓ | ✓ | ✓ | Hub REST/WS 客户端 SSOT；mobile-rn `api/hubClient.ts` 仅 re-export `@agenthub/shared/hubClient` |
| `apiClient.ts` | **edge-side** | ✗ | ✗ | ✗ | **零消费点**。grep 全仓无 `@shared/apiClient` 导入；desktop 走自维护 `edgeClient.ts`（薄壳，只 import `@shared/types` + `@shared/errors`）。**实质已是死表面对外，仅 shared 内部 `index.ts` re-export**。 |
| `eventClient.ts` | **edge-side** | ✗ | ✓(hooks) | ✗ | desktop `useEventStream`/`stores/edgeEventBridge` 用；web/mobile 不用 |
| `transcript/edge*.ts`（12 文件） | **edge-side** | ✗ | ✓ | ✗ | `normalizeEdgeEvents`/`edgeEventMappers*`；仅 desktop `useDesktopEdgeEvents`/`edgeEventBridge` 用 |
| `stores/queryKeys.ts` (edgeQueryKeys) | **edge-side** | ✗ | ✓ | ✗ | 仅 desktop `agentQueries`/`runQueries`/`threadQueries` 用 |
| `context/breakdown` | **truly-shared** | — | ✓ | — | token 估算，无 hub/edge 倾向 |

### 1.3 关键观察

1. **`apiClient.ts` 是"edge 表面"但零外部消费**——它是 Edge REST 的旧 SSOT 客户端，已被三端的 hubClient thin-shell + desktop 的 `edgeClient.ts` 取代。它在 `shared/src/index.ts` 行 236–275 被 re-export，但全仓 `grep '@shared/apiClient'` 无命中。**这是最干净的剔除候选，不是拆分候选。**
2. **`eventClient.ts` + `transcript/edge*.ts` + `edgeQueryKeys` 是真正 edge-only 的表面**，且**仅 desktop 用**（web/mobile-rn 都是 hub-only 客户端）。这三个加起来 ~1.2k 行。
3. **`hubClient*.ts` 32 文件 9.3k 行是 hub-side 最大单一表面**，但**mobile-rn 也用它**（mobile 是 hub-only，所以 hubClient 对 mobile 而言是"正确归属"）。把 hubClient 抽到 shared-hub 不解决 mobile 的任何问题——mobile 仍需 hubClient。
4. **web 和 mobile-rn 都是 hub-only**：web 不 import 任何 `@shared/apiClient`/`edgeQueryKeys`/`eventClient`/`transcript/edge*`；mobile-rn 同样禁（`verify-mobile-hub-boundary.ps1` + `verify-web-hub-boundary.ps1` 已守）。**"edge-only 表面污染 hub-only 消费者"的风险已被既有边界门禁覆盖。**

## 2. 证据：消费者实际导入路径

### 2.1 desktop（同时是 hub + edge 客户端）

`app/desktop/src/api/edgeClient.ts:20-23`：
```ts
import type { HealthResponse, Runner, AgentInfo, ListResponse, RunInfo, RunDiff, ThreadInfo, ThreadItemInfo, ThreadPinInfo, StartRunRequest, Artifact, Preview, UserProfileInfo } from '@shared/types';
import { parseError } from '@shared/errors';
import { reportApiError } from '@shared/errors';
import type { AppError } from '@shared/errors';
```
desktop 用 `@shared/types` + `@shared/errors` 构造 edge REST 客户端——**类型/errors 是 truly-shared，edgeClient 本身在 desktop 自维护，不在 shared**。

`app/desktop/src/api/hubClient.ts:7,14,17`：
```ts
import { AppError } from '@shared/errors';
import { createHubClient as createSharedHubClient, type ExecutionTarget, ... } from '@shared/hubClient';
export * from '@shared/hubClient';
```
desktop hub 路径经 shared hubClient SSOT（#1452 thin-shell）。

`app/desktop/src/hooks/useEventStream.ts:12` / `stores/edgeEventBridge.ts`：
```ts
import type { EventEnvelope } from '@shared/events';
// 经 shared/eventClient 消费 Edge WS
```

### 2.2 web（hub-only）

`app/web/src/api/transport.ts:2`：`export * from '@shared/transport';`（truly-shared）
`app/web/src/api/hubWS.ts:22-23`：`import type { HubEventType } from '@shared/hubEvents';` + `import { HUB_EVENTS } from '@shared/hubEvents';`（hub-side）
`app/web/src/App.tsx:4`：`import { AgentHubWorkbench } from '@shared/workbench';`（truly-shared）

web grep 全仓**零** `@shared/apiClient` / `@shared/eventClient` / `edgeQueryKeys` 命中——边界门禁 `#1431` 守住了。

### 2.3 mobile-rn（hub-only）

`app/mobile-rn/src/api/hubClient.ts:24-31`：
```ts
import type { ... } from '@agenthub/shared/hubClient';
import type { HubEventType } from '@agenthub/shared/hubEvents';
export * from '@agenthub/shared/hubClient';
```
`app/mobile-rn/src/platform/mobilePlatform.ts:1-2`：
```ts
import type { AgentHubPlatform, SurfaceCapabilities, WorkbenchConversation } from '@agenthub/shared/platform';
import type { ComposerIntent, ComposerSubmitResult } from '@agenthub/shared/composer';
```
mobile-rn grep **零** edge 表面命中——边界门禁 `#1436` 守住。且 mobile-rn 是唯一在 `package.json` 显式声明 `"@agenthub/shared": "workspace:*"` 的消费者（web/desktop 走 vite/tsconfig path 别名，未声明 workspace 依赖——见 §4.3 隐患）。

### 2.4 Go 侧零 TS 依赖

`grep -rnE 'agenthub/shared|app/shared|@shared' edge-server/ hub-server/` 仅命中 `hub-server/internal/ws/frame.go:11` 一行**注释**（声明与 `app/shared/src/hubEvents.ts` 1:1 镜像）。Go 与 TS shared 无编译期依赖。

## 3. 提议的拆分（或为何不拆）

### 3.1 审计建议的三分

`shared-core`（truly-shared 类型/契约/errors/transport/theme/i18n）+ `shared-hub`（hubClient/hubEvents/hubQueryKeys）+ `shared-edge`（apiClient/eventClient/transcript-edge/edgeQueryKeys）。

### 3.2 为什么不建议全量三分

1. **消费者现实是"2 hub-only + 1 dual"，不是"hub vs edge 对等"。** web/mobile-rn 只用 hub 表面，desktop 两者都用。把 hub 表面抽到 shared-hub，**mobile-rn 仍要 import shared-hub**——没解耦，只是多一个包名。把 edge 表面抽到 shared-edge，**只有 desktop 一个消费者**——为 1 个消费者新建一个 workspace 包，churn > 收益。
2. **既有 14 层门禁已覆盖三分的真实目标。** 三分想解决的"edge 表面泄漏到 hub-only 客户端"和"hub 运行时 import 进 shared UI"，已被 `#1431 web-hub-boundary`、`#1436 mobile-hub-boundary`、`#1463 shared-boundary`（shared workbench/chatview/ui 禁 Edge 客户端）、`#1468 shared-ui-hubclient`（shared UI 禁 runtime hubClient）守住。`#1452 hubclient-ssot` 把 hubClient 收口到 shared 单一 SSOT。**剩下的"包边界"是组织性洁癖，不是依赖图问题。**
3. **`apiClient.ts` 零外部消费**——它根本不需要"拆到 shared-edge"，它需要**删**（见 §6 quick-win 1）。
4. **churn 估算**：全量三分需移动 ~578 文件、建 3 个 package.json、改 3 套 tsconfig/vite path 别名、改 35 个 exports 子路径、改 mobile-rn 的 `"@agenthub/shared"` 声明。对比 A-V1 的 13 文件移动，**churn 高一个数量级，收益线性且部分已被门禁吃掉**。

### 3.3 建议：定向剔除 edge 死表面 + 硬化 edge 边界（不三分）

- **不新建 shared-hub / shared-edge 包。** 保留 `@agenthub/shared` 单包。
- **把 `apiClient.ts`（零消费的 Edge REST 旧 SSOT）从 `index.ts` re-export 中移除**，确认全仓无导入后删除文件（quick-win 1）。
- **`eventClient.ts` + `transcript/edge*.ts` + `edgeQueryKeys` 保留在 shared**，但补一条门禁：`shared/src` 内的 edge 表面**不得被 web/mobile-rn import**（当前已由 web/mobile 边界门禁间接守，但 shared 侧无直接门禁——补 `verify-shared-edge-surface-isolation.py` 作为软门禁，见 §5）。
- **`hubClient*.ts` 保留在 shared**——mobile-rn 作为 hub-only 客户端合法消费它，抽到 shared-hub 无净收益。

## 4. 迁移路径（strangler fig，针对 §3.3 的定向方案）

### 4.1 Step 1 — 剔除死 edge 表面（低风险，先做）

1. `grep -rn '@shared/apiClient\|@agenthub/shared/apiClient\|from "./apiClient"\|from "../apiClient"' app/` 确认零外部消费（已实测为 0）。
2. 从 `app/shared/src/index.ts` 删除 `apiClient` 的 re-export 块（行 236–275）。
3. 删除 `app/shared/src/apiClient.ts`、`app/shared/src/apiClient.test.ts`。
4. 跑 `pnpm --filter @agenthub/shared lint` + `pnpm -r typecheck` + 三端 `pnpm test`。
5. `#1467 shared-rest-contract` 门禁须确认 apiClient 不在契约比对集里（它针对 hub 路由，apiClient 是 edge，应不在）。

### 4.2 Step 2 — 硬化 edge 表面隔离门禁

1. 新增 `scripts/verify/verify-shared-edge-surface-isolation.py`：扫描 `app/web/src`、`app/mobile-rn/src`，禁止 import `@shared/apiClient`(若已删则禁 path)、`@shared/eventClient`、`@shared/transcript/edge*`(edgeEventMappers/normalizeEdgeEvents)、`@shared/stores/queryKeys` 中的 `edgeQueryKeys`。
2. 先以 lint（非阻塞）跑一个周期，确认 0 违规（实测应为 0，因 web/mobile 边界门禁已守）。
3. 稳定后硬化为 `-ErrorAction Stop`，并入 `validate` 14→15 层门禁索引。

### 4.3 Step 3 — 修 web/desktop 的隐式 workspace 依赖（顺手）

`app/web/package.json` / `app/desktop/package.json` **未声明** `"@agenthub/shared": "workspace:*"`，仅靠 vite/tsconfig path 别名 `@shared` 直读 `../shared/src/*`。mobile-rn 是显式声明的。这是**既有隐患**（不是 A-V3 引入）：path 别名绕过 pnpm 工作区依赖图，`pnpm why` 看不到 web→shared 边。若未来要分包，这一步是前置。**建议在 Step 3 给 web/desktop 补 `"@agenthub/shared": "workspace:*"` 声明**，与 path 别名并存（path 别名继续提供 `@shared` 短名），让依赖图显式化。此步独立于拆分决策，纯卫生。

### 4.4 不走全量三分的迁移路径（已驳回，记录于此供对照）

若管理员强制要求三分，strangler fig 路径会是：先建 `shared-core` package.json，把 `types/errors/transport/tree/diff/theme/i18n/composer/platform/agentSpec/surfaceMetadata` 迁入并留 `@agenthub/shared` barrel re-export；再建 `shared-edge`（迁 `apiClient/eventClient/transcript-edge/edgeQueryKeys`）与 `shared-hub`（迁 `hubClient*/hubEvents/hubQueryKeys`）；最后把 web 的 `@shared/*` 别名逐个指向新包。**预计 4–6 个 PR、跨 2 周门禁稳定期，且 mobile-rn 的 `@agenthub/shared/hubClient` 导入要重写为 `@agenthub/shared-hub/hubClient`**——churn 大、行为零变化、门禁收益被既有 14 层吃掉。**不推荐。**

## 5. 门禁影响

### 5.1 既有门禁（14 层，全部已合入）

`#1431 web-hub-boundary` · `#1436 mobile-hub-boundary` · `#1435 hub-pure-packages` · `#1440 design-token` · `#1443 coverage-baseline` · `#1444 openapi-contract` · `#1452 hubclient-ssot` · `#1463 shared-boundary` · `#1468 shared-ui-hubclient` · `#1467 shared-rest-contract` · + `shared-barrel` / `hub-layering` / `conventions` / `token-ssot`。

**A-V3 三分想强制的边界，与 `#1463 shared-boundary` + `#1431/#1436` 高度重叠。** `#1463` 已禁 shared workbench/chatview/ui 出现 Edge 客户端（`apiClient`/`EventClient`/`edgeClient`/`/v1/runs`/`/v1/events`）；`#1468` 已禁 shared UI runtime-import hubClient。**剩下的 gap 是 `eventClient.ts` / `transcript/edge*` / `edgeQueryKeys` 在 shared 根未被任何门禁直接点名**——它们不在 workbench/chatview/ui（`#1463` 扫描范围），但若 web/mobile 误 import 它们，只有 web/mobile 边界门禁间接挡。§4.2 Step 2 的软门禁补这个 gap。

### 5.2 新增门禁建议

- **`verify-shared-edge-surface-isolation.py`**（软起，稳定后硬化）：禁 web/mobile-rn import `@shared/eventClient`、`@shared/transcript/edge*`、`edgeQueryKeys`。**与 `#1463` 互补**（`#1463` 守 shared 内部不出现 edge 客户端实现；新门禁守 shared 内已存在的 edge 表面不被 hub-only 消费者 import）。
- **不新增 coverage 门禁**：剔除 `apiClient.ts` 会微降 shared coverage（apiClient 有单测），但 `#1443` 基线 71.57% 是 shared 整体，删除后需重测基线——预计影响 <0.3pp，可接受，但**合入时须同步更新 `#1443` 基线数**。

### 5.3 删除 apiClient 对 REST 契约门禁的影响

`#1467 shared-rest-contract`（`verify-shared-rest-contract.py`）比对的是 Hub 路由契约，`apiClient.ts` 是 Edge REST 客户端——**不在比对集**。删除 apiClient 对 `#1467` 零影响。需确认 `apiClient.ts` 的 OpenAPI 引用（`api/openapi.yaml` 的 Edge 路径）是否还有其他消费者——实测 desktop `edgeClient.ts` 自维护 schema（`./schemas`），不依赖 `apiClient.ts`。

## 6. 工作量 / 风险 / 建议

| 维度 | 全量三分（驳回） | 定向剔除（推荐） |
|---|---|---|
| 范围 | L–XL。3 包 + 578 文件归类 + 3 套 path 别名 | XS。删 1 文件 + 1 软门禁 + 2 package.json 补声明 |
| 调用点改动 | web/desktop/mobile-rn 大量 import 重写 | 外部 0（apiClient 零消费） |
| 行为变化 | 无 | 无 |
| 测试影响 | 三端 vitest config 调整 | 删 apiClient.test.ts；coverage 基线微调 |
| 风险 | 中高（path 别名错配、pnpm workspace 解析回归） | 低（删的是死表面，有 grep 兜底） |
| 收益 | 包边界清晰，但被既有 14 层门禁大量覆盖 | 补齐 edge 表面 gap，消除 1 死表面 |
| 建议 | **REJECT**（DEFER 候选，非高价值） | **采纳 quick-wins** |

**核心建议**：**驳回 A-V3 全量三分；采纳 §4.1 + §4.2 的定向剔除与 edge 隔离门禁；§4.3 的 workspace 依赖声明作为独立卫生项随手做。**

### 6.1 Quick-wins（无需 RFC sign-off，安全可执行）

1. **删 `app/shared/src/apiClient.ts` + 从 `index.ts` 移除 re-export**（§4.1）。零外部消费，纯死表面清除。改 `#1443` 基线数。
2. **给 web/desktop `package.json` 补 `"@agenthub/shared": "workspace:*"`**（§4.3）。依赖图显式化，`pnpm why` 可见。

### 6.2 需 sign-off 的部分

- **新增 `verify-shared-edge-surface-isolation.py` 并硬化入 validate 门禁索引**（§4.2 Step 2 → §5.2）。新增 CI 硬门禁属工程治理变更，建议管理员确认强度（lint vs hard-fail）与是否并入 14 层索引（→15 层）。

## 7. 与审计/原 issue 的诚实对照

- **审计说**"shared currently mixes hub-only and edge-only types"。**实测属实，但规模被高估**：真正 edge-only 的只有 `apiClient`(零消费) + `eventClient` + `transcript/edge*`(12 文件) + `edgeQueryKeys` 一段，~1.2k 行 / 14 文件，占 shared 37.6k 的 ~3%。hub-only 的是 `hubClient*` 9.3k 行，但 mobile-rn 也消费——不是"只 web/desktop"的 hub 表面。
- **审计隐含的"三分能解耦"**：实测 web/mobile 已被边界门禁守住不碰 edge 表面，desktop 双消费是设计意图（desktop 本就是 dual 客户端）。**三分不改变任何消费者的实际 import 集合，只改包名。** 这与 A-V1 对 lifecycle 的裁决同构——"god function 已被 D-V1 解，拆包是命名洁癖"。
- **类比 D-V2 PostRuns**：D-V2 被评估为低价值（358 行但线性、有 D-V1 前置）；A-V3 同样——边界已被门禁守，剩下的三分是结构性洁癖。**诚实结论：A-V3 是 P3 中第二个"评估为低价值/驳回"的裁决项。**

## 8. RFC sign-off 记录

**已裁决 2026-08-03（#1523）**：采纳"驳回全量三分 + quick-wins 落地 + 软门禁硬化待定"路径。理由：

1. 全量三分牵动 ~578 文件 + 3 包重建，churn 高一个数量级；既有 14 层门禁已守住 shared 不泄漏 Edge 客户端、shared UI 不 runtime-import hubClient 两条关键边。
2. Quick-wins 已执行（apiClient.ts 删除 + web/desktop 显式 `workspace:*` 依赖，随 41309678 落地）。
3. 隔离门禁已按软门禁建（`verify-shared-edge-surface-isolation.py`，NON-BLOCKING）；硬化成硬门禁（违规即失败 + 正负向自测）转独立任务 **#1525**。

## 9. 参考

- 既有边界门禁：`scripts/verify/verify-shared-boundary.ps1`、`verify-shared-ui-hubclient.ps1`、`verify-web-hub-boundary.ps1`、`verify-mobile-hub-boundary.ps1`、`verify-shared-rest-contract.ps1`、`verify-hubclient-ssot.ps1`
- MASTER 门禁索引：`docs/progress/MASTER.md` L94（14 层 validate 硬门禁）
- hubClient SSOT：`app/desktop/src/api/hubClient.ts:7,14,17`、`app/web/src/api/hubClient.ts:4,12,14`、`app/mobile-rn/src/api/hubClient.ts:24-31`
- Edge 表面仅 desktop：`app/desktop/src/api/edgeClient.ts:20-23`、`app/desktop/src/stores/edgeEventBridge.ts`、`app/desktop/src/platform/useDesktopEdgeEvents.ts:2-3`
- hubEvents 1:1 镜像 SSOT：`hub-server/internal/ws/frame.go:11` 注释
- 风格先例：`docs/plan/rfc-A-V1-adapters-lifecycle-split.md`（同类"驳回全量、采纳定向"裁决）
