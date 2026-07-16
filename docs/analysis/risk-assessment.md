# AgentHub Risk Assessment

> last-updated: 2026-07-16  
> purpose: cleanup baseline risks, verified contradictions, S.U.P.E.R health, evidence grades  
> sources: discovery lanes + verification results; security SSOT remains `docs/governance/security-risk-register.md`

## 1. Executive judgment

1. **生产是 LIVE（hk3）**，不是 offline。最大运维风险是 **CI/docs 仍讲 decommissioned**，导致门禁与 agent 行为偏松或偏错。
2. **架构风险低于接线风险**：Hub/Edge/platform 边界大体正确；Open High 多来自半成品安全路径与证据缺口。
3. **适合增量 strangler**；不适合 rewrite。治理骨架（AGENTS / ADR / risk register / verify skills）是资产，问题是 **状态漂移**。
4. **llm-wiki 不作为产品重写目标**；若使用，仅作 agents 的 *compiled knowledge layer*，源仍是 repo docs + code facts。

## 2. S.U.P.E.R health summary

S.U.P.E.R = Single-purpose · Unidirectional · Ports · Environment-agnostic · Replaceable

| Module | S | U | P | E | R | Score band | Notes |
|---|---|---|---|---|---|---|---|
| Hub Server overall | strong | mostly | strong | medium | medium | **B+** | 控制平面清晰；AgentService 浓度拖累 R |
| Hub `service` flat | weak | yes | partial | partial | partial | **C** | 主内部风险面 |
| Hub `agentteam` | strong | partial | yes | yes | partial | **B** | 抽取范本 |
| Hub auth/session | strong | strong | good | good | good | **A-** | 实现正确；文档 JWT overclaim；缺 live 证据 |
| Edge adapters CLI/SDK | med-high | med | high | med | high | **B+** | orchestrator 错位降 S |
| Edge lifecycle | low | low | med | med | low | **C-** | god-object；P0 抽取 |
| Edge runners | high | high | med | high | high | **A-** | 兼容壳；勿当执行中心 |
| Edge hub callback | high purpose | high | low | high | med | **C+** | best-effort；缺 port |
| Edge API handlers | low | low | med | med | low | **C-** | 安全改动 blast radius 大 |
| Shared platform | high | high | high | high | high | **A-** | ConversationPort 未吃满 |
| Shared transcript | high | high | high | high | high | **A** | 清理期保护 |
| Shared workbench | med | med | med | high | low-med | **C+** | 巨文件 |
| Desktop shell | strong | mostly | strong | low | med | **B** | demo 默认与 orphan UI |
| Web shell | strong | strong | strong | high | high | **B** | sessionStorage 拉低安全分 |
| Mobile RN | med | mostly | med | med | med | **B-** | 边界好；非主线 |
| API contract | strong intent | n/a | strong docs | high | high | **B-** | 体积 + ghost paths |
| Deploy/Ops narrative | weak | broken | multi | docs ok | high if unified | **D+** | **P0** |
| Governance/docs/skills | strong | strong | strong | good | good | **B+** | 漂移非缺体系 |
| Scripts smoke/verify | med | med | med | med | low-med | **C** | 矩阵重叠 |

**组合结论：** 边界层（Hub/Edge/platform）多为 B/A；浓度层（service/handlers/lifecycle/workbench）与叙事层（deploy/CI）是 cleanup 杠杆点。

## 3. Verified contradictions（高置信）

以下均经 2026-07-16 verification **confirmed**（或 confirmed refined）。

### 3.1 Production status: LIVE vs decommissioned

| | |
|---|---|
| **Impact** | Agents/CI under-gate；运维按 offline 叙事行动 |
| **Evidence** | `C:/Users/Ding/server/projects/agenthub/STATE.md` Current Role LIVE hk3；`.github/workflows/checks.yml` S1 decommissioned；server CI policy class D 滞后 |
| **Mitigation** | STATE 优先；改写 CI 页眉与 policy；恢复“应对 live 产品开启”的门禁，昂贵 lane 仍可 manual 但理由写清 |

### 3.2 Production image name split

| | |
|---|---|
| **Impact** | 错误 pull / 不可信 rollback 文档 |
| **Evidence** | `deployments/production/docker-compose.yml` → `agenthub-hub-server`；`cd-hub-server.yml` 同；`cd-production.yml` → `agenthub-hub`；旧 `hub-server/deployments/*` 默认旧名 |
| **Mitigation** | 单一镜像 SSOT；CD 实装或明确 dry-run |

### 3.3 Production DB topology templates

| | |
|---|---|
| **Impact** | 重建本地 PG 或错误凭据（`tdadmin`） |
| **Evidence** | STATE Azure PG role `agenthub`；production compose Azure 但默认 `PG_USER=tdadmin`；`docker-compose.prod.yml` 独立 postgres:16 |
| **Mitigation** | 对齐默认角色/env 名；旧模板加 non-authoritative 横幅 |

### 3.4 Remote / hub_relay dispatchability

