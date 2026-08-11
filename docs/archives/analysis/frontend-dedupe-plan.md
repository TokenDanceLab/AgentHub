# Frontend Dedupe Plan (Strangler Cleanup)

> pending external archive — see docs/history.md

最后更新：2026-07-18
范围：`app/desktop` / `app/web` / `app/shared`（mobile 仅边界相关）
原则：只做小切片绞杀；不先大合并 orphan UI；先 SSOT 再删 fork。
注意：本计划为 strangler 历史切片记录；活进度见 `docs/progress/MASTER.md`。

## 0. Goal

**Eliminate dual hub clients and dual settings surfaces without UX rewrite.**

具体目标：

1. **单一 hubClient SSOT**：`app/shared/src/hubClient.ts` 成为 Desktop/Web/Mobile 的共同 HTTP 客户端；desktop/web 本地实现降级为 thin re-export + surface-only 胶水（token storage、baseUrl、auth refresh、fetch transport）。
2. **单一 Settings surface**：shared workbench `SettingsPage` 为唯一产品设置 UI；desktop/web 本地 SettingsPage 孤儿全删；desktop Edge diagnostics 通过 `SettingsPort` / host diagnostics 通道进入 shared，不复活整页。
3. **零 UX 回归**：用户可见的 Desktop Web 行为不变；不重写 workbench shell、不重排路由、不引入新 UI 框架。
4. **安全边界不减**：AH-SR-043 demo/mock 泄漏按 fail-closed 收紧；Web 绝不获得 localEdge/localFiles/cli spawn 能力；Desktop renderer 绝不获得 raw process execution。

非目标（本波明确不做）：

- 不把 mobile 强行切到 shared workbench UI。
- 不在未做 parity test 前删除 desktop/web hubClient 本地实现。
- 不把 orphan Settings/TeamRun 直接 merge 回产品路径。
- 不在同一 PR 同时改 hubClient + dataMode gate + ConversationPort。

## 1. 现状结论（一句话）

产品路径已经是 **shell -> platform adapter -> shared workbench**，但 pre-shared 时代留下的 **hubClient 三份实现、Settings/TeamRun 孤儿分叉、platform demo 默认值、双 dataMode 词表** 仍在制造漂移与 AH-SR-043 误报风险。

## 2. Dupe Clusters

### C1. hubClient 三份实现（+ mobile thin wrap）

| Path | LOC (approx) | Role (2026-07-16 inventory) |
|---|---:|---|
| `app/shared/src/hubClient.ts` | ~1533 | 意图中的 SSOT；mobile 已消费；含 request 超时/401 refresh/route fallback |
| `app/desktop/src/api/hubClient.ts` | ~1854 | Desktop 产品真实客户端；类型与方法最全（team/docs/streamTaskEvent 等） |
| `app/web/src/api/hubClient.ts` | ~1705 | Web 产品真实客户端；与 desktop 近重复，含 task approvals/artifacts |
| `app/mobile-rn/src/api/hubClient.ts` | ~641 | **正确模式**：re-export/extend shared，本地补缺口类型 |

**方法面漂移（return object keys，粗算）：**
- desktop and web approximately 107
- desktop-only（相对 web）：documents CRUD、executionTarget create/update、`streamTaskEvent`、`postTeamRouteDecision`、`removeAgentTeamMember`、`getAgentProfile` 等
- web-only（相对 desktop）：`listTaskApprovals` / `decideTaskApproval` / `listTaskArtifacts`
- shared 已有 auth/session/workspace 主干，但 **未覆盖** desktop/web 的 team-run、agent-profile、settings、attachment 完整面

**SSOT：** `app/shared/src/hubClient.ts`
**表面 glue 留在：** desktop/web 的 token storage、baseUrl、auth refresh 注入、surface-only headers
**风险：** 中高。类型名未统一（desktop `Session` vs shared `HubSession`），调用方广；一次替换易炸。
**切片：** 先 types/re-export -> 方法补齐 + contract test -> desktop callers -> web callers -> 删本地实现。

