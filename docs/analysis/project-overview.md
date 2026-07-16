# AgentHub Project Overview

> last-updated: 2026-07-16  
> scope: cleanup baseline synthesis (Architecture / Hub / Edge / Frontend / Debt / Governance)  
> authority: synthesis of discovery lanes + verified contradictions; not a replacement for AGENTS.md / architecture.md / server STATE

## 1. 产品定位

AgentHub 是 TokenDance 生态内的 **Hub / Edge 双平面 Agent 工作台**：

| 平面 | 职责 | 主要目录 |
|---|---|---|
| **Hub** | 身份会话、IM/同步、路由、审计、TeamRun 协作、设备路由 | `hub-server/` |
| **Edge** | 本地执行权威：lifecycle、adapters、EventStore、workspace | `edge-server/` |
| **Workbench UI** | Desktop / Web / Mobile 共享 transcript + workbench 合同 | `app/shared/` + surface shells |

核心产品事实：

1. **Hub 不直接启动 CLI**；本地执行只发生在 Edge（Desktop 可托管 Local Edge）。
2. **Web / Mobile 不能使用 Local Edge**；仅 Desktop 具备 `capabilities.localEdge: true`。
3. **主协议是 REST JSON + typed WS events**；Protobuf / Connect-RPC / JSON-RPC 仅历史遗留。
4. **生产已在 2026-07-15 于 hk3 恢复 LIVE**（container `agenthub-hub`，health `127.0.0.1:8090`，Azure PG role `agenthub`）。  
   **禁止把生产描述为 offline / permanently decommissioned。**  
   CI 与部分 policy 文档仍保留 “decommissioned runtime” 节流叙述，这是 **叙事漂移**，不是运行时真相。

## 2. 仓库结构与规模（约数）

| 区域 | 规模线索 | 说明 |
|---|---|---|
| 全仓 Go | ~473 `.go` 文件 | Go workspace：`edge-server`, `hub-server`, `pkg`（Go 1.25） |
| 全仓 TS/TSX app | ~815 文件 | Desktop/Web/Mobile + shared |
| `edge-server` | ~76k LOC-ish | 执行平面最大 |
| `hub-server` | ~66k LOC-ish | 控制平面 |
| `app/shared` | ~60k LOC-ish | workbench / transcript / platform 合同 |
| `app/desktop` | ~51k LOC-ish | Tauri shell + Edge host |
| `app/web` | ~27k LOC-ish | Hub-only remote workbench |
| `reference/` | ~3.7G ignored | 仅 `reference/INDEX.md` 入仓；研究克隆非 SSOT |

固定本地端口（SSOT：`AGENTS.md`）：

| 资源 | 端口 |
|---|---:|
| Desktop Vite | 5173 |
| Web Vite | 5174 |
| Mobile Expo Web | 5177 |
| Hub Server | 8080 |
| Local Edge | 3210 |

## 3. 架构骨架（不可谈判边界）

### 3.1 Hub / Edge 分工

```
Clients (Desktop / Web / Mobile)
        │ REST + WS
        ▼
   Hub Server  ── identity / IM / routing / audit / outbox ──► PG + Redis
        │
        │ dispatch / callback (partial durable contract)
        ▼
   Edge Server ── lifecycle + adapters + EventStore ──► local runtime (CLI/SDK)
```

权威入口：

- `docs/architecture.md`
- `docs/architecture/01-hub-server.md` … `06-auth-identity.md`
- `docs/decisions.md`（ADR-001 Hub/Edge；ADR-011 shared platform；ADR-016 delivery；ADR-017 capability 方向）
- `hub-server/README.md` / `edge-server/README.md`

### 3.2 前端分层（已基本正确）

```
surface shell (desktop|web|mobile)
   → platform adapter (AgentHubPlatform)
      → shared workbench / transcript / chatview
         → Hub REST/WS  and/or  Local Edge (Desktop only)
```

- Desktop + Web 产品路径已挂载共享 `AgentHubWorkbench`。
- Mobile 主线是 `app/mobile-rn`（Expo RN）；旧 `app/mobile` Tauri 残渣不应再被当作第二主线。
- shared UI **不得**直接调用 Tauri / Hub / Edge 客户端；只经 platform ports。

### 3.3 协议与响应信封

- REST / WS 合同：`api/openapi.yaml`、`api/events.md`、`api/conventions.md`
- Hub 成功信封仍是 `{code:OK,data}`；Edge 返回 bare JSON —— **有意兼容债**，禁止 big-bang 同时改两边。
- Event 所有者分裂：Edge envelope vs Hub flat frame；前端 transcript normalizer 负责收敛。

## 4. 生产与运维叙事（必须先对齐）

| 事实层 | 当前权威 | 状态 |
|---|---|---|
| Live host / health / DB role | `C:/Users/Ding/server/projects/agenthub/STATE.md` | **LIVE hk3**（2026-07-15） |
| In-repo production shape | `deployments/production/docker-compose.yml` | 最接近 hk3（Azure PG + redis + 8090） |
| CI 门禁叙述 | `.github/workflows/checks.yml` | 仍写 S1 decommissioned / throttle |
| 旧 prod 模板 | `hub-server/deployments/docker-compose.prod.yml` 等 | 本地 PG 形态，**非 live SSOT** |
| 镜像名 | 分裂 | `agenthub-hub-server` vs `agenthub-hub`（已验证矛盾） |

**生产叙事 SSOT 推荐三件套：**

1. server `STATE.md`（live host/facts）
2. `deployments/production/`（in-repo shape）
3. `docs/architecture/05-deployment.md` 短指针

