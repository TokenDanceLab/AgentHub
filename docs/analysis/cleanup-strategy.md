# AgentHub Cleanup Strategy

> last-updated: 2026-07-16  
> program: **knowledge-first strangler cleanup** + optional **llmwiki as compiler only**  
> hard rule: **NO big-bang rewrite**

## 1. Program thesis

AgentHub 已经具备正确的 **Hub/Edge 双平面 + shared platform/transcript** 骨架。清理目标不是“重建系统”，而是：

1. **先校正事实**（生产 LIVE、风险 partial、模块 SSOT）
2. **再闭合安全半成品**（capability / remote authz / delivery / demo 门禁）
3. **再机械 strangler**（god-file → ports；fork → SSOT；兼容面重源）
4. **全程用现有验证脊柱**，不发明 root wrappers，不宣称假 real E2E

可选 **llmwiki** 只作为 agent 的 *knowledge compiler*：从 repo docs + code facts 编译可读 wiki，**不成为第二权威**。

## 2. Non-negotiables

| # | Rule |
|---|---|
| 1 | 生产是 **LIVE on hk3**；禁止 offline 叙事 |
| 2 | 不合并 Edge 进 Hub；Web/Mobile 无 Local Edge |
| 3 | 不 big-bang 改协议信封 / OpenAPI 双平面同时重写 |
| 4 | Desktop renderer 无 raw process execution |
| 5 | 不新增 root script wrappers；沿用 `scripts/{verify,dev,smoke,release,lib}` |
| 6 | 无 active SPEC 时不假装有 `MASTER` 进度；roadmap 为“无 active SPEC”真相 |
| 7 | High 风险未修/未验/未 accepted 前不公开发布 |
| 8 | llmwiki 若启用：sources → compile → wiki；**禁止 wiki → 覆盖 SSOT** |

## 3. Strategy stack

```
┌─────────────────────────────────────────────┐
│ 0. Knowledge baseline (this docs/analysis/) │
│    + SSOT pointers (AGENTS, STATE, arch)    │
├─────────────────────────────────────────────┤
│ 1. Truth alignment (prod/CI/risk/memory)    │
├─────────────────────────────────────────────┤
│ 2. Security minimum closed loops            │
├─────────────────────────────────────────────┤
│ 3. Strangler extractions (behavior-stable)  │
├─────────────────────────────────────────────┤
│ 4. Fork retirement & contract hygiene       │
├─────────────────────────────────────────────┤
│ 5. Optional llmwiki compile pass            │
└─────────────────────────────────────────────┘
```

每一层必须 **可独立 merge**；下层失败不阻塞上层已合并的真相修复。

## 4. Phased program

### Phase 0 — Knowledge lock (done by this baseline)

**Deliverables**

- `docs/analysis/project-overview.md`
- `docs/analysis/module-inventory.md`
- `docs/analysis/risk-assessment.md`
- `docs/analysis/cleanup-strategy.md`

**Exit**

- 任何 cleanup agent 先读这四份 + `AGENTS.md` + server STATE Current Role
- 不再从 `.agenthub/memory` 或 checks 页眉推断 offline

### Phase 1 — Truth & hygiene (1–3 短 PR)

| Work item | Priority | Evidence |
|---|---|---|
| 改写 CI S1 叙事：LIVE/hk3；throttle 理由改为 cost/risk 而非 decommissioned | P0 | `checks.yml` 页眉与 job 注释 |
| 统一镜像名 SSOT（推荐 `agenthub-hub-server`）并修正 `cd-production` / rollback 文案 | P0 | compose + workflows 一致 |
| 更新 server STATE 验证命令到 hk3；历史段只读 | P0 | STATE |
| 提交移除 `hub-server/server-hub`；补 ignore bare binary | P0 | git clean of binary |
| 解决 `src-tauri/gen` 脏树：删 android gen 或恢复必要 schema 并文档化 | P0 | clean status policy |
| 中和 `.agenthub/memory/project.md` 为指针 | P0 | 无 SUPER 假进度 |
| MASTER：stub “no active SPEC” **或** AGENTS 改为 if-present | P1 | progressive load 不炸 |
| 降级 `hub-server/deployments/*` prod 模板为 historical | P1 | banner + pointer to `deployments/production` |
| production compose 默认角色对齐 `agenthub`（密钥仍外置） | P1 | defaults/comments |

**Exit criteria**

- 新人/agent 不会把产品当 decommissioned
- clone 不再依赖 tracked ELF
- 工作树 hygiene 政策明确

### Phase 2 — Security minimum loops (behavior-changing, small slices)

