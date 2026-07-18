# AgentHub Cleanup Strategy（权威程序决策）

> **ARCHIVED PROGRAM — cleanup-baseline closed 2026-07-16 / PR #446.** Do not open new `cleanup-baseline` issues. Live work: `phase:61` / milestone 82 via [../progress/MASTER.md](../progress/MASTER.md).
> last-updated: 2026-07-18
> program: **knowledge-first strangler cleanup** + **lightweight llmwiki as compiler only**
> hard rule: **NO big-bang rewrite**

本文是 cleanup-baseline 的历史程序决策（冻结快照）。规则 SSOT 仍是 `AGENTS.md`；架构/API SSOT 仍是 `docs/architecture*` 与 `api/*`；生产 live SSOT 仍是 server `projects/agenthub` external ops SSOT。历史任务编号：GitHub Issues #424–#451（label `cleanup-baseline`，已关闭）。

---

## 1. Program thesis

AgentHub 已具备正确的 **Hub/Edge 双平面 + shared platform/transcript** 骨架。清理目标不是重建系统，而是：

1. **先校正事实**（生产 LIVE、风险 PARTIAL、模块 SSOT）
2. **再闭合安全半成品**（capability / remote authz / delivery / demo 门禁 / Web session 决策）
3. **再机械 strangler**（god-file → ports；fork → SSOT；兼容面重源）
4. **全程用现有验证脊柱**，不发明 root wrappers，不宣称假 real E2E

**Lightweight llmwiki**（`wiki/`）只作为 agent 的 *knowledge compiler*：从 repo docs + 已验证 code facts 编译可读导航，**永不成为第二权威**。

---

## 2. Authoritative decisions

| 决策 | 内容 |
|---|---|
| Rewrite? | **NO** big-bang rewrite |
| Method | **Strangler** 增量切片，每片可独立 merge |
| Knowledge | **`wiki/` 编译层**；AGENTS / architecture / api / risk / STATE 仍为 SSOT |
| Production | **LIVE on hk3**；CI decommissioned = 漂移待修 |
| Mobile | **boundary-only**（本程序） |
| Scripts | 沿用 `scripts/{verify,dev,smoke,release,lib}`；禁止新根级 wrapper |
| Tracking | **GITHUB_FULL**：Project + Milestones + Issues；**禁止无 Issue 实现** |
| Workflow role | Workflow/subagent 只做 **Issue executor**，不是第二 backlog |

---

## 2.1 Issue-bound execution protocol

1. 任何实现/重构必须对应 open Issue（`cleanup-baseline`）。
2. 分支命名建议：`chore/cleanup-T{id}-short` 或沿用 worktree 单分支多 PR 时 PR 描述写 `closes #N`。
3. Workflow/subagent 启动前必须写入 Issue number；无 Issue 的 freestyle fleet **禁止**。
4. 活状态看 GitHub Project：https://github.com/users/DeliciousBuding/projects/6
5. 本地索引：`docs/progress/MASTER.md`（Mode=GITHUB_FULL）

---

## 3. Non-negotiables（硬约束）

1. 生产是 **LIVE on hk3**；禁止把 offline/decommissioned 写成当前状态
2. 不合并 Edge 进 Hub；Web/Mobile 无 Local Edge
3. 不 big-bang 改协议信封 / 同时重写 OpenAPI 双平面
4. Desktop renderer 无 raw process execution
5. 不新增 root script wrappers
6. High 风险未修 / 未验 / 未 accepted 前不公开发布
7. llmwiki：sources → compile → wiki；**禁止 wiki 覆盖 SSOT**
8. 不发明 issue 编号；路径尽量 repo-relative
9. 秘密 / 真实 token / 用户数据不进仓库文档
10. 远程 Execution Target 产品化不得早于 capability + durable delivery 合同

---

## 4. Explicit non-goals

