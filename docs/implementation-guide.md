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

## 2. 三人分工

后续按前端、后端、客户端三个部分并行推进，API 契约作为共享边界，不单独拆一堆文档分支。

| 部分 | 主要目标 | 主要目录 | 先读 |
|---|---|---|
| 前端 | Web 工作台、IM 流、Diff/Preview/Approval 面板、前端状态 | `app/web/`、`app/shared/` | `docs/reference/03-build/frontend/01-desktop-ux.md`、`docs/reference/01-learn/deep-dive/12-multica-product-ui.md` |
| 后端 | Hub Server、Edge-Hub 通信、账号/群聊/同步/中继 | `hub-server/`、`edge-server/`、`api/` | `docs/reference/03-build/backend/16-hub-server-requirements.md`、`docs/reference/03-build/backend/02-go-services.md` |
| 客户端 | Desktop、Runner、Edge 本地调度、Agent CLI、workspace、preview | `app/desktop/`、`runner/`、`edge-server/` | `docs/reference/03-build/backend/12-workspace-lifecycle.md`、`docs/reference/03-build/backend/04-adapter-sdk.md` |

## 3. API Foundation 已定规则

- REST API 负责命令和查询。
- WebSocket typed events 负责实时状态流。
- `api/openapi.yaml` 汇总 REST endpoint。
- `api/events.md` 汇总事件信封和事件表。
- `api/conventions.md` 规定 ID、错误、分页、权限、阶段。
- 不创建 `api/events.schema.json`，事件契约先用 `api/events.md` 维护，避免过早加重。
- 每条实现线都可以补 API，但必须先更新 `api/openapi.yaml` 或 `api/events.md`，再写代码。

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
- 三个长期 issue 是前端、后端、客户端；代码分支保持短小，例如 `feat/frontend-shell`、`feat/backend-health`、`feat/client-runner-mock`。
- 小修分支用 `docs/...` 或 `fix/...`。
- 文档、协议、服务结构变更走 PR。
- PR 尽量小，能让一个同学一次看完。
- commit 标题使用 `type(scope): 中文摘要`。
- 每条实现线至少每天 push 一次工作分支，避免进度只留在本机。
- 分支继续开发前先 `git fetch origin` 并同步最新 `master`。
- Agent 生成的代码由对应开发者负责审查、测试和解释。
- 首次克隆后运行 `.\scripts\setup.ps1` 启用本地 hooks；需要参考仓库时运行 `.\scripts\setup.ps1 -Reference core`。

## 8. 测试框架方向

测试框架跟实现一起补，不单独空转搭架子。GitHub Actions 先只做空白字符检查和 OpenAPI YAML 解析，具体 Go/前端测试随代码落地后再加入。

| 方向 | 测试重点 | 建议起点 |
|---|---|---|
| 前端 | API client、store、消息流状态、关键工作台交互 | 单元测试 + 后续 Playwright |
| 后端 | Hub handler、Edge-Hub sync、权限、错误码、事件序号 | Go `testing` + handler/service 测试 |
| 客户端 | Runner 进程、workspace 路径保护、stdout/stderr 事件转换、preview | Go `testing` + 本地 smoke test |

必须覆盖的高风险点：

- 权限和审批分支。
- 文件路径和 workspace 边界。
- Runner 命令执行和取消。
- WebSocket event 序号、重连和重复事件。
- Edge-Hub 同步的断线恢复。

## 9. 安全边界

- 不提交 `.env`、token、cookie、私钥、真实服务器地址、生产数据库 dump。
- 示例配置只用 `.env.example` 和占位符。
- issue、PR、日志、截图里也不能出现真实密钥或服务器隐私。
- Agent 执行命令前要确认不会上传文件、打印密钥或访问生产数据。

## 10. 验收命令

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
