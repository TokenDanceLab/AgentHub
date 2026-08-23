# AGENTS.md - AgentHub 项目总规则

本文件是 AgentHub 的**项目总规则唯一入口**。Claude Code、Codex 和其他 Agent 都读本文件；本仓库不再维护 `CLAUDE.md` 或第二套根级规则。

## 0. 事实源优先级

1. 管理员的直接指令
2. `AGENTS.md` - 项目规则、红线、工作流、skill 白名单、验证纪律
3. GitHub issues/PR - 当前专项进度、Issue/PR、阻塞、验收证据
4. `docs/architecture.md` + `docs/architecture/` - 架构、数据流、协议边界
5. 其他专题文档、`docs/decisions.md`、reference、history

不要在治理报告或其他文档里复制本文件的规则。规则变更改这里；其他文档只链接或保留一句摘要。

## 0.5 根级目录地图

【活】= 维护中的源码/文档；【产物】= 构建/临时产物（gitignored，勿提交）；【参考】= 只读副本。

| 目录 | 分类 | 职责 |
|---|---|---|
| `api/` | 活 | API 契约 SSOT（openapi.yaml/events.md/conventions.md） |
| `app/` | 活 | 前端 monorepo（web/desktop/mobile-rn/shared/workbench） |
| artifacts/ dist/ tmp/ | 产物 | 本地构建/临时输出（gitignored） |
| `docs/` | 活 | 知识库（architecture/governance/reference/archives） |
| `edge-server/` | 活 | Go Edge 服务（local runtime、adapters、lifecycle） |
| `hub-server/` | 活 | Go Hub 服务（REST/WS/OIDC/dispatch/agentteam） |
| node_modules/ | 产物 | 依赖（gitignored） |
| `pkg/` | 活 | Go 共享包（errcode 等） |
| `reference/` | 参考 | 第三方源码只读副本（gitignored，INDEX.md 管理） |
| `scripts/` | 活 | 验证/开发/发布脚本（verify/dev/e2e/git-hooks/lib/release/smoke/） |
| `tests/` | 活 | 跨服务测试 |

## 1. 首次入仓与渐进式加载

### 新 Agent 90 秒入口

1. 先运行 `git status --short --branch`、`git log -5 --oneline`、`git worktree list`，确认真实分支、脏文件和并行 worktree；不要从旧 handoff 推断现场。
2. 完整读本文件，再读 GitHub issues/PR 的当前目标与 active track。仓库根目录不维护第二份进度文件。
3. 只在任务需要时读 `docs/architecture.md` 和一个 owner 文档；不要先遍历整个 `docs/`。
4. 查明对应 Issue/PR、允许修改路径、禁改路径和验收命令后再动代码。没有活跃任务且范围复杂时，先建立短 spec 再动手。
5. 每完成一个切片立即运行最窄验证；宣称 merge-ready、真实 E2E、发布或生产就绪前，再运行对应完整 gate。

**停止加载规则**：已经能回答“当前目标、事实 owner、允许改哪里、用什么验证”时就停止读文档；论证材料最多追加 1-3 篇精确 `docs/reference/**`，历史只通过 `docs/history.md` 定位。

人类同学的最短入口是 `README.md` → `docs/architecture.md` → `docs/developer-quickstart.md`。

任务路由：接口改动读 `api/openapi.yaml`、`api/events.md`、`api/conventions.md`；UI/数据流读 `docs/architecture/04-frontend-data-flow.md`；身份、授权、飞书、Gateway、安全、公开包装、i18n、设计 token 的跨产品边界读下方 §4 生态边界（TokenDance 系统级 docs 在私有 workspace，公开仓不复制其内容）。

## 2. 项目分工和边界

| 方向 | 负责范围 | 主要目录 |
|---|---|---|
| 前端 | Web 工作台、IM 交互、Diff/Preview/Approval、前端状态 | `app/web/`, `app/shared/` |
| 后端 | Hub Server、TokenDance ID 接入、Edge-Hub 通信、同步、中继、审计 | `hub-server/`, `edge-server/`, `api/` |
| Desktop | Tauri、Local Edge、本地 runtime、workspace、tray | `app/desktop/`, `edge-server/` |
| Mobile | Expo/RN、OIDC deep-link、SecureStore、Notifications | `app/mobile-rn/` |

