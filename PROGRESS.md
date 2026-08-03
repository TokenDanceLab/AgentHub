# PROGRESS — #1566 A-V1 Step 2: Edge orchestrator 迁移到叶子包

分支: `feat/orchestrator-leaf`（基于 origin/master 07b2ad0f）
日期: 2026-08-03
任务书: `C:\Users\Ding\tmp\brief-A-1566.md`（任务书 A）

## 完成范围（完整迁移，非分批）

orchestrator 实现整体迁入叶子包 `edge-server/internal/adapters/orchestrator`（`package orchestrator`），
并完成依赖方向单向化：

### 1. 合同 SSOT 扩大（internal/orchestration）
- 新增 `internal/orchestration/contracts.go`：`AgentAdapter`、`EventEmitter`、`AdapterMetadata`、
  `AgentCapabilities`、`SubAgentTask`、`SiblingInfo`、`SubAgentSpawner`、`RunProcessContext`（alias）、
  `CtxBudgetKey`、全部 `BusEvent*` 事件常量。
- 根 `internal/adapters` 通过 `contract_aliases.go` 保留 alias（外部调用点零改动，非双 SSOT）；
  `context_budget.go` 改为 alias；`adapter.go` 精简为根包自有内容（`DefaultWorkDir`、
  `BuildSiblingContextPrompt`、ctx keys、`ParseStreamError`）。
- 说明：`DefaultPlanApprovalConfig` 不迁入 orchestration（属于 broker 行为），留在叶子包。

### 2. 叶子包迁移（13 源文件 + plan_approval.go + 测试）
- 13 个 `orchestrator*.go` + `plan_approval.go` 从根包 `git mv` 到叶子包。
- 叶子包新增 `ports.go`：`AgentExecutor`（agent execution port，由 ClaudeCodeAdapter 实现）、
  `AdapterRegistry`（adapter lookup port，由根 Registry 实现）。
- `NewOrchestratorAdapter` 签名改为 `(inner AgentExecutor, systemPrompt string)`：
  composition root（cmd/agenthub-edge）构造 ClaudeCodeAdapter 后注入（composition seam）。
- `Available()` 日志去掉 `inner.binaryPath`（port 不暴露根包私有字段；仅日志变化，返回值语义不变）。
- `FailureRecoveryManager`/`dispatchInterceptor` 的 `adapterRegistry` 字段改为 `AdapterRegistry` port。
- 共享测试 double 统一到 `test_doubles_test.go`（stubEmitter/busEmitter/fakeAgentExecutor/
  fakeAdapterRegistry/mockAgentAdapter），叶子测试不再依赖根包 helpers。

### 3. Composition root 装配
- `cmd/agenthub-edge/main.go`：`registerOrchestratorAdapter` 先建 ClaudeCodeAdapter 再注入叶子构造器。
- `internal/httpserver/server.go` / `server_wiring.go`：`NewPlanApprovalBroker`、
  `*orchestrator.OrchestratorAdapter`、`*orchestrator.PlanApprovalBroker`。
- `internal/api/handlers.go`：`PlanApprovalBroker` 字段类型改为叶子包类型。
- lifecycle 零改动（仅通过 alias 使用合同）。

### 4. Verifier 与自测
- `scripts/verify/verify-orchestrator-deps.ps1`（新）：三条机器断言
  1. 叶子包 `go list -deps` 不含根 `internal/adapters` 实现包；
  2. `internal/orchestration` 无 adapters 依赖；
  3. 根 `internal/adapters` 不含叶子包（单向 seam）。
- `scripts/verify/tests/verify-orchestrator-deps.Tests.ps1`（新）：3 个负向自测
  （positive / leaf-imports-root / orchestration-imports-adapters），fixture 在临时目录构建真实模块。
- 更新 `scripts/verify/test-sleep-baseline.json`（plan_approval_test.go 换路径，计数不变 3）。
- 更新 `scripts/verify/verify-live-chain-topology.ps1`（BuildCommand 合同断言指向新 SSOT 位置）。
- 更新叶子包 preflight 测试 `orchestrator_extract_preflight_test.go` 为迁移后不变式
  （文件在叶子、根不持有；叶子不 import 根；orchestration 中立；合同类型仅 alias；vet/build）。
- 更新 `docs/progress/MASTER.md`、`docs/plan/rfc-A-V1-adapters-lifecycle-split.md`。

### 5. 未动的部分
- `registry.go` 留在根 adapters（composition-level registry；issue 目标方向把 registry 放在
  composition root 层注入叶子，叶子通过 `AdapterRegistry` port 消费）。
- `edge-server/internal/lifecycle/**` 未改；hub-server/前端/OpenAPI 未改；
  `.github/workflows/**` 未改；task status/JSON/事件语义未改。

## 验证输出摘要

```powershell
cd edge-server
go build ./...                                          # PASS
go test ./internal/adapters/... -count=1 -short         # PASS (adapters + orchestrator)
go test ./internal/lifecycle/... -count=1 -short        # PASS
go test ./... -short -count=1                           # PASS (全部包)
go vet ./...                                            # PASS
go test ./internal/adapters/... -short -race -count=1   # 环境失败：TSAN 无法分配内存
                                                        # （ThreadSanitizer allocation error，
                                                        #  对未改动包 internal/events 同样失败，
                                                        #  属本机 Windows 环境限制，非本 PR 回归）
```

依赖方向机械证明：

```text
go list -deps ./internal/adapters/orchestrator/... | grep internal/adapters
  → 仅 github.com/agenthub/edge-server/internal/adapters/orchestrator（叶子自身）

go list -deps ./internal/orchestration/ | grep internal/adapters
  → （空）

go list -deps ./internal/adapters | grep adapters/orchestrator
  → （空）
```

负向证明（verifier 自测，真实 FAIL）：

```text
pwsh scripts/verify/tests/verify-orchestrator-deps.Tests.ps1
  PASS  positive fixture (one-way direction holds)
  PASS  leaf imports root adapters fails closed
  PASS  orchestration imports adapters fails closed
```

其他 verifier：`verify-test-sleep-ratchet.ps1` PASS；`verify-ci-gates.ps1` PASS；
`verify-edge-cli-dispatch-evidence.ps1` PASS；`verify-edge-cli-json-readiness.ps1` PASS；
`verify-backend-perf-leak-gates.ps1` PASS；`verify-live-chain-topology.ps1` 与本 PR 相关断言 PASS
（其余 29 项失败为主树既有问题：hub-server/app 文件缺失，主树同样失败，与本 PR 无关）。

## 阻塞点 / 偏差说明

- race 全量在本机不可跑（TSAN 分配失败），与改动无关（对未改动包同样失败）；已在 PR body 注明。
- `registry.go` 未迁入叶子包：issue 目标方向把 registry 置于 composition root 层（"composition root /
  registry 注入具体依赖"），且 lifecycle 通过 `*adapters.Registry` 强引用、lifecycle 禁止改动。
- 构造签名变更（`NewOrchestratorAdapter`）是 composition seam 的预期结果（issue 要求
  "composition root 显式构造并注册 orchestrator"）；对外行为、事件、JSON、状态语义不变。

## 剩余批次

无。本 PR 完成全部迁移（合同 SSOT + 叶子包 + ports + composition wiring + verifier/负向自测）。