CI comments / 旧 compose / 旧 deploy.sh **不得**覆盖 Current Role。

## 5. 模块健康一览（S.U.P.E.R 摘要）

> 详细评分见 `risk-assessment.md`；模块清单见 `module-inventory.md`。

| 模块 | 单目的 | 单向依赖 | 端口化 | 环境无关 | 可替换 | 结论 |
|---|---|---|---|---|---|---|
| Hub control plane | 强 | 大多单向 | 强 | 中 | 中 | 边界正确；AgentService / outbox 接线是主压力 |
| Edge execution | 强意图 | 意图强 | 强 adapter | 中高 | adapter 高 | god-file + 半成品安全路径 |
| Shared frontend contract | 强 | 强规则 | 强 | 高 | 高 | 清理支点；勿拆 transcript |
| Desktop shell | 强 | 大多 | 强 | 低（设计如此） | 中 | 保留 Edge host；清 orphan UI |
| Web shell | 强 | 强 | 强 | 高 | 高 | Hub-only 正确；sessionStorage 风险 |
| Mobile RN | 中 | 大多 Hub-only | 有 | 中 | 中 | 边界隔离好；非本轮 UI 主线 |
| Deploy/Ops narrative | 弱 | 叙事断裂 | 多模板 | docs 正确但模板竞争 | 高 | **P0 对齐** |
| Governance/docs | 强骨架 | 强 | 强 | 好 | 好 | 状态漂移，不缺体系 |

整体判断：**架构已够支撑增量 strangler cleanup；不需要 rewrite。**

## 6. 当前最大清理压力（按类别）

### 6.1 叙事 / 运维漂移（P0）

- LIVE hk3 vs CI “decommissioned” 叙述（verified）
- 镜像名 `agenthub-hub-server` vs `agenthub-hub`（verified）
- 生产 DB 模板：Azure PG `agenthub` vs 旧本地 postgres / 默认 `tdadmin`（verified）
- STATE 验证命令仍残留 hk2/us1 路径

### 6.2 安全半成品（Open High，P0）

| ID | 主题 | 现状 |
|---|---|---|
| AH-SR-037 | Web sessionStorage | 仍真实 |
| AH-SR-045 | Remote Edge 授权粒度 | owner 过滤偏软 |
| AH-SR-046 | capability 双令牌 | Edge 验但 Hub 未见签发；claims 不完整 |
| AH-SR-049 | Hub-Edge durable delivery | Hub outbox 有实现但 retry loop 未接线；Edge callback 仍 best-effort |
| AH-SR-043 | demo/mock 泄漏 | auto/fixture 仍可假成功 |

### 6.3 代码浓度 / 分叉（P0–P1）

- Hub：`AgentService` 多关注点（dispatch / outbox / run-events / edge-callback）；flat `service` ~12k 行
- Edge：`handlers.go` ~2374、`process_executor.go` ~2279
- Frontend：三份 `hubClient`；orphan SettingsPage / TeamRunConsole；ConversationPort 未承载真实会话列表
- Hygiene：tracked `hub-server/server-hub` ELF；Tauri android gen 脏树；无 active `docs/progress/MASTER.md`

## 7. 明确不做什么

1. **不做 big-bang rewrite**（Hub/Edge 合并、协议同时改、前端整页重写）。
2. **不把 Edge 并入 Hub**，不给 Web Local Edge 权限。
3. **不把 llm-wiki 做成产品化第二知识平面**；可选的是 *knowledge compiler*（见 `cleanup-strategy.md`）。
4. **不新增 root script wrappers**；沿用 `scripts/{verify,dev,smoke,release,lib}` 与 `make test` / `go test -short` / `pnpm typecheck|test`。
5. **不宣称 production offline**。
6. **不把 residual hub_relay 分支误读为 remote 执行已产品化**。

## 8. 证据入口（精选）

| 主题 | 路径 |
|---|---|
| 项目规则 | `AGENTS.md` |
| 架构总览 | `docs/architecture.md` |
| 前端数据流 | `docs/architecture/04-frontend-data-flow.md` |
| 部署 | `docs/architecture/05-deployment.md` |
| 认证边界 | `docs/architecture/06-auth-identity.md` |
| 决策 | `docs/decisions.md` |
| 风险登记 | `docs/governance/security-risk-register.md` |
| 威胁模型 | `docs/governance/threat-model.md` |
| 路线图 | `docs/roadmap.md` |
| Live 生产 | `C:/Users/Ding/server/projects/agenthub/STATE.md` |
| In-repo prod compose | `deployments/production/docker-compose.yml` |
| CI | `.github/workflows/checks.yml` |
| API 合同 | `api/openapi.yaml`, `api/conventions.md`, `api/events.md` |

## 9. 相关基线文档

| 文档 | 内容 |
|---|---|
| `docs/analysis/module-inventory.md` | 模块清单、复杂度、清理优先级 |
| `docs/analysis/risk-assessment.md` | 矛盾、Open High、S.U.P.E.R、测试证据等级 |
| `docs/analysis/cleanup-strategy.md` | knowledge-first strangler 程序 + 可选 llmwiki |

## 10. 一句话结论

AgentHub 的 **边界与分层已经正确且大体落地**；清理对象是 **叙事漂移、安全半成品接线、god-file 浓度、前端分叉与仓库卫生**，不是“缺架构”。正确路径是 **knowledge-first + strangler 增量**，把 SSOT 与安全门禁先校正，再机械抽取可替换端口。
