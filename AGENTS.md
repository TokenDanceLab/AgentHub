# AGENTS.md - AgentHub 项目规则

## 0. 优先级

1. 管理员的直接指令
2. 本文件
3. `docs/reference/` 调研文档

## 1. 渐进式加载

文档职责：

- `README.md` 是对外展示页，给评审、同学和新读者快速了解项目，不放细碎开发约束。
- `README_EN.md` 是英文补充入口，只保留对外介绍。
- `AGENTS.md` 是给开发者和 Agent 的开发规范、开发风格和流程约束；每个 Agent 开始工作前必须读。
- 在 `D:\Code\TokenDance` workspace 内做跨系统治理时，先读 `../AGENTS.md` 和 `../docs/`；AgentHub 仓内 docs 只负责本产品实现细节。

人类同学先读：

1. `README.md`
2. `docs/product-requirements.md`
3. `docs/system-architecture.md`
4. `docs/implementation-guide.md`

Agent 不要一次性扫全仓库。按下面顺序加载，够用就停：

1. 先读本文件。
2. 读 `docs/handoff/STATE.md` — 当前项目状态、阻塞、部署信息（新 Agent 接手必读）。
3. 明确任务卡：目标、所属方向、写入范围、接口影响、验收命令。
4. 如果用户要求持续推进、自我迭代、长程开发、worktree/subagent 分发或交叉 review，必须先加载 `.agents/skills/dev-loop/SKILL.md`，再按其中 `references/` 执行。短任务（单文件修复、小改动）不需要。
5. 只读相关主文档章节：产品不清读 `docs/product-requirements.md`；边界不清读 `docs/system-architecture.md`；实现顺序不清读 `docs/implementation-guide.md`。
6. 改接口时读 `api/README.md`、`api/openapi.yaml`、`api/events.md`。
7. 改 TokenDance ID 登录、OIDC、跨产品鉴权、Feishu/Lark 集成、公开包装或共享设计 token 时，同步读 `../docs/identity-auth.md`、`../docs/unified-login.md`、`../docs/feishu-agenthub-integration.md`、`../docs/product-matrix.md`、`../docs/agent-seo-i18n-packaging.md` 或 `../docs/design-system.md` 中相关文档。
8. 持续开发和任务拆解读 `docs/roadmap.md`、`docs/roadmaps/<方向>.md` 和当前分支路线图。
9. 客户端 M1 任务读 `docs/client-roadmap.md`。
10. 需要论证时最多读 1-3 篇精确的 `docs/reference/**`。

`docs/archive/` 只在追溯旧方案时读。`reference/**` 是第三方源码镜像，默认不改、不翻译、不全文扫描。

## 2. 三人分工

AgentHub 的开发工作流是"三个开发者，每个开发者可以带一个或多个 Agent"。Agent 是协助者，不是仓库负责人。

| 部分 | 负责范围 | 主要目录 |
|---|---|---|
| 前端 | Web 工作台、IM 交互、Diff/Preview/Approval 面板、前端状态 | `app/web/`、`app/shared/` |
| 后端 | Hub Server、TokenDance ID 接入、Edge-Hub 通信、账号/群聊/同步/中继、Profile/Skill/MCP/审计 | `hub-server/`、`edge-server/`、`api/` |
| 客户端 | Desktop、Edge 本地调度、Agent Runtime 进程、workspace、执行目标体验 | `app/desktop/`、`edge-server/` |

共享边界：

- API 契约写在 `api/`。
- Edge Server 同时连接前端和 Hub，改动前先看 `docs/system-architecture.md`。
- 跨两个方向的改动先在 PR 描述里写清楚影响面。
- 开发者必须审查自己 Agent 生成的代码、文档和命令输出；不要把未看懂的 Agent 改动直接合入。

### AgentHub 产品术语边界

实现、文档和 UI 文案必须区分以下概念：

