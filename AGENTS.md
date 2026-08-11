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
| `app/` | 活 | 前端 monorepo（web/desktop/mobile-rn/shared） |
| artifacts/ | 产物 | 本地构建输出（gitignored） |
| dist/ | 产物 | 本地构建输出（gitignored，已清理） |
| `docs/` | 活 | 知识库（architecture/progress/plan/analysis/governance/reference/archives） |
| `edge-server/` | 活 | Go Edge 服务（local runtime、adapters、lifecycle） |
| `hub-server/` | 活 | Go Hub 服务（REST/WS/OIDC/dispatch/agentteam） |
| node_modules/ | 产物 | 依赖（gitignored） |
| `pkg/` | 活 | Go 共享包（errcode 等） |
| `reference/` | 参考 | 第三方源码只读副本（gitignored，INDEX.md 管理） |
| `scripts/` | 活 | 验证/开发/发布脚本（verify/dev/release/smoke/lib/） |
| `tests/` | 活 | 跨服务测试 |
| tmp/ | 产物 | 本地临时文件（gitignored，已清理） |

## 1. 首次入仓与渐进式加载

### 新 Agent 90 秒入口

1. 先运行 `git status --short --branch`、`git log -5 --oneline`、`git worktree list`，确认真实分支、脏文件和并行 worktree；不要从旧 handoff 推断现场。
2. 完整读本文件，再读 GitHub issues/PR 的当前目标与 active track。仓库根目录不维护第二份进度文件。
3. 只在任务需要时读 `docs/architecture.md` 和一个 owner 文档；不要先遍历整个 `docs/`。
4. 查明对应 Issue/PR、允许修改路径、禁改路径和验收命令后再动代码。没有活跃任务且范围复杂时，先建立短 spec 再动手。
5. 每完成一个切片立即运行最窄验证；宣称 merge-ready、真实 E2E、发布或生产就绪前，再运行对应完整 gate。

**停止加载规则**：已经能回答“当前目标、事实 owner、允许改哪里、用什么验证”时就停止读文档；论证材料最多追加 1-3 篇精确 `docs/reference/**`，历史只通过 `docs/history.md` 定位。

人类同学的最短入口是 `README.md` → `docs/architecture.md` → `docs/developer-quickstart.md`。

任务路由：接口改动读 `api/openapi.yaml`、`api/events.md`、`api/conventions.md`；UI/数据流读 `docs/architecture/04-frontend-data-flow.md`；登录、授权、Feishu/Lark、Gateway、安全、公开包装、i18n 或设计 token 同时读上级 `../AGENTS.md` 与对应 `../docs/` owner 文档。

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
- Hub REST/WS 方法与 DTO 的 SSOT 是 `app/shared/src/hubClient.ts`（及拆出的 payload/extended 模块）。Desktop/Web/Mobile 的 `app/{desktop,web,mobile-rn}/src/api/hubClient.ts` 只能是 thin shell（平台默认 baseUrl、Tauri proxy、SecureStore token、fixture snapshot、WS URL 等胶水）；禁止在客户端再分叉 REST 实现。
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
| 登录 | AgentHub 只接 TokenDance ID；第三方 provider、账号绑定、`oauth_bindings` 归 TokenDance ID | `../docs/identity/identity-auth.md` |
| 授权 | TokenDance ID 只证明身份；Hub Server 用 Hub-local membership/resource/action 决定权限 | `../docs/identity/authorization-model.md` |
| 安全风险 | Critical/High 且状态为 Open、rotate required 或 *verification required 时阻断公开发布；Accepted 须记 owner/日期/补偿控制（SSOT：`docs/governance/security-risk-register.md`） | `docs/governance/security-risk-register.md`, `../docs/security/security-risk.md` |
| 演示诚实 | stub/demo/fixture/readiness-only 不得声称真实登录、真实模型/API 或 packaged Desktop | `docs/governance/threat-model.md` |
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
- 早期独立 runner 目录已废弃；执行生命周期在 `edge-server/internal/lifecycle/`，runtime 适配在 `edge-server/internal/adapters/`。
- `edge-server/internal/runners/` 是兼容摘要包；`/v1/runners` 不代表新的业务 Agent 模型。