1. 整仓 rewrite 或“为拆而拆”的微服务化
2. 放弃 Local Edge 改成纯云 IDE
3. Mobile UI 深改、商店发布、Tauri Mobile 复活
4. 默认自动化真实模型消耗 / 签名 / 公证 / 生产上传（需单独审批）
5. 用 wiki/RAG 产品替代 AGENTS 与 architecture
6. 把 `reference/` 3.7G 研究树提交进 git
7. 一次 PR 收敛全部 Hub/Edge JSON 包络
8. 无差别把 CI 全开昂贵 e2e（应按 LIVE 产品**重选** gate）
9. 顺手视觉品牌重做
10. 合并 TeamRun 双 fork 却不决定产品 owner

---

## 5. Strategy stack

```text
┌─────────────────────────────────────────────┐
│ 0. Knowledge baseline (docs/analysis/*)     │
│    + SSOT pointers (AGENTS, STATE, arch)    │
├─────────────────────────────────────────────┤
│ 1. Truth alignment (prod/CI/risk/hygiene)   │
├─────────────────────────────────────────────┤
│ 2. Lightweight wiki compile (wiki/)         │
├─────────────────────────────────────────────┤
│ 3. Security minimum closed loops            │
├─────────────────────────────────────────────┤
│ 4. Backend strangler (Hub + Edge ports)     │
├─────────────────────────────────────────────┤
│ 5. Frontend dedupe + contract honesty        │
└─────────────────────────────────────────────┘
```

每一层必须 **可独立 merge**；下层失败不阻塞上层已合并的真相修复。

---

## 6. Phase plan 0–5（含验收门禁）

### Phase 0 — Knowledge lock（本基线）

**交付**

- `docs/analysis/project-overview.md`
- `docs/analysis/module-inventory.md`
- `docs/analysis/risk-assessment.md`
- `docs/analysis/cleanup-strategy.md`
- 重建 `docs/progress/MASTER.md`（指向本程序）

**Exit**

- [ ] 任何 cleanup agent 先读四件套 + `AGENTS.md` + server STATE Current Role
- [ ] 不再从 CI 页眉或过期 memory 推断 offline
- [ ] 风险表承认 046/049 **PARTIAL**（register 校准可在 Phase 1 合入）

### Phase 1 — Truth & hygiene（1–3 短 PR）

| Work item | P | Evidence |
|---|---|---|
| 改写 CI S1 叙事：LIVE/hk3；throttle 理由改为 cost/risk 而非 decommissioned | P0 | `checks.yml` 页眉与 job 注释 |
| 统一镜像名 SSOT（推荐 `agenthub-hub-server`）并修正 CD / rollback 文案 | P0 | compose + workflows 一致或显式别名 |
| 更新 server STATE 验证命令到 hk3（运维侧）；历史段只读 | P0 | STATE |
| 移除 / ignore `hub-server/server-hub` 等 binary noise | P0 | clean policy |
| `src-tauri/gen` 脏树政策：删 android gen 或恢复必要 schema 并文档化 | P0 | status policy |
| 中和过期 agent memory 为指针 | P0 | 无假 SUPER 进度 |
| 降级 `hub-server/deployments/*` prod 模板为 historical banner | P1 | pointer → `deployments/production` |
| production compose 默认角色对齐 `agenthub`（密钥外置） | P1 | defaults/comments |
| scripts 清单：required / optional / readiness-only | P1 | script map |
| reference：确认仅 INDEX 跟踪 + 克隆忽略声明 | P1 | INDEX / ignore |

**Exit**

- [ ] 新人/agent 不会把产品当 decommissioned
- [ ] clone 不依赖 tracked ELF
- [ ] 工作树 hygiene 政策明确
- [ ] 无新根级脚本 wrapper

### Phase 2 — Lightweight llmwiki（可与 Phase 1 并行）

**What**