| 概念 | 含义 | 权威位置 |
|---|---|---|
| Agent Runtime | Codex、OpenCode、Claude Code 等 CLI/SDK 运行时适配器，回答“用什么运行”。Runtime 不是用户可管理的业务 Agent。 | Edge `internal/adapters/` |
| Agent Profile | 用户可选择、可管理的 Agent 实体，回答“谁来做事”。 | Hub CustomAgent / Edge local profile |
| Agent Configuration | Profile 的配置集合，包含 `AGENTS.md`、memory、上下文、聊天记录、工作目录、Skill、MCP、模型参数、审批策略。 | Edge Context Builder + Hub profile store |
| Execution Target | 一次 Run 的实际执行位置，包含 Local Edge、Remote Edge over SSH/Tailscale、Cloud Edge、Hub Relay target。 | Edge registration + Hub routing |

本地执行不依赖 Hub：Desktop 可以只连接 Local Edge 完成项目、Thread、Run 和 Runtime adapter 调度。Hub 进入链路的场景是账号、云端 IM、多端同步、远程查看/审批、设备路由、中继和审计。

### 统一 TokenDance ID 登录边界

所有 AgentHub 登录工作先读 `../docs/unified-login.md` 和 `../docs/identity-auth.md`。

- Hub Agent 负责 Hub Server 作为 TokenDance ID relying party 的后端流程：Hub-owned callback、code exchange、ID token 验证、`tokendance_sub` 到 Hub user 的映射、Hub 本地 access/refresh session 签发。
- Client Agent 负责 Desktop/Web 登录入口、系统浏览器 PKCE/回调体验和 Hub session 存储；客户端不得直接集成 GitHub、Google、飞书，也不得把第三方 provider token 存进 AgentHub。
- AgentHub Home 的 `https://hub.vectorcontrol.tech/api/auth/callback` 是产品官网静态站 OIDC callback，不是 Hub API 登录 callback。
- 现有 TokenDance ID bearer-token middleware 只是兼容路径；最终浏览器/桌面登录必须由 Hub Server 兑换 code 并签发 Hub 本地 session。

### Feishu/Lark 应用边界

AgentHub 飞书/Lark应用规划见 `../docs/feishu-agenthub-integration.md`。Feishu app 只做协作入口：机器人收发消息、事件订阅、卡片交互、工作台/H5 和任务通知。它不得成为 AgentHub 第二套登录系统；飞书 OAuth provider、飞书账号绑定、TokenDance ID 账号自动创建和 `oauth_bindings` 由 TokenDance ID 负责。Hub Server 接收 Feishu Integration Gateway 转发的业务事件后，仍按 TokenDance ID `sub` 和 AgentHub 权限执行。

任务分发：

- 一个主线 issue 对应一个方向：前端、后端、客户端。小任务写进对应 issue、路线图或 PR。
- 分发前先写任务卡：分支名、worktree、负责人、写入范围、依赖、验收命令。
- 只有写入范围互不重叠时才并行；会改同一批文件的任务按顺序做。
- 主 Agent 负责拆解、验收、提交和 PR；subagent 只负责被分配的窄任务。
- subagent 提示必须包含：目标、允许修改的路径、必须阅读的文档、必须运行的检查、隐私红线。
- subagent 不自行扩大范围；发现范围不够，停下交回主 Agent。

### 模型分配策略

> 实际后端模型映射，AgentHub 项目专用。dev-loop skill 同步更新。

| 别名 | 实际模型 | 上下文 | 角色 | 适用场景 |
|---|---|---|---|---|
| **opus** | DeepSeek-V4-Pro | 1M | 推理/架构/审查/复杂重构 | 主 Agent、架构设计、安全审查、DI 重构 |
| **sonnet** | Kimi-K2.6 | 256k | 前端/多模态/快速并行 | Desktop UI、IM 界面、视觉审查、批量编码 |
| **haiku** | GLM-5.1 | 200k | 高智力编码/业务逻辑 | 算法实现、bug 修复、Go 后端编码、测试生成 |

