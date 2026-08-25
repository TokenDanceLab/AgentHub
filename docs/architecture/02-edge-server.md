# Edge Server

> 子文档 | 主索引：[architecture.md](../architecture.md)
>
> 最后更新：2026-08-20

## 职责

Edge Server（`edge-server/`）是本机执行层：

- 本地项目管理
- Thread 管理
- Context Builder（构建 Agent 执行上下文）
- Run lifecycle（一次执行的生命周期管理）
- Agent Runtime adapter（统一不同 Agent CLI/SDK 的协议）
- Artifact index（产物索引）

## 在架构中的位置

```text
Desktop shared workbench
  -> Desktop platform adapter
  -> Local Edge Server           <-- 本文档（执行 / Thread / Run / Artifact）
  -> AgentAdapter
  -> Claude Code / Codex / OpenCode
```

```text
Web shared workbench
  -> Web platform adapter
  -> Hub Server
  -> Edge routing / relay
  -> Edge Server                 <-- 本文档（远程）
  -> AgentAdapter
```

## 组件总览

| 组件 | 职责 |
|---|---|
| 项目管理 | 本地 workspace 的项目发现和注册 |
| Thread | 会话线程管理，上下文窗口维护 |
| Context Builder | 从 AGENTS.md、memory、Skill、MCP 等构建执行上下文 |
| Run lifecycle | 单次 Agent 执行的完整生命周期 |
| AgentAdapter | 将不同 Agent Runtime 的协议统一为 `RunEvent` 流 |
| Artifact index | Agent 产物的索引、预览和应用 |
| EventStore | 执行事件的持久化存储 |

## Run Lifecycle 状态机

`RunExecutor` 接口（`internal/lifecycle/executor.go`）定义运行状态转换入口：`queued → started → running → finished / failed / cancelled / completed_with_issues`。

| 组件 | 文件 | 职责 |
|---|---|---|
| ProcessExecutor | `internal/lifecycle/process_executor.go` | 启动 agent CLI 子进程、管理 stdin/stdout pipe、超时与优雅关闭 |
| DecisionLoop | `internal/lifecycle/decision_loop.go` | 包装 adapter 事件流，step 计数、maxSteps 强制、工具审批门控 |
| EvidenceGate | `internal/lifecycle/evidence_gate.go` | 运行前/后证据验证门 |
| FaultEscalation | `internal/lifecycle/fault_escalation.go` | 故障自动重试链：失败后按 `MaxRetries` 自动重试，错误 review 与 replan 交由 agent in-context 自纠错 |
| EnvSanitizer | `internal/lifecycle/env_sanitizer.go` | 运行环境变量脱敏 |

ProcessExecutor 配置 `RunTimeout`（默认 30 分钟）、`ShutdownGracePeriod`（默认 10 秒），Unix 下先 SIGTERM 再 SIGKILL。

## Store 与事件持久化

`Store`（`internal/store/store.go`）是核心内存数据结构，管理 Project、Thread、Run、Item、Pin、Diff、Artifact、Preview、UserProfile、AgentProfile、Settings 的全量 CRUD。`SQLiteStore`（`internal/store/sqlite_store.go`）通过 snapshot 持久化到 SQLite（WAL 模式，定期 checkpoint），支持崩溃恢复。终端状态 runs（completed/failed/cancelled/completed_with_issues）按 `TerminalTTL` 超时或 `MaxTerminalRunsPerThread` 上限自动清理，级联删除关联 diffs/artifacts/previews/items。

`EventBus`（`internal/events/bus.go`）是基于 channel 的发布/订阅模型：4 worker 并发 observer、子 channel 缓冲（256）、gap detection（`system.gap` 事件）；通过 `PersistFn` 钩子先持久化再广播。`EventLog` 是 append-only JSON-lines 事件日志（默认 50 MiB 上限，超限截断保留尾部 75%）。

## Source Map

| 方向 | Source |
|---|---|
| CLI/config | `cmd/agenthub-edge/` |
| REST/WS handlers | `internal/api/`, `internal/httpserver/` |
| Event bus/replay | `internal/events/` |
| Store | `internal/store/` |
| Run lifecycle | `internal/lifecycle/` |
| Runtime adapters | `internal/adapters/`（按家族分子包，见下） |
| Agent registry/queue | `internal/agents/` |
| Context / skills / MCP | `internal/runnerctx/`, `internal/skills/`, `internal/mcp/` |
| Session index | `internal/sessionindex/` |
| Security / permission | `internal/security/`, `internal/permission/`, `internal/edgeidentity/` |
| Metrics / run control | `internal/metrics/`, `internal/runcontrol/`, `internal/runnerctx/` |
| Runners compat summary | `internal/runners/` — compat summary only; `/v1/runners` is not a new business Agent model |

## Adapter 家族子包（#1760）

`internal/adapters/` 已从平铺大包拆分为按 Agent 家族归组的子包。依赖方向分两类：`claude`/`codex`/`opencode`/`sdk` 是依赖根包的叶子（embed 根包共享机制如 `AcpAdapter`）；`orchestrator` 是**唯一不依赖根包的纯叶子**（经机器门禁禁止 import 根 `internal/adapters` 实现，只依赖 `internal/orchestration` 合同 + 窄 ports）。根包（非测试代码）不 import 任何子包，仅保留字符串适配器 ID，注册由组合根（`cmd/agenthub-edge`、`internal/httpserver`）完成。共享机制（`AcpAdapter`、NDJSON parser、权限处理链、MCP 临时配置、registry）留在根包。