| | |
|---|---|
| **Impact** | 把残码当产品完成 |
| **Evidence** | `validateDispatchTarget` 仅 `local_edge`；`dispatchTask` 仍有 hub_relay 分支；OpenAPI 声明 remote 未产品化 |
| **Mitigation** | maturity gate 显式化；删或死代码闸住 hub_relay 一致性 |

### 3.5 Outbox retry not enabled at runtime

| | |
|---|---|
| **Impact** | 以为有 durability，实际无周期 retry/dead-letter |
| **Evidence** | RecordDelivery/MarkDeliverySent 在 dispatch 路径；`StartDeliveryRetryLoop` 无 app wiring 调用 |
| **Mitigation** | app background 接线 + 行为测试 |

### 3.6 JWT membership doc overclaim

| | |
|---|---|
| **Impact** | 未来 middleware 可能错误塞 authz 进 JWT |
| **Evidence** | `06-auth-identity.md` 写 membership；`jwtutil.Claims` 仅 user/device + registered |
| **Mitigation** | 文档改为 device-bound session identity；AuthZ 仍服务端 DB 检查 |

### 3.7 Capability completeness overstated

| | |
|---|---|
| **Impact** | AH-SR-046 误判完成；wrong-target/action/workspace/stale 仍开 |
| **Evidence** | PostRuns 注释 overclaim；claims 无 target/workspace；purpose 不强制；Hub 未见 issuer |
| **Mitigation** | Hub 签发 + 扩展 claims + 负例；CORS 允许 capability header |

### 3.8 Local event durability ≠ Hub-Edge contract

| | |
|---|---|
| **Impact** | offline/replay 后状态分歧 |
| **Evidence** | Edge EventLog/cursor 本地；callback fire-and-forget；Hub outbox partial；AH-SR-049 Open |
| **Mitigation** | Edge journal + idempotent ack + reconciliation 最小切片 |

### 3.9 runners vs adapters runtime model

| | |
|---|---|
| **Impact** | API 消费者仍把 runners 当 agent 模型 |
| **Evidence** | 执行用 `adapters.Registry`；`/v1/runners` 仍 `runners.Registry`；Desktop `useRunners` |
| **Mitigation** | 保留响应 shape，重源 AdapterRegistry/health |

### 3.10 ConversationPort vs real conversation source

| | |
|---|---|
| **Impact** | 把 `list()` 当 SSOT 会弄坏侧栏 |
| **Evidence** | desktop/web `conversations.list` 仅 demo；真实列表来自 workbench models |
| **Mitigation** | 对齐 port 或停止假装 list 是产品数据 |

### 3.11 Settings SSOT triple UI

| | |
|---|---|
| **Impact** | 误改 orphan；或误删仍活的 SettingsPort |
| **Evidence** | live UI = shared `workbench/pages/SettingsPage`；desktop/web components pages orphan；SettingsPort adapters **仍 live** |
| **Mitigation** | import-graph 证明后再删；Edge diagnostics 走 SettingsPort |

### 3.12 TeamRun product surface ambiguity

| | |
|---|---|
| **Impact** | 合并 dead UI 或丢产品模型 |
| **Evidence** | 后端 agentteam 真；TeamRunConsole/Dock 未挂 App；demo fixture 活跃 |
| **Mitigation** | 先定 UI owner，再 merge 或 archive |

### 3.13 其他 hygiene / governance 矛盾

| Topic | Impact |
|---|---|
| MASTER 缺失 vs AGENTS 强制读取 | agent 启动漂移 |
| `.agenthub/memory/project.md` 过期 SUPER 叙事 | 重启死计划 |
| tracked binary + Tauri gen dirty tree | 脏 handoff / 二进制污染 |
| OpenAPI deprecations 时间表滞后 | 兼容面无限期 |

## 4. Security risk posture（cleanup 相关）

> 权威表：`docs/governance/security-risk-register.md`。此处只标 cleanup 优先级与代码事实对齐。

| ID | Severity | Register (as of baseline read) | Code fact (2026-07-16) | Cleanup action |
|---|---|---|---|---|
| **AH-SR-037** | High | Open | Web `hubTokenStorage` → sessionStorage | BFF/HttpOnly **或** Accepted risk + CSP/短 TTL/补偿 |
| **AH-SR-045** | High | Open | remote read 主要 owner filter；空 user/owner 软 | route/target/workspace/action 矩阵 + 负例 |
| **AH-SR-046** | High | Open（应标 partial） | Edge dual-token 校验在；claims 不全；**Hub 无 issuer** | 最小闭环：签发 + 绑定 + 负例 |
| **AH-SR-049** | High | Open（应标 partial） | Hub outbox 有；retry 未接线；Edge callback best-effort | 接线 + Edge journal 最小合同 |
| **AH-SR-043** | High/Open related | Open | auto/demo/fixture 仍可共享 mutation 路径 | dataMode 门禁 + 可见 badge + mobile fail-closed |
| **AH-SR-028** | Mitigated-ish | 需 deploy 证据 | config 拒硬编码 secret | 生产 JWT 轮换证据 |
| **AH-SR-035/036** | 证据缺口 | — | harness 缺 live OIDC / Desktop reconnect | 生产证据批，非再写一层框架 |
| **AH-SR-044** | 一致性 | — | runners 仍进 UI health | 重源兼容面 |
| **AH-SR-048** | runtime | — | adapter debug log 脱敏证据 | verify 批 |

