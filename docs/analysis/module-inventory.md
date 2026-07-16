# AgentHub Module Inventory

> last-updated: 2026-07-16  
> purpose: per-module inventory for cleanup prioritization  
> companion: `project-overview.md`, `risk-assessment.md`, `cleanup-strategy.md`

## Legend

| 字段 | 含义 |
|---|---|
| **Complexity** | L / M / H / VH（体量 + 耦合 + 变更风险） |
| **Cleanup priority** | P0 / P1 / P2 / P3（对本轮 strangler 的先后） |
| **Role** | 产品职责摘要 |
| **Hotspots** | 优先拆/对齐的路径 |
| **Do not** | 清理红线 |

---

## 1. Control & execution backends

### 1.1 Hub Server (`hub-server/`)

| | |
|---|---|
| **Role** | 控制平面：OIDC RP → Hub-local JWT session、IM/sync、agent dispatch、TeamRun、审计、WS fanout |
| **Entry** | `hub-server/cmd/server-hub/main.go` → config / PG / Redis / `app.Run` |
| **Layering** | `app → router → handler → service → repository/model` + `middleware` / `ws` / `cache` |
| **Complexity** | **VH**（~66k LOC-ish；flat service ~12k prod lines / 41 files） |
| **Cleanup priority** | **P0**（outbox 接线 + AgentService 拆分）→ P1 领域包抽取 |
| **S.U.P.E.R (summary)** | single-purpose 强；单向大多成立；ports 强；env-agnostic 中；replaceable 中 |
| **Hotspots** | `internal/service/agent_dispatch.go`；`delivery_outbox.go`；flat `internal/service`；`router/router.go`；`message.go`；`agent_run_event.go` |
| **Strengths** | handler 多数依赖 service interface；model 叶子干净；migrations 至 0055 可演进；auth 边界（OIDC 只换身份，产品 API 要 Hub session）与代码一致 |
| **Debt** | AgentService 集中 dispatch/outbox/run-events/edge-callback；`StartDeliveryRetryLoop` **未接入** `app` 启动；repository 风格双轨；OpenAPI 双 surface 路径漂移 |
| **Do not** | 不要把 membership 塞进 JWT；不要在未完成 durable/device proof 前放开 remote/hub_relay 产品路径 |

子包速查：

| 子模块 | Complexity | Priority | 备注 |
|---|---|---|---|
| `internal/app` | M | P1 | composition root；events fanout 与 domain 反应略混 |
| `internal/router` | M–H | P1 | SetupRoutes 巨参函数；宜按 public/client/web/edge/cloud 拆 |
| `internal/handler` | M | P1 | 方向正确；health 直连 gorm 是例外 |
| `internal/service` (flat) | **VH** | **P0–P1** | 主 strangler 战场 |
| `internal/service/agentteam` | H | P1 | 已有最佳领域抽取范本；仍耦合 parent Bus/AgentService |
| `internal/repository` | M | P1 | 函数式 vs struct 双风格；outbox 模型仍在 service |
| `internal/model` | L–M | P2 | 干净；`agent_team.go` 过大可按类型切 |
| `internal/middleware` | L–M | P2 | Auth/RequireHubSession 清晰 |
| `internal/ws` | M | P2 | frame 所有者明确 |
| `internal/cache` | M–H | P2 | Client 多域 Redis 门面 |
| `migrations` | M | P2 | 增量历史好，outbox/agent team 已在 |

### 1.2 Edge Server (`edge-server/`)

| | |
|---|---|
| **Role** | 本地执行权威：ProcessExecutor + AdapterRegistry + store + events |
| **Entry** | `edge-server/cmd/agenthub-edge`（默认 `127.0.0.1:3210`） |
| **Runtime model** | `AgentAdapter`（BuildCommand / ParseStream / NeedsStdin / Available）；**不是** `internal/runners` |
| **Complexity** | **VH**（~76k；handlers ~2374，process_executor ~2279） |
| **Cleanup priority** | **P0**（capability / callback seams）→ P1 god-file 拆分 |
| **S.U.P.E.R** | 执行职责强；lifecycle 单目的弱（混 callback/spawn）；adapter ports 强；runners 高可替换 |
| **Hotspots** | `internal/api/handlers.go`；`lifecycle/process_executor.go`；`hub/callback.go`；`jwtutil/capability.go`；`store/store.go`；`adapters/orchestrator.go` |
| **Strengths** | CLI/SDK adapter 可替换；EventBus 本地 cursor 重放；memory+sqlite store 双实现 |
| **Debt** | AH-SR-046 半成品；AH-SR-049 Edge→Hub fire-and-forget；AH-SR-045 remote read 偏软；orchestrator 放在 adapters 包破坏边界 |
| **Do not** | 不要把 execution center 迁回 `runners`；不要在无 outbox 前继续堆 callback 载荷 |

