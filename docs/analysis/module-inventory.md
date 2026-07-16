# AgentHub 模块清单（Cleanup Baseline）

> last-updated: 2026-07-16
> purpose: per-module inventory for strangler prioritization
> companion: `project-overview.md`, `risk-assessment.md`, `cleanup-strategy.md`

规模来自 cleanup-baseline worktree 扫描（`.go/.ts/.tsx/.rs/.css`，排除 `node_modules/dist/target` 等），**约数**。测试判定基于 `*_test.go` / `*.test.ts(x)` / `e2e|tests` 启发式。

## Legend

| 字段 | 含义 |
|---|---|
| **Files / Lines** | 生产文件数 / 生产 LOC（估）；测试另列 |
| **Complexity** | L / M / H / VH |
| **Priority** | P0 / P1 / P2 / P3（本轮 strangler） |
| **S.U.P.E.R** | `S` 单职责 · `U` 单向 · `P` 端口 · `E` 环境无关 · `R` 可替换；灯号 🟢🟡🔴 |

---

## 总表

| 模块 | 路径 | Files（prod估） | Lines prod / test | Complexity | S.U.P.E.R | Priority | Role |
|---|---|---:|---:|---|---|---|---|
| Hub Server | `hub-server/` | ~156 | ~29k / ~46k | VH | S🟢 U🟢 P🟡 E🟡 R🟡 | P0–P1 | 控制面 |
| Hub service | `hub-server/internal/service/` | ~41 | ~12.1k / ~14.1k | VH | S🔴 U🟢 P🟡 E🟡 R🟡 | **P0** | 绞杀核心 |
| Hub handler | `hub-server/internal/handler/` | ~27 | ~5.8k / ~10.5k | H | S🟢 U🟢 P🟢 E🟢 R🟢 | P1 | 保持薄 |
| Hub ws | `hub-server/internal/ws/` | ~2 | ~0.5k / ~1.1k | M | S🟢 U🟢 P🟡 E🟢 R🟡 | P2 | WS frame owner |
| Hub repository | `hub-server/internal/repository/` | ~25 | ~3.0k / ~3.3k | M | S🟢 U🟢 P🟡 E🟡 R🟡 | P1 | 统一风格 |
| Edge Server | `edge-server/` | ~86 | ~33k / ~47k | VH | S🟡 U🟡 P🟡 E🟡 R🟡 | P0–P1 | 执行面 |
| Edge adapters | `edge-server/internal/adapters/` | ~30 | ~12.0k / ~15.8k | VH | S🟡 U🟡 P🟢 E🟡 R🟢 | P1 | CLI/SDK；迁出 orchestrator |
| Edge lifecycle | `edge-server/internal/lifecycle/` | ~14 | ~4.9k / ~6.4k | VH | S🔴 U🔴 P🟡 E🟡 R🔴 | **P0** | ProcessExecutor god-object |
| Edge api | `edge-server/internal/api/` | ~5 | ~3.9k / ~4.5k | VH | S🔴 U🔴 P🟡 E🟡 R🔴 | **P0** | handlers ~2375 |
| Edge store | `edge-server/internal/store/` | ~7 | ~4.4k / ~5.1k | H | S🟡 U🟢 P🟡 E🟢 R🟡 | P2 | memory+sqlite |
| Edge hub-callback | `edge-server/internal/hub/` | ~3 | ~1.1k all | M | S🟢 U🟢 P🔴 E🟢 R🟡 | **P0** | AH-SR-049 关键 |
| Shared frontend | `app/shared/` | ~272 | ~62k / ~17k | VH | S🟢 U🟢 P🟢 E🟢 R🟡 | P0–P1 | cleanup 支点 |
| Shared workbench | `app/shared/src/workbench/` | 巨文件 | Workbench~1768 + test~2987 | VH | S🟡 U🟡 P🟡 E🟢 R🔴 | P1 | 继续拆 |
| Shared transcript | `app/shared/src/transcript/` | — | 高覆盖 | H | S🟢 U🟢 P🟢 E🟢 R🟢 | P1 保护 | 勿重写 pipeline |
| Shared platform | `app/shared/src/platform/` | — | 小而清晰 | M | S🟢 U🟢 P🟢 E🟢 R🟢 | P0 对齐 | ports 合同 |
| Desktop | `app/desktop/` | ~290 | ~54k / ~16k | VH | S🟡 U🟡 P🟡 E🔴 R🟡 | P0–P1 | shell + Local Edge |
| Web | `app/web/` | ~124 | ~26k / ~8k | H | S🟡 U🟡 P🟡 E🟢 R🟡 | P0–P1 | Hub-only |
| Mobile RN | `app/mobile-rn/` | ~51 | ~12k / ~7k | M | S🟡 U🟢 P🟡 E🟡 R🟡 | P1–P2 | **boundary only** |
| API contracts | `api/` | ~5 | openapi~7.5k | H | S🟢 U— P🟢 E🟢 R🟢 | P1 | REST/WS SSOT |
| Scripts/verify | `scripts/` | ~63 ps1 | ~18k | H | S🟡 U— P🟡 E🟡 R🟡 | P1 | readiness 分层 |
| pkg | `pkg/` | ~9 | ~1.2k | L | S🟢 U🟢 P🟢 E🟢 R🟢 | P3 | 小工具 |
| Deploy/CI narrative | `deployments/` + `.github/workflows/` | 多模板 | — | H 治理 | S🔴 U🔴 P🔴 E🟡 R🟢 | **P0** | LIVE 对齐 |
| reference | `reference/` | INDEX only | 本机~3.7G clones | 卫生 | S🟡 — — — — | P2 本机 | 非 SSOT |
| worktrees | `.worktrees/` | 本地 | ~4.6G | 卫生 | — | 持续 | 任务后删 |