**发布门禁提醒：** Critical/High 未修复、未验证或未 accepted 前阻断公开发布（`AGENTS.md` + risk register）。

## 5. Non-security operational risks

| Risk | Level | Notes |
|---|---|---|
| Wrong-host verification (hk2/us1 leftovers) | High | 污染 deploy 证据 |
| Image name footgun | High | 见 3.2 |
| Obsolete compose as “prod” | High | 见 3.3 |
| Committed binary re-entry | Med-High | ignore gap `server-hub` bare name |
| Dirty tree (gen + binary) | Med | 阻断 clean handoff |
| Smoke script false confidence | Med | 重叠矩阵 / 误标 real E2E |
| OpenAPI ghost routes | Med | 客户端打到死路径 |
| Disk bulk (reference 3.7G, worktrees 5.6G) | Low-Med ops | 非源码债 |
| No MASTER while AGENTS expects it | Med agent | stub 或改措辞 |

## 6. Test harness fitness for cleanup

### 6.1 Strong for security refactor

- Hub/Edge 大量 `*_test.go`（auth/middleware/jwt/capability/outbox）
- sqlite + miniredis + sqlmock + testify 常见
- skills / scripts：pre-push、verify-doc-ssot、coverage、readiness 分类存在

### 6.2 Weak for public-release evidence

- 缺 live OIDC browser、Desktop login/logout/reconnect 闭环证据
- mega-tests（1k–2k+ LOC）+ `time.Sleep` + 少 `t.Parallel` → 反馈慢、易碎
- smoke 多路径重叠，易被误引为 real

### 6.3 Cleanup verification spine（推荐）

| Grade | Commands / artifacts |
|---|---|
| **unit/short** | `go test -short`（hub + edge 相关包）；`pnpm typecheck` / `pnpm test` 聚焦包 |
| **contract** | router vs OpenAPI Hub 前缀核对；hubClient method parity tests |
| **security focused** | capability 负例；auth middleware；outbox retry wiring test |
| **doc SSOT** | `scripts/verify` 既有 doc-ssot 路径 |
| **observed / approved-real** | 现有 smoke 矩阵中 **一条** 路径 per grade；禁止 readiness 冒充 real |
| **prod evidence** | STATE 验证命令（更新后）+ secret 轮换 + 登录闭环记录 |

## 7. Risk-driven cleanup order

```
P0 truth & safety
  ├─ production narrative + image + STATE commands
  ├─ risk register partial flags (046/049)
  ├─ capability closed loop + remote authz
  ├─ outbox retry wire + Edge callback seam plan
  ├─ hubClient SSOT + AH-SR-043 gates
  └─ binary/gen dirty tree + stale memory
P1 structure without behavior change
  ├─ god-file mechanical extract (Hub dispatch/services, Edge handlers/lifecycle)
  ├─ deploy template demotion + CI policy doc
  ├─ orphan Settings/TeamRun decision
  └─ smoke matrix + OpenAPI hygiene
P2 debt burn-down
  ├─ runners re-source, envelope convergence plan
  ├─ mega-test split, reference prune
  └─ continued domain packages
```

**禁止顺序颠倒：** 不要在半成品 capability / outbox 上先做大规模无关清理；不要在 import-graph 前删 UI fork。

## 8. llmwiki / knowledge-plane risk

| Option | Verdict |
|---|---|
| 产品化 llm-wiki / RAG 第二事实源 | **不推荐** — 与现有 AGENTS/roadmap/architecture/risk SSOT 竞争 |
| 可选 knowledge compiler（agent 侧） | **可接受** — sources = repo docs + verified code facts；output = compiled markdown wiki；**永不反向覆盖 SSOT** |
| 用 wiki 替代 risk register / STATE | **禁止** |

## 9. Residual open questions（不阻塞基线，但影响执行）

见 `cleanup-strategy.md` §Open questions。关键未决：

1. Web session：改造 vs Accepted risk？
2. TeamRun 专用 UI 是否仍要产品化？
3. CI 对 live 产品应恢复哪些自动 gate？
4. capability claims 的最小字段集是否在本轮一次做完？
5. `app/desktop/src-tauri/gen` 是否仍需部分 schema 入仓？

## 10. Bottom line

- **架构健康度：可清理、可演进。**
- **安全健康度：有多个 Open High；若干已 partial 但文档未写。**
- **运维健康度：live 已恢复，叙事未跟上。**
- **推荐：knowledge-first strangler + 安全最小闭环优先，拒绝 rewrite 与第二知识平面。**
