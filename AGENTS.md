# AGENTS.md - AgentHub 项目总规则

本文件是 AgentHub 的**项目总规则唯一入口**。Claude Code、Codex 和其他 Agent 都读本文件；本仓库不再维护 `CLAUDE.md` 或第二套根级规则。

## 0. 事实源优先级

1. 管理员的直接指令
2. `AGENTS.md` - 项目规则、红线、工作流、skill 白名单、验证纪律
3. `docs/progress/MASTER.md` - 当前 spec-driven 专项进度、Issue/PR、阻塞、验收证据
4. `docs/roadmap.md` - 总进度、长期路线、模块级下一步
5. `docs/architecture.md` + `docs/architecture/` - 架构、数据流、协议边界
6. 其他专题文档、`docs/decisions.md`、reference、history

不要在 roadmap、MASTER、治理报告或 skill 里复制本文件的规则。规则变更改这里；其他文档只链接或保留一句摘要。

## 1. 渐进式加载

人类同学先读：

1. `README.md`
2. `docs/architecture.md`
3. `docs/developer-quickstart.md`

Agent 按需加载，够用就停：

1. 先读本文件。
2. 读 `docs/progress/MASTER.md`。如果存在，按当前 SPEC 继续，不重启旧计划。
3. 读 `docs/roadmap.md` 和 `docs/architecture.md` 获取当前目标和架构边界。
4. 改接口时读 `api/openapi.yaml`、`api/events.md`、`api/conventions.md`。
5. 做 UI/数据流时读 `docs/architecture/04-frontend-data-flow.md` 和 workspace 设计文档中相关章节。
6. 做登录、授权、Feishu/Lark、Gateway、安全、公开包装、i18n 或共享设计 token 时，先读 `../AGENTS.md` 和对应 `../docs/` owner 文档。
7. 需要论证时最多读 1-3 篇精确 `docs/reference/**`。第三方调研默认先看 `docs/history.md` 定位外部归档，避免展开旧长文。

## 2. 项目分工和边界

| 方向 | 负责范围 | 主要目录 |
|---|---|---|
| 前端 | Web 工作台、IM 交互、Diff/Preview/Approval、前端状态 | `app/web/`, `app/shared/` |
| 后端 | Hub Server、TokenDance ID 接入、Edge-Hub 通信、同步、中继、审计 | `hub-server/`, `edge-server/`, `api/` |
| Desktop | Tauri、Local Edge、本地 runtime、workspace、tray | `app/desktop/`, `edge-server/` |
| Mobile | Expo/RN、OIDC deep-link、SecureStore、Notifications | `app/mobile-rn/` |

Mobile 主线是 Expo + React Native development build。旧 Tauri Mobile 不再恢复。当前 UI/UX 主线优先 Desktop/Web；Mobile 深度重构另开任务。

固定端口：

| 资源 | 端口 |
|---|---:|
| Desktop/Tauri Vite | 5173 strict |
| Web Vite | 5174 strict |
| Mobile RN Expo Web | 5177 |
| Hub Server | 8080 |
| Local Edge | 3210 |

共享边界：

- API 契约写在 `api/`。
- 通用 UI、transcript、composer、inspector、platform contract 放 `app/shared/`。
- Desktop 只能把 Tauri/Rust native 能力放在 `app/desktop/src-tauri/`。
- Web 只能通过 Hub/Web adapter 访问远端能力，不能直连 Local Edge 或 runtime。
- Desktop renderer 不获得 raw process execution 权限；本地执行由 Local Edge 和 Tauri host typed API 承担。

## 3. 产品术语

| 概念 | 含义 | 权威位置 |
|---|---|---|
| Agent Runtime | Codex、OpenCode、Claude Code 等 CLI/SDK 运行时适配器，回答“用什么运行” | Edge `internal/adapters/` |
| Agent Profile | 用户选择和管理的 Agent 实体，回答“谁来做事” | Hub profile store / Edge local profile |
| Agent Configuration | Profile 的上下文、Skill、MCP、模型参数、审批策略等配置集合 | Edge Context Builder + Hub store |
| Execution Target | 一次 Run 的执行位置：Local Edge、Remote Edge、Cloud Edge、Hub Relay target | Edge registration + Hub routing |

本地执行不依赖 Hub。Hub 进入链路的场景是账号、云端 IM、多端同步、远程查看/审批、设备路由、中继和审计。

## 4. 生态边界