```text
sources (authoritative)
  AGENTS.md, architecture/*, decisions, risk register,
  api/*, module code facts, docs/analysis/*
        │ compile (scripts / deterministic prompts)
        ▼
wiki/ (derived, disposable)
  Home, Architecture-Map, Module-Index,
  Safety-Boundaries, Verify-Map, Production-Pointer
```

**Rules**

1. Wiki **只读派生**；冲突以 sources 为准
2. 不写密钥、不写 live 密码、不替代 server STATE
3. 不进入产品运行时
4. 可整目录删除而不损 SSOT
5. 维护税 > 导航收益 → 关掉

**Exit**

- [ ] `wiki/Home.md` 声明 compiled layer / not SSOT
- [ ] 全文可回链 SSOT
- [ ] 新 Agent 阅读路径 ≤ 5 个入口

### Phase 3 — Security minimum loops（行为改变，小切片）

| Slice | Risk IDs | Do | Don’t |
|---|---|---|---|
| **3a Capability closed loop** | AH-SR-046 | Hub 签发 per-run capability；dispatch 携带 header；扩展 claims；PostRuns 强制 purpose；负例；CORS header | 半成品上加 remote 产品入口 |
| **3b Remote Edge authz** | AH-SR-045 | read/write 作用域；空 allowlist fail-closed；负例 | 仅 owner 字符串过滤 |
| **3c Delivery durability** | AH-SR-049 | Hub `StartDeliveryRetryLoop` 接线 + 测试；失败不 silent continue；Edge journal 最小 + idempotent ack | 重做整套消息系统 |
| **3d Demo/dataMode gates** | AH-SR-043 | observed/approved-real + auth 才允许“真执行”主张；badge；mobile fail-closed | 静默 fixture 成功 |
| **3e Web session decision** | AH-SR-037 | **二选一**：BFF/HttpOnly **或** Accepted risk + 补偿 | 既不修也不 accept |
| **3f Risk register refresh** | governance | 046/049 → partial mitigated + 剩余关闭条件/owner | 保持全 Open 误导 |

**Exit**

- [ ] register 与代码同态
- [ ] remote run-start 不再“Edge 验、Hub 不发”
- [ ] outbox retry 在进程内真实运行
- [ ] 发布门禁可引用 evidence / accepted
- [ ] 触达服务 `go test -short` 绿

### Phase 4 — Backend strangler（行为稳定）

原则：**先接口后搬家；测试绿；一次一个 seam。**

#### Hub

1. 抽 `DispatchService` / `RunEventService` / `EdgeCallbackService`（名可变）出 `AgentService`
2. delivery 模型进 `model`/`repository`
3. target maturity：代码保持 local_edge-only；hub_relay 标 incomplete 或死代码闸
4. router 按 surface 拆注册 + deps struct
5. 后续 im/catalog 等 agentteam 风格子包
6. 测试卫生：拆 mega-test、减 Sleep（不降保护力）

#### Edge

1. `ProcessExecutor` 抽 `CallbackReporter`、`SubAgentSpawner`、output pipeline
2. `handlers.go` 按路由域拆文件（OpenAPI 路径不变）
3. orchestrator/failure 迁出 `adapters` → lifecycle/agents
4. store domain interfaces 渐进
5. `/v1/runners` 保留 shape，数据改 AdapterRegistry 投影

**Exit**

- [ ] 对外路径兼容
- [ ] 关键路径不再只有“一个 2k 文件可改”
- [ ] dispatch 成熟度在代码与文档一致
- [ ] 无循环依赖回潮
- [ ] 触达包 short tests 绿

### Phase 5 — Frontend dedupe & honesty

1. **shared hubClient SSOT**：types → methods → 删 desktop/web forks（auth storage 留 surface）
2. import-graph 后删除/归档孤儿 Settings / TeamRunConsole
3. ConversationPort 对齐真实会话 **或** 明确 port 非 list SSOT
4. 统一 dataMode 词表；退役/改名 `workbenchDataMode.ts`
5. 继续拆 `AgentHubWorkbench` / mega-tests
6. Settings：shared page = UI SSOT；Edge diagnostics 走 SettingsPort
7. TeamRun：**先产品决策** 再 merge 或 archive
8. Mobile：fail-closed + shared client；**不上**全量 workbench

