# 文档审计报告 — 2026-05-23

> 审计范围：`docs/archive/`、`docs/reference/02-decide/`、`docs/reference/03-build/backend/`、`docs/system-architecture.md`、`docs/implementation-guide.md`
> 审计人：Agent (Task #3)
> 分支：`dev/delicious233`

## 总体统计

| 目录 | 文件数 | 标记类型 |
|---|---|---|
| `docs/archive/` | 25 | `📦 已归档` |
| `docs/reference/02-decide/` | 7 | `✅/🔄/⏳` |
| `docs/reference/03-build/backend/` | 16 | `✅/🔄/⏳` + 1 `📦` |
| 系统文件 | 2 | 已验证 |
| **合计** | **50** | |

## 状态分布

| 状态 | 数量 | 占比 |
|---|---|---|
| ✅ 已落地 | 2 | 4% |
| 🔄 进行中 | 11 | 22% |
| ⏳ 计划中 | 11 | 22% |
| 📦 已归档 | 26 | 52% |

## 系统文件验证

### `docs/system-architecture.md`
- **状态**: 活跃维护
- **内容**: Hub-Edge-Runner 架构、P0 拓扑、组件职责、通信方式、三条数据线、EventStore 语义、权威模型、数据模型主线、部署阶段 M1-P4、文档分层
- **与代码一致性**: 一致。当前处于 M1 收口阶段，Desktop UI -> Local Edge -> Mock Run -> WebSocket events 链路已跑通。
- **建议**: 无。架构文档准确反映当前系统状态。

### `docs/implementation-guide.md`
- **状态**: 活跃维护
- **内容**: M1 收口目标、三人分工（前端/后端/客户端）、API Foundation 规则、阶段路线 M1-M4、Go 服务边界、WebSocket 输出规则、开发规范、测试现状、安全边界、验收命令
- **与代码一致性**: 一致。描述了已跑的测试框架（Go test/Vitest/Playwright/smoke），M2 目标（Edge 本地数据持久化）正在推进。
- **建议**: 无。实现文档准确反映当前开发阶段。

## 02-decide 详情

| 文件 | 状态 | 说明 |
|---|---|---|
| `01-adapters.md` | 🔄 | Agent 适配器接口已设计，M1 mock 已实现，M3 真实 adapter 待接入 |
| `02-im-ux.md` | 🔄 | Desktop UI 基础框架已建立，IM 完整 UX 待后续迭代 |
| `03-orchestration.md` | ⏳ | P1+ 多 Agent 调度，当前未实现 |
| `04-sandbox-tools.md` | ⏳ | workspace 隔离列入 M4，sandbox/tool registry 未实现 |
| `05-undo-rollback.md` | ⏳ | 未列入当前 M1-M4 里程碑 |
| `06-realtime-sync.md` | 🔄 | M1 WebSocket 基础事件已通，seq/cursor 重连已实现 |
| `07-permission-models.md` | 🔄 | 基础审批请求已实现，完整权限管道待后续 |

## 03-build/backend 详情

| 文件 | 状态 | 说明 |
|---|---|---|
| `01-protocol.md` | 🔄 | M1 核心事件类型已实现，完整类型体系随 M2-M4 迭代 |
| `02-go-services.md` | 🔄 | 基础模块结构已建立，持久化层 M2 推进中 |
| `03-eventstore-memory.md` | 🔄 | M1 内存 bus 已实现，持久 EventStore 列入 M2 |
| `04-adapter-sdk.md` | ⏳ | 真实 adapter 接入列入 M3 |
| `05-context-builder.md` | ⏳ | 未在 M1-M2 范围 |
| `06-concurrency-limits.md` | ⏳ | 未在 M1-M4 范围，设计预留 |
| `07-observability.md` | 🔄 | 基础 /healthz 已实现，完整可观测性待后续 |
| `08-error-handling.md` | 🔄 | 基础错误码在 API 层已使用，完整体系待实现 |
| `09-testing-strategy.md` | ✅ | Go/Vitest/Playwright/smoke 四层测试已覆盖 M1 |
| `10-graceful-degradation.md` | ⏳ | 未在 M1-M4 范围，设计预留 |
| `11-model-fallback.md` | ⏳ | M3 真实 adapter 接入后启用 |
| `12-workspace-lifecycle.md` | ⏳ | 列入 M4 |
| `13-protobuf-schema.md` | 📦 | 历史方案，当前主线为 REST JSON + WebSocket |
| `14-scaffold-services.md` | ✅ | go.mod/Makefile/CI 已配置并运行 |
| `15-websocket-reliability.md` | 🔄 | M1 基础 bus 已实现，可靠投递待 M2+ |
| `16-hub-server-requirements.md` | ⏳ | Hub Server 为 P0 边界外，P2+ 实现 |

## 发现与建议

### 已落地 (✅)
- 测试策略已按四层金字塔执行，覆盖 Edge/Runner/Desktop 核心链路
- 项目脚手架（go.mod、Makefile、CI、lint）已就绪

### 推进中 (🔄)
- 协议类型、Go 服务结构、EventStore、WebSocket 可靠性均处于 M1->M2 过渡期
- 适配器接口、IM UX、实时同步、权限模型有基础实现但未完成
- 错误处理、可观测性有最小实现，完整方案待补

### 待启动 (⏳)
- 11 份设计文档对应的功能尚未进入里程碑（orchestrator、sandbox、undo、context builder、concurrency、graceful degradation、model fallback、workspace lifecycle、Hub Server）
- 建议 M2 收口后重新评估这些设计的优先级

### 无独立文档覆盖的已知实现
以下功能在代码中已落地但无独立 reference 文档：
- AgentAdapter 层（`edge-server/internal/adapters/`）
- Desktop 启动编排（`app/desktop/src-tauri/`）
- `api/openapi.yaml` 和 `api/events.md` 契约文件

这些由 `system-architecture.md` 和 `implementation-guide.md` 间接覆盖，不需要额外文档。
