# AgentHub 风险评估（Cleanup Baseline）

> last-updated: 2026-07-16  
> purpose: cleanup baseline risks、verified contradictions、S.U.P.E.R health、debt surfaces  
> sources: 五条 discovery lanes + 主会话卫生债；安全发布 SSOT 仍是 `docs/governance/security-risk-register.md`

## 1. Executive judgment

1. **生产是 LIVE（hk3）**，不是 offline。最大运维风险是 **CI/docs 仍讲 decommissioned**。
2. **架构风险低于接线风险**：Hub/Edge/platform 边界大体正确；Open High 多来自半成品安全路径与证据缺口。
3. **适合增量 strangler**；不适合 rewrite。
4. **llmwiki 不作为产品第二事实源**；仅可选 *compiled knowledge layer*。
5. **Debt lane 不完整**：卫生 / scripts / reference / worktrees 必须在本文件与 strategy 覆盖。

## 2. S.U.P.E.R health summary

S.U.P.E.R = Single-purpose · Unidirectional · Ports · Environment-agnostic · Replaceable

| Module | S | U | P | E | R | Band | Notes |
|---|---|---|---|---|---|---|---|
| Hub Server overall | 🟢 | 🟢 | 🟡 | 🟡 | 🟡 | B+ | 控制面清晰；AgentService 浓度拖累 R |
| Hub `service` flat | 🔴 | 🟢 | 🟡 | 🟡 | 🟡 | C | 主内部风险面 |
| Hub `agentteam` | 🟢 | 🟡 | 🟢 | 🟢 | 🟡 | B | 抽取范本 |
| Hub auth/session | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | A- | 实现正确；缺 live 证据 |
| Hub handler / ws | 🟢 | 🟢 | 🟢/🟡 | 🟢 | 🟢/🟡 | A-/B+ | 相对健康 |
| Edge adapters CLI/SDK | 🟡 | 🟡 | 🟢 | 🟡 | 🟢 | B+ | orchestrator 错位降 S |
| Edge lifecycle | 🔴 | 🔴 | 🟡 | 🟡 | 🔴 | C- | god-object；P0 抽取 |
| Edge api handlers | 🔴 | 🔴 | 🟡 | 🟡 | 🔴 | C- | 安全改动 blast radius 大 |
| Edge hub callback | 🟢 | 🟢 | 🔴 | 🟢 | 🟡 | C+ | best-effort；缺 port |
| Edge runners | 🟢 | 🟢 | 🟡 | 🟢 | 🟢 | A- | 兼容壳；勿当执行中心 |
| Shared platform | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | A- | ConversationPort 未吃满 |
| Shared transcript | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | A | 清理期保护 |
| Shared workbench | 🟡 | 🟡 | 🟡 | 🟢 | 🔴 | C+ | 巨文件 |
| hubClient forks | 🔴 | 🔴 | 🔴 | 🟡 | 🔴 | D+ | 三份实现漂移 |
| Desktop shell | 🟡 | 🟡 | 🟡 | 🔴 | 🟡 | B | demo 默认与 orphan UI |
| Web shell | 🟡 | 🟡 | 🟡 | 🟢 | 🟡 | B | sessionStorage 拉低安全分 |
| Mobile RN | 🟡 | 🟢 | 🟡 | 🟡 | 🟡 | B- | 边界好；非主线 |
| API contract | 🟢 | — | 🟢 | 🟢 | 🟢 | B- | 体积 + ghost paths |
| Deploy/Ops narrative | 🔴 | 🔴 | 🔴 | 🟡 | 🟢 | D+ | **P0** |
| Scripts smoke/verify | 🟡 | — | 🟡 | 🟡 | 🟡 | C | readiness 噪声 |
| Governance/docs/skills | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | B+ | 漂移非缺体系 |
| Hub↔Edge delivery | 🟡 | 🟡 | 🔴 | 🟡 | 🟡 | C | **PARTIAL** |