Mobile 主线是 Expo + React Native development build。旧 Tauri Mobile 不再恢复。当前 UI/UX 主线优先 Desktop/Web；Mobile 深度重构另开任务。

固定端口（Vite strict：Desktop 5173、Web 5174、Mobile Expo Web 5177；Hub API 8080、Local Edge 3210；含 PG/Redis/admin 的全景）见 `docs/architecture/05-deployment.md` 默认端口表。

共享边界：

- API 契约写在 `api/`。
- 通用 UI、transcript、composer、inspector、platform contract 放 `app/shared/`；端级 workbench shell 放 `app/workbench/`（`@agenthub/workbench`，依赖方向 workbench → shared 单向，#1759）。
- Hub REST/WS 方法与 DTO 的 SSOT 是 `app/shared/src/hub/hubClient.ts`（及拆出的 payload/extended 模块）。Desktop/Web/Mobile 的 `app/{desktop,web,mobile-rn}/src/api/hubClient.ts` 只能是 thin shell（平台默认 baseUrl、Tauri proxy、SecureStore token、fixture snapshot、WS URL 等胶水）；禁止在客户端再分叉 REST 实现。
- Desktop 只能把 Tauri/Rust native 能力放在 `app/desktop/src-tauri/`。
- Web 只能通过 Hub/Web adapter 访问远端能力，不能直连 Local Edge 或 runtime。
- Mobile（Expo/RN）同样 **Hub-only**：只走 Hub 合同与 shared hubClient；不得直连 Local Edge、raw runtime 或 Desktop host。详见 `app/mobile-rn/README.md`。
- Desktop renderer 不获得 raw process execution 权限；本地执行由 Local Edge 和 Tauri host typed API 承担。

## 3. 产品术语

| 概念 | 含义 | 权威位置 |
|---|---|---|
| Agent Runtime | Codex、OpenCode、Claude Code 等 CLI/SDK 运行时适配器，回答“用什么运行” | Edge `edge-server/internal/adapters/` |
| Agent Profile | 用户选择和管理的 Agent 实体，回答“谁来做事” | Hub profile store / Edge local profile |
| Agent Configuration | Profile 的上下文、Skill、MCP、模型参数、审批策略等配置集合 | Edge Context Builder + Hub store |
| Execution Target | 一次 Run 的执行位置：Local Edge、Remote Edge、Cloud Edge、Hub Relay target | Edge registration + Hub routing |

本地执行不依赖 Hub。Hub 进入链路的场景是账号、云端 IM、多端同步、远程查看/审批、设备路由、中继和审计。

## 4. 生态边界

| 主题 | 规则 | Owner 文档 |
|---|---|---|
| 登录 | AgentHub 只接 TokenDance ID；第三方 provider、账号绑定、`oauth_bindings` 归 TokenDance ID | `docs/architecture/06-auth-identity.md` |
| 授权 | TokenDance ID 只证明身份；Hub Server 用 Hub-local membership/resource/action 决定权限 | `docs/architecture/06-auth-identity.md` |
| 安全风险 | Critical/High 且状态为 Open、rotate required 或 *verification required 时阻断公开发布；Accepted 须记 owner/日期/补偿控制（SSOT 在 TokenDance 私有治理文档 governance/agenthub/security-risk-register.md，本仓摘要见 `SECURITY.md`） | `SECURITY.md` |
| 演示诚实 | stub/demo/fixture/readiness-only 不得声称真实登录、真实模型/API 或 packaged Desktop（威胁模型正文在 TokenDance 私有治理文档） | `docs/governance/README.md` |
| Feishu/Lark | 飞书只做协作入口，不是第二登录系统；慢任务异步，卡片回调 3 秒内响应（治理执行正文在 TokenDance 私有治理文档） | `docs/governance/README.md` |
| i18n/公开包装 | zh/en 语义一致；不把第三方 provider 写成 AgentHub 直连登录 | `docs/governance/README.md` |
| Gateway | TokenDance API key 不是 TokenDance ID token，不得暴露给浏览器 UI 或公开日志 | `docs/architecture/06-auth-identity.md` |
| 设计 | dense command-center surface，真实工作流截图，不截空壳 | `docs/architecture/07-design-system-ssot.md`, `docs/component-acceptance.md` |