---

## 1. Hub Server

### 1.1 总览

| | |
|---|---|
| **Role** | 控制平面：OIDC RP → Hub-local JWT session、IM/sync、agent dispatch、TeamRun、审计、WS fanout |
| **Entry** | `hub-server/cmd/server-hub/main.go` → config / PG / Redis / `app.Run` |
| **Layering** | `app → router → handler → service → repository/model` + `middleware` / `ws` / `cache` |
| **Complexity** | VH（flat service ~12k prod / 41 files） |
| **Priority** | **P0** outbox 接线 + AgentService 拆分 → P1 领域包 |
| **S.U.P.E.R** | S🟢 U🟢 P🟡 E🟡 R🟡 |
| **Hotspots** | `service/agent_dispatch.go`（~781）；`delivery_outbox.go`；flat `service`；`router/router.go`；`message.go`（~860）；`agent_run_event.go`（~694） |
| **Strengths** | handler 多依赖 service interface；auth 边界与文档一致（OIDC 身份，产品 API 要 Hub session）；migrations 可演进 |
| **Debt** | AgentService 集中 dispatch/outbox/run-events/edge-callback；`StartDeliveryRetryLoop` **未接入** app 启动；repository 风格双轨；OpenAPI 路径漂移 |
| **Do not** | membership 塞进 JWT；未完成 durable/device proof 前放开 remote/hub_relay 产品路径 |

### 1.2 子模块

| 子模块 | Complexity | Priority | S.U.P.E.R | 备注 |
|---|---|---|---|---|
| `internal/app` | M | P1 | S🟡 U🟢 P🟡 E🟡 R🟡 | composition root；需接 outbox retry |
| `internal/router` | M–H | P1 | S🟡 U🟢 P🔴 E🟢 R🟡 | SetupRoutes 巨参；按 public/client/web/edge/admin 拆 |
| `internal/handler` | M | P1 | S🟢 U🟢 P🟢 E🟢 R🟢 | 方向正确 |
| `internal/service` (flat) | **VH** | **P0–P1** | S🔴 U🟢 P🟡 E🟡 R🟡 | 主 strangler 战场 |
| `internal/service/agentteam` | H | P1 | S🟢 U🟡 P🟢 E🟢 R🟡 | 领域抽取范本 |
| `internal/repository` | M | P1 | S🟢 U🟢 P🟡 E🟡 R🟡 | struct vs pure func |
| `internal/model` | L–M | P2 | S🟢 U🟢 P— E🟢 R🟢 | 叶子干净 |
| `internal/middleware` | L–M | P2 | S🟢 U🟢 P🟡 E🟡 R🟢 | Auth/RequireHubSession |
| `internal/ws` | M | P2 | S🟢 U🟢 P🟡 E🟢 R🟡 | frame 所有者明确 |
| `internal/cache` | M–H | P2 | S🟡 U🟢 P🟡 E🟡 R🟡 | 多域 Redis 门面 |

### 1.3 Dispatch / Outbox 成熟度

- `validateDispatchTarget` **仅允许 `local_edge`**；`hub_relay` 残码 ≠ 产品完成。
- Delivery outbox：migration + service 方法 + 测试存在；`RecordDelivery` 在 dispatch 路径；**自动 retry 可能未运行**。
- 与 AH-SR-049 PARTIAL 一致。

---

## 2. Edge Server

### 2.1 总览

