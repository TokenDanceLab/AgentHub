# RFC A-V1 — adapters/ 12.3k + lifecycle/ 7.6k 包拆分评估

> 状态: **已裁决 2026-08-03** — 采纳定向抽取；驳回 lifecycle 拆分与 adapters 全量叶子包化 · 执行入口 #1526（先合同解环，后移动文件）· **Step 2 已落地 2026-08-03（#1566）**
> 作者: senior-architect agent · 日期: 2026-07-30 · 更新: 2026-08-03（#1523 事实对齐；#1566 Step 2 完成）
> 权威: `docs/progress/MASTER.md`；裁决由审核 leader 拍板，实际移动文件仍需 AGENTS.md §5 审批（见 §9）
> 证据: 真实行数来自 `wc -l`，文件名来自 `edge-server/internal/{adapters,lifecycle}/*.go`

## 0. 摘要（先读）

- **lifecycle/ 不建议拆包**。D-V1 Step 1+2 刚把 `run()` 418→246 行（-41%），god function 主痛点已解；`process_executor_pure_*.go` 命名前缀已经在包内划出"纯谓词"子域，再强制成 `lifecycle/pure/` 叶子包收益 < churn。**诚实结论：D-V1 已覆盖 lifecycle 的拆分动机。**
- **adapters/ 建议做一次定向拆分，不做全量叶子包化**。28.5k 行 / 101 文件确实大，但 101 个文件同属 `package adapters`、共享 `AgentAdapter`/`EventEmitter`/`Registry` 契约，cohesion 真实存在。全量拆成 `cli/`/`sdk/`/`orchestrator/`/`registry/` 会牵动 31 个外部导入点，churn 巨大且收益线性。**只把最内聚、边界最清晰的 `orchestrator_*` 子域（2.97k 非测试行，13 文件）抽成 `adapters/orchestrator` 叶子包**，其余保持扁平。
- 拆分用 A-V4 验证过的 **type alias 反向兼容**模式（`hub-server/internal/service/eventbus.go` 即先例），零调用点改动。
- **需管理员 RFC sign-off**：MASTER 明示 A-V1 需管理员定档，且属 AGENTS.md §5 "大规模删除/移动文件"类高风险操作。

## 1. adapters/ 子域图谱

实测 `edge-server/internal/adapters/`：101 个 `.go` 文件，**28559 行**（含测试）。非测试源约 12.3k 行（与 issue 标题一致）。

按职责分组（非测试行数，测试行数括注）：

| 子域 | 关键文件 | 非测试行 | 测试行 | 备注 |
|---|---|---:|---:|---|
| **A. 契约 + 注册表** | `adapter.go` `registry.go` `context_budget.go` | 428 | (1187) | `AgentAdapter` 接口、`Registry`、`RunProcessContext` alias、`IsSDKAdapter`/`ValidateCLIAdapterID`。根契约，不拆。 |
| **B. CLI adapters** | `claude_code.go` `codex.go` `codex_dispatch.go` `codex_emit_{files,task,text,tools}.go` `codex_event_types.go` `opencode.go` `agentspec_fixture.go` | 2218 | (2597) | 三个 CLI 后端 + codex emit 拆分 + fixture。共享 `AgentAdapter` 契约，薄实现。 |
| **C. SDK adapters** | `anthropic_sdk.go` `anthropic_sdk_{request,sse,types}.go` `openai_sdk.go` `openai_sdk_{request,sse,types}.go` `sdk_common.go` | 1378 | (1884) | 两个 HTTP API 后端 + 共享 request/sse/types。 |
| **D. SDK fixture mapper** | `sdk_fixture_mapper.go` `sdk_fixture_mapper_{map,payload,sanitize}.go` | 711 | (908) | SDK 专用的 fixture 映射，C 子域强耦合。 |
| **E. Orchestrator** | `orchestrator.go` `orchestrator_dag.go` `orchestrator_dispatch_{handle,interceptor,parse,results}.go` `orchestrator_failure{,_circuit,_classify,_recovery}.go` `orchestrator_{ids,payloads,prompt}.go` | 2971 | (3119) | **最大单一内聚子域**：DAG 解析、dispatch 拦截、failure 分类/熔断/恢复、payloads。自含 13 文件。 |
| **F. NDJSON parser** | `parser_ndjson.go` `parser_ndjson_{emit,parse_msg,types}.go` | 713 | (407) | 通用 NDJSON 流解析，被 CLI adapters 复用。 |
| **G. Control protocol** | `control_protocol.go` `control_stubs.go` | 583 | (1246) | claude-code 双向 control 协议。 |
| **H. 事件发射层** | `event_emitter.go` `secure_emitter.go` `scanner.go` | 462 | (730) | `EventEmitter` 接口、安全包装、行扫描器。 |
| **I. Hooks** | `hooks.go` `security_hooks.go` `tool_allowlist_hook.go` | 720 | (1081) | `AgentHook` 接口 + 安全管线 + allowlist。 |
| **J. Surfacing** | `surfacing.go` `surfacing_{classify,diff,emit,walk}.go` | 824 | (155) | 工作区产物自动浮现，纯文件扫描逻辑。 |
| **K. 配置** | `model_config.go` `mcp_config.go` `runtime_manifest.go` `invocation_plan.go` `plan_approval.go` | 1220 | (1390) | 模型/MCP/运行时清单/调用计划/审批门。 |
| **L. ACP skeleton** | `acp.go` | 170 | — | #1404 spike，JSON-RPC over stdio 骨架。 |

