# AGENTS.md - AgentHub 项目规则

## 0. 优先级

1. 管理员的直接指令
2. 本文件
3. `.agenthub/` 项目记忆
4. `docs/reference/` 调研文档

## 1. 文档语言

- AgentHub 自有文档最终全部中文化。关键入口先中文化，长调研文档按 `docs/chinese-documentation-roadmap.md` 分批处理。
- 英文 README 保留在 `README_EN.md`，只作为对外补充入口。
- 代码标识、目录名、协议字段、branch 名、commit message 保持英文。
- `docs/reference/**` 是 Agent 和实现阶段使用的深度调研资料，也要逐步中文化；翻译时保留代码、路径、协议字段和原仓库专有名词。
- `reference/**` 是 clone 下来的第三方参考仓库，不属于 AgentHub 自有文档，默认不翻译、不改写。
- 不要使用未解释缩写。第一次出现时写中文白话解释，例如写“唯一协议源头”。

完整规则见 `docs/language-policy.md`。

## 2. 平台支持

| 平台 | UI | Agent 执行 | 说明 |
|------|:--:|:----------:|------|
| Windows | Web + Tauri | 是（WSL/native） | 主要桌面目标 |
| macOS | Web + Tauri | 是 | 完整 CLI 工具链 |
| Linux | Web | 是 | 主要 Runner/Server 目标 |
| iOS | PWA | 否 | 只做控制台 |
| Android | PWA | 否 | 只做控制台 |
| Web | Browser | 否 | 需要连接 Edge node |

> Mobile 和 Web 是控制台：它们连接 Edge node 来执行 Agent。只有 Desktop 平台本地运行完整栈。

## 3. Git - Conventional Commits

Commit message 使用英文 type/scope + 中文摘要，格式如下：

```text
type(scope): 中文摘要
```

| type | 用途 |
|------|------|
| `init` | 项目初始化 |
| `feat` | 新功能 |
| `fix` | 修复问题 |
| `docs` | 仅文档 |
| `refactor` | 代码结构调整 |
| `chore` | 构建、依赖、工具 |
| `test` | 测试 |
| `perf` | 性能优化 |
| `ci` | CI/CD |
| `revert` | 回滚提交 |

- Scope 可选，只用小写 `[a-z0-9._-]+`。
- Summary 中文为主，不加句号，最长 120 bytes。
- `.githooks/` 里的 hook 是可选的本地辅助，不是团队强制门禁。
- 如需启用本地 hook：`git config core.hooksPath .githooks`。
- GitHub branch protection 才是共享保护。

### GitHub Issue / PR 语言

- Issue 和 PR 标题、正文中文为主，便于同学直接理解。
- 标题开头保留规范前缀：
  - Issue: `M0: 中文任务名`、`M1: 中文任务名`
  - PR: `docs: 中文变更说明`、`feat(edge): 中文变更说明`
- 正文用中文写背景、改了什么、怎么验收；代码标识、路径、协议字段、命令保持英文。
- 如果 PR 用 squash merge，最终 squash commit 标题也使用 `type(scope): 中文摘要`。
- 模板位置：`.github/ISSUE_TEMPLATE/task.md`、`.github/PULL_REQUEST_TEMPLATE.md`。

## 4. 分支管理

AgentHub 使用轻量 trunk-based workflow，不使用 GitFlow。

### 主分支

- `master` 是受保护稳定分支，应始终可读、可演示、方便继续开发。
- 代码、协议和服务结构变更通过 Pull Request 合入。
- 维护者/管理员只有在低风险文档或流程清理时才直接提交 `master`；不确定时走 PR。

### 分支命名

使用小写 kebab-case：

```text
<type>/<short-topic>
```

允许的分支类型：

| type | 用途 |
|------|------|
| `feat/` | 产品或架构功能 |
| `fix/` | 修 bug 或修坏文档 |
| `docs/` | 仅文档 |
| `chore/` | 仓库流程、labels、scripts、工具 |
| `refactor/` | 不改变行为的结构调整 |
| `spike/` | 限时研究或实验，不长期保留 |
| `codex/` | Codex app 自动创建的工作分支 |

示例：

```text
docs/branch-workflow
chore/github-labels
feat/runner-command-protocol
spike/multica-runtime-model
```

### Pull Request