子包速查：

| 子模块 | Complexity | Priority | 备注 |
|---|---|---|---|
| `adapters` (CLI/SDK) | H | P1 | 保留 claude/codex/opencode/sdk；迁出 orchestrator |
| `lifecycle` | **VH** | **P0** | 保留 Start/Cancel 状态机；抽出 CallbackReporter / SubAgentSpawner / output pipeline |
| `api.Handler` | **VH** | **P0–P1** | 按 runs/threads/events/agents/approvals/health 拆文件，路径不变 |
| `hub.CallbackClient` | L–M | **P0** | 最佳 effort → durable outbox/journal 端口 |
| `events.Bus` | M | P2 | 本地 WS 恢复 ≠ Hub 投递合同 |
| `store` | H | P2 | 已有 Repository 接口；按 domain 切 |
| `runners` | L | P2 | 兼容摘要；可改由 AdapterRegistry 投影 |
| `jwtutil` | L | **P0** | 扩展 capability claims + purpose 强制 |
| `httpserver` | M | P1 | CORS 补 capability header；auth 保持 identity-only |

### 1.3 Shared Go packages (`pkg/`)

| | |
|---|---|
| **Role** | 跨模块小工具：`errcode`, `reqlog`, `debug` |
| **Complexity** | L |
| **Cleanup priority** | P3 |
| **Do not** | 不要把 domain 逻辑下沉到这里 |

### 1.4 API contract (`api/`)

| | |
|---|---|
| **Role** | REST/WS 约定与 OpenAPI SSOT 意图 |
| **Complexity** | H（`openapi.yaml` ~7.5k lines / ~197 paths / ~232KB） |
| **Cleanup priority** | P1 |
| **Hotspots** | `openapi.yaml` 混 Edge `/v1` + Hub `/client|/web|/edge`；ghost deprecated paths；`deprecations.md` 落后（2026-06-05） |
| **Do not** | 不以 OpenAPI 覆盖 runtime router；router 是路径运行时 SSOT |

---

## 2. Frontend surfaces

### 2.1 Shared platform & workbench (`app/shared/`)

| | |
|---|---|
| **Role** | workbench / transcript / composer / inspector / platform / demo 合同 |
| **Complexity** | **VH**（~60k；Workbench 1768 + test 2987；Routes 1404） |
| **Cleanup priority** | **P0**（hubClient SSOT + dataMode 门禁）→ P1 分解巨文件 |
| **S.U.P.E.R** | platform/transcript 强；workbench 多关注点；hubClient 未成为 Desktop/Web SSOT |
| **Hotspots** | `hubClient.ts`；`demo/dataMode.ts`；`workbench/AgentHubWorkbench.tsx`；`WorkbenchRoutes.tsx`；`workbenchDataMode.ts`（旧词汇） |
| **Strengths** | `AgentHubPlatform` surface/capabilities 清晰；transcript 多源归一健康；Desktop/Web 已挂共享 workbench |
| **Debt** | ConversationPort.list 非产品会话真相；demo 被 platform 默认导入；双 dataMode 词汇 |
| **Do not** | 清理期不要重写 transcript pipeline；不要把 product UI 迁回 surface-local forks |

子域：

| 子域 | Complexity | Priority | 备注 |
|---|---|---|---|
| `platform/` | M | P0 对齐 | contract 小而清晰；真实数据常在 model hooks |
| `transcript/` | H | P1 保护 | 高覆盖；只加必要 filter/parity tests |
| `chatview/` | H | P2 | adapter 测试巨大；先按 concern 拆测试 |
| `workbench/` | **VH** | P1 | 继续 ConversationHost 式抽取 |
| `hubClient` + stores | H | **P0** | 目标 SSOT |
| `demo/` | M | **P0** 门禁 | AH-SR-043 |

### 2.2 Desktop (`app/desktop/` + Tauri)