### C2. SettingsPage 三层分叉

| Path | LOC | Runtime status |
|---|---:|---|
| `app/shared/src/workbench/pages/SettingsPage.tsx` | ~717 | **产品 SSOT**（`WorkbenchRoutes` 挂载） |
| `app/desktop/src/components/SettingsPage.tsx` + `settings/sections/*` | ~869 + sections | 基本 orphan；仅 `useTopMenuConfig` 类型引用 `SectionId` |
| `app/web/src/components/SettingsPage.tsx` | ~2386 | orphan 巨石；无产品 import graph |

**SSOT：** shared workbench SettingsPage + `SettingsPort` / host diagnostics
**保留价值：** desktop Edge diagnostics / local CLI discovery / execution-target sections 可能有独有内容，应迁入 shared panes 或 platform host，而不是整页复活。
**风险：** 低（删 orphan）/ 中（迁 Edge 独有 section）。
**切片：** 抽 `SectionId` 类型 -> 证明 import-graph 死链 -> quarantine/delete web SettingsPage -> 迁 desktop 独有 section -> 删 desktop SettingsPage。

### C3. TeamRunConsole desktop vs web（+ IM 子组件）

| Path | LOC | Runtime status |
|---|---:|---|
| `app/desktop/src/views/TeamRunConsole.tsx` | ~636 | 无 App/workbench 产品 import |
| `app/web/src/views/TeamRunConsole.tsx` | ~999 | 无产品 import；有 unit test |
| `app/*/src/components/IM/Team*.tsx` | 多文件 | 近名分叉，相似度低（ratio ~0.19-0.45） |

结构相似度 ~0.67，web 多出 payload 解析与 execution-target 辅助逻辑。
另有 `desktop TeamRunDock` / `shared/demo/teamrunDemo` / agentTeamQueries 并行存在。

**SSOT（若产品仍要 TeamRun）：** shared workbench 下的 TeamRun view-model + console
**若产品已由 workbench/team pages 替代：** archive 两端 console，测试改成 shared behavior specs
**风险：** 中。在未决定产品 owner 前合并 = 复活死 UI。
**切片：** 决策 owner -> 若 archive：先标 orphan + 保留 test 语义 -> 再删；若保留：先抽 shared view-model，再薄壳 desktop/web。

### C4. Platform adapters vs `AgentHubPlatform`

| Path | Compliance | 主要偏差 |
|---|---|---|
| `app/shared/src/platform/types.ts` | contract SSOT | `AgentHubPlatform` 定义正确且小 |
| `app/shared/src/platform/createMockPlatform.ts` | test-only | 符合；不应进产品默认路径 |
| `app/desktop/src/platform/desktopPlatform.ts` | 部分 | `surface/capabilities` 正确；`conversations.list()` **恒 demo**；module-level demo exports；`demoRuntimeFallback` |
| `app/web/src/platform/webPlatform.ts` | 部分 | capabilities 正确（无 localEdge/files）；`conversations.list()` 返回 demo `webConversations`；`submitComposerIntent` 混 optimistic cache + demo fallback |
| `app/mobile-rn/src/platform/mobilePlatform.ts` | 部分 | hub 失败可 silent fixture fallback |

真实会话列表实际来自 `useDesktopWorkbenchModel` / `useWebWorkbenchModel`，**绕过 ConversationPort**。
这与 `docs/architecture/04-frontend-data-flow.md` "adapter 提供数据端口" 叙事不完全一致。

**SSOT：** `app/shared/src/platform/types.ts` + 各 surface 的 `create*Platform`
**风险：** 中高（改 list()/fallback 会动真实 UI 数据源）。
**切片：** 先让 demo seeds 不再是默认 export -> ConversationPort 要么接真实 model，要么文档标明 "model owns list" -> 再收紧 fallback。

### C5. Mock / demo leakage（AH-SR-043）