| Slice | Risk IDs | Do | Don’t |
|---|---|---|---|
| **2a Capability closed loop** | AH-SR-046 | Hub 签发 per-run capability；dispatch 携带 header；扩展 claims（至少 purpose/action + project；目标含 target/workspace）；PostRuns 强制；负例；CORS header | 半成品上继续加 remote 产品入口 |
| **2b Remote Edge authz** | AH-SR-045 | read/write 作用域检查；空 allowlist fail-closed；负例 | 仅依赖 owner 字符串过滤 |
| **2c Delivery durability** | AH-SR-049 | Hub `StartDeliveryRetryLoop` 接线 + app 级测试；失败路径不 silent continue；Edge outbox/journal 最小 + idempotent ack 合同 | 重做整套消息系统 |
| **2d Demo/dataMode gates** | AH-SR-043 | observed/approved-real + auth 才允许“真执行”主张；badge 强制；mobile hub 失败 fail-closed | 静默 fixture 成功 |
| **2e Web session decision** | AH-SR-037 | **二选一**：BFF/HttpOnly **或** Accepted risk + 补偿控制写进 register | 既不修也不 accept |
| **2f Risk register refresh** | governance | 046/049 → partial mitigated + 剩余关闭条件/owner | 保持全 Open 误导 |

**Exit criteria**

- register 与代码同态
- remote run-start 不再“Edge 验、Hub 不发”
- outbox retry 在进程内真实运行
- 发布门禁可引用明确 evidence / accepted 记录

### Phase 3 — Strangler extractions（行为稳定）

原则：**先接口后搬家；测试绿；一次一个 seam。**

#### 3.1 Hub

1. 抽 `DispatchService` / `RunEventProjector` / outbox repository 出 `AgentService`
2. `delivery` 模型进 `model`/`repository`
3. target maturity：代码层保持 local_edge-only；hub_relay 标 incomplete 或死代码闸
4. router 按 surface 拆注册 + deps struct
5. 后续：`im/`、`catalog/` 等 agentteam 风格子包

#### 3.2 Edge

1. `ProcessExecutor` 抽 `CallbackReporter`、`SubAgentSpawner`、output pipeline
2. `handlers.go` 按路由域拆文件（OpenAPI 路径不变）
3. orchestrator/failure 迁出 `adapters` → lifecycle/agents
4. store domain interfaces 渐进
5. `/v1/runners` 保留 shape，数据改 AdapterRegistry 投影

#### 3.3 Frontend

1. **shared hubClient SSOT**：types → methods → 删 desktop/web forks（auth storage 留 surface）
2. ConversationPort 对齐真实 sessions/threads **或** 文档化 port 非 list SSOT
3. 继续拆 `AgentHubWorkbench` / mega-tests（按 concern）
4. Settings：shared page 为 UI SSOT；Edge diagnostics 走 SettingsPort；orphan pages 证明后删
5. TeamRun：**先产品决策** → shared view model **或** archive consoles + 保留行为 spec
6. Mobile：仅 fail-closed + shared client；不上全量 workbench

**Exit criteria**

- 关键路径不再只有“一个 2k 文件可改”
- Desktop/Web API 漂移可测
- 无复活 orphan UI 的默认路径

### Phase 4 — Contract & tooling hygiene

| Item | Notes |
|---|---|
| OpenAPI tag/partition Hub vs Edge；清 ghost `/client/*` | router 为运行时 SSOT |
| 刷新 `api/deprecations.md` | runners 兼容明确到 2027 或更新 |
| CI policy owner 文档补齐或 retarget | 与 live 姿态一致 |
| smoke matrix README：fixture / observed / approved-real 各一条 | 删/标 deprecated wrappers |
| verify spine 文档化证据等级 | 禁止 readiness = real |
| 可选：response envelope 版本化收敛计划 | 无 big-bang |

### Phase 5 — Optional llmwiki (knowledge compiler)

**When**

- Phase 0–2 完成或并行于 Phase 3 只读编译  
- 多 agent 清理需要稳定“已编译”导航时

**What it is**

```
sources (authoritative)
  AGENTS.md, architecture/*, decisions, risk register,
  api/*, module code facts, this analysis/*
        │ compile (deterministic prompts / scripts)
        ▼
wiki markdown (derived, disposable)
  modules index, risk cards, seam maps, runbooks
```

**Rules**

1. Wiki **只读派生**；冲突以 sources 为准  
2. 不写密钥、不写 live 密码、不替代 server STATE  
3. 不进入产品运行时  
4. 可整目录删除而不损 SSOT  
5. 若维护税 > 导航收益 → 关掉

**What it is not**

- 不是产品知识库功能  
- 不是 RAG 平台项目  
- 不是替换 `docs/governance` 的流程系统