## 5. 技术主线

- Hub Server 和 Edge Server 使用 Go。
- UI 使用 React + TypeScript；Desktop 使用 Tauri。
- 主协议是 REST JSON API + typed WebSocket events。
- REST 入口：`api/openapi.yaml`。
- WebSocket 事件入口：`api/events.md`。
- Protobuf、Connect-RPC、JSON-RPC 只作为历史参考，不是当前主线。
- 早期独立 runner 目录已废弃；执行生命周期在 `edge-server/internal/lifecycle/`，runtime 适配在 `edge-server/internal/adapters/`。
- `edge-server/internal/runners/` 是兼容摘要包；`/v1/runners` 不代表新的业务 Agent 模型。

前端规范：

- 通用组件在 `app/shared/src/ui/`，Desktop/Web 从 shared 导入，禁止复制本地 UI 副本。
- CSS Modules + OKLCH tokens，避免硬编码颜色。
- 用户消息、Agent 回复、工具/审批/产物卡片必须按时间线性展示；调试、mock、mode 信息不得进入主聊天流。
- UI 改动用自动化 Playwright + Visual QA 证明行为和布局；Desktop/Web gate 视口为 `1440x810` light+dark，入口 `app/{desktop,web}/scripts/visual-qa-shell.mjs`（`visual:qa:shell`）。`app/web/scripts/visual-qa.mjs` 为可选/遗留多场景电池，不是 merge gate。
- 新 shared 组件必须带三件套：`<组件>.test.tsx` + `<组件>.stories.tsx` + 对照 `docs/component-acceptance.md` 验收表逐项勾选；缺件不得合入。
- 设计 token 改动（`app/shared/src/styles/`、`app/shared/src/designTokens.ts`）必须跑 `python scripts/verify/verify-design-token-ssot.py`，且 `app/shared/src/designTokens.test.ts`、`app/shared/src/styles/tokens-base.test.ts` 全绿后交付。

前端 CI 易踩坑（exactOptionalPropertyTypes / noUncheckedIndexedAccess / CSS helper 类型 / DesignNavIcon / 11px CJK 下限 / changes job）见 `docs/architecture/04-frontend-data-flow.md` §前端 CI 易踩坑。

## 5.5 测试分层（L0-L4）

分层是执行入口的事实描述，不是可选约定；每层对应的 Makefile 目标与 CI job 必须一致。

| 层 | 内容 | 入口 | CI job |
|---|---|---|---|
| L0 单元 | Go `-short`（零依赖）+ 前端 vitest | `make test` / `make fe-test` | `go-edge-test`/`go-hub-test`（2-shard 包轮转）+ `go-edge`/`go-hub`（lint/覆盖率门禁）+ `frontend-*`（checks.yml）+ Windows 原生合同（`windows-go-test`/`windows-frontend-test` 执行矩阵 → `windows-go`/`windows-frontend` 稳定 required-check 聚合，见 `docs/architecture/github-actions-ci-cd-policy.md`） |
| L1 集成 | Go 集成（真实 PG16+Redis7，OIDC mock，`-tags integration`） | `make test-hub-integration`（先 `scripts/dev/dev-up.sh` 起容器） | `backend-integration`（service 容器） |
| L2 回调 E2E | Edge→Hub 回调链路（进程内 mock hub / fixture smoke） | `make test-edge-e2e` / `make e2e-local` | `backend-edge-e2e` / `backend-e2e-fixture` |
| L3 真实 E2E | Playwright 真实登录/聊天流（真实 ID+Hub+Edge 栈） | 远程 dev 服务器：`scripts/dev/devserver.sh test|integration`（见 #1681） | 仓库自认空白（`wsl-full-stack-e2e.sh` WSL 专属） |
| L4 发布门禁 | 打包/安装器/真实证据 | `release-readiness.yml` | `release-readiness` |