| 主题 | 规则 | Owner 文档 |
|---|---|---|
| 登录 | AgentHub 只接 TokenDance ID；第三方 provider、账号绑定、`oauth_bindings` 归 TokenDance ID | `../docs/identity/identity-auth.md` |
| 授权 | TokenDance ID 只证明身份；Hub Server 用 Hub-local membership/resource/action 决定权限 | `../docs/identity/authorization-model.md` |
| 安全风险 | Critical/High 未修复、未验证或未 accepted 前阻断公开发布 | `docs/governance/security-risk-register.md`, `../docs/security/security-risk.md` |
| Feishu/Lark | 飞书只做协作入口，不是第二登录系统；慢任务异步，卡片回调 3 秒内响应 | `../docs/identity/feishu-integration.md` |
| i18n/公开包装 | zh/en 语义一致；不把第三方 provider 写成 AgentHub 直连登录 | `../docs/identity/i18n-packaging.md` |
| Gateway | TokenDance API key 不是 TokenDance ID token，不得暴露给浏览器 UI 或公开日志 | `../docs/ecosystem/product-matrix.md` |
| 设计 | dense command-center surface，真实工作流截图，不截空壳 | `../docs/design/design-playbook.md`, `../docs/design/visual-qa-matrix.md` |

## 5. 技术主线

- Hub Server 和 Edge Server 使用 Go。
- UI 使用 React + TypeScript；Desktop 使用 Tauri。
- 主协议是 REST JSON API + typed WebSocket events。
- REST 入口：`api/openapi.yaml`。
- WebSocket 事件入口：`api/events.md`。
- Protobuf、Connect-RPC、JSON-RPC 只作为历史参考，不是当前主线。
- 早期独立 `runner/` 目录已废弃；执行生命周期在 `edge-server/internal/lifecycle/`，runtime 适配在 `edge-server/internal/adapters/`。
- `edge-server/internal/runners/` 是兼容摘要包；`/v1/runners` 不代表新的业务 Agent 模型。

前端规范：

- 通用组件在 `app/shared/src/ui/`，Desktop/Web 从 shared 导入，禁止复制本地 UI 副本。
- CSS Modules + OKLCH tokens，避免硬编码颜色。
- 用户消息、Agent 回复、工具/审批/产物卡片必须按时间线性展示；调试、mock、mode 信息不得进入主聊天流。
- UI 改动用自动化 Playwright + Visual QA 证明行为和布局；Desktop/Web 主视口优先 `1440x810`。

## 6. Git 和 worktree

当前开发基线是 `dev/delicious233`，合并路径：

```text
feat/* 或 docs/* -> dev/delicious233 -> master
```

开始新工作：

```powershell
git checkout dev/delicious233
git pull --ff-only
git worktree add .worktrees/<topic> -b <type>/<topic>
```

规则：

- `master` 禁止直接 push。
- 项目级 worktree 固定放 `.worktrees/`，一个 worktree 对应一个短分支和一个任务卡/PR。
- 不按历史 handoff 或旧审计推断分支状态；用 `git status --short --branch`、`git worktree list`、GitHub issue/PR live 状态。
- 完成后运行验收、push、开 PR；合并后删除分支和 worktree。
- 不在共享分支 force-push。

提交格式：

```text
type(scope): 中文摘要
```

`type` 用 `feat|fix|docs|refactor|chore|test|perf|ci|revert`。摘要不超过 50 字。

## 7. Agent 和 skill

Agent 是协助者，不是仓库负责人。主 Agent 负责拆解、验收、提交和 PR；subagent 只改指定范围。

subagent 提示必须包含：目标、允许修改路径、禁改路径、必须阅读文档、必须运行检查、隐私红线。

仓库只提交以下 active skill：

- `.agents/skills/dev-loop/`
- `.agents/skills/test-coverage/`
- `.agents/skills/pre-push/`
- `.agents/skills/integration-test/`
- `.agents/skills/adapter-dev/`
- `.agents/skills/env-sandbox/`
- `.agents/skills/real-e2e-acceptance/`

白名单由 `scripts/verify/verify-project-skills.ps1` 校验。过期 skill 只保存在 `docs/history.md` 指向的外部归档，不能作为 active workflow 加载。

使用规则：

- 长程多步骤任务默认先按当前 SPEC；没有 active SPEC 且任务复杂时读 `.agents/skills/dev-loop/SKILL.md`。
- 涉及真实 E2E、Playwright、Visual QA、approved-real、真实登录/运行、打包 Desktop、性能/泄漏、发布或 merge-ready 结论时，先读 `.agents/skills/real-e2e-acceptance/SKILL.md`。
- 除白名单 skill 外，`.agents/`、`.codex/`、`.claude/` 的本机状态、缓存、会话记录和个人配置不得提交。