**组合结论：** 边界层多为 B/A；浓度层（service/handlers/lifecycle/workbench）与叙事层（deploy/CI）是 cleanup 杠杆点。

## 3. Violation hotspots

### 3.1 生产叙事

| 热点 | 现象 | 影响 | P |
|---|---|---|---|
| CI `checks.yml` | decommissioned 叙事 + 节流 | 按 offline 行事 | P0 |
| server STATE 验证命令 | 仍 ssh hk2/us1 旧路径 | 事故响应打错拓扑 | P0 运维 |
| 镜像名 | `agenthub-hub` vs `agenthub-hub-server` | 错误 pull/rollback | P0/P1 |
| 旧 prod compose | 本地 PG / `tdadmin` | 重建过时栈 | P1 |
| nginx 叙述 | Hub 在 hk3，nginx 历史在 hk2 | 单主机假设误导 | P1 文档 |

**硬约束：** 任何 cleanup 文档与 PR **不得**把当前生产写成 offline / decommissioned。

### 3.2 代码热点

| 热点 | 规模 / 症状 | 风险 |
|---|---|---|
| `edge-server/internal/api/handlers.go` | ~2375 LOC | API 改动爆炸半径 |
| `edge-server/internal/lifecycle/process_executor.go` | ~2280 LOC | 执行+callback+spawn 缠死 |
| `edge-server/internal/store/store.go` (+ sqlite) | ~1560 + ~1179 | 多域仓库 |
| `adapters/orchestrator*` | ~2k+ | runtime 包污染策略 |
| Hub `service` flat | ~12k prod | dispatch/outbox/IM 混居 |
| `agent_dispatch.go` / `delivery_outbox.go` | 多 concern + 半接线 | 假 durability |
| 三份 `hubClient` | ~1.5k–1.9k ×3 | 合同漂移 |
| 孤儿 Settings / TeamRun | desktop/web 大文件 | 错误活跃面假设 |
| `AgentHubWorkbench` + tests | ~1768 + ~2987 | UI 改动成本极高 |
| OpenAPI 双表面 | 单 yaml 混 Edge+Hub | 文档路径漂移 |

## 4. Risk matrix

| ID | 类别 | 可能性 | 影响 | 等级 | 状态 | 响应 |
|---|---|---|---|---|---|---|
| R-PROD-1 | 叙事 | 高 | 高 | Critical 治理 | 开放 | Phase 0 对齐 CI/docs/STATE 指针 |
| R-SEC-037 | 安全 | 中 | 高 | High | Open | BFF/HttpOnly 或 Accepted risk |
| R-SEC-046 | 安全 | 中 | 高 | High | **PARTIAL** | claims/purpose/Hub 签发/负例/CORS |
| R-SEC-045 | 安全 | 中 | 高 | High | PARTIAL/Open | 远程 read 作用域授权 |
| R-SEC-049 | 可靠/安全 | 中 | 高 | High | **PARTIAL** | Edge journal + Hub retry 接线 + ack |
| R-SEC-043 | 产品诚实 | 高 | 中 | Medium-High | Open | dataMode 显式；mutation fail-closed |
| R-SEC-028/35/36/48 | 验证队列 | 中 | 高 | High | 验证中 | 轮换 / 真实登录 / 日志抽查 |
| R-EDGE-GOD | 可维护性 | 高 | 高 | High | 开放 | 先端口后拆文件 |
| R-HUB-SVC | 可维护性 | 高 | 中高 | High | 开放 | Dispatch/RunEvent/Callback 绞杀 |
| R-FE-FORK | 可维护性 | 高 | 中高 | High | 开放 | hubClient SSOT + 删孤儿 |
| R-DISPATCH-MAT | 成熟度 | 中 | 中 | Medium | 开放 | 代码保持 local_edge-only |
| R-TEST-READY | 质量信号 | 高 | 中 | Medium | 开放 | readiness 标注 |
| R-DEBT-FS | 卫生 | 高 | 低-中 | Medium | 开放 | reference/worktree/scripts |
| R-MOBILE | 范围蔓延 | 中 | 中 | Medium | 受控 | boundary-only |
| R-ENVELOPE | 协议债 | 中 | 低-中 | Low-Med | 短期接受 | 版本化收敛 |