| Surface | Leak path |
|---|---|
| Shared contract | `demo/dataMode.ts`：`auto` 允许 mock/fixture；`mock/fixture` 允许 `allowsDemoRuntimeFallback` |
| Dual vocabulary | `workbenchDataMode.ts`（loading/live/offline-snapshot...）与 product dataMode 并存 |
| Desktop | `createDesktopPlatform({ demoRuntimeFallback })`；`conversations.list` demo；App 在 demo 场景开启 fallback |
| Web | `demoRuntimeFallback` + `auto && !token` 可走 demo submit；platform 默认 demo conversations |
| Mobile | hub error -> fixture success（假成功） |

**关闭条件（来自 security-risk-register）：** 预览模式显式 gate；生产 mutation 走 Hub `/web/agent-tasks` 或 TeamRun API；UI 不得把 demo 成功宣称为 real execution/private-chat。

**SSOT：** `app/shared/src/demo/dataMode.ts` + `testing/e2eDataModeContract.ts`
**风险：** 安全中等、产品体验高。先 gate 再删 demo 文件。
**切片：** badge 强制可见 -> mutation fail-closed（非 observed/approved-real 禁止假成功）-> 拆 platform 内 demo 默认值 -> 再考虑删/迁 demo 模块边界。

### C6. 次级 API 近重复（跟随 hubClient 后处理）

同名 desktop/web 文件（不完全重复，但同主题）：
- `hubAuth.ts`, `hubWS.ts`, `hubTokenStorage.ts`, `hubEvents.ts`（events 已接近/identical）
- `agentTeamQueries.ts`, `executionTargetQueries.ts`, `projectQueries.ts`, `agentQueries.ts`, `threadQueries.ts`, `runQueries.ts`, `transport.ts`, `edgeClient.ts`（desktop 重、web 轻）

**SSOT 方向：** query key / DTO 下沉 shared；surface query hooks 可保留薄封装。
**不要**与 hubClient 大合并同 PR。

## 3. 建议 SSOT 总表

| Cluster | SSOT | Keep surface-local |
|---|---|---|
| Hub HTTP client | `app/shared/src/hubClient.ts` | token get/refresh、baseUrl、Tauri/browser fetch 差异 |
| Platform contract | `app/shared/src/platform/types.ts` | desktop host/Edge、web preview/sessionStorage glue |
| Workbench UI shell | `app/shared/src/workbench/*` | App.tsx wiring only |
| Settings product UI | `app/shared/src/workbench/pages/SettingsPage.tsx` | Edge diagnostics via SettingsPort/host |
| Data mode product | `app/shared/src/demo/dataMode.ts` | env/storage override wiring |
| TeamRun (if kept) | new shared view-model under workbench | surface query client injection |
| Mock platform | `createMockPlatform` tests only | never product default |

## 4. 提取 / 删除风险评级

| Slice | Risk | Why |
|---|---|---|
| Inventory + mark orphans (no delete) | Low | 只文档/注释/类型搬家 |
| hubClient types re-export alias | Low-Med | 调用方多但可兼容 alias |
| hubClient method parity + contract tests | Med | endpoint 形状差会 silent fail |
| Switch desktop callers to shared client | Med-High | team/docs/settings 覆盖面大 |
| Switch web callers to shared client | Med | task approval/artifact 必须先补 shared |
| AH-SR-043 fail-closed gates | Med | 可能打断 dev auto 体验；需 badge + docs |
| Delete web SettingsPage orphan | Low after graph proof | 巨石但无 runtime import |
| Delete desktop SettingsPage | Low-Med | 先迁 SectionId + 独有 sections |
| Merge TeamRunConsole | High if premature | product owner 未决 |
| Make ConversationPort real SSOT | Med-High | model 层已是真相源；硬切易空列表 |
| Dual dataMode rename/deprecate | Low-Med | 词表污染测试证据 |

## 5. Forbidden Moves（不可越过）