**Exit**

- [ ] 产品路径不再维护第二份完整 hubClient
- [ ] 孤儿删除有引用扫描证据
- [ ] AH-SR-043 相关断言存在
- [ ] shared + 触达 app typecheck/test 绿
- [ ] UI 行为变更有 Playwright/Visual QA 或“无 UI 行为变化”说明
- [ ] Mobile boundary tests 绿

---

## 7. Parallel Workflow team map

可同时开 5 队；**不跨队改同一 god-file 的同一职责。**

| 队 | Phase | 允许改动（示意） | 禁改 | 关键交付 |
|---|---|---|---|---|
| **hygiene** | 0–1 | workflows 叙事、deploy banner、scripts 清单/删重、gitignore、roadmap 短指针 | 业务运行时逻辑 | LIVE 叙事、script map |
| **wiki** | 2 | 仅 `wiki/**` + 必要生成脚本 | `AGENTS.md` 规则正文、api 合同 | 编译知识层 Home/Map |
| **security-capability** | 3 | Hub auth/session/outbox 接线、Edge capability/callback 合同、register 状态、Web session 方案 | 无关 UI 重设计 | 046/049/045/037/043 切片 |
| **edge-split** | 3–4 | `edge-server/**`（handlers/lifecycle/hub/jwtutil/adapters 编排迁出） | `app/**` 产品 UI | 端口 + god-file 减重 |
| **frontend-dedupe** | 5（可早做 orphan 扫描） | `app/shared/**`、`app/desktop/**`、`app/web/**`（+ mobile boundary 小改） | Edge/Hub 协议大改 | hubClient SSOT、孤儿删除、dataMode |

### 协作规则

1. **security-capability** 定义跨服务合同（header、claims、ack 语义）；实现队服从合同
2. **frontend-dedupe** 不绕过 platform ports 直打新 API
3. **wiki** 只在其他队合并后刷新链接，不阻塞代码队
4. **hygiene** 先合叙事，减少 PR 描述写错生产状态
5. 每 PR：范围、验证命令、证据等级、非目标

### 建议分支命名

```text
docs/cleanup-baseline
chore/cleanup-hygiene
docs/cleanup-wiki
fix/sec-capability-046
fix/sec-delivery-049
refactor/edge-split-<slice>
refactor/hub-dispatch-outbox
refactor/frontend-hubclient-ssot
chore/frontend-orphan-settings
```

---

## 8. Strangler 执行原则

1. **先端口后搬家**
2. **先删真孤儿，再合并相似实现**
3. **兼容外壳可留一个版本**（runners、旧 envelope）
4. **一个 PR 一个可叙述行为**
5. **测试与实现同向绞杀**
6. **产品成熟度以代码强制为准**
7. **证据诚实**：readiness ≠ real；partial ≠ closed

---

## 9. Verification policy per phase

| Phase | Minimum green bar |
|---|---|
| 0 Knowledge | analysis 四件套齐；MASTER 指向程序 |
| 1 Truth | doc/workflow 审阅；binary 政策；STATE 诚实 |
| 2 Wiki | 条目可回链 source；声明 not SSOT |
| 3 Security | 相关 `go test` + 负例；register 更新；无假完成注释 |
| 4 Strangler | 包级 short tests + 行为对比清单 |
| 5 Frontend | typecheck/test + 引用扫描 + 诚实 dataMode 证据 |

**永远不够单独充当 real：** demo/fixture 绿、readiness 默认路径、OpenAPI 有路径但无 router、CI skeleton job 仅“存在”。

---

## 10. Top priorities（有序）