## 5. High security risks（含 PARTIAL）

> 权威表：`docs/governance/security-risk-register.md`。此处对齐 **2026-07-16 代码事实**。

| ID | Severity | Register（基线读） | Code fact | Cleanup action |
|---|---|---|---|---|
| **AH-SR-037** | High | Open | Web `hubTokenStorage` → sessionStorage | BFF/HttpOnly **或** Accepted + 补偿 |
| **AH-SR-045** | High | Open | remote read 主要 owner filter | route/target/workspace/action + 负例 |
| **AH-SR-046** | High | Open（**应标 partial**） | Edge dual-token 校验在；claims 不全；purpose 不强制；**Hub 未见完整 issuer**；CORS 可能漏 header | 最小闭环：签发 + 绑定 + 负例 + CORS |
| **AH-SR-049** | High | Open（**应标 partial**） | Hub outbox 有；`StartDeliveryRetryLoop` 未接线；Edge callback best-effort | 接线 + Edge journal + idempotent ack |
| **AH-SR-043** | Open related | Open | auto/demo/fixture 可共享 mutation | dataMode 门禁 + badge + mobile fail-closed |
| **AH-SR-028** | Mitigated-ish | 需 deploy 证据 | 拒硬编码 JWT secret | 生产轮换证据 |
| **AH-SR-035/036** | 证据缺口 | — | 缺 live OIDC / Desktop 闭环 | 生产证据批 |
| **AH-SR-048** | runtime | — | adapter debug 脱敏证据 | verify 批 |

### AH-SR-046 — PARTIAL（详）

- **已有：** `PostRuns` dual-token 痕迹；`CapabilityClaims` 基础字段；部分测试。
- **缺失：** workspace/target/action/route 绑定；purpose 强制；Hub 签发 → Edge 校验闭环；wrong-device/project/user/stale 负例；CORS allow-headers。
- **禁止：** 因“看到 dual-token 代码”就写已关闭。

### AH-SR-049 — PARTIAL（详）

- **Hub：** outbox 模型 / migration / RecordDelivery 存在；**retry loop 接线存疑**。
- **Edge：** 内存 3 次 backoff 后丢弃；无 journal；本地 EventBus cursor ≠ Hub 投递合同。
- **关闭：** Edge journal + sequence + idempotent ack + Hub retry 真实运行 + 失败不可 silent continue。

### AH-SR-037 / 045 / 043

- **037：** XSS → session theft；二选一实现或 accepted。
- **045：** owner filter ≠ capability 模型。
- **043：** demo 假成功污染 merge-ready 与用户信任。

**发布门禁：** Critical/High 未修复、未验证或未 accepted 前阻断公开发布。

## 6. Testing risks

| 风险 | 说明 |
|---|---|
| readiness 冒充 real | 大量 verify/smoke 只证明形状 |
| mega-tests | Hub/Edge/Frontend 1k–3k 行测试锁错误抽象 |
| timing tests | `time.Sleep` fragile |
| Vite ≠ packaged Desktop | 声明 packaged 需另证 |
| fixture remote-control | 只证明拓扑形状 |
| mobile 静默 fallback | non-mock 失败回 fixture → 假绿 |
| 测试 > 生产 | 保护力高，重构摩擦也高 |

### 推荐 cleanup 验证脊柱

| Grade | Commands / artifacts |
|---|---|
| unit/short | `go test -short`（hub+edge 触达包）；`pnpm typecheck/test` |
| contract | router vs OpenAPI Hub 前缀；hubClient method parity |
| security focused | capability 负例；auth；outbox retry wiring |
| doc SSOT | `scripts/verify/verify-doc-ssot.ps1` |
| observed / approved-real | 每 grade 一条诚实路径；禁止 readiness=real |
| prod evidence | 更新后的 STATE 命令 + 轮换/登录闭环（私有） |

