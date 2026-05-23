> 📦 已归档

# REST JSON + WebSocket 协议迁移计划

> 给后续执行 Agent / 同学使用：本计划只描述协议迁移步骤，不等同于最终协议文档。最终协议说明见 [protocol.md](protocol.md)，契约入口见 [../api/](../api/)。

## 目标

将 AgentHub 主协议收敛为更轻的：

```text
REST JSON API + WebSocket typed events
```

REST API 负责命令和查询，WebSocket typed events 负责实时状态流。OpenAPI 和事件 schema 负责约束字段。

Protobuf、Connect-RPC、JSON-RPC 不作为 UI / Hub / Edge / Runner 主链路的 M0 契约；只保留为未来可选方案，或局部 Agent bridge / sidecar 的内部协议。

## 当前目录结构

```text
AgentHub/
├── docs/
├── app/
│   ├── desktop/
│   ├── web/
│   └── shared/
├── hub-server/
├── edge-server/
├── runner/
├── api/
│   ├── README.md
│   ├── openapi.yaml
│   └── events.schema.json
├── scripts/
└── .agenthub/
```

不再使用旧主线：

```text
apps/
services/
packages/
proto/
docker/
```

Docker 配置随模块放置，不再单独恢复根级 `docker/`：

```text
hub-server/Dockerfile      # 仅当 Hub 需要容器化
edge-server/compose.yaml   # 仅当 Edge 需要本地依赖编排
runner/Dockerfile          # 仅当 Runner 需要隔离 Agent CLI 环境
compose.yaml               # 可选，仅用于跨模块一键联调
```

## 最终状态

迁移完成后，仓库应表达同一套协议方向：

```text
api/openapi.yaml             # REST API 契约
api/events.schema.json       # WebSocket 事件信封和事件 payload 契约
docs/protocol.md             # 人读说明：API、事件、错误、版本、兼容规则
docs/module-boundaries.md    # Hub / Edge / Runner / App / API 的职责归属
```

运行时链路：

```text
UI -> Edge       REST JSON API + WebSocket typed events
UI -> Hub        REST JSON API + WebSocket typed events
Edge -> Hub      REST sync API + reverse WebSocket typed events
Edge -> Runner   local REST API + typed event stream
Runner -> Agent  CLI 原生协议 / NDJSON / 局部 bridge
```

## 已在本次结构重构中完成

- [x] 顶层目录改为 `app/`、`hub-server/`、`edge-server/`、`runner/`、`api/`。
- [x] 删除空的旧占位目录：`apps/`、`services/`、`packages/`、`proto/`、`docker/`。
- [x] 新增 `api/README.md`。
- [x] 新增最小 `api/openapi.yaml`。
- [x] 新增最小 `api/events.schema.json`。
- [x] 新增 `docs/module-boundaries.md`，承接旧 `packages/*` 职责说明。
- [x] `README.md`、`README_EN.md`、`AGENTS.md` 已同步新目录和协议方向。
- [x] `docs/protocol.md` 已改为 REST JSON + WebSocket typed events。
- [x] `docs/agent-loop.md` 已改为 REST 命令 + WebSocket 事件流。

## 后续任务

### Task 1: 完善 OpenAPI

**Files:**

- `api/openapi.yaml`

补齐 P0/P1 请求、响应和错误结构：

```text
GET    /v1/projects
POST   /v1/projects
GET    /v1/threads
POST   /v1/threads
GET    /v1/threads/{threadId}
POST   /v1/runs
POST   /v1/runs/{runId}:cancel
POST   /v1/approvals/{approvalId}:decide
GET    /v1/artifacts/{artifactId}
GET    /v1/events
```

验收：

- 每个 endpoint 有 request / response schema。
- 错误统一使用 `ErrorResponse`。
- `GET /v1/events` 只描述 WebSocket 握手、鉴权和恢复参数，事件 payload 不放进 OpenAPI。

### Task 2: 完善 WebSocket event schema

**Files:**

- `api/events.schema.json`

补齐 event payload：

```text
message.created
message.delta
run.started
run.output
run.status.changed
approval.requested
artifact.created
preview.ready
run.finished
error
```

验收：

- event envelope 必含 `version`、`id`、`seq`、`type`、`sentAt`、`payload`。
- 每种 `type` 都有对应 payload schema。
- `seq` 能支持断线重连后的回放和去重。

### Task 3: 同步历史参考文档语境

**Files:**

- `docs/reference/README.md`
- `docs/reference/03-build/backend/13-protobuf-schema.md`
- `docs/reference/03-build/backend/14-scaffold-services.md`
- 其他仍把 Protobuf / Connect-RPC 当当前主线的 reference 文档

改法：

- 保留 Protobuf / Connect-RPC 研究资料，不删除。
- 在文件开头或索引中标明“历史参考 / 未来可选方案”。
- 当前实现入口指向 `api/openapi.yaml`、`api/events.schema.json`、`docs/protocol.md`。

### Task 4: 更新 GitHub Issue #1

建议标题：

```text
M0: 冻结 REST API、事件流和类型契约
```

建议正文：

```text
背景：当前协议方向从 proto-first/Connect-RPC 收敛为 REST JSON + WebSocket typed events。
目标：冻结 api/openapi.yaml、api/events.schema.json、docs/protocol.md。
验收：REST endpoint、事件 envelope、错误格式、版本/序号/去重规则一致。
```

如果需要，可以新增 label：

```text
area:api
```

### Task 5: 接入生成工具

不是 M0 必须项。后续可选：

- `oapi-codegen` 生成 Go server/client/types。
- `openapi-typescript` 生成 TypeScript client types。
- JSON Schema validator 校验 WebSocket events。

## 不做的事

本迁移不做：

- 不实现 Go HTTP server。
- 不实现 WebSocket server。
- 不生成 TypeScript client。
- 不引入 Connect-RPC。
- 不删除第三方 reference 原文。
- 不把历史 Protobuf 调研资料强行改写成 REST。

## 判断标准

迁移完成后，新同学应该能用一句话说清楚协议：

```text
AgentHub 用 REST JSON API 处理命令和查询，用 WebSocket typed events 推送实时状态；
API 契约写在 api/openapi.yaml，事件契约写在 api/events.schema.json。
```

如果文档还让人以为“必须先写 proto / 必须用 Connect-RPC / WebSocket 上跑 JSON-RPC”，说明迁移没有完成。