- **主 Agent（本 session）** 使用 opus 做决策、审查、编辑核心文件
- **前端 subagent** 派 sonnet（多模态 UI 能力）
- **后端 subagent** 派 haiku（Go 编码 + 测试），失败才换 opus
- **批量机械工作**（格式化、重命名、翻译）派 sonnet

### Agent 间文件通信

其他 Agent（或人类）通过 `docs/inbox/` 投递报告。规则见 `docs/inbox/README.md`。
dev-loop 主 Agent 每次循环开始时检查收件箱，按优先级处理，处理后归档到 `docs/reference/`。

### 仓库级 Skill

- 仓库只提交白名单 skill：`.agents/skills/dev-loop/`、`.agents/skills/test-coverage/`、`.agents/skills/pre-push/`、`.agents/skills/integration-test/`。
- 长程多步骤任务（跨文件重构、多步骤功能、需要审查的变更）必须先读 `.agents/skills/dev-loop/SKILL.md`。
- 短任务（单文件修复、typo、小改动）不需要 dev-loop——直接做。
- `.agents/skills/dev-loop/references/` 已内嵌模型分配策略、审查清单、worktree 指南；不要假设外部同名 skill 一定可用。
- `docs/roadmap.md` 和 `docs/roadmaps/` 是持续开发台账，用来记录当前目标、方向任务、分支进展、验证和下一步；不要把详细方案写成第二套主文档。
- 除白名单 skill 外，`.agents/`、`.codex/`、`.claude/` 的本机状态、缓存、会话记录和个人配置不得提交。

## 3. 技术主线

- Hub Server 和 Edge Server 使用 Go。早期独立 `runner/` 目录已废弃；当前执行生命周期在 `edge-server/internal/lifecycle/`，Agent Runtime 协议适配在 `edge-server/internal/adapters/`。
- UI 使用 React + TypeScript，Desktop 使用 Tauri。
- 主协议是 REST JSON API + WebSocket typed events。
- REST endpoint 入口是 `api/openapi.yaml`。
- WebSocket 事件入口是 `api/events.md`。
- Protobuf、Connect-RPC、JSON-RPC 只作为历史参考，不是当前主线。

### 前端规范

**共享 UI 包**：`app/shared/src/ui/`（`@shared/ui`）。所有通用组件在此维护，desktop 和 web 从 `@shared/ui` 导入。禁止在 app 内创建重复的本地 UI 副本。

**样式**：CSS Modules + OKLCH 设计 tokens（`var(--primary)`, `var(--border)` 等）。禁止硬编码颜色值。

**测试**：`cd app/desktop && pnpm test`。共享 UI 组件测试放在 `app/shared/src/ui/*.test.tsx`。新组件必须有测试 + Storybook story。

**Storybook**：`cd app/desktop && pnpm storybook`（端口 6006）。Story 放 `app/shared/src/ui/*.stories.tsx`。

**Lint**：各 app 独立 eslint 配置。`pnpm lint`。Web 之前没有 lint，已补充。

**类型检查**：`pnpm typecheck` 在 desktop 和 web 各跑一次。当前 `app/shared/src/ui` 存在 React 类型解析 / pnpm 跨包虚拟存储的既有限制；提交说明必须区分既有 shared-ui 限制和本次新增错误。

前端架构详见 `docs/system-architecture.md` 前端章节。

## 4. Git 规则

开始工作前先同步：

```powershell
git checkout dev/delicious233
git pull --ff-only
```

已有功能分支继续开发前：

```powershell
git fetch origin
git rebase origin/dev/delicious233
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
feat/client-edge-smoke
codex/short-topic
docs/short-topic
fix/short-topic
```

`codex/` 是 Codex App 自动工作分支前缀，可以用于临时 PR。手工创建分支优先用 `feat/`、`fix/`、`docs/`。实现、协议和结构调整走 PR；小文档修正可以直接提交，但不确定就走 PR。PR 标题也用 `type(scope): 中文摘要`。

### 分支治理

当前分支状态和合并规则详见 `docs/branch-governance.md`。摘要：

```
feat/* → dev/delicious233 → master
```