## 7. Governance drift

| 漂移 | 表现 | 纠正 |
|---|---|---|
| 生产状态 | CI decommissioned vs hk3 LIVE | 改 CI 注释/门禁策略；roadmap 短指针 |
| 安全登记 vs 代码 | 046/049 半落地未写 partial | Phase 0 校准 register |
| 部署多 SSOT | production / hub-server deployments / CD | 指定权威形状，其余 banner |
| 进度 SSOT | 无 active MASTER 却开始大型 cleanup | 重建 `docs/progress/MASTER.md` |
| 跨仓架构指针 | 可能仍指旧 system-architecture 路径 | 修指针 |
| llmwiki 诱惑 | 第二规则源 | wiki 仅编译层 |

## 8. Debt surfaces（卫生与体积）

| 表面 | 规模 | 风险 | 处理 |
|---|---|---|---|
| `reference/` 研究克隆 | ~3.7G ignored；tracked `INDEX.md` | 磁盘 / 误读 | 保持 ignore；不产品化 |
| `.worktrees/` | ~4.6G | 磁盘 / 旧分支混淆 | 合并后删 |
| scripts 家族 | ~80 体感 / ~63 ps1 | 入口噪声 | required vs readiness 分层 |
| dirty main noise | android gen 删除、`server-hub` binary | 误提交 | ignore；不把 noise 当功能叙事 |
| OpenAPI 巨石 | 混表面 | 合同漂移 | 路径 verifier；远期可拆 |
| 测试/prod 倒挂 | Edge/Hub test > prod | 重构摩擦 | 先测后拆 |
| stale memory / 无 MASTER | agent 启动漂移 | 指针化 / 建 MASTER |

## 9. Verified contradictions（高置信摘要）

1. **LIVE vs decommissioned** — STATE Current Role vs CI S1 注释  
2. **镜像名分裂** — production compose / cd-hub-server vs cd-production  
3. **DB 拓扑模板** — Azure `agenthub` vs 本地 postgres / `tdadmin`  
4. **Outbox retry 未启用** — 实现在、接线无  
5. **Capability 完成度被高估** — Edge 验、Hub 签不全  
6. **Local event durability ≠ Hub-Edge contract**  
7. **runners vs adapters** — 兼容面 vs 执行中心  
8. **ConversationPort.list vs 真实会话源**  
9. **Settings 三套 UI / TeamRun 产品面模糊**  
10. **MASTER 缺失 vs AGENTS 渐进加载假设**

## 10. Risk-driven cleanup order

```text
P0 truth & safety
  ├─ production narrative + image + STATE pointer honesty
  ├─ risk register partial flags (046/049)
  ├─ capability closed loop + remote authz
  ├─ outbox retry wire + Edge callback seam
  ├─ hubClient SSOT + AH-SR-043 gates
  └─ binary/gen dirty tree + scripts hygiene plan
P1 structure (behavior-stable)
  ├─ god-file mechanical extract
  ├─ deploy template demotion
  ├─ orphan Settings/TeamRun decision
  └─ smoke matrix + OpenAPI hygiene
P2 debt burn-down
  ├─ runners re-source, envelope plan
  ├─ mega-test split, reference prune
  └─ continued domain packages
```

**禁止顺序颠倒：** 不要在半成品 capability/outbox 上先做大规模无关清理；不要在 import-graph 前删 UI fork。

## 11. Bottom line

- **架构健康度：可清理、可演进。**
- **安全健康度：多个 Open High；046/049 已 PARTIAL 但文档常仍写全 Open。**
- **运维健康度：live 已恢复，叙事未跟上。**
- **Debt：体积与 scripts 噪声真实，但不等于架构失败。**
- **推荐：knowledge-first strangler + 安全最小闭环优先，拒绝 rewrite 与第二知识平面。**
