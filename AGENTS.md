# AGENTS.md - AgentHub 项目规则

## 0. 优先级

1. 管理员的直接指令
2. 本文件
3. `.agenthub/` 项目记忆
4. `docs/reference/` 调研文档

## 1. 先读什么

人类同学先读：

1. `README.md`
2. `docs/product-requirements.md`
3. `docs/system-architecture.md`
4. `docs/implementation-guide.md`

Agent 开始写代码前先读：

1. 本文件
2. 与任务相关的三份主文档章节
3. `api/README.md`、`api/openapi.yaml`、`api/events.md`
4. 最多 1-3 篇相关 `docs/reference/**`，不要把 archive 全部扫一遍

`docs/archive/` 是历史方案和旧细分文档，只在追溯背景时读取。`reference/**` 是第三方仓库镜像，默认不改、不翻译。

## 2. 三人分工

| 方向 | 负责范围 | 主要目录 |
|---|---|---|
| 前端 UI 设计 | Web 工作台、IM 交互、Diff/Preview/Approval 面板、前端状态 | `app/web/`、`app/shared/` |
| 后端开发 | Hub Server、Edge-Hub 通信、账号/群聊/同步/中继 | `hub-server/`、`edge-server/`、`api/` |
| 客户端开发 | Desktop、Runner、Edge 本地调度、Agent CLI 进程、workspace | `app/desktop/`、`runner/`、`edge-server/` |

共享边界：

- API 契约写在 `api/`。
- Edge Server 同时连接前端、Hub 和 Runner，改动前先看 `docs/system-architecture.md`。
- 跨两个方向的改动先在 PR 描述里写清楚影响面。

## 3. 技术主线

- Hub Server、Edge Server、Runner 使用 Go。
- UI 使用 React + TypeScript，Desktop 使用 Tauri。
- 主协议是 REST JSON API + WebSocket typed events。
- REST endpoint 入口是 `api/openapi.yaml`。
- WebSocket 事件入口是 `api/events.md`。
- Protobuf、Connect-RPC、JSON-RPC 只作为历史参考，不是当前主线。

## 4. Git 规则

Commit message 使用英文 type/scope + 中文摘要：

```text
type(scope): 中文摘要
```

常用 type：

- `feat`：功能
- `fix`：修复
- `docs`：文档
- `refactor`：结构调整
- `chore`：仓库流程、脚本、依赖
- `test`：测试

分支命名用小写：

```text
feat/frontend-ui
feat/backend-hub-edge
feat/client-runner-desktop
docs/short-topic
fix/short-topic
```

`master` 是稳定分支。实现、协议和结构调整走 PR；小文档修正可以直接提交，但不确定就走 PR。PR 标题也用 `type(scope): 中文摘要`。

## 5. 文档规则

- 主文档只保留三份：产品需求、系统架构、功能实现。
- 新增长期说明先考虑合并进三份主文档，不要随手新增根级文档。
- 详细调研放 `docs/reference/`。
- 历史方案、旧审查、旧计划放 `docs/archive/`。
- 文档中文为主；代码标识、路径、API 字段、命令保留英文。
- 不使用未解释缩写。第一次出现时写白话解释。
- 修改目录、协议、分工后，同步 `README.md`、本文件和相关主文档。

## 6. 验证

文档或 API 变更至少运行：

```powershell
git diff --check
python -c "import yaml, pathlib; yaml.safe_load(pathlib.Path('api/openapi.yaml').read_text(encoding='utf-8')); print('yaml ok')"
git status --short --branch
```

有 Go 代码后追加：

```powershell
go test ./...
```

有前端代码后追加：

```powershell
pnpm test
pnpm build
```