以下操作**任何切片均禁止**，作为 cleanup 硬红线：

| # | 禁止操作 | 原因 | 后果 |
|---|---|---|---|
| F1 | **Web 获得 localEdge / localFiles 能力** | AGENTS.md L60 硬边界：Web/Mobile 不能使用 Local Edge | 安全回归；架构合法性崩塌 |
| F2 | **Web / Desktop renderer 直连 raw CLI / process spawn** | AGENTS.md L61 硬边界；raw process 只经 Local Edge 与 typed Tauri host | 安全回归；不可审计的执行路径 |
| F3 | **删除 desktop/web hubClient 前未完成 shared parity test** | endpoint 形状差异可 silent fail team/docs/settings 等关键路径 | 产品功能静默丢失 |
| F4 | **同时删除两端 hubClient 本地实现** | 必须一端一端切，先 desktop 再 web（或反过来），中间保留薄 re-export | 爆炸半径不可控 |
| F5 | **把 orphan SettingsPage / TeamRunConsole 直接 merge 回 shared workbench 产品路径** | 孤儿代码无维护者、无产品 owner、无 import graph 证据 | 复活死 UI；引入未审计代码 |
| F6 | **删除 shared demo/dataMode contract 或破坏 e2eDataModeContract test** | AH-SR-043 gate 依赖 dataMode vocabulary 作为证据源 | 失去 mock/real 区分能力 |
| F7 | **合并 desktop/web platform adapter 为单一 adapter** | Desktop 与 Web 的 surface/capabilities/host 差异是架构正确性保障 | LocalEdge 泄漏到 Web；架构退化 |
| F8 | **在同一 PR 同时改 hubClient + dataMode gate + ConversationPort** | 三项改动各自风险评级 Med 到 Med-High | 爆炸半径过大；无法逐片回滚 |
| F9 | **新增任何根级 script wrapper 或第二套规则文件** | AGENTS.md 规则纪律 | 工具链膨胀 |
| F10 | **Mobile 强制切到 shared workbench UI** | mobile 是 boundary-isolated，shared workbench UI 不是当前 mobile 主线 | scope 爆炸 |

## 6. 建议 PR 顺序（小切片绞杀 + 验收测试）

每个 PR 列出最小验收命令。**所有切片共享的铁律**：

- `cd app/shared && corepack pnpm test` 必须绿
- `cd app/desktop && corepack pnpm typecheck` 必须绿
- `cd app/web && corepack pnpm typecheck` 必须绿
- 触及 desktop call site 的 PR 加 `cd app/desktop && corepack pnpm test -- hubClient`
- 触及 web call site 的 PR 加 `cd app/web && corepack pnpm test -- hubClient`

### PR-0 -- Inventory freeze（无行为变更）

- 在 analysis/docs 标记 orphan 候选与 import-graph 证据（本文）。
- 冻结规则：禁止在 desktop/web `hubClient.ts` 新增方法；新方法只进 shared。
- **验收**：
  ```powershell
  # 文档 + 可选 eslint/path comment；不改 runtime
  cd app/shared; corepack pnpm typecheck
  cd app/desktop; corepack pnpm typecheck
  cd app/web; corepack pnpm typecheck
  ```

### PR-1 -- hubClient types SSOT（兼容 alias）

- shared 导出权威 DTO（`HubSession` 等）。
- desktop/web 本地类型改为 `export type Session = HubSession` 一类 alias，或 re-export。
- 不切换 `createHubClient` 实现。
- **验收**：
  ```powershell
  cd app/shared; corepack pnpm test -- hubClient
  cd app/desktop; corepack pnpm typecheck
  cd app/web; corepack pnpm typecheck
  # 确认 Session vs HubSession alias 无 breaking
  ```

### PR-2 -- shared hubClient 方法补齐 + parity contract test