- PR 控制在一个同学能一次看完的大小。
- 有对应 GitHub issue 时，在 PR 中链接。
- 代码 PR 写清验证命令；暂时无法运行时说明原因。
- 协议 PR 先改 `proto/agenthub/v1`，后续有生成链路后再同步 Go/TypeScript 产物。
- 纯文档 PR 写清摘要即可。
- 当前 GitHub 保护要求走 PR，但还不要求 CI 或 approving review。

### 合并规则

- 短分支优先 squash merge。
- 合并后删除分支。
- 不保留长期个人分支。
- 如果分支改了协议、服务结构或共享包归属，合并前先同步 `master`。
- `master` 保护禁止 force-push 和删除分支。

### 三人团队规则

这是三人项目。任何规则如果带来的沟通成本高于保护收益，就简化规则并更新本文件。

## 5. 仓库结构

```text
AgentHub/
├── apps/           # TS frontends (web, desktop, mobile)
├── services/       # Go backends (hub-server, edge-server, runner)
├── packages/       # shared Go + TS packages
├── proto/          # Protobuf schema, 唯一协议源头
├── docs/           # product + architecture + reference
├── scripts/        # build, migration, codegen
├── .githooks/      # commit-msg + prepare-commit-msg
└── .agenthub/      # project memory and rules
```

## 6. 文档导航

- `README.md` - 中文主入口
- `README_EN.md` - 英文补充入口
- `docs/architecture.md` - Hub-Edge-Runner 拓扑
- `docs/language-policy.md` - 文档语言规则
- `docs/chinese-documentation-roadmap.md` - 全仓库中文化路线图
- `docs/deepseek-handoff.md` - 交给 DeepSeek 执行中文化的交接入口
- `docs/glossary.md` - 白话术语表
- `docs/project-management.md` - 里程碑、labels、issue 聚合规则
- `docs/reference/README.md` - 调研索引和 Agent 阅读路线
- `docs/reference/01-learn/` - 外部仓库调研和源码提取
- `docs/reference/02-decide/` - 跨仓库比较和取舍分析
- `docs/reference/03-build/` - 后端和前端工程规格
- `docs/reference/04-plan/` - 路线图和影响分析

## 7. Agent 协作规则

- 写代码前先读相关 `docs/reference/` 文档。
- Adapter 设计遵循 `docs/reference/03-build/backend/04-adapter-sdk.md`。
- 协议变更先更新 `proto/agenthub/v1`，再生成 Go + TypeScript 类型，最后实现服务和 UI。
- 新调研发现放进合适的 `01-learn/` 或 `02-decide/` 路径。
- Commit message 使用 `type(scope): 中文摘要` 格式。

## 8. 知识库同步规则（neat-freak）

当用户调用 `neat-freak`，或要求“整理文档 / 同步 AGENTS / 更新 README / 收口仓库知识”时，按本节执行。

### 什么时候必须同步

- 架构、协议、目录结构、分支流程、GitHub issue 管理发生变化。
- GitHub issue / PR 语言、模板或标题规范发生变化。
- 新增或调整重要调研结论，例如 Multica、Ruflo、Paperclip、ByteDance 比赛材料。
- 新增 `docs/*.md`、`docs/reference/**`、`services/*/README.md`、`packages/*/README.md`。
- 发现 README、AGENTS、术语表、项目管理文档互相矛盾。
- 完成一个 milestone、PR 或大范围文档整理前。

### 同步顺序

1. 先枚举根目录、`docs/` 和两层内的 markdown 文件，确认哪些要改、哪些不用改。
2. 先改人类入口文档：`README.md`、`docs/glossary.md`、`docs/project-management.md`、`docs/language-policy.md`。
3. 再改 Agent 入口文档：`AGENTS.md`、`docs/reference/README.md`、相关 reference 索引。
4. 最后检查链接、旧文件名、术语漂移和相对时间。

### 编辑原则

- 合并旧内容，不做无脑追加。
- 删除或改写过期规则，不把旧方案留在正文里制造歧义。
- 文档按受众分层：README 给新人，AGENTS 给 Agent，reference 给实现阶段查证。
- AgentHub 自有文档按 `docs/chinese-documentation-roadmap.md` 最终中文化。
- `reference/**` 是第三方仓库源码和文档镜像，不翻译、不改写。
- 新增文档必须补进合适入口：README、AGENTS 或 `docs/reference/README.md`。

### 自检命令

```powershell
Select-String -Path .\README.md,.\README_EN.md,.\AGENTS.md,.\docs\*.md,.\docs\reference\README.md -Pattern ('README_Z' + 'H')
git diff --check
git status --short --branch
```