1. 生产叙事 SSOT：STATE + `deployments/production` + CI 去 decommissioned 误导
2. 镜像名统一 + CD 诚实（真部署或 dry-run 标注）
3. AH-SR-046 闭环（Hub 签发 + claims + 负例）
4. AH-SR-049：Hub outbox retry 接线 + Edge journal 最小切片
5. AH-SR-045 remote 作用域授权
6. AH-SR-037 决策（修或 accept）
7. AH-SR-043 dataMode / demo 门禁
8. hubClient SSOT 收敛 Desktop/Web
9. Hub AgentService / Edge ProcessExecutor+handlers 端口化拆分
10. Hygiene：binary、gen dirty tree、scripts readiness、orphan UI 决策

---

## 11. Ownership suggestions

| Stream | Primary surfaces | Notes |
|---|---|---|
| Ops truth | server STATE, deployments, workflows | 可与代码 PR 分离 |
| Hub security/delivery | hub-server service/app | outbox + capability issuer |
| Edge security/runtime | edge-server api/lifecycle/hub | capability enforce + journal |
| Frontend contract | app/shared + desktop/web adapters | hubClient + dataMode |
| Docs/governance | risk register, architecture 05/06, MASTER | 状态同态 |
| Wiki compile | `wiki/` + analysis sources | 非阻断 |

---

## 12. Open questions（不阻塞基线）

1. AH-SR-037：公开 Web 时间表是否强制 BFF，还是短期 Accepted risk？
2. TeamRun UI：workbench 内嵌 vs 独立 console vs 暂缓？
3. CI 恢复集：live 后哪些 gate 必须 push 自动？
4. capability 字段最小集：本轮是否一次包含 workspace/target/action？
5. Tauri gen schemas：打包是否仍依赖已删文件？
6. 镜像发布权：`cd-hub-server` vs `cd-production` 谁为 build 权威？
7. Envelope 收敛：是否立季度目标，还是仅登记债务？
8. llmwiki：Phase 3 前启用只读 compile，还是等清理稳定后？

---

## 13. Success definition（program level）

Cleanup 成功 **不是** “目录更少” 或 “重写完成”，而是：

1. Live 生产叙事与 CI/模板一致
2. Open High 要么 closed with evidence，要么 partial 有关闭条件，要么 accepted
3. 关键执行/控制路径可在端口边界上改，而不必编辑 2k 行神文件
4. Desktop/Web 共享合同与客户端不再三叉漂移
5. Agent 入场只依赖 AGENTS + roadmap + architecture +（可选）compiled wiki
6. 全程无架构红线破坏、无假 real 证据、无 big-bang rewrite

---

## 14. One-page command for agents

```text
Read: AGENTS.md → docs/analysis/* → docs/roadmap.md → architecture seams for your slice
Privilege: server STATE Current Role over CI decommission comments
Change: smallest strangler slice with tests
Never: rewrite planes, grant Web local edge, dual SSOT, silent demo success
Verify: short tests + focused security/contract + honest evidence grade
Stop: when slice green; open next Phase item, do not expand scope
```

---

## 15. File index

| 文件 | 用途 |
|---|---|
| `docs/analysis/project-overview.md` | 总览 + 生产现实 |
| `docs/analysis/module-inventory.md` | 模块规模与 S.U.P.E.R 灯号 |
| `docs/analysis/risk-assessment.md` | 风险矩阵与 PARTIAL 安全项 |
| `docs/analysis/cleanup-strategy.md` | 本程序决策 |
| `docs/analysis/_raw_lane_results.json` | 五条 lane 原始结果 |
| `AGENTS.md` | 规则 SSOT |
| `docs/governance/security-risk-register.md` | 安全发布门禁 |
| server `projects/agenthub` external ops SSOT | 生产 LIVE SSOT |

**Strategy one-liner：** 在 hk3 LIVE 前提下，用绞杀式增量清理 + 轻量 `wiki/` 编译知识层，先对齐叙事与安全半落地，再切 Edge/Hub 巨石与前端 hubClient 分叉，绝不 big-bang rewrite。