- 把 desktop/web 独有且产品仍用的方法并入 shared（team run、agent profiles、settings、attachments、task approvals/artifacts、documents 按需）。
- 增加 method/endpoint parity 测试（shared vs 当前 desktop/web 期望表）。
- **验收**：
  ```powershell
  cd app/shared; corepack pnpm test -- hubClient
  # parity contract test: shared method set covers desktop + web union
  cd app/desktop; corepack pnpm typecheck
  cd app/web; corepack pnpm typecheck
  ```

### PR-3 -- desktop 切到 shared createHubClient

- `app/desktop/src/api/hubClient.ts` 变成 thin re-export + 极少数 desktop-only 扩展。
- 先改 `hubQueries`/`sessionQueries`/`teamRunQueries` 等入口，再删本地 request 实现。
- **验收**：
  ```powershell
  cd app/shared; corepack pnpm test -- hubClient
  cd app/desktop; corepack pnpm test -- hubClient
  cd app/desktop; corepack pnpm typecheck
  # manual smoke: login/list/session 不回归
  ```

### PR-4 -- web 切到 shared createHubClient

- 同 PR-3 模式；确保 task approval/artifact 与 web workbench model 不回归。
- **验收**：
  ```powershell
  cd app/shared; corepack pnpm test -- hubClient
  cd app/web; corepack pnpm test -- hubClient
  cd app/web; corepack pnpm typecheck
  # stubbed hub e2e 合同不回归
  ```

### PR-5 -- AH-SR-043 gate harden（优先于大删 UI）

- production mutation：`observed`/`approved-real` + auth 才允许真实成功路径。
- `auto` 可展示 fixture/demo，但必须强制 dataMode badge，且禁止把 demo submit 标成 real execution。
- mobile：observed/approved-real fail-closed，禁止 hub error -> fixture success。
- platform：demo seeds 不再作为默认 module export 语义；`demoRuntimeFallback` 仅 mock/fixture 显式模式。
- **验收**：
  ```powershell
  cd app/shared; corepack pnpm test -- dataMode
  cd app/desktop; corepack pnpm test -- desktopPlatform
  cd app/web; corepack pnpm test -- webPlatform
  cd app/mobile-rn; corepack pnpm test -- mobilePlatform
  # e2eDataModeContract: auto 有 badge, approved-real 无假成功
  cd app/desktop; corepack pnpm typecheck
  cd app/web; corepack pnpm typecheck
  ```

### PR-6 -- ConversationPort / platform 叙事对齐

- 二选一（推荐 B 过渡）：
  - A. `conversations.list()` 改为真实 model 数据源；
  - B. 明确 model owns conversation truth，port 仅用于 mock/tests，并删产品路径对 demo list 的依赖。
- 拆 `webPlatform` 内 optimistic mutation helper 与纯 adapter。
- **验收**：
  ```powershell
  cd app/shared; corepack pnpm test -- platform
  cd app/desktop; corepack pnpm test -- desktopPlatform
  cd app/web; corepack pnpm test -- webPlatform
  # Desktop Edge real + Web Hub real 路径不空列表
  cd app/desktop; corepack pnpm typecheck
  cd app/web; corepack pnpm typecheck
  ```

### PR-7 -- Settings orphan 清理

1. 抽出 `SectionId`/surface metadata 到 shared 或 desktop types。
2. 删除/隔离 `app/web/src/components/SettingsPage.tsx`。
3. 审计 desktop `settings/sections/*` 独有 Edge 能力 -> 经 SettingsPort 进入 shared Settings。
4. 删除 desktop SettingsPage shell。
- **验收**：
  ```powershell
  cd app/shared; corepack pnpm test -- SettingsPage
  cd app/desktop; corepack pnpm test
  cd app/web; corepack pnpm test
  # Workbench settings 路由无回归；Edge diagnostics 仍可达
  cd app/desktop; corepack pnpm typecheck
  cd app/web; corepack pnpm typecheck
  ```

### PR-8 -- TeamRun 决策与处理

