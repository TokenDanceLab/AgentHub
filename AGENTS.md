# AGENTS.md - AgentHub 项目规则

## 0. 优先级

1. 管理员的直接指令
2. 本文件
3. `.agenthub/` 本地项目记忆（如果存在）
4. `docs/reference/` 调研文档

## 1. 渐进式加载

文档职责：

- `README.md` 是对外展示页，给评审、同学和新读者快速了解项目，不放细碎开发约束。
- `README_EN.md` 是英文补充入口，只保留对外介绍。
- `AGENTS.md` 是给开发者和 Agent 的开发规范、开发风格和流程约束；每个 Agent 开始工作前必须读。

人类同学先读：

1. `README.md`
2. `docs/product-requirements.md`
3. `docs/system-architecture.md`
4. `docs/implementation-guide.md`

Agent 不要一次性扫全仓库。按下面顺序加载，够用就停：

1. 先读本文件。
2. 明确任务卡：目标、所属方向、写入范围、接口影响、验收命令。
3. 只读相关主文档章节：产品不清读 `docs/product-requirements.md`；边界不清读 `docs/system-architecture.md`；实现顺序不清读 `docs/implementation-guide.md`。
4. 改接口时读 `api/README.md`、`api/openapi.yaml`、`api/events.md`。
5. 客户端 M1 任务读 `docs/client-roadmap.md`。
6. 需要论证时最多读 1-3 篇精确的 `docs/reference/**`。

`docs/archive/` 只在追溯旧方案时读。`reference/**` 是第三方源码镜像，默认不改、不翻译、不全文扫描。

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

任务分发：

- 一个主线 issue 对应一个方向：前端、后端、客户端。小任务写进对应 issue、路线图或 PR。
- 分发前先写任务卡：分支名、worktree、负责人、写入范围、依赖、验收命令。
- 只有写入范围互不重叠时才并行；会改同一批文件的任务按顺序做。
- 主 Agent 负责拆解、验收、提交和 PR；subagent 只负责被分配的窄任务。
- subagent 提示必须包含：目标、允许修改的路径、必须阅读的文档、必须运行的检查、隐私红线。
- subagent 不自行扩大范围；发现范围不够，停下交回主 Agent。

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

- `init`：项目初始化
- `feat`：功能
- `fix`：修复
- `docs`：文档
- `refactor`：结构调整
- `chore`：仓库流程、脚本、依赖
- `test`：测试
- `perf`：性能优化
- `ci`：CI/CD
- `revert`：回滚

分支命名用小写：

```text
feat/frontend-shell
feat/backend-health
feat/client-runner-mock
codex/short-topic
docs/short-topic
fix/short-topic
```

`codex/` 是 Codex App 自动工作分支前缀，可以用于临时 PR。手工创建分支优先用 `feat/`、`fix/`、`docs/`。`master` 是稳定分支。实现、协议和结构调整走 PR；小文档修正可以直接提交，但不确定就走 PR。PR 标题也用 `type(scope): 中文摘要`。

进度同步：

- 每个开发者至少在一天结束前 push 当前分支。
- 完成一个可说明的小阶段就 push，不要把多天工作只留在本机。
- 跨方向改动尽早开 draft PR 或普通 PR，让另外两条线知道接口变化。
- PR 合并前先同步最新 `master`，解决冲突后再合。
- 不在共享分支上 force-push；确实需要时先在群里说明。
- Issue 只保留三部分主线任务：前端、后端、客户端。小任务写进对应 issue 或 PR，不额外开一堆 issue。
- 本地提交 hook 放在 `scripts/git-hooks/`。首次克隆后运行 `.\scripts\setup.ps1` 启用。
- hook 是本地辅助，GitHub Actions 是最低限度的共享检查。

### Worktree + Subagent

- 项目级 worktree 固定放在 `.worktrees/`，已写入 `.gitignore`，不得提交。
- 一个 worktree = 一个短分支 = 一个 PR。不要多个 Agent 共用同一 worktree。
- 创建前同步 `master`：`git switch master && git pull --ff-only`。
- 创建示例：`git worktree add .worktrees/client-edge-foundation -b feat/client-edge-foundation`。
- 每个 worktree 必须绑定任务卡和写入范围；范围变化先更新任务卡或 PR 说明。
- DeepSeek、Codex、Claude 等可在 worktree 内调度 subagent，但 subagent 只能在当前 worktree 的指定路径内工作。
- 完成后运行验收命令、push 分支、开 PR；合并后执行 `git worktree remove .worktrees/<name>`。
- worktree 内禁止保存密钥、真实服务器配置、私有日志和本机 Agent 状态。

## 5. 文档规则

- 主文档只保留三份：产品需求、系统架构、功能实现。
- `docs/client-roadmap.md` 是客户端 M1 并行开发路线图；完成后可归档进 `docs/archive/`，不要长期扩写成第二套实现文档。
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