| 家族 | 子包 | 内容 |
|---|---|---|
| Claude | `internal/adapters/claude/` | legacy `ClaudeCodeAdapter`（`claude-code`，DEPRECATED）+ 官方 ACP `ACPAdapter`（`claude-acp`） |
| Codex | `internal/adapters/codex/` | ACP `CodexACPAdapter`（`codex-acp`） |
| OpenCode | `internal/adapters/opencode/` | 原生 ACP `ACPAdapter`（`opencode-acp`） |
| Orchestrator | `internal/adapters/orchestrator/` | 群聊编排 `OrchestratorAdapter`（`orchestrator`）+ dispatch interceptor 各子层（纯叶子，不依赖根包） |
| SDK | `internal/adapters/sdk/` | HTTP `AnthropicSDKAdapter`（`anthropic-sdk`）、`OpenAISDKAdapter`（`openai-sdk`） |
| Test fixtures | `internal/adapters/testdata/` | 测试共享 JSON fixtures（`sdk_fixture_mapper/`）；mapper 代码在根包 `sdk_fixture_mapper.go` |

纯包门禁：`orchestrator` 叶子包经 `scripts/verify/verify-orchestrator-deps.py` 机器门禁（断言：叶子不 import 根、`internal/orchestration` 不 import adapters、根不 import 叶子），`TestLeafDoesNotImportRootAdapters` 保证依赖方向单向。共享 ACP 运行时（`acp.go` `AcpAdapter`）与各家族子包共置于根包平铺区（残留平铺文件含 `acp*.go`/`parser_ndjson*.go`/`registry.go`/`sdk_fixture_mapper.go` 等）。

## 与 Hub 的通信

| 方向 | 方式 |
|---|---|
| Hub -> Edge | REST callbacks + Hub WebSocket dispatch/relay |
| Edge -> Hub | 同步、状态上报 |

## Adapter 注册表

Edge 维护一个 adapter registry，根据 runtime type 分发到对应 adapter：

- CLI Adapters：Claude Code、Codex、OpenCode
- SDK HTTP Adapters：Anthropic SDK、OpenAI SDK
- Orchestrator Adapter：群聊编排、子 Agent 调度

详见 [03-runtime-adapters.md](03-runtime-adapters.md)。

## Agent 产品模型中的角色

| 概念 | Edge 的角色 |
|---|---|
| Agent Runtime | adapter registry 管理 |
| Agent Profile | 本地 profile 存储 |
| Agent Configuration | Context Builder 构建 |
| Execution Target | 本地注册、remote/cloud 路由 |
| Run Session | lifecycle + EventStore |

## 事件流

```text
Agent Runtime -> Edge EventStore -> Edge/Hub WS -> Platform Adapter -> Transcript
```

```text
RunEvent -> EvidenceRef -> Inspector -> Artifact/File/Preview
```

```text
Edge EventStore -> Hub Sync -> Web/Desktop/Mobile viewers
```

## Checkpoint 与恢复语义（#1968）

**Checkpoint = run 前快照**：执行开始前对 workdir 取快照（`adapters.TakeWorkdirSnapshot`：≤500 文件、单文件文本内容 ≤128KB、跳过隐藏/忽略目录），作为该 run 的 checkpoint 持久化，供时间线卡预览。无 workdir 的 run 诚实缺省——不发射 checkpoint、前端不渲染卡。

**数据合同**：

- 事件 `run.checkpoint`（Edge→客户端）：`runId`、`checkpointId`、`fileCount`、`totalBytes`、`createdAt`；在 run.started 之前发射（快照先于进程启动）。
- 存储 `RunCheckpoint`（与 run 1:1）：文件清单（相对路径/大小/SHA-256）+ 文本内容预览副本；只读，不随 run 结束删除（回放/审查证据面）。
- API：`GET /v1/runs/{runId}/checkpoint`（元数据 + 文件清单）、`GET /v1/runs/{runId}/checkpoint/file?path=...`（单文件预览内容；路径必须命中 checkpoint 记录，防路径逃逸）。

**恢复语义（先文档后实现；本期不落写回）**：

- 恢复 = 把 checkpoint 状态写回 workdir，属写回操作。按 #1870 收口结论，写回走远程证据轨道：需携带执行器上报的可信 workDir 证据（同 run 审查 workDir 合同）、用户显式批准动作与审计记录；Web 表面禁止（Hub-only 边界）。
- 权限边界：恢复只允许写回 checkpoint 自身 run 的 workdir；跨目录、符号链接逃逸、checkpoint 文件集之外的写入一律拒绝（与 `validateWorkDirAllowed` 硬边界同源）。
- 本期产品形态：时间线卡提供只读预览 + 明示「恢复未接线」的诚实提示；不提供假恢复按钮，不产生第二套回滚状态机。

## 相关文档

- [01-hub-server.md](01-hub-server.md) — Hub 与 Edge 的同步和中继关系
- [03-runtime-adapters.md](03-runtime-adapters.md) — 所有 adapter 的详细规范
- [04-frontend-data-flow.md](04-frontend-data-flow.md) — 前端如何消费 Edge 事件
- [../archives/reference/backend-performance-gates.md](../archives/reference/backend-performance-gates.md) — Edge lifecycle/store/adapters 的性能和泄漏证据边界（已归档 2026-08-19；当前门禁执行者 `scripts/verify/verify-backend-perf-leak-gates.py`）