- 先写 1 页 product owner 决策：workbench 内嵌 vs 独立 console vs archive。
- archive 路径：保留 tests 语义，删 desktop/web views + 逐步合并 IM Team* 到 shared（若仍被别处用再迁）。
- keep 路径：shared TeamRun view-model -> 单一 console -> desktop/web 只注入 queries。
- **验收**：
  ```powershell
  # archive 路径
  cd app/shared; corepack pnpm test -- teamRun
  cd app/desktop; corepack pnpm typecheck
  cd app/web; corepack pnpm typecheck
  # keep 路径：至少一侧有产品路由，无死 UI 复活
  ```

### PR-9 -- 次级 API / IM 组件收口（可选）

- `hubEvents`/`deviceId` 已接近 identical 的先 re-export。
- `hubAuth`/`hubWS`/`hubTokenStorage` 抽 shared core + surface storage.
- IM Team* 仅在 TeamRun owner 明确后合并。
- **验收**：
  ```powershell
  cd app/shared; corepack pnpm typecheck
  cd app/desktop; corepack pnpm typecheck && corepack pnpm test
  cd app/web; corepack pnpm typecheck && corepack pnpm test
  # 逐包，禁止大爆炸 PR
  ```

### PR-10 -- 双 dataMode 词表收敛

- 将 `workbenchDataMode.ts` 重命名/降级为 catalog-source mode，停止与 product dataMode 混用。
- **验收**：
  ```powershell
  cd app/shared; corepack pnpm test -- dataMode
  cd app/shared; corepack pnpm typecheck
  # 用词统一；PR evidence 三角（surface / data source / auth-execution）清晰
  ```

## 7. Suggested Workflow Team（后期并行实施）

当 PR-0/1/2 完成（hubClient types SSOT + 方法补齐 + parity contract test 就绪），后续切片可由独立 agent 并行推进。每个 agent 分配一个 slice，文件集**互不重叠**，避免合并冲突。

### Agent A: desktop-hubClient-switch（PR-3）

**职责**：Desktop 调用方全量切换到 shared `createHubClient`。

**文件范围（只改这些，不动其他）：**

- `app/desktop/src/api/hubClient.ts` -- thin re-export + surface-only 扩展
- `app/desktop/src/api/hubQueries.ts`
- `app/desktop/src/api/sessionQueries.ts`
- `app/desktop/src/api/teamRunQueries.ts`
- `app/desktop/src/api/agentTeamQueries.ts`
- `app/desktop/src/api/executionTargetQueries.ts`
- `app/desktop/src/api/projectQueries.ts`
- `app/desktop/src/api/agentQueries.ts`
- `app/desktop/src/api/threadQueries.ts`
- `app/desktop/src/api/runQueries.ts`
- `app/desktop/src/api/transport.ts`
- `app/desktop/src/api/hubAuth.ts` -- 保留 surface auth glue
- `app/desktop/src/api/hubTokenStorage.ts` -- 保留 surface token glue
- `app/desktop/src/api/hubWS.ts` -- 保留 surface WS glue
- `app/desktop/src/*/` 中所有 import `../api/hubClient` 的调用点

**不碰**：`app/shared/`、`app/web/`、`app/mobile-rn/`、desktop platform adapter、desktop components/views 非 api 部分。

**前置**：PR-2 绿灯（shared hubClient 方法 parity contract test 通过）。

**验收**：
```powershell
cd app/desktop; corepack pnpm typecheck
cd app/desktop; corepack pnpm test -- hubClient
cd app/shared; corepack pnpm test -- hubClient
```

---

### Agent B: web-hubClient-switch（PR-4）

**职责**：Web 调用方全量切换到 shared `createHubClient`。

**文件范围（只改这些，不动其他）：**