**耦合事实**（grep 实测）：
- 外部非测试导入 `internal/adapters` 的点：9 个（`cmd/agenthub-edge`、`api/handlers*` ×4、`httpserver/server*` ×2、`mcp/server` + `mcp/tools_handlers`）。
- `lifecycle/` 内有 21 个文件导入 `adapters`（process_executor 家族全员）。
- 被引用最多的导出符号：`adapters.EventEmitter`(16) `adapters.AgentAdapter`(15) `adapters.Registry`(10) —— 这些是根契约，必须留在根包或 alias 回根包。
- adapters 对内仅依赖 `internal/store`(14) `internal/runnerctx`(9) `internal/agents`(4)，**无反向依赖**，是干净的叶子候选。

## 2. lifecycle/ 子域图谱

实测 `edge-server/internal/lifecycle/`：74 个 `.go` 文件，**17545 行**（含测试）。非测试源约 7.6k 行。

| 子域 | 关键文件 | 非测试行 | 测试行 | 备注 |
|---|---|---:|---:|---|
| **P1. process_executor 主族** | `process_executor.go` `process_executor_run.go` `process_executor_build.go` `process_executor_{spawn,start,cancel,finish,publish,hub_callback,structured,unix,windows}.go` | 1462 | (3554) | run/build/spawn/finish 管道。**D-V1 刚完成此处**。 |
| **P2. process_executor_pure 纯谓词** | `process_executor_pure.go` `pure_{adapter,cancel,ctx,fault,finish,hub,output,spawn,status}.go` | 2540 | — | 10 文件纯谓词，无副作用。**已是事实子域**（仅命名前缀，未成包）。 |
| **P3. DecisionLoop** | `decision_loop.go` | 459 | (337) | 多步执行循环 + 工具审批门。 |
| **P4. env_sanitizer** | `env_sanitizer.go` | 373 | (737) | 环境变量脱敏。 |
| **P5. evidence** | `evidence_gate.go` `runtime_evidence.go` | 454 | (519) | 运行时证据落盘。 |
| **P6. fault** | `fault_escalation.go` | 125 | (545) | 故障升级。 |
| **P7. 结果聚合/转录** | `result_aggregator.go` `subagent_result_sanitize.go` `thread_transcript.go` | 839 | (605) | orchestrator 子 agent 结果聚合 + 转录。 |
| **P8. 进程支持类型** | `process_{ids,payloads,profile,status,defaults,arg_log}.go` `run_{env,errors}.go` `run_output_limiter.go` `hub_output_text.go` `process_output_text.go` `child_budget.go` `error_with_run_output.go` `preview_runner.go` `session_conflict.go` | 1385 | (227) | 值对象 + 小工具。 |
| **P9. 接口 + mock** | `executor.go` `mock_executor.go` | 268 | (224) | `Executor` 接口 + 测试 mock。 |

