# AGENTS.md - AgentHub 项目规则

## 0. 优先级

1. 管理员的直接指令
2. 本文件
3. `.agenthub/` 项目记忆
4. `docs/reference/` 调研文档

## 1. 先读什么

文档职责：

- `README.md` 是对外展示页，给评审、同学和新读者快速了解项目，不放细碎开发约束。
- `README_EN.md` 是英文补充入口，只保留对外介绍。
- `AGENTS.md` 是给开发者和 Agent 的开发规范、开发风格和流程约束；每个 Agent 开始工作前必须读。

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

AgentHub 的开发工作流是“三个开发者，每个开发者可以带一个或多个 Agent”。Agent 是协助者，不是仓库负责人。

| 部分 | 负责范围 | 主要目录 |
|---|---|---|
| 前端 | Web 工作台、IM 交互、Diff/Preview/Approval 面板、前端状态 | `app/web/`、`app/shared/` |
| 后端 | Hub Server、Edge-Hub 通信、账号/群聊/同步/中继 | `hub-server/`、`edge-server/`、`api/` |
| 客户端 | Desktop、Runner、Edge 本地调度、Agent CLI 进程、workspace | `app/desktop/`、`runner/`、`edge-server/` |

共享边界：

- API 契约写在 `api/`。
- Edge Server 同时连接前端、Hub 和 Runner，改动前先看 `docs/system-architecture.md`。
- 跨两个方向的改动先在 PR 描述里写清楚影响面。
- 开发者必须审查自己 Agent 生成的代码、文档和命令输出；不要把未看懂的 Agent 改动直接合入。

## 3. 技术主线

- Hub Server、Edge Server、Runner 使用 Go。
- UI 使用 React + TypeScript，Desktop 使用 Tauri。
- 主协议是 REST JSON API + WebSocket typed events。
- REST endpoint 入口是 `api/openapi.yaml`。
- WebSocket 事件入口是 `api/events.md`。
- Protobuf、Connect-RPC、JSON-RPC 只作为历史参考，不是当前主线。

## 4. Git 规则

开始工作前先同步：

```powershell
git switch master
git pull --ff-only
```

已有功能分支继续开发前：

```powershell
git fetch origin
git rebase origin/master
```

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
feat/frontend
feat/backend
feat/client
docs/short-topic
fix/short-topic
```

`master` 是稳定分支。实现、协议和结构调整走 PR；小文档修正可以直接提交，但不确定就走 PR。PR 标题也用 `type(scope): 中文摘要`。

进度同步：

- 每个开发者至少在一天结束前 push 当前分支。
- 完成一个可说明的小阶段就 push，不要把多天工作只留在本机。
- 跨方向改动尽早开 draft PR 或普通 PR，让另外两条线知道接口变化。
- PR 合并前先同步最新 `master`，解决冲突后再合。
- 不在共享分支上 force-push；确实需要时先在群里说明。
- Issue 只保留三部分主线任务：前端、后端、客户端。小任务写进对应 issue 或 PR，不额外开一堆 issue。

## 5. 文档规则

- 主文档只保留三份：产品需求、系统架构、功能实现。
- AgentHub 自有文档中文优先；`README_EN.md` 是唯一常规英文入口。
- 新增长期说明先考虑合并进三份主文档，不要随手新增根级文档。
- 详细调研放 `docs/reference/`。
- 历史方案、旧审查、旧计划放 `docs/archive/`。
- 文档、issue、PR 正文中文为主；代码标识、路径、API 字段、命令保留英文。
- 不使用未解释缩写。第一次出现时写白话解释。
- 修改目录、协议、分工后，同步 `README.md`、本文件和相关主文档。
- 不在文档中依赖个人本机绝对路径、私人服务器、私人账号或不可公开的环境。
- 如果别人克隆仓库后需要某个配置或命令才能开发，把它写进 `README.md`、三份主文档或 `.env.example`。

## 6. 安全和隐私

禁止提交或粘贴：

- `.env`、API key、token、cookie、私钥、证书、SSH 配置。
- 真实服务器 IP、内网地址、数据库连接串、生产账号、个人路径。
- 生产数据库 dump、用户数据、聊天记录、日志中的敏感字段。
- GitHub issue、PR、commit message 中也不要写上述内容。
- 本机 Agent 记忆和运行状态，例如 `.agenthub/memory/`、`.claude/`、`.codex/`。

执行规则：

- 需要示例配置时只提交 `.env.example`，值用占位符。
- 日志和错误截图提交前先检查是否含 token、路径、账号、服务器信息。
- Agent 运行命令前，先确认命令不会上传本地文件、打印密钥或访问生产数据。
- 不要因为“本机能跑”就把私有配置写死进代码；需要配置项时写成环境变量或本地配置文件，并提供公开示例。
- 新增本地生成目录、缓存、数据库、日志、私钥或 Agent 状态目录时，先更新 `.gitignore`。
- 如果误提交敏感信息，立即停止继续推送，通知维护者，旋转密钥，再清理历史。

## 7. 验证和测试

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

Go 服务测试要求：

- 新增核心逻辑要有同包 `*_test.go`。
- Hub/Edge/Runner 的接口边界优先写 handler 或 service 层测试。
- 涉及权限、路径、命令执行、同步序号的逻辑必须有失败用例。

有前端代码后追加：

```powershell
pnpm test
pnpm build
```

前端和客户端测试要求：

- 前端状态转换和 API client 要有单元测试。
- 关键 UI 流程后续用 Playwright 覆盖：新建 Thread、启动 Run、查看 Diff、Approval、Preview。
- Desktop/Runner 改动至少提供本地 smoke test 步骤；无法自动化时写在 PR 验收里。