- `app/web/src/api/hubClient.ts` -- thin re-export + surface-only 扩展
- `app/web/src/api/hubQueries.ts`
- `app/web/src/api/sessionQueries.ts`
- `app/web/src/api/agentTeamQueries.ts`
- `app/web/src/api/projectQueries.ts`
- `app/web/src/api/agentQueries.ts`
- `app/web/src/api/threadQueries.ts`
- `app/web/src/api/runQueries.ts`
- `app/web/src/api/transport.ts`
- `app/web/src/api/hubAuth.ts` -- 保留 surface auth glue
- `app/web/src/api/hubTokenStorage.ts` -- 保留 surface token glue
- `app/web/src/api/hubWS.ts` -- 保留 surface WS glue
- `app/web/src/*/` 中所有 import `../api/hubClient` 的调用点

**不碰**：`app/shared/`（除非 shared hubClient 方法补缺，需先与 Agent E 协调）、`app/desktop/`、`app/mobile-rn/`。

**前置**：PR-2 绿灯。可与 Agent A 完全并行（文件无交集）。

**验收**：
```powershell
cd app/web; corepack pnpm typecheck
cd app/web; corepack pnpm test -- hubClient
cd app/shared; corepack pnpm test -- hubClient
```

---

### Agent C: demo-gate-harden（PR-5）

**职责**：AH-SR-043 fail-closed 收紧 + demo seeds 不再为默认 export。

**文件范围（只改这些，不动其他）：**

- `app/shared/src/demo/dataMode.ts` -- 收紧 gate 逻辑
- `app/shared/src/demo/*` -- badge 相关
- `app/desktop/src/platform/desktopPlatform.ts` -- 拆 demo seeds export
- `app/web/src/platform/webPlatform.ts` -- 拆 demo seeds export
- `app/mobile-rn/src/platform/mobilePlatform.ts` -- fail-closed on hub error
- `testing/e2eDataModeContract.ts` -- 更新合同

**不碰**：hubClient、Settings、TeamRun、workbench shell、ConversationPort 数据流。

**前置**：PR-0/1 完成即可开始（不依赖 hubClient switch）。

**验收**：
```powershell
cd app/shared; corepack pnpm test -- dataMode
cd app/desktop; corepack pnpm test -- desktopPlatform
cd app/web; corepack pnpm test -- webPlatform
cd app/mobile-rn; corepack pnpm test
cd app/desktop; corepack pnpm typecheck
cd app/web; corepack pnpm typecheck
```

---

### Agent D: settings-orphan-cleanup（PR-7）

**职责**：消除三份 SettingsPage，恢复唯一 SSOT。

**文件范围（只改这些，不动其他）：**

- `app/shared/src/workbench/pages/SettingsPage.tsx` -- 只加 SectionId type export，不改 UI
- `app/desktop/src/components/SettingsPage.tsx` -- 删
- `app/desktop/src/components/settings/sections/*` -- 审计后迁 Edge 独有内容，其余删
- `app/web/src/components/SettingsPage.tsx` -- quarantine 后删
- `app/desktop/src/hooks/useTopMenuConfig.ts` -- SectionId 引用重定向
- `app/shared/src/platform/types.ts` -- SettingsPort 可能增项

**不碰**：hubClient、dataMode、TeamRun、ConversationPort、workbench shell 路由结构。

**前置**：PR-0 import-graph 证明 orphan 死链完成。

**验收**：
```powershell
cd app/shared; corepack pnpm test -- SettingsPage
cd app/desktop; corepack pnpm typecheck && corepack pnpm test
cd app/web; corepack pnpm typecheck && corepack pnpm test
```

---

### Agent E: shared-hubClient-owner（PR-2 持续维护 + cross-agent 协调）

**职责**：shared `hubClient.ts` 是唯一 SSOT；负责方法补齐、parity contract test、调用方问题答疑。

**文件范围（只改这些，不动其他）：**

- `app/shared/src/hubClient.ts` -- 权威 SSOT
- `app/shared/src/hubClient.test.ts` -- parity contract test
- `app/shared/src/hubClientTypes.ts` -- DTO export

**不碰**：任何 surface-local 调用方（那是 Agent A/B 的职责）。

**前置**：无（本 agent 产出是其他 agent 的前置）。