规则：

- L0-L2 是 PR merge 门禁（squash 前必须绿）；L3 在远程 dev 服务器手动/脚本执行并落证据（`tests/artifacts/`，gitignore）；L4 是发布门禁。
- 异步等待一律 `pkg/testkit` 的 `Eventually`/`WaitFor`，禁止裸 `time.Sleep` 轮询回调（docstring 明示 Prefer this over time.Sleep）。
- 前端 coverage 契约由 `app/test-config/coverage.ts` factory 强制生产源码全量进分母，阈值在各 package `vitest.config.ts`（CI/本地同源，禁止两套阈值漂移）。
- 证据等级（9 级，见 `scripts/verify/verify-real-e2e-contract.py`）与分层正交：L3 内按证据等级记录 real_tested 状态。

## 6. Git 和 worktree

合并路径（2026-07 起简化）：

```text
feat/* 或 docs/* -> master（squash merge）
```

开始新工作：

```powershell
git pull origin master --ff-only
git worktree add .worktrees/<topic> -b <type>/<topic> origin/master
```

规则：

- `master` 禁止直接 push；所有变更通过 PR，合并仅用 **Squash and merge**（GitHub 已禁 merge/rebase commit）——一个 PR 一个主题，合入后 master 每主题仅一个 squash commit；禁止堆碎 commit、禁止用多次小 PR 凑历史。
- **域分组集成例外**（2026-08-23 定）：同一文件域的多条并行 lane（如设计系统域：token/组件/基建共享大量 CSS/docs 文件）可先在本地按序 merge 进一个 integration 分支，冲突只解一次，**一个 PR** 提回 master；PR body 必须列出全部 `Closes #<issue>` 引用保留自动关单。不同文件域（产品面/后端面）仍各自独立 PR。
- 项目级 worktree 固定放 `.worktrees/`，一个 worktree 对应一个短分支和一个任务卡/PR。
- **一个 worktree 同时只放一个写 agent**：多 agent 并行写同一 worktree 会互相覆盖 barrel/未提交文件（2026-08-23 实测）；并行 lane 需要各自的 worktree。
- 不按历史 handoff 或旧审计推断分支状态；用 `git status --short --branch`、`git worktree list`、GitHub issue/PR live 状态。
- 完成后运行验收、push、开 PR；合并后删除分支和 worktree。
- 不在共享分支 force-push（amend 后 force-with-lease 除外）。

并行波次开发模型（2026-08-23 定）：

- 开发在本地 worktree 完成；L3 真实 E2E/Visual QA 等验证在「远程 dev 服务器」执行（§5.5 L3 同口径，入口 `scripts/dev/devserver.sh`）——开发 lane 不放远程（容量受限）。**公开仓不写内部主机别名/规格**（§9 隐私红线）。
- 本地 worktree 可把 app 下的 node_modules 用 junction 借主树（`New-Item -ItemType Junction`）；主树 `pnpm install` 只在全部 lane 收工后做；junction 依赖版本与 lockfile 不一致时本地 typecheck 可能与 CI 不同——CI 是最终裁决。
- 多 lane 测试串行单进程（`vitest run --no-file-parallelism --maxWorkers=1`），防过载假红。
- CodeRabbit 自动评审已关闭（#1858），按需 `@coderabbitai`；五道硬门禁（validate/go-hub/go-edge/windows-go/windows-frontend）是合并唯一强制 gate。
- 并行 lane 任务书必须含地界/法/验收；主线做最终验收与合并裁决。