| 分支 | 说明 | 状态 |
|------|------|:--:|
| **dev/delicious233** | 主开发分支，唯一事实源 | 活跃 |
| master | PR-only 稳定快照，Q2 里程碑后同步 | 滞后（勿直接 clone 使用） |
| dev/trump | Trump 的 Web 前端（`feat/frontend-page-preview`），不合并 | 独立开发 |
| dev/johnny | 已过期 | 待清理 |

规则：
- `master` 禁止直接 push，必须通过 PR。
- `master` 目前滞后于 `dev/delicious233` 300+ commits，始终从 `dev/delicious233` 开始工作。
- `dev/*` 合并前本地验证：`go test ./...` + `pnpm test` + `pnpm build`。
- `feat/*` 合并前需要 rebase 到最新 `dev/delicious233`，解决冲突后再开 PR。
- 删除已合并的 `feat/*` 分支和对应的 worktree。
- `dev/trump` 不合并到 `dev/delicious233`，最终由 Trump 自行决定是否 PR。

开发引擎：`.agents/skills/dev-loop/` — 模型分配（opus/sonnet/haiku）+ 标准循环 + 交叉审查。

P0-P3、M3b、M4、M5、M6、M7 全部完成。详细进度见 `docs/roadmap.md`。

进度同步：

- 每个开发者至少在一天结束前 push 当前分支。
- 完成一个可说明的小阶段就 push，不要把多天工作只留在本机。
- 跨方向改动尽早开 draft PR 或普通 PR，让另外两条线知道接口变化。
- PR 合并前先同步最新 `dev/delicious233`，解决冲突后再合。
- 不在共享分支上 force-push；确实需要时先在群里说明。
- Issue 只保留三部分主线任务：前端、后端、客户端。小任务写进对应 issue 或 PR，不额外开一堆 issue。
- 本地提交 hook 放在 `scripts/git-hooks/`。首次克隆后运行 `.\scripts\setup.ps1` 启用。
- hook 是本地辅助，GitHub Actions 是最低限度的共享检查。

### Worktree + Subagent

- 项目级 worktree 固定放在 `.worktrees/`，已写入 `.gitignore`，不得提交。
- 一个 worktree = 一个短分支 = 一个 PR。不要多个 Agent 共用同一 worktree。
- 创建前同步 `dev/delicious233`：`git checkout dev/delicious233 && git pull --ff-only`。
- 创建示例：`git worktree add .worktrees/client-edge-foundation -b feat/client-edge-foundation`。
- 每个 worktree 必须绑定任务卡和写入范围；范围变化先更新任务卡或 PR 说明。
- DeepSeek、Codex、Claude 等可在 worktree 内调度 subagent，但 subagent 只能在当前 worktree 的指定路径内工作。
- 完成后运行验收命令、push 分支、开 PR；合并后执行 `git worktree remove .worktrees/<name>`。
- worktree 内禁止保存密钥、真实服务器配置、私有日志和本机 Agent 状态。

## 5. 文档规则

- 主文档只保留三份：产品需求、系统架构、功能实现。
- `docs/roadmap.md` 和 `docs/roadmaps/` 只记录持续开发目标、当前进展、验证和下一步，不承载完整产品或架构说明。
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
- 本机 Agent 记忆和运行状态，例如 `.claude/`、`.codex/`、`.agents/`（仓库级 `.agents/skills/dev-loop/` 是唯一例外）。
- 服务器别名（hk1、hk2、us1、gz1）不得出现在仓库文件中；生产配置限 `.env.production`（已 gitignored）。

执行规则：

- 需要示例配置时只提交 `.env.example`，值用占位符。
- 日志和错误截图提交前先检查是否含 token、路径、账号、服务器信息。
- Agent 运行命令前，先确认命令不会上传本地文件、打印密钥或访问生产数据。
- 不要因为"本机能跑"就把私有配置写死进代码；需要配置项时写成环境变量或本地配置文件，并提供公开示例。
- 新增本地生成目录、缓存、数据库、日志、私钥或 Agent 状态目录时，先更新 `.gitignore`。
- 如果误提交敏感信息，立即停止继续推送，通知维护者，旋转密钥，再清理历史。