**耦合事实**：
- 外部非测试导入 `internal/lifecycle`：9 个（同 adapters 的 api/mcp/httpserver 面）。
- `lifecycle/` 内 21 个文件反向导入 `adapters` —— **lifecycle 依赖 adapters，方向单一**。
- lifecycle 对内依赖：`adapters`(21) `store`(22) `runnerctx`(11) `agents`(7) `events`(4) `metrics`(2) `hub`(2)。

## 3. adapters/ 拆分建议

### 3.1 建议：仅抽 `adapters/orchestrator` 一个叶子包

理由（基于上表实测）：

1. **orchestrator 子域最大且最自含**（E 行，2.97k 非测试行，13 文件），有自己的 DAG 解析 / dispatch 拦截 / failure 子系统（`orchestrator_failure*` 4 文件占 1032 行），内部高内聚、对外只通过 `OrchestratorAdapter`（实现 `AgentAdapter`）+ `PlanApprovalBroker` 暴露。
2. **外部对 orchestrator 类型的直接引用极少**：全仓 `OrchestratorAdapter`/`ExecutionPlan`/`dispatchInterceptor`/`PlanApprovalBroker` 的非测试引用点 ≤ 13，且多数在 adapters 包内自引用。
3. **其余子域不值得拆**：
   - CLI/SDK adapters（B+C+D，4.3k 行）是 `AgentAdapter` 的薄实现，强共享根契约，拆出后每个叶子包都要回导 `AgentAdapter`/`EventEmitter`，净增 import 噪音。
   - NDJSON/Hooks/Surfacing/Config（F+I+J+K，3.4k 行）单文件多在 200–450 行，未到必须分包的体量；Hooks/Surfacing 跨 adapter 复用，拆开反而增加耦合面。
   - `acp.go`（L，170 行骨架）规模太小，不值得单独成包，留在根等 #1404 spike 成熟再说。

### 3.2 不建议：全量叶子包化（cli/sdk/registry 三分）

`package adapters` 的 101 文件确实大，但 **cohesion 真实**：`AgentAdapter`/`EventEmitter`/`Registry` 是所有子域的共同词汇表。全量拆分需改动 31 个外部导入点 + 101 文件的 package 声明，且每个新叶子包都要在根包留 type alias 回词汇表 —— churn ≈ A-V4 的 5–8 倍，而收益仅线性。**A-V4 能成立是因为 `bus` 只有 ~7 个导入点；adapters 量级不同。**

### 3.3 adapters/orchestrator 抽取后的结构

```
edge-server/internal/adapters/
  adapter.go            # AgentAdapter / EventEmitter / Registry 留根
  registry.go
  orchestrator/         # 新叶子包（插件式单向依赖，见 §6.1）
    orchestrator.go
    orchestrator_dag.go
    orchestrator_dispatch_{handle,interceptor,parse,results}.go
    orchestrator_failure{,_circuit,_classify,_recovery}.go
    orchestrator_{ids,payloads,prompt}.go
    orchestrator_test.go, orchestrator_dag_test.go, ...
  # 其余 cli/sdk/ndjson/hooks/surfacing/config/acp 保持扁平
```

依赖方向（Step 2 裁决，与 §6.1 一致）：`orchestrator` 叶子包只 import 根 `adapters`；根包**不**反向 import 叶子包、不保留 `OrchestratorAdapter` alias；注册/构造/装配由 composition root（`cmd/agenthub-edge`）承担。

## 4. lifecycle/ 拆分建议

### 4.1 建议：不拆包

- **D-V1 Step 1+2 已解主痛点**：`run()` 418→246 行（-41%），`buildAndStartProcess` + `collectAndWaitOutput` 提到 `process_executor_build.go`，循环体已成清晰三段管道。MASTER 2026-07-30 记录："D-V1 仍是唯一高价值重构——已完成"。
- **纯谓词子域已用文件名前缀表达**：`process_executor_pure_*.go` 10 文件 2.54k 行已是一组无副作用纯函数，无需再套 `lifecycle/pure/` 包边界——那是纯命名洁癖，没有依赖图收益（它们仍要导入 `adapters`/`store`）。
- **god function 全仓扫描已穷尽**（MASTER 2026-07-30）：其余 18 个 >150 行函数均为长但线性的路由/注册/wiring，无新 god function 重构目标。
- **`evidence`/`env_sanitizer` 子域**单文件 285–373 行，在可读区间，拆包只会让 `lifecycle/` 与 `lifecycle/evidence/` 之间多一层无意义跳转。