| | |
|---|---|
| **Role** | 本地执行权威：ProcessExecutor + AdapterRegistry + store + events |
| **Entry** | `edge-server/cmd/agenthub-edge`（默认 `127.0.0.1:3210`） |
| **Runtime model** | `AgentAdapter`（BuildCommand / ParseStream / NeedsStdin / Available）；**不是** `internal/runners` |
| **Complexity** | VH（handlers ~2375，process_executor ~2280） |
| **Priority** | **P0** capability / callback seams → P1 god-file 拆 |
| **S.U.P.E.R** | S🟡 U🟡 P🟡 E🟡 R🟡（adapters 可替换高；lifecycle 低） |
| **Hotspots** | `api/handlers.go`；`lifecycle/process_executor.go`；`hub/callback.go`；`jwtutil/capability.go`；`store/store.go`；`adapters/orchestrator.go` |
| **Strengths** | CLI/SDK 可替换；EventBus 本地 cursor；memory+sqlite 双实现 |
| **Debt** | AH-SR-046 PARTIAL；AH-SR-049 best-effort callback；AH-SR-045 owner filter 偏软；orchestrator 污染 adapters |
| **Do not** | 执行中心迁回 `runners`；无 outbox 前堆 callback 载荷 |

### 2.2 子模块

| 子模块 | Complexity | Priority | S.U.P.E.R | 备注 |
|---|---|---|---|---|
| `adapters` CLI/SDK | H | P1 | S🟡 U🟡 P🟢 E🟡 R🟢 | claude/codex/opencode/sdk；迁出 orchestrator |
| `lifecycle` | **VH** | **P0** | S🔴 U🔴 P🟡 E🟡 R🔴 | 抽 CallbackReporter / SubAgentSpawner / output |
| `api.Handler` | **VH** | **P0–P1** | S🔴 U🔴 P🟡 E🟡 R🔴 | 按 runs/threads/events/agents/approvals/health 拆，路径不变 |
| `hub.CallbackClient` | L–M | **P0** | S🟢 U🟢 P🔴 E🟢 R🟡 | fire-and-forget → journal 端口 |
| `events.Bus` | M | P2 | S🟢 U🟢 P🟡 E🟢 R🟡 | 本地恢复 ≠ Hub 投递合同 |
| `store` | H | P2 | S🟡 U🟢 P🟡 E🟢 R🟡 | 域接口渐进；保留 Repository 外观 |
| `runners` | L | P2 | S🟢 U🟢 P🟡 E🟢 R🟢 | 兼容摘要；可 AdapterRegistry 投影 |
| `jwtutil` | L | **P0** | S🟢 U🟢 P🟡 E🟢 R🟢 | 扩展 claims + purpose 强制 |
| `httpserver` | M | P1 | S🟡 U🟢 P🟡 E🟡 R🟡 | CORS 补 capability header |

### 2.3 Adapter 家族

| ID | 形态 |
|---|---|
| `claude-code` | CLI NDJSON / stream-json |
| `codex` | CLI JSONL |
| `opencode` | CLI JSON |
| `anthropic-sdk` / `openai-sdk` | HTTP in ParseStream |
| Orchestrator | 包装 ClaudeCode + SubAgentSpawn（应迁出 adapters） |

---

## 3. Shared frontend / Desktop / Web / Mobile

### 3.1 Shared（`app/shared/`）

| | |
|---|---|
| **Role** | workbench / transcript / composer / inspector / platform / demo 合同 |
| **Complexity** | VH |
| **Priority** | **P0** hubClient SSOT + dataMode 门禁 → P1 巨文件分解 |
| **S.U.P.E.R** | S🟢 U🟢 P🟢 E🟢 R🟡（workbench/hubClient 拉低 R） |
| **Hotspots** | `hubClient.ts`~1533；`demo/dataMode.ts`；`AgentHubWorkbench.tsx`~1768；`WorkbenchRoutes.tsx`~1404；`workbenchDataMode.ts` 旧词表 |
| **Do not** | 清理期重写 transcript；product UI 迁回 surface-local forks |

| 子域 | Complexity | Priority | S.U.P.E.R | 备注 |
|---|---|---|---|---|
| `platform/` | M | P0 对齐 | S🟢 U🟢 P🟢 E🟢 R🟢 | ConversationPort.list 未承载真实会话 |
| `transcript/` | H | P1 保护 | S🟢 U🟢 P🟢 E🟢 R🟢 | 多源归一 |
| `chatview/` | H | P2 | S🟢 U🟢 P🟢 E🟢 R🟡 | 测试巨大但健康 |
| `workbench/` | VH | P1 | S🟡 U🟡 P🟡 E🟢 R🔴 | ConversationHost 式继续抽 |
| `hubClient` + stores | H | **P0** | S🟡 U🟡 P🔴 E🟢 R🔴 | 目标 SSOT |
| `demo/` | M | **P0** | S🟢 U🟢 P🟡 E🟡 R🟡 | AH-SR-043 |

### 3.2 Desktop（`app/desktop/` + Tauri）