## 7. 验证和测试

文档或 API 变更至少运行：

```powershell
git diff --check
python -c "import yaml, pathlib; yaml.safe_load(pathlib.Path('api/openapi.yaml').read_text(encoding='utf-8')); print('yaml ok')"
git status --short --branch
```

运行命令以真实入口为准：Edge 是 `edge-server/cmd/agenthub-edge`，Hub 是 `hub-server/cmd/server-hub`。`scripts/dev-start.ps1` / `scripts/dev-start.sh` 仍引用旧 Hub 命令，`scripts/client-smoke.ps1` 仍包含已删除 `runner/` 的历史检查；修复脚本前不要把这些脚本作为验收依据。

有 Go 代码后追加：

```powershell
cd edge-server
go test ./... -short -count=1

cd ..\hub-server
go test ./... -short -count=1
```

Go 服务测试要求：

- 新增核心逻辑要有同包 `*_test.go`。
- Hub/Edge/Agent Runtime adapter 的接口边界优先写 handler、service、lifecycle 或 adapter 层测试。
- 涉及权限、路径、命令执行、同步序号的逻辑必须有失败用例。

有前端代码后追加：

```powershell
cd app/desktop
pnpm test
pnpm build
pnpm typecheck

cd ..\web
pnpm typecheck
pnpm build
```

前端和客户端测试要求：

- 前端状态转换和 API client 要有单元测试。
- 关键 UI 流程后续用 Playwright 覆盖：新建 Thread、启动 Run、查看 Diff、Approval、Preview。
- Desktop/Edge 执行链路改动至少提供本地 smoke test 步骤；无法自动化时写在 PR 验收里。

## 8. 质量治理

### 测试覆盖率

| 模块 | 最低覆盖率 | 当前 |
|------|-----------|------|
| edge-server | 75% | CI 强制阻断 |
| hub-server | 40% | CI 强制阻断 |
| app/desktop | 不做硬性要求 | 551/560 tests |
| app/web | 不做硬性要求 | build 通过即可 |

- CI 使用 `go test -short` 跳过需要真实 CLI 的集成测试。
- 新增 adapter 功能必须补同包 `*_test.go`。
- 修改 shared types 必须同步更新所有消费者的测试。

### CI 触发规则

| 触发条件 | CI 行为 |
|----------|---------|
| push 到 `master` | 全量：Go test + pnpm test + pnpm build + YAML 校验 |
| push 到 `dev/*` | 全量 |
| PR 到 `master` / `dev/*` | 全量 |
| push 到 `feat/*` | **不触发**（仅在开 PR 后触发） |

### 提交纪律

- **小步提交**：每个逻辑改动完成后立即 commit，不要攒到一天结束。
- **commit 即 push**：`git commit` 后直接 `git push`，让 CI 尽快运行。
- **每日收尾**：结束工作前 `git status --short` 确认无遗留改动，已全部 commit + push。
- **不跨夜留改动**：未完成的功能用 feature flag 或 WIP commit，不留 uncommitted 改动过夜。
- **PR 优先**：跨分支协作尽早开 PR（哪怕未完成），让其他人看到进度和方向。
- **hook 必须启用**：clone 后运行 `scripts/setup.ps1`（Windows）或 `scripts/setup.sh`（Unix），确保 `core.hooksPath` 指向 `scripts/git-hooks`。CI 也会拦截不规范提交。

### 提交格式

```
type(scope): 中文摘要

type: init|feat|fix|docs|refactor|chore|test|perf|ci|revert
scope: client|edge|api|docs|desktop|web
```

- 摘要不超过 50 字。
- 不要写 "added"、"fixed" 等英文动词——用中文。
- hook 脚本在 `scripts/git-hooks/commit-msg`，clone 后运行 `scripts/setup.ps1` 启用。