| | |
|---|---|
| **Role** | shell + Desktop adapter + Local Edge host/sidecar + keyring/tray |
| **Complexity** | H（~51k + native） |
| **Cleanup priority** | **P0** hubClient 收敛 / demo 默认值；P1 orphan UI |
| **Hotspots** | `src/api/hubClient.ts`（~1854）；`platform/desktopPlatform.ts`；orphan `components/SettingsPage.tsx` + `settings/sections/*`；orphan `views/TeamRunConsole.tsx`；`src-tauri/gen/` 脏树 |
| **Strengths** | `localEdge:true`；renderer 不 raw spawn；host diagnostics 扩展共享合同 |
| **Debt** | demo conversations 默认；Settings/TeamRun 分叉；gen/android 政策债 |
| **Do not** | 删除 Edge host 能力；不要恢复 Tauri Mobile 主线 |

### 2.3 Web (`app/web/`)

| | |
|---|---|
| **Role** | Hub-only remote workbench |
| **Complexity** | H（~27k；SettingsPage orphan ~2386 单独） |
| **Cleanup priority** | **P0** hubClient + AH-SR-037/043；P1 orphan 清理 |
| **Hotspots** | `api/hubClient.ts`；`api/hubTokenStorage.ts`（sessionStorage）；`platform/webPlatform.ts`；orphan `components/SettingsPage.tsx`；orphan `views/TeamRunConsole.tsx` |
| **Strengths** | `localEdge:false` / `localFiles:false`；thin `App.tsx` + shared workbench |
| **Debt** | sessionStorage 会话；optimistic mutation 逻辑过重塞进 adapter；Settings 巨 orphan |
| **Do not** | 给 Web 加 Local Edge 直连 |

### 2.4 Mobile RN (`app/mobile-rn/`)

| | |
|---|---|
| **Role** | Hub-facing Expo RN；UI 深度非当前主线 |
| **Complexity** | M |
| **Cleanup priority** | P1 fail-closed fixture；P2 边界保持 |
| **Hotspots** | `platform/mobilePlatform.ts`（hub 失败静默 fixture） |
| **Strengths** | import boundary 测试；复用 shared hubClient |
| **Do not** | 本轮不要强上 shared workbench 全 UI |

### 2.5 Legacy Mobile Tauri (`app/mobile/`)

| | |
|---|---|
| **Role** | **非主线残渣** |
| **Complexity** | L（~9M local；常 ignored） |
| **Cleanup priority** | P1 inventory → archive/delete |
| **Do not** | 不要当作 dual-mobile 架构继续演进 |

---

## 3. Deploy, CI, scripts, docs, research

### 3.1 Deploy / Ops narrative

| 资产 | Complexity | Priority | 说明 |
|---|---|---|---|
| `deployments/production/docker-compose.yml` | M | **P0–P1** | 最接近 hk3；默认 `PG_USER=tdadmin` 需对齐 `agenthub` |
| `.github/workflows/cd-hub-server.yml` | L | P1 | 镜像 `agenthub-hub-server` |
| `.github/workflows/cd-production.yml` | M | **P0–P1** | `IMAGE_NAME=.../agenthub-hub`；deploy 多为 echo/docs |
| `hub-server/deployments/docker-compose.prod.yml` (+ hk2/us1) | M | P1 | 本地 PG 历史形态；应降级 non-authoritative |
| server `STATE.md` | L | **P0** | LIVE 权威；验证命令需去 hk2/us1 残留 |

### 3.2 CI (`.github/workflows/checks.yml`)

| | |
|---|---|
| **Complexity** | M |
| **Priority** | **P0** 叙事 / P1 policy 文档 |
| **Debt** | S1 decommissioned 注释；mobile/e2e/benchmark 仅 `workflow_dispatch`；引用缺失的 `docs/architecture/github-actions-ci-cd-policy.md`（server 侧 policy 亦滞后） |
| **Do not** | 不要在未写明证据等级前把所有 heavy gate 一键全开 |

### 3.3 Scripts (`scripts/`)

| | |
|---|---|
| **Taxonomy** | `verify` / `dev` / `release` / `smoke` / `lib` —— **保持** |
| **Complexity** | H（重叠 readiness 矩阵；大量 ps1/sh） |
| **Priority** | P1 smoke matrix 收敛 |
| **Hotspots** | `scripts/smoke/*` 多条 400–900 LOC 近重复；`integration-e2e.ps1` 已自标 deprecated |
| **Do not** | 新增 root wrapper |

### 3.4 Docs / governance SSOT