| | |
|---|---|
| **Role** | shell + adapter + Local Edge host/sidecar + keyring/tray |
| **Complexity** | H–VH（~54k + native） |
| **Priority** | **P0** hubClient / demo 默认；P1 orphan UI |
| **S.U.P.E.R** | S🟡 U🟡 P🟡 E🔴 R🟡 |
| **Hotspots** | `api/hubClient.ts`~1854；`platform/desktopPlatform.ts`；orphan Settings / TeamRun；`src-tauri/gen` 脏树策略 |
| **Do not** | 删除 Edge host；恢复 Tauri Mobile 主线 |

### 3.3 Web（`app/web/`）

| | |
|---|---|
| **Role** | Hub-only remote workbench |
| **Complexity** | H（~26k；orphan Settings~2386） |
| **Priority** | **P0** hubClient + AH-SR-037/043；P1 orphan |
| **S.U.P.E.R** | S🟡 U🟡 P🟡 E🟢 R🟡（sessionStorage 安全维 🔴） |
| **Hotspots** | `api/hubClient.ts`~1705；`api/hubTokenStorage.ts`；`platform/webPlatform.ts`；orphan Settings / TeamRun |
| **Do not** | 给 Web 加 Local Edge 直连 |

### 3.4 Mobile RN（`app/mobile-rn/`）— boundary only

| | |
|---|---|
| **Role** | Hub-facing Expo RN；UI 深度非主线 |
| **Complexity** | M |
| **Priority** | P1 fail-closed fixture；P2 边界保持 |
| **S.U.P.E.R** | S🟡 U🟢 P🟡 E🟡 R🟡 |
| **Hotspots** | `platform/mobilePlatform.ts`（失败静默 fixture） |
| **Do not** | 本轮强上 shared workbench 全 UI；不恢复旧 Tauri Mobile |

### 3.5 前端分叉速查

| 项 | 路径 | 问题 |
|---|---|---|
| 三份 hubClient | shared / desktop / web | 类型与方法集漂移 |
| Settings 孤儿 | desktop/web 本地 SettingsPage | live UI = shared SettingsPage |
| TeamRunConsole | desktop/web views | 基本无产品 importer |
| 双 dataMode | `demo/dataMode.ts` vs `workbenchDataMode.ts` | 语义漂移 |

---

## 4. API contracts（`api/`）

| | |
|---|---|
| **Role** | REST/WS 约定与 OpenAPI SSOT 意图 |
| **Complexity** | H（`openapi.yaml` ~7.5k / ~197 paths） |
| **Priority** | P1 |
| **S.U.P.E.R** | S🟢 U— P🟢 E🟢 R🟢 |
| **Hotspots** | 混 Edge `/v1` + Hub `/client|/web|/edge`；ghost deprecated paths；`deprecations.md` 滞后 |
| **Do not** | 以 OpenAPI 覆盖 runtime router；router 是路径运行时 SSOT |
| **兼容债** | Hub `{code:OK,data}` vs Edge bare JSON — 禁止 big-bang 同时改 |

---

## 5. Scripts / verify

| 目录 | 约计数 | 用途 | 原则 |
|---|---:|---|---|
| `scripts/verify/` | ~29 | doc-ssot、CI gates、boundary、OIDC readiness | 保留有保护力的；标 readiness |
| `scripts/smoke/` | ~25 | 烟测 / 形状 | 不得冒充 approved-real |
| `scripts/release/` | ~11 | 发布门禁 | 对齐 risk register |
| `scripts/dev/` + `lib/` | 少 | 开发 / 复用 | 禁止根级 wrapper |
| 全仓 ps1 | ~63 | — | 主会话“~80 家族”含体感与历史 |

**S.U.P.E.R：** S🟡 U— P🟡 E🟡 R🟡

---

## 6. 卫生与外围

| 表面 | 规模 | Priority | 处理 |
|---|---|---|---|
| `reference/` | ~3.7G ignored | P2 本机 | 只跟踪 INDEX；研究克隆非依赖 |
| `.worktrees/` | ~4.6G | 持续 | 合并后删 |
| dirty main noise | android gen / `server-hub` binary | P0 hygiene | ignore + 不提交噪声 |
| Deploy templates | 多 SSOT | P0–P1 | `deployments/production` + STATE 权威 |

---

## 7. 建议切割顺序（模块视角）

1. Deploy/CI 叙事 + security register partial 校准
2. Edge capability + callback outbox 端口
3. Hub Dispatch/RunEvent/Callback 绞杀 + retry 接线
4. Frontend hubClient SSOT + 孤儿删除 + AH-SR-043
5. Edge handlers / ProcessExecutor / store 域拆
6. scripts readiness 分层、reference/worktree 卫生
7. Mobile boundary；envelope / runners 退役靠后

详见 `cleanup-strategy.md`。
