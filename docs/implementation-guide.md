# AgentHub 功能实现文档

## 1. 当前实现目标

当前阶段先完成 API foundation 和后续模块接口规范，然后进入 Go 服务和 UI 实现。

主线：

```text
REST JSON API + WebSocket typed events
```

接口契约位置：

```text
api/
├── README.md
├── conventions.md
├── openapi.yaml
└── events.md
```

## 2. 模块分工

后续按模块分支并行推进。

| 分支 | 主要文件 | 负责人方向 |
|---|---|---|
| `docs/api-im-project` | `api/im-project.md`、`api/openapi.yaml` | Project、Conversation、Thread、Message、Item |
| `docs/api-execution-runner` | `api/execution-runner.md`、`api/openapi.yaml` | Runner、Run、Approval、Artifact、Preview、Workspace |
| `docs/api-hub-sync-relay` | `api/hub-sync-relay.md`、`api/openapi.yaml` | Auth、User、Device、Edge、Sync、Relay、Cloud |
| `docs/api-contract-review` | `api/` 全部 | 命名、错误、事件、权限、分页一致性审查 |

## 3. API Foundation 已定规则

- REST API 负责命令和查询。
- WebSocket typed events 负责实时状态流。
- `api/openapi.yaml` 汇总 REST endpoint。
- `api/events.md` 汇总事件信封和事件表。
- `api/conventions.md` 规定 ID、错误、分页、权限、阶段。
- 不创建 `api/events.schema.json`，事件契约先用 `api/events.md` 维护，避免过早加重。

## 4. P0 实现顺序

建议实现顺序：

1. Edge 本地 HTTP server。
2. Edge WebSocket event stream。
3. Project / Thread / Item 本地存储。
4. Runner 注册和心跳。
5. `POST /v1/runs` 启动本地 AgentRun。
6. Runner stdout/stderr 转 `run.output.batch`。
7. Artifact / Diff 索引。
8. Approval request / decision。
9. Preview 启动和 `preview.ready`。
10. Apply / Discard。

## 5. Go 服务边界

### Edge Server

负责：

- REST API for UI。
- WebSocket event stream。
- Project / Thread / Item 存储。
- Context Builder。
- Approval policy。
- Runner Manager。
- Artifact index。

不负责：

- 直接执行 Agent CLI。
- 直接读写远程 Cloud workspace。

### Runner

负责：

- Agent CLI 子进程。
- workspace / worktree。
- stdout/stderr。
- Diff。
- Preview。
- 文件路径保护。

不负责：

- IM 消息主序列。
- Hub 账号和群聊。

### Hub Server

负责：

- Auth / User。
- Contact / Group。
- Edge 注册。
- Edge-Hub sync。
- Hub relay。
- Web/Mobile 远程控制。

P0 不要求 Hub 完整实现。

## 6. WebSocket 输出规则

Runner 输出不要逐行直接刷 UI。

建议：

```text
50ms 或 8KB 聚合一次 -> run.output.batch
```

每个事件带：

```text
version / id / seq / type / scope / sentAt / payload
```

断线重连用 `cursor` 恢复；无法恢复时，客户端重新拉 REST snapshot。

## 7. 开发规范

- 分支从 `master` 切出。
- 分支名用 `docs/...`、`feat/...`、`fix/...`。
- 文档和协议变更走 PR。
- PR 尽量小，能让一个同学一次看完。
- commit 标题使用 `type(scope): 中文摘要`。

## 8. 验收命令

文档/API 变更至少运行：

```powershell
git diff --check
python -c "import yaml, pathlib; yaml.safe_load(pathlib.Path('api/openapi.yaml').read_text(encoding='utf-8')); print('yaml ok')"
```

后续有 Go 代码后追加：

```powershell
go test ./...
```

后续有前端代码后追加：

```powershell
pnpm test
pnpm build
```