## 5. Verification policy per phase

| Phase | Minimum green bar |
|---|---|
| 1 Truth | doc/workflow 审阅；binary 不在 tree；STATE 命令可复制 |
| 2 Security | 相关 `go test` + 负例；register 更新；无“假完成”注释 |
| 3 Strangler | 包级 short tests + 受影响前端 typecheck/test；行为对比清单 |
| 4 Hygiene | verify-doc-ssot / openapi path 抽检；smoke matrix 自洽 |
| 5 Wiki | 抽样条目可回链到 source 行级证据 |

**永远不够单独充当 real 的东西**

- demo/fixture 绿
- readiness script 默认路径
- OpenAPI 有路径但无 router
- CI job body 仅 skeleton 但 “存在”

## 6. Top priorities (ordered)

1. **生产叙事 SSOT**：STATE + `deployments/production` + CI 去 decommissioned 误导  
2. **镜像名统一** + CD 诚实（真部署或 dry-run 标注）  
3. **AH-SR-046 闭环**（Hub 签发 + claims + 负例）  
4. **AH-SR-049**：Hub outbox retry 接线 + Edge journal 最小切片  
5. **AH-SR-045** remote 作用域授权  
6. **AH-SR-037** 决策（修或 accept）  
7. **AH-SR-043** dataMode / demo 门禁  
8. **hubClient SSOT** 收敛 Desktop/Web  
9. **Hub AgentService / Edge ProcessExecutor+handlers** 端口化拆分  
10. **Hygiene**：binary、gen dirty tree、stale memory、orphan UI 决策  

## 7. Anti-patterns (explicit ban list)

- “先 rewrite service 层再谈安全”
- “合并 TeamRunConsole 两个 fork 当 cleanup 胜利”而未挂载产品路径
- “删除 runners 包”而未迁移 `/v1/runners` 消费者
- “把 ConversationPort.list 当唯一会话源”直接改 shared UI
- “CI 全开 e2e”而无证据等级与成本政策
- “新建 docs/archive 或 root `tools.sh`”
- “用 llmwiki 当 MASTER/进度系统”
- “生产仍 live 却在 PR 描述写 decommissioned 完成”

## 8. Ownership suggestions

| Stream | Primary surfaces | Notes |
|---|---|---|
| Ops truth | server STATE, deployments, workflows | 可与代码 PR 分离 |
| Hub security/delivery | hub-server service/app | outbox + capability issuer |
| Edge security/runtime | edge-server api/lifecycle/hub | capability enforce + journal |
| Frontend contract | app/shared + desktop/web adapters | hubClient + dataMode |
| Docs/governance | risk register, architecture 05/06, AGENTS MASTER wording | 状态同态 |
| Optional wiki compile | analysis/ + scripts later | 非阻断 |

## 9. Open questions

1. **AH-SR-037**：公开 Web 时间表是否强制 BFF，还是短期 Accepted risk？  
2. **TeamRun UI**：workbench 内嵌 vs 独立 console vs 暂缓产品 UI？  
3. **CI 恢复集**：live 后哪些 gate 必须 push 自动（govulncheck？mobile？）？  
4. **capability 字段最小集**：本轮是否一次包含 workspace/target/action？  
5. **Tauri gen schemas**：Desktop 打包是否仍依赖已删 schema 文件？  
6. **镜像发布权**：`cd-hub-server` 与 `cd-production` 谁为唯一 build 权威？  
7. **Envelope 收敛**：是否立 Q 目标版本，还是仅登记债务？  
8. **llmwiki**：是否在 Phase 3 前启用只读 compile，还是等清理稳定后？

## 10. Success definition (program level)

Cleanup 程序成功 **不是** “目录更少” 或 “重写完成”，而是：

1. Live 生产叙事与 CI/模板一致  
2. Open High 要么 closed with evidence，要么 partial 有关闭条件，要么 accepted  
3. 关键执行/控制路径可在端口边界上改，而不必编辑 2k 行神文件  
4. Desktop/Web 共享合同与客户端不再三叉漂移  
5. Agent 入场只依赖 AGENTS + roadmap + architecture +（可选）compiled wiki，而不依赖过期 memory  
6. 全程无架构红线破坏、无假 real 证据、无 big-bang rewrite

## 11. One-page command for agents

```
Read: AGENTS.md → docs/analysis/* → docs/roadmap.md → architecture seams for your slice
Privilege: server STATE Current Role over CI decommission comments
Change: smallest strangler slice with tests
Never: rewrite planes, grant Web local edge, dual SSOT, silent demo success
Verify: short tests + focused security/contract + honest evidence grade
Stop: when slice green; open next Phase item, do not expand scope
```