### 4.2 若未来仍想轻量整理

唯一有边际价值的动作：把 `mock_executor.go` + `executor.go`（接口+测试桩）迁到 `lifecycle/executor` 叶子包，让 `lifecycle` 包不再在产品代码里暴露 mock。但这属于测试卫生，不是架构拆分，且只有 268 行，**不推荐在本 RFC 范围内做**。

## 5. D-V1 重构是否改变拆分建议？

**是，对 lifecycle 改变显著；对 adapters 无影响。**

- **lifecycle**：D-V1 的目标正是 lifecycle 最大的 god function（`run()` 418 行）。它完成后，lifecycle 包不再有"必须拆包才能读懂"的函数。本 RFC 据此把 lifecycle 从"可考虑拆 `executor/`+`pure/`"调整为"不拆"。这是 D-V1 带来的新结论，不是原 issue 设想时的判断。
- **adapters**：D-V1 完全在 lifecycle 包内，未触及 adapters。adapters 的体量问题（28.5k 行）与 D-V1 无关，结论不变。

## 6. 迁移路径（Step 0 已完成；Step 2 采用插件式单向依赖）

### 6.0 Step 0 已完成（#1526）：plan contract SSOT 抽离

合同类型已从根 adapters 迁入中立包 `edge-server/internal/orchestration/`（唯一权威）：`TaskStatus`（+4 常量）、`PlanTask`、`ExecutionPlan`、`PlanApprovalConfig`、`PendingPlan`、`PlanDecision`。根 `adapters` 通过 `contract_aliases.go` 的 type alias 保持零调用点改动（含外部 `internal/api/handlers_approvals.go` 的 `adapters.PlanDecision`）。

合同依赖方向（本步已验证）：

```text
internal/orchestration（无依赖，中立合同）
      ↑
internal/adapters（contract_aliases.go 引用合同）
```

**边界**：本步只收敛合同 SSOT，**不解决** Step 2 叶子包的完整依赖环（orchestrator.go 对根包 `AgentAdapter`/`EventEmitter`/`Registry`/`PlanApprovalBroker` 等符号的强依赖仍在；其解环方案见 §6.1 裁决）。

回归门禁（`internal/adapters/orchestrator/orchestrator_extract_preflight_test.go`）：

- `TestImportCycleRisk`：硬门禁——adapters→orchestrator 下游类型引用必须为空（有环即 FAIL，不再是日志警报）。
- `TestOrchestrationContractNeutral`：orchestration 不得依赖 adapters（`go list -deps` 断言）。
- `TestContractTypesOwnedByOrchestration`：合同类型在 adapters 只允许 alias 形式（防双 SSOT 与环回退）。

### 6.1 Step 2 方向（已裁决 2026-08-03）：插件式单向依赖 → 实施为"叶子仅依赖合同与窄 ports"

**否决** A-V4 式"根包 alias 叶子包"迁移路径（原方案：根包 `type OrchestratorAdapter = orchestrator.OrchestratorAdapter` + `var NewOrchestratorAdapter = ...`，同时叶子包 import 根包）——根包反向 import 叶子包 + 叶子包 import 根包必然成环。

**#1566 实施裁决（比本 RFC 更严格）**：叶子包**不得** import 根 `internal/adapters` 实现包（verifier 机器断言）。共享合同（`AgentAdapter`/`EventEmitter`/`AdapterMetadata`/`AgentCapabilities`/`SubAgentTask`/`SiblingInfo`/`SubAgentSpawner`/`RunProcessContext`/`CtxBudgetKey`/`BusEvent*`）随叶子包一起迁入 `internal/orchestration`（合同 SSOT 扩大），根包保留 alias 使外部调用点零改动。叶子包定义窄 ports（`AgentExecutor`、`AdapterRegistry`），由 composition root 注入具体实现（`ClaudeCodeAdapter`、`*adapters.Registry`）。

```text
internal/orchestration（合同 SSOT：plan 类型 + adapter-domain 合同）
       ↑                          ↑
       │（叶子直接依赖合同）        │（根包 alias 引用合同）
internal/adapters/orchestrator ←── internal/adapters（实现 + Registry 留根）
       ↑
cmd/agenthub-edge / internal/httpserver（composition root 装配）
```