防线（三层，防 master 直 push / 历史重写 / 非 squash 合入）：(1) GitHub branch protection + repo 设置——master 禁 force/直 push、必须 PR、线性历史、squash only、要求 `validate`/`go-hub`/`go-edge`/`windows-go`/`windows-frontend`、`enforce_admins: true`；(2) 本地 pre-push hook（`scripts/git-hooks/pre-push`，`bash scripts/git-hooks/install.sh` 启用）——master 直 push 本地拦截，feat/fix/docs/chore/* 放行，`git push --no-verify` 紧急绕过；(3) CI——`scripts/verify/verify-commit-messages.sh` + `verify-ci-gates.py` 在 `validate` job fail-closed 校验 Conventional Commits 与 job 结构。详见 `scripts/git-hooks/` 与 `.github/workflows/checks.yml`。

提交格式：

```text
type(scope): 中文摘要
```

`type` 用 `feat|fix|docs|refactor|chore|test|perf|ci|revert`。摘要不超过 50 字。

## 7. Agent 和 skill

Agent 是协助者，不是仓库负责人。主 Agent 负责拆解、验收、提交和 PR；subagent 只改指定范围。

subagent 提示必须包含：目标、允许修改路径、禁改路径、必须阅读文档、必须运行检查、隐私红线。

仓库不再 vendored skill。真实 E2E 证据等级矩阵由 `scripts/verify/verify-real-e2e-contract.py` 内嵌规范维护；涉及真实 E2E、Playwright、Visual QA、approved-real、真实登录/运行、打包 Desktop、性能/泄漏、发布或 merge-ready 结论时，先对照该 gate 的证据等级。

`.codex/`、`.claude/` 的本机状态、缓存、会话记录和个人配置不得提交。

## 8. 文档规则

- 项目规则只写 `AGENTS.md`。
- 架构概览写 `docs/architecture.md`；模块细节写 `docs/architecture/`。
- 架构决策摘要写 `docs/decisions.md`；旧 ADR 正文只在 `docs/history.md` 指向的外部归档中追溯。
- 模块当前 gate 写各模块 `README.md`；历史 handoff、设备证明和一次性验收记录归档，不作为当前事实入口。
- 历史 longform、日期型审计、旧发布材料和已完成 spec-driven 工件放到 `docs/history.md` 指向的外部归档；新历史 longform 不进源仓。
- `scripts/` 根目录只保留分类目录（verify/dev/e2e/git-hooks/lib/release/smoke/）；不要新增根级脚本 wrapper。
- 过时长期文档直接删除；需要保留审计轨迹时归档为只读快照，外迁规则见 `docs/history.md`。
- 避免巨石文档：主入口只保留职责、摘要、当前事实和链接；长表、历史日志、验收证据和专题设计移到 owner 子文档或 archive。
- 文档不写个人本机绝对路径、私有服务器、生产 secret、token、日志或截图中的敏感信息。
- 修改目录、协议、分工或稳定规则后，同步 README、architecture、governance owner 文档和 verifier。
- `.agenthub/memory/**` 是 gitignored 本机 scratch，不是 SSOT；不得把 `project.md` 当进度或规则权威。进度与状态只写 GitHub Issue/PR；本仓库不维护本地 progress 文件，也不从已归档快照推断现场。

## 9. 安全和隐私

禁止提交或粘贴：

- `.env`、API key、token、cookie、私钥、证书、SSH 配置。
- 真实服务器 IP、内网地址、数据库连接串、生产账号、个人路径。
- 生产数据库 dump、用户数据、聊天记录、含敏感字段的日志。
- 本机 Agent 记忆和运行状态（含 `.agenthub/memory/**` 内容；该目录仅为本地 scratch）。

发布红线：

- stub/demo/fixture 不得冒充真实登录、真实模型/API 或 packaged Desktop。
- Critical/High 且 Open、rotate required 或 *verification required 阻断公开发布；Accepted 与当前队列以 `SECURITY.md`（本仓摘要）与 TokenDance 私有治理文档 security-risk-register（SSOT）为准。

需要示例配置时只提交 `.env.example`，值用占位符。新增本地生成目录、缓存、数据库、日志或私钥目录前，先更新 `.gitignore`。

## 9.5 规则 → 机器验证映射

机器验证的完整映射（规则 → 验证脚本/负向自测 → CI job）在 `docs/governance/verifier-map.md`（SSOT，脚本与 CI 路径由 `verify-doc-ssot.py` 校验存在性）；本节不复制长表。

- 何时读：给规则配新机器门禁、改 CI job、核对负向自测、或审计某条规则有没有机器管时。
- 里面有什么：全表三列（规则/验证脚本/CI job）+ 维护规则；`无` 表示暂无机器验证，靠人工自觉，规则本身不因此失效。
- 权威范围：映射只描述“有没有机器管”，规则本身的权威仍是本文件；两者冲突时以本文件为准，并更新映射表。

## 10. 验证纪律

所有变更的统一验证命令清单（diff/SSOT/yaml/Go/前端）见 `docs/developer-quickstart.md` §测试速查；文档/API 变更至少跑 `python scripts/verify/verify-doc-ssot.py` + openapi yaml parse。

UI 工作流变更必须有行为断言，不只截图：共享 unit/contract + Desktop/Web Playwright + Visual QA，证据等级按 `scripts/verify/verify-real-e2e-contract.py` 内嵌规范标注。Vite renderer 不等于 packaged Desktop；stub/fixture/readiness-only 必须写 `real_tested=false`。

禁止无保护力测试：

| 反模式 | 禁止原因 |
|---|---|
| 测试复制实现 switch | 只能证明测试和实现一起错 |
| 测常量字符串 | 编译器已保证 |
| 硬断错误文案 | 文案不是行为合同 |
| mock 被测函数自己 | mock 应模拟外部系统，不模拟实现内部 |

## 11. Spec-Driven Develop

大型复杂任务默认走 spec-driven-develop：

1. 先读 GitHub issues/PR 的当前目标与 active track，确认 issue/milestone live 状态。
2. SPEC 文档、任务分解、验收标准先行（以 GitHub issue 为载体）。
3. 开发、测试、端到端验收其次。
4. 完成后更新 GitHub issue/PR、验收证据和归档计划。
5. 专项完成后，把专项 SPEC 与证据外迁到 `docs/history.md` 指向的外部归档，并更新历史索引。

短任务（单文件修复、typo、小改动）不需要完整 SPEC，但仍必须遵守本文件的范围、隐私和验证规则。

## 12. 发布流程

唯一发布入口：本地打 tag → `git push origin <tag>` → `.github/workflows/release.yml` 触发构建并出 GitHub Release。tag SOP（前置校验、tag 格式、产物门控、冻结开关）见 `docs/developer-quickstart.md` §发布 tag SOP。

版本号递增纪律（1.0 之前，0.x 阶段）：默认升 patch（如 0.6.0 → 0.6.1）；升 minor（v0.(x+1).0）需产品级理由（新平台、破坏性变更或对外里程碑）；RC 走 `vX.Y.Z-rc.N`（prerelease，不覆盖稳定 tag）；三端版本同步（desktop 必须与 tag 一致，web/mobile 落后在 release notes 注明，不单独打 tag）。**禁止**：同一 minor 反复 bump、24 小时内重打同 minor（patch 除外）、1.0 前打 `v1.x`。

平台策略（Windows 唯一桌面目标、NSIS+portable、`RELEASE_MOBILE_ENABLED`/`RELEASE_UNSIGNED_OK`/`RELEASE_SIGNING_APPROVED` 门控）与产物命名/双语 release notes 见 `docs/developer-quickstart.md` §发布 tag SOP 步骤 4；发布后产物核对见步骤 5，release job 失败按步骤 6 重发。

## 13. 依赖更新（Renovate）

配置 SSOT 是 `.github/renovate.json`，本节只总结策略，不复制规则细节。

- patch：周一自动合并（squash），前提是 `.github/workflows/checks.yml` 全绿且沉淀 1 天；CI 红时 Renovate 不自合。
- minor：汇总周度 review PR；major：逐个独立 PR 评审；均不自动合并；`expo`/`expo-*`、`storybook`/`@storybook/*`、`vite`、`typescript` 的 major 不开 PR。
- 改规则只改 `.github/renovate.json`，不在本文件或子文档复制 rule 值；上述 major 排除是“延期”不是“永禁”，迁移完成后由对应通道更新配置。Renovate PR 一律带 `dependencies` label。