## 8. 文档规则

- 项目规则只写 `AGENTS.md`。
- 当前 spec 进度只写 `docs/progress/MASTER.md`。
- 总进度只写 `docs/roadmap.md`。
- 架构概览写 `docs/architecture.md`；模块细节写 `docs/architecture/`。
- 架构决策摘要写 `docs/decisions.md`；旧 ADR 正文只在 `docs/history.md` 指向的外部归档中追溯。
- 模块当前 gate 写各模块 `README.md`；历史 handoff、设备证明和一次性验收记录归档，不作为当前事实入口。
- 历史 longform、日期型审计、旧发布材料、过期设计、完成的 spec-driven 工件和过期项目 skill 放到 `docs/history.md` 指向的外部 TokenDance docs 归档。
- AgentHub 源仓不再保留 `docs/archive/` 或 `docs/archives/`；当前执行中的 SPEC 才可以临时使用 `docs/analysis/`、`docs/plan/` 和 `docs/progress/`。
- `scripts/` 根目录只保留分类目录：`scripts/verify/`、`scripts/dev/`、`scripts/release/`、`scripts/smoke/` 和 `scripts/lib/`；不要新增根级脚本 wrapper。
- 过时长期文档直接删除；需要保留审计轨迹时归档快照。
- 避免巨石文档：主入口只保留职责、摘要、当前事实和链接；长表、历史日志、验收证据和专题设计移到 owner 子文档或 archive。
- 文档不写个人本机绝对路径、私有服务器、生产 secret、token、日志或截图中的敏感信息。
- 修改目录、协议、分工或稳定规则后，同步 README、roadmap、architecture、governance owner 文档和 verifier。

## 9. 安全和隐私

禁止提交或粘贴：

- `.env`、API key、token、cookie、私钥、证书、SSH 配置。
- 真实服务器 IP、内网地址、数据库连接串、生产账号、个人路径。
- 生产数据库 dump、用户数据、聊天记录、含敏感字段的日志。
- 本机 Agent 记忆和运行状态。

需要示例配置时只提交 `.env.example`，值用占位符。新增本地生成目录、缓存、数据库、日志或私钥目录前，先更新 `.gitignore`。

## 10. 验证纪律

所有变更至少运行：

```powershell
git diff --check
git status --short --branch
```

文档或 API 变更追加：

```powershell
pwsh ./scripts/verify/verify-doc-ssot.ps1
python -c "import yaml, pathlib; yaml.safe_load(pathlib.Path('api/openapi.yaml').read_text(encoding='utf-8')); print('yaml ok')"
```

Go 变更按 touched service 跑：

```powershell
cd edge-server; go test ./... -short -count=1
cd ../hub-server; go test ./... -short -count=1
```

前端变更按 touched app 跑：

```powershell
cd app/desktop; corepack pnpm test; corepack pnpm typecheck
cd ../web; corepack.cmd pnpm typecheck; corepack.cmd pnpm exec vite build
```

UI 工作流变更必须有行为断言，不只截图：共享 unit/contract + Desktop/Web Playwright + Visual QA，证据等级按 `real-e2e-acceptance` 标注。Vite renderer 不等于 packaged Desktop；stub/fixture/readiness-only 必须写 `real_tested=false`。

禁止无保护力测试：

| 反模式 | 禁止原因 |
|---|---|
| 测试复制实现 switch | 只能证明测试和实现一起错 |
| 测常量字符串 | 编译器已保证 |
| 硬断错误文案 | 文案不是行为合同 |
| mock 被测函数自己 | mock 应模拟外部系统，不模拟实现内部 |

## 11. Spec-Driven Develop

大型复杂任务默认走 spec-driven-develop：

1. 先读 active `docs/progress/MASTER.md`，GitHub mode 下同步 issue/milestone live 状态。
2. SPEC 文档、任务分解、验收标准先行。
3. 开发、测试、端到端验收其次。
4. 完成后更新 MASTER、GitHub issue/PR、验收证据和归档计划。
5. 专项完成后，把 `docs/analysis/`、本专项 `docs/plan/` 和 `docs/progress/` 外迁到 `docs/history.md` 指向的外部归档，并更新历史索引。

短任务（单文件修复、typo、小改动）不需要完整 SPEC，但仍必须遵守本文件的范围、隐私和验证规则。