- 根 adapters **绝不** import 叶子包（机器门禁：`scripts/verify/verify-orchestrator-deps.ps1`）。
- 不保留根包 `OrchestratorAdapter` alias；orchestrator 的注册、构造、装配移到 composition root（`cmd/agenthub-edge` + `internal/httpserver`）。
- 移动文件清单不变（13 源 + 5 测试 + plan_approval.go，见 §1 子域图谱 E/K）。

Step 2 合入门禁：`go build ./...`、`go test ./internal/adapters/... ./internal/lifecycle/...`、`go vet ./...` 全过；`go list -deps ./internal/adapters/orchestrator/...` 证明叶子不含根实现包、`internal/orchestration` 无 adapters 依赖、根包不含 `internal/adapters/orchestrator`；负向自测（`scripts/verify/tests/verify-orchestrator-deps.Tests.ps1`）证明两类违规 fixture 真实 FAIL。

## 7. 门禁影响

- **现有门禁不覆盖此拆分**：`#1435 pure-packages`、`#1463 shared-boundary`、`#1467 hubClient-ssot` 等 14 层门禁均针对 hub-server / shared / 前端，edge-server/internal/ 的包边界目前**无 validate 硬门禁**。
- 拆分后建议补一条软门禁（非阻塞，先 lint）：`verify-edge-orchestrator-leaf.ps1` —— 禁止 `adapters/orchestrator` 反向 import `adapters/cli*`/`adapters/sdk*`，保持叶子包单向。等 ACP spike (#1404) 落地后再决定是否硬化为 `-ErrorAction Stop`。
- **不新增 coverage 门禁**：A-V1 是纯移动，不改行为，coverage 基线（`#1443`）不受影响。

## 8. 工作量 / 风险 / 建议

| 维度 | 评估 |
|---|---|
| **范围** | S–M。13 文件移动 + ~6 个 type alias。仅 adapters/orchestrator 一个叶子包。 |
| **调用点改动** | 外部 0（alias 兜底）；orchestrator 内部 import 调整 ~13 文件。 |
| **行为变化** | 无。纯结构性移动。 |
| **测试影响** | orchestrator_*_test.go 同步迁移，package 改声明；`go test` 预期全过。 |
| **风险** | 中低。主要风险是 import cycle（Step 0 预演可消解）；远低于 D-V1（#867 会话语义阻塞）。 |
| **收益** | adapters 根包从 ~12.3k 降至 ~9.3k 非测试行；orchestrator 子域获得独立边界，利于 #1404 ACP spike 并行迭代（failure 子系统可在叶子包内演进不污染根）。 |
| **建议** | **采纳 adapters/orchestrator 定向抽取；驳回 lifecycle 拆分与 adapters 全量叶子包化。** |

## 9. RFC sign-off 记录

**已裁决 2026-08-03（#1523）**：采纳"adapters/orchestrator 定向抽取、驳回 lifecycle 拆分与全量叶子包化"路径。理由：

1. lifecycle 拆分动机已被 D-V1 覆盖（run() 418→246 行），诚实结论是不拆。
2. 全量叶子包化牵动 31 个外部导入点，churn 巨大、收益线性；orchestrator 子域（13 文件）是唯一高内聚、边界清晰的抽取候选。
3. 新包边界门禁按软门禁先落地，硬化与否由 #1526 阶段再定。

**执行前置（不可省略）**：实际移动 13 个生产文件仍属 AGENTS.md §5 高风险审批项（"大规模删除/移动文件"），需在 #1526 开移动 PR 时获管理员批准；PR 需回链本 RFC 与 #1471。

## 10. 参考

- A-V4 先例：`c006e9f8` `refactor(hub): extract event Bus to internal/bus leaf package`，`hub-server/internal/service/eventbus.go` 的 alias 模式。
- D-V1 完成记录：MASTER 2026-07-30 "D-V1 Step 1+2：418→246 行 -41%"。
- god function 全仓扫描：MASTER 2026-07-30 "19 个 >150 行函数…D-V1 仍是唯一高价值重构"。
- ACP spike：#1404（紧迫度↑，codeg v0.22.1 已落地子 agent 直播）。