前端规范：

- 通用组件在 `app/shared/src/ui/`，Desktop/Web 从 shared 导入，禁止复制本地 UI 副本。
- CSS Modules + OKLCH tokens，避免硬编码颜色。
- 用户消息、Agent 回复、工具/审批/产物卡片必须按时间线性展示；调试、mock、mode 信息不得进入主聊天流。
- UI 改动用自动化 Playwright + Visual QA 证明行为和布局；Desktop/Web gate 视口为 `1440x810` light+dark，入口 `app/{desktop,web}/scripts/visual-qa-shell.mjs`（`visual:qa:shell`）。`app/web/scripts/visual-qa.mjs` 为可选/遗留多场景电池，不是 merge gate。
- 新 shared 组件必须带三件套：`<组件>.test.tsx` + `<组件>.stories.tsx` + 对照 `../docs/design/component-acceptance.md` 验收表逐项勾选；缺件不得合入。
- 设计 token 改动（`app/shared/src/styles/`、`app/shared/src/designTokens.ts`）必须跑 `python scripts/verify/verify-design-token-ssot.py`，且 `app/shared/src/designTokens.test.ts`、`app/shared/src/styles/tokens-base.test.ts` 全绿后交付。

前端 CI 易踩坑（exactOptionalPropertyTypes / noUncheckedIndexedAccess / CSS helper 类型 / DesignNavIcon / 11px CJK 下限 / changes job）见 `docs/architecture/04-frontend-data-flow.md` §前端 CI 易踩坑。

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
- 项目级 worktree 固定放 `.worktrees/`，一个 worktree 对应一个短分支和一个任务卡/PR。
- 不按历史 handoff 或旧审计推断分支状态；用 `git status --short --branch`、`git worktree list`、GitHub issue/PR live 状态。
- 完成后运行验收、push、开 PR；合并后删除分支和 worktree。
- 不在共享分支 force-push（amend 后 force-with-lease 除外）。