**验收**：
```powershell
cd app/shared; corepack pnpm test -- hubClient
```

---

### Agent F: teamrun-decision（PR-8）

**职责**：product owner 决策 + 根据决策执行。

**文件范围**（取决于决策）：

| 决策 | 文件 |
|---|---|
| archive | `app/desktop/src/views/TeamRunConsole.tsx` -- 删；`app/web/src/views/TeamRunConsole.tsx` -- 删；shared test 保留语义 |
| keep | `app/shared/src/workbench/teamrun/*` -- 新 view-model；`app/desktop/src/views/TeamRunConsole.tsx` -- 薄壳；`app/web/src/views/TeamRunConsole.tsx` -- 薄壳 |

**不碰**：hubClient（依赖 Agent E 的 shared SSOT）、Settings、dataMode gate。

**前置**：Product owner decision doc 完成。

**验收**：
```powershell
cd app/shared; corepack pnpm test -- teamRun
cd app/desktop; corepack pnpm typecheck
cd app/web; corepack pnpm typecheck
```

---

### 文件重叠检查矩阵

| | Agent A | Agent B | Agent C | Agent D | Agent E | Agent F |
|---|---|---|---|---|---|---|
| Agent A (desktop hub) | -- | 无重叠 | `desktopPlatform.ts` 由 C 独占 | 无重叠 | 不写 shared | 无重叠 |
| Agent B (web hub) | 无重叠 | -- | `webPlatform.ts` 由 C 独占 | 无重叠 | 不写 shared | 无重叠 |
| Agent C (demo gate) | `desktopPlatform.ts` | `webPlatform.ts` | -- | 无重叠 | 不写 shared | 无重叠 |
| Agent D (settings) | 无重叠 | 无重叠 | 无重叠 | -- | `SettingsPort` in types.ts 需协调 | 无重叠 |
| Agent E (shared SSOT) | 读 shared（只读） | 读 shared（只读） | 无重叠 | `platform/types.ts` 需协调 | -- | 无重叠 |
| Agent F (teamrun) | 无重叠 | 无重叠 | 无重叠 | 无重叠 | 读 shared hubClient | -- |

**协调规则**：
1. `desktopPlatform.ts` 同时出现在 Agent A 和 Agent C -> **Agent C 先改 demo seeds export**，Agent A 在 C merge 后基于新 baseline 改 hub callers。
2. `webPlatform.ts` 同理 -> **Agent C 先**，Agent B 后。
3. `platform/types.ts` 同时出现在 Agent D 和 Agent E -> **Agent E 先定 DTO**，Agent D 后加 SettingsPort 项。
4. 所有 agent 的共同只读依赖是 `app/shared/src/hubClient.ts`（Agent E 维护），使用方不得修改。

## 8. 与既有分析对齐

本计划对齐 frontend strangler 顺序（原 `_lane_digest.md` Frontend 段已删除；以本文件与 MASTER 为准）：
1. inventory orphans
2. hubClient SSOT
3. AH-SR-043 gates
4. platform contract honesty
5. 再处理 Settings/TeamRun forks

## 9. 路径速查（仓库相对路径）

- `app/shared/src/hubClient.ts`
- `app/desktop/src/api/hubClient.ts`
- `app/web/src/api/hubClient.ts`
- `app/shared/src/workbench/pages/SettingsPage.tsx`
- `app/desktop/src/components/SettingsPage.tsx`
- `app/web/src/components/SettingsPage.tsx`
- `app/desktop/src/views/TeamRunConsole.tsx`
- `app/web/src/views/TeamRunConsole.tsx`
- `app/shared/src/platform/types.ts`
- `app/desktop/src/platform/desktopPlatform.ts`
- `app/web/src/platform/webPlatform.ts`
- `app/shared/src/demo/dataMode.ts`
- `docs/governance/security-risk-register.md` (AH-SR-043)
- `docs/progress/MASTER.md` (live progress)