| 资产 | Priority | 说明 |
|---|---|---|
| `AGENTS.md` | keep | 唯一根规则；MASTER 缺失时措辞需容忍 “if present” |
| `docs/roadmap.md` | keep | 当前无 active SPEC |
| `docs/progress/MASTER.md` | **P1** | 有意缺失；需 stub 或 AGENTS 改写 |
| `docs/governance/*` | P0 状态刷新 | risk register 落后于 partial 046/049 代码 |
| `.agenthub/memory/project.md` | **P0** | 过期本地 memory（SUPER/MASTER/CLAUDE.md）；gitignored |
| `docs/history.md` + TokenDanceLab archive | keep | 历史/ADR 外置归档 |

### 3.5 Research (`reference/`)

| | |
|---|---|
| **Role** | 第三方研究克隆工作区 |
| **Complexity** | disk H / 管理 L |
| **Priority** | P2 INDEX 刷新 + 剪枝 |
| **Rule** | 仅 `INDEX.md` 入仓；非产品 SSOT |

### 3.6 Local hygiene artifacts

| 路径 | Priority | 说明 |
|---|---|---|
| `hub-server/server-hub` | **P0** | tracked ELF ~47MB；应移除并补 `.gitignore` |
| `app/desktop/src-tauri/gen/` | **P0** | 31 deleted tracked android/schema 脏树 |
| `.worktrees/` | P1 | ~5.6G 本地 |
| `dist/`, `tmp/`, `*/.tmp/` | P2 | ignored 构建/草稿 |
| `app/mobile/` leftover | P2 | 本地残渣 |

---

## 4. Cross-cutting product domains

| Domain | Owner modules | Maturity | Cleanup note |
|---|---|---|---|
| Auth / session | Hub middleware + OIDC service；Web/Desktop token storage | 边界正确；Web storage 风险 | AH-SR-037 决策；JWT 文档去 membership overclaim |
| Local dispatch | Hub `agent_dispatch` + Edge PostRuns | **local_edge-first** 产品化 | 保持 validate 硬闸；hub_relay 分支标 incomplete |
| Remote/relay | Hub relay + Edge remote auth | **incomplete** | 先 capability + durable delivery，再谈产品路径 |
| TeamRun | Hub `agentteam` + hubClient APIs；UI orphan | 后端产品模型真；专用 console UI 未挂载 | 先定 UI owner 再合并 forks |
| Transcript | shared transcript/chatview | 健康 | 清理期保护 |
| Settings | shared SettingsPage + SettingsPort | UI SSOT = shared；desktop/web page orphan | adapter 非 orphan |
| Runners inventory | Edge runners + Desktop hooks | 兼容面 | 响应 shape 保留，数据源改 adapters |
| Delivery | Hub outbox + Edge callback | partial | 接线 retry + Edge journal |

---

## 5. Complexity × priority matrix（执行视图）

| Priority | Modules / assets |
|---|---|
| **P0** | Prod narrative SSOT；image name；tracked binary + gen dirty tree；stale agent memory；Hub outbox wire；AgentService dispatch strangler start；Edge capability complete + callback outbox seam；hubClient SSOT；AH-SR-043/037/045/046 门禁决策或接线；risk register partial 状态 |
| **P1** | Router/OpenAPI path audit；service domain packages（agentteam 模式）；handlers/process_executor/store 拆分；orphan Settings/TeamRun 决策；CI policy doc；smoke matrix；deploy template demotion；MASTER stub；STATE 验证命令 |
| **P2** | runners 重源；response envelope 收敛计划；test mega-file hygiene；reference INDEX；legacy workbenchDataMode；local disk reclaim；mechanical god-file continues |
| **P3** | `pkg/*` 微调；纯文档措辞；非关键 UI polish |

---

## 6. Inventory rules for cleanup agents

1. **先读 import graph / 运行时挂载**，再删 fork（Settings / TeamRun / app/mobile 尤甚）。
2. **平台边界是硬约束**：Web/Mobile 无 Local Edge；Desktop renderer 无 raw CLI。
3. **兼容响应 shape 可保留**（`/v1/runners`、Hub envelope），但数据源与文档语言要迁到 Runtime/Profile/Target。
4. **测试与脚本按证据等级使用**：`go test -short` / unit ≠ real OIDC browser / Desktop reconnect。
5. **生产事实以 server STATE Current Role 为准**，不以 checks.yml 页眉为准。