防线（三层，防 master 直 push / 历史重写 / 非 squash 合入）：(1) GitHub branch protection + repo 设置——master 禁 force/直 push、必须 PR、线性历史、squash only、要求 `validate`/`go-hub`/`go-edge`、`enforce_admins: true`；(2) 本地 pre-push hook（`scripts/git-hooks/pre-push`，`bash scripts/git-hooks/install.sh` 启用）——master 直 push 本地拦截，feat/fix/docs/chore/* 放行，`git push --no-verify` 紧急绕过；(3) CI——`scripts/verify/verify-commit-messages.sh` + `verify-ci-gates.py` 在 `validate` job fail-closed 校验 Conventional Commits 与 job 结构。详见 `scripts/git-hooks/` 与 `.github/workflows/checks.yml`。

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
- 历史 longform、日期型审计、旧发布材料、过期设计、完成的 spec-driven 工件和过期项目 skill 放到 `docs/history.md` 指向的外部 TokenDance docs 归档。
- 新历史 longform 不进源仓：走 `docs/history.md` 指向的外部 TokenDance docs 归档。
- `scripts/` 根目录只保留分类目录：`scripts/verify/`、`scripts/dev/`、`scripts/release/`、`scripts/smoke/`、`scripts/e2e/` 和 `scripts/lib/`；不要新增根级脚本 wrapper。
- 过时长期文档直接删除；需要保留审计轨迹时归档快照。
- 避免巨石文档：主入口只保留职责、摘要、当前事实和链接；长表、历史日志、验收证据和专题设计移到 owner 子文档或 archive。
- 文档不写个人本机绝对路径、私有服务器、生产 secret、token、日志或截图中的敏感信息。
- 修改目录、协议、分工或稳定规则后，同步 README、architecture、governance owner 文档和 verifier。
- `.agenthub/memory/**` 是 gitignored 本机草稿，不是 SSOT；不得把 `project.md` 当进度或规则权威。权威仍是本文件与 GitHub issues（指针见 `docs/archives/analysis/local-memory-pointer.md`）。

## 9. 安全和隐私

禁止提交或粘贴：

- `.env`、API key、token、cookie、私钥、证书、SSH 配置。
- 真实服务器 IP、内网地址、数据库连接串、生产账号、个人路径。
- 生产数据库 dump、用户数据、聊天记录、含敏感字段的日志。
- 本机 Agent 记忆和运行状态（含 `.agenthub/memory/**` 内容；该目录仅为本地 scratch）。

发布红线：

- stub/demo/fixture 不得冒充真实登录、真实模型/API 或 packaged Desktop。
- Critical/High 且 Open、rotate required 或 *verification required 阻断公开发布；Accepted 与当前队列以 `docs/governance/security-risk-register.md` 为准。

需要示例配置时只提交 `.env.example`，值用占位符。新增本地生成目录、缓存、数据库、日志或私钥目录前，先更新 `.gitignore`。

## 9.5 规则 → 机器验证映射

下表列出有机器管的规则与其验证脚本、CI job。脚本路径与 CI 文件由 `verify-doc-ssot.py` 校验存在性；`无` 表示暂无机器验证，靠人工自觉，规则本身不因此失效。

| 规则 | 验证脚本 | CI job |
|---|---|---|
| CI 路径筛选与 job 结构（统一 `changes` job） | `scripts/verify/verify-ci-gates.py` | checks.yml → validate |
| action runtime 只允许 node24（防 Node-20 major 回退，#1580） | `scripts/verify/verify-action-runtimes.py`（负向自测 `scripts/verify/tests/verify-action-runtimes.Tests.py`） | checks.yml → validate |
| Hub lint finding fingerprint ratchet（防新增/替换，#1573） | `scripts/verify/verify-hub-lint-ratchet.py`（负向自测 `scripts/verify/tests/verify-hub-lint-ratchet.Tests.py`，baseline `scripts/verify/hub-lint-baseline.json`） | checks.yml → go-hub |
| skill 白名单只提交 active skill | `scripts/verify/verify-project-skills.py` | checks.yml → validate |
| 文档与 Agent 入口 SSOT：根级入口/路径/行数/标记/映射表保鲜 | `scripts/verify/verify-doc-ssot.py`（负向自测 `scripts/verify/tests/verify-doc-entrypoints.Tests.py`） | checks.yml → validate |
| Web Hub-only 边界（不直连 Local Edge） | `scripts/verify/verify-web-hub-boundary.py` | checks.yml → validate |
| Hub 纯包导入（不依赖框架包） | `scripts/verify/verify-hub-pure-packages.py` | checks.yml → validate |
| Mobile Hub-only 边界（不直连 Local Edge/runtime） | `scripts/verify/verify-mobile-hub-boundary.py` | checks.yml → validate |
| hubClient thin-shell SSOT（客户端不分叉 REST 实现） | `scripts/verify/verify-hubclient-ssot.py` | checks.yml → validate |
| Design token SSOT（CSS 硬编码颜色禁令） | `scripts/verify/verify-design-token-ssot.py` | checks.yml → validate |
| shared UI i18n callsites ratchet（CJK 字面量不得新增，#1612） | `scripts/verify/verify-i18n-callsites.py` | checks.yml → validate |
| 演示诚实：stub/fixture 不得冒充真实登录/API | `scripts/verify/verify-real-e2e-contract.py` | checks.yml → validate |
| OpenAPI↔hub router 合同一致 | `scripts/verify/verify-openapi-contract.py` | checks.yml → validate |
| shared 内不出现 Edge 客户端实现 | `scripts/verify/verify-shared-boundary.py` | checks.yml → validate |
| shared barrel 不泄漏 Edge 导出 | `scripts/verify/verify-shared-barrel.py` | checks.yml → validate |
| Hub handler 不直连 repository | `scripts/verify/verify-hub-layering.py` | checks.yml → validate |
| router 方法必须在 conventions.md 文档化 | `scripts/verify/verify-conventions.py` | checks.yml → validate |
| 出站 client 卫生：service/jwtutil/edge-hub 范围内禁裸 client、禁 request-path env 读取、外部响应必须有 body limit、retry 必须有预算；allowlist 只缩且带 issue（#1549/#1564） | `scripts/verify/verify-outbound-client-hygiene.py`（负向自测 `scripts/verify/tests/verify-outbound-client-hygiene.Tests.py`） | checks.yml → validate |
| shared REST contract 与 Hub router 一致 | `scripts/verify/verify-shared-rest-contract.py` | checks.yml → validate |
| shared UI 依赖 hubClient 门禁 | `scripts/verify/verify-shared-ui-hubclient.py` | checks.yml → validate |
| 前端覆盖率基线不回退 | `scripts/verify/verify-coverage-baseline.py` | checks.yml → validate |
| shared edge 表面不被 web/mobile-rn import（A-V3 门禁） | `scripts/verify/verify-shared-edge-surface-isolation.py` | checks.yml → validate |
| v4 旧 UI 组件/路由不得复活 | `scripts/verify/verify-v4-old-ui-active-paths.py` | checks.yml → validate |
| Hub/Edge gosec SAST 告警清零（#1574，hard fail） | `scripts/verify/verify-gosec-gates.sh`（负向自测 `scripts/verify/tests/verify-gosec-gates.Tests.sh`）；go-edge/go-hub Security scan (gosec) step 直接 fail-closed | checks.yml → go-edge / go-hub |
| OIDC 配置形状与边界（issuer/redirect/无 secret） | 旧 OIDC readiness 检查器已退役（2026-08-07，#1653：断言旧服务/测试名）；配置形状与证据等级见 `docs/architecture/05-deployment.md` 部署证据等级表（OIDC 行）；WSL 全栈 E2E 覆盖真实 OIDC 流 | — |
| P0 remote-control fixture 就绪 | `scripts/verify/verify-p0-remote-control-fixture.py` | checks.yml → backend-e2e-fixture |
| 后端 perf/leak 门禁（手动触发） | `scripts/verify/verify-backend-perf-leak-gates.py` | checks.yml → backend-perf-leak-gates |
| 部署形状 SSOT：唯一 production compose、镜像名 SSOT、遗留清单关闭（#1527） | `scripts/verify/verify-deployment-shape.py`（负向自测 `scripts/verify/tests/verify-deployment-shape.Tests.py`） | cd-pr-check.yml → deployment-files |
| Tauri packaged 行为与签名门禁 | `scripts/release/verify-tauri-package-readiness.py` | release-readiness.yml |
| Tauri installer 冒烟 | `scripts/release/verify-tauri-installer-smoke.py` | release-readiness.yml |
| Tauri dry 打包 | `scripts/release/verify-tauri-package-dry.py` | release-readiness.yml |
| secrets/token 不落库 | `scripts/verify/check-secrets.sh` | checks.yml → validate |
| 提交格式 `type(scope): 中文摘要`（PR 时） | `scripts/verify/verify-commit-messages.sh` | checks.yml → validate |
| UI Visual QA shell 行为证明（1440x810 light/dark） | `app/{desktop,web}/scripts/visual-qa-shell.mjs` | checks.yml → visual-qa-shell |
| 真实登录/OIDC e2e 链路（需真实服务与凭据，`scripts/verify/verify-oidc-flow.py` 等 gate 保留在 `scripts/verify/`） | 无 | 无 |
| 交互型 UI/UX 验收（Type/Motion/Empty 等跨组件行为） | 无 | 无 |
| 配置组合安全（fail-closed 默认/env 全覆盖） | `hub-server/internal/config/config_validate.go`（校验入口）+ `hub-server/internal/config/constants.go`（`AuthFailClosedDefault`、`RateLimitFailOpenDefault`：auth 路径恒 fail-closed，非 auth 路径可 fail-open） | 无 |
| edge debug 端点鉴权（Dev→nil / LocalAuthToken→Bearer / HubJWTSecret→hub-JWT 校验） | `edge-server/internal/httpserver/server_auth.go`（`debugAuthFunc` 分层鉴权，pprof/config/state 端点） | 无 |
| 域 SSOT（CSP / Desktop 默认 URL / compose 回调域 三方一致） | `app/desktop/src-tauri/tauri.conf.json`（CSP + 默认 URL）；compose 回调域见 `deployments/production/.env.example`；专用 verifier 暂未建 | 无 |

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

唯一发布入口：本地打 tag → `git push origin <tag>` → `.github/workflows/release.yml` 触发构建并出 GitHub Release。旁路入口 cd-desktop.yml 与 scripts/release/release.ps1 已于 2026-08-02 删除。完整 tag SOP（前置校验、tag 格式正则、产物门控 variable、冻结开关）见 `docs/developer-quickstart.md` §发布 tag SOP。

版本号递增纪律（1.0 之前，0.x 阶段）：

- **默认升 patch**：常规发布打 `v0.x.y+1`（如 0.6.0 → 0.6.1），保持小步快跑，避免版本号虚高。
- **升 minor（v0.(x+1).0）需产品级理由**：新平台支持、破坏性 UI/API 变更、或对外公告的功能里程碑；日常功能/修复/重构一律 patch。
- **RC 走 `vX.Y.Z-rc.N`**：正式发版前可迭代 rc，GitHub Release 自动标记 prerelease；RC 不覆盖稳定 tag。
- **三端版本同步**：desktop（package.json + tauri.conf.json）版本必须与 tag 一致；web/mobile 版本落后 desktop 时在 release notes 中注明，不单独打三份 tag。
- **禁止**：同一 minor 内反复 bump minor；tag 打后 24 小时内再打同 minor 的新 minor（patch 除外）；1.0 前打 `v1.x`。

发布平台策略（2026-08-11）：**Windows 是唯一桌面发布目标**（NSIS 安装包 + 便携 zip），macOS 桌面/公证不在范围内；Go 服务端二进制保留跨平台（Linux/Windows/darwin）；Android APK 走 `RELEASE_MOBILE_ENABLED` 门控（EAS）。代码签名：无商业证书时走 unsigned 策略（`RELEASE_UNSIGNED_OK=true`，SmartScreen 提示、updater 自签可用）；签名证书就绪后改用 `RELEASE_SIGNING_APPROVED=true` + 签名证据。

Release 自动化的产物命名、双语 release notes（git-cliff 按 conventional commits 分类生成，配置见 `cliff.toml`）与 SHA256SUMS 校验和由 release.yml 维护，改动须过 `release-readiness.yml` 门禁。

发布后按 `docs/developer-quickstart.md` §发布 tag SOP 步骤 5 核对产物（12 项 + 描述）；release job 失败按步骤 6 重发（移 tag → 删旧 release → 重推，softprops 不覆盖已存在 release）。

## 13. 依赖更新（Renovate）

依赖更新由 `.github/renovate.json` 驱动，配置 SSOT 即该文件；本节只总结策略，不复制规则细节。

| 策略 | 行为 |
|---|---|
| 启用 managers | `npm`、`gomod`、`cargo`、`dockerfile`、`github-actions`、`docker-compose` |
| 调度 | 周一 09:00 后（Asia/Shanghai）；`prConcurrentLimit=10`、`prHourlyLimit=2` |
| patch 更新 | 周一自动合并（`automerge: true`，squash），但 `ignoreTests: false` + `stabilityDays: 1`——必须等 `.github/workflows/checks.yml` 全绿且沉淀 1 天才合并，CI 红时 Renovate 不会自合。 |
| minor 更新 | 周一汇总成一个 review PR，**不**自动合并，需人工审。 |
| major 更更新 | 每个一个独立 PR，**不**自动合并，需人工审。 |
| 排除的 major | `expo`/`expo-*`（mobile 生态 major 由 mobile 通道管）、`storybook`/`@storybook/*`（8→10 迁移延期）、`vite`（6→8 迁移面大）、`typescript`（5→7 迁移面大）。这些 major Renovate 不开 PR。 |

纪律：

- 不要在 AGENTS.md 或子文档复制 renovate.json 的具体 rule 值——改规则只改 `.github/renovate.json`，本表随之过期以配置为准。
- patch auto-merge 的安全前提是 `checks.yml` 全绿。若 checks.yml 被禁用或跳过，Renovate 不会自动合并（`ignoreTests: false`），但也不应有人手动绕过 CI 合 patch。
- Expo/Storybook/vite/TS 的 major 排除是"延期"，不是"永禁"。相关迁移由各自通道（mobile/design/build）推进，迁完再在 renovate.json 移除对应 `enabled: false` rule。
- Renovate PR 一律带 `dependencies` label，便于过滤。