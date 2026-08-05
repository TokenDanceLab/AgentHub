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

## 0.5 根级目录地图

【活】= 维护中的源码/文档；【产物】= 构建/临时产物（gitignored，勿提交）；【参考】= 只读副本。

| 目录 | 分类 | 职责 |
|---|---|---|
| `api/` | 活 | API 契约 SSOT（openapi.yaml/events.md/conventions.md） |
| `app/` | 活 | 前端 monorepo（web/desktop/mobile-rn/shared） |
| artifacts/ | 产物 | 本地构建输出（gitignored） |
| `deployments/` | 活 | 部署模板（production/；hk2/ 已随 #1527 删除） |
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
2. 完整读本文件，再读 `docs/progress/MASTER.md` 的当前目标与 active track。仓库根目录不维护第二份进度文件。
3. 只在任务需要时读 `docs/roadmap.md`、`docs/architecture.md` 和一个 owner 文档；不要先遍历整个 `docs/`。
4. 查明对应 Issue/PR、允许修改路径、禁改路径和验收命令后再动代码。没有活跃任务且范围复杂时，先按 `.agents/skills/dev-loop/SKILL.md` 建立短 spec。
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
| 演示诚实 | stub/demo/fixture/readiness-only 不得声称真实登录、真实模型/API 或 packaged Desktop | `docs/governance/threat-model.md`, `.agents/skills/real-e2e-acceptance/` |
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
- UI 改动用自动化 Playwright + Visual QA 证明行为和布局；Desktop/Web gate 视口为 `1440x810` light+dark，入口 `app/{desktop,web}/scripts/visual-qa-shell.mjs`（`visual:qa:shell`）。评分 SSOT：`docs/archives/analysis/visual-qa-scorecard.md`。`app/web/scripts/visual-qa.mjs` 为可选/遗留多场景电池，不是 merge gate。

前端 CI 易踩坑（站立规则）：

- `exactOptionalPropertyTypes`：禁止 `...{ optional: maybeUndefined }`；只在 defined 时赋值；async handler 传给 `() => void` 时用 `void fn()` 包装。
- `noUncheckedIndexedAccess`：CSS module / `Record<string, string>` 索引用 `styles.foo ?? ''`，不要假设必有 key。
- CSS helper 参数类型用 `Record<string, string>`，不要 `Pick<typeof styles, 'a' | 'b'>`（与 `CSSModuleClasses` 不兼容）。
- Nav 图标只用 `DesignNavIcon`（有效名称见 `DesignNavIconName` 类型）；禁止散落的 nav glyph 组件。
- 11px (0.6875rem) 为 CJK 最小可读字号；badge/chip 用此值，正文标签 ≥12px。
- CI 使用统一 `changes` job（`dorny/paths-filter@v4`）进行路径筛选：Go-only PR 跳过前端 CI，CSS-only PR 跳过 Go CI。`scripts/verify/verify-ci-gates.ps1` 校验 job 结构。

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

- `master` 禁止直接 push；所有变更通过 PR squash merge。
- 项目级 worktree 固定放 `.worktrees/`，一个 worktree 对应一个短分支和一个任务卡/PR。
- 不按历史 handoff 或旧审计推断分支状态；用 `git status --short --branch`、`git worktree list`、GitHub issue/PR live 状态。
- 完成后运行验收、push、开 PR；合并后删除分支和 worktree。
- 不在共享分支 force-push（amend 后 force-with-lease 除外）。

防线（三层，防 master 直 push / 历史重写 / 非 squash 合入）：

- **GitHub branch protection + repo 设置**（已配置，最强）：master 禁止 force push、禁止直接 push（必须 PR）、要求线性历史；**合并方式已锁死为 squash only**（merge commit / rebase merge 均已禁用，PR 按钮只剩一个选项）；要求 `validate`/`go-hub`/`go-edge` 通过；`enforce_admins: true` 管理员也不能绕过。strict 模式要求 PR 分支基于最新 master——并行 PR 偶尔需要 rebase 属正常预期，rebase 后 force-with-lease 推分支即可。
- **本地 pre-push hook**（`scripts/git-hooks/pre-push`，clone 后跑 `bash scripts/git-hooks/install.sh` 启用）：往 master 直 push 本地提前拦截；feat/fix/docs/chore/* 分支放行；非 master 允许 force-with-lease；紧急绕过 `git push --no-verify`（GitHub 层仍兜底）。
- **CI**：`scripts/verify/verify-commit-messages.sh` 在必跑 `validate` job 中 fail-closed 校验 Conventional Commits；`verify-ci-gates.ps1` 校验 job 结构。

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
- 新历史 longform 不进源仓：走 `docs/history.md` 指向的外部 TokenDance docs 归档。允许保留既有 `docs/archives/cleanup-baseline/` 快照；不要再新增平行 `docs/archives/*` 叙事目录。当前执行中的 SPEC 使用 `docs/analysis/`、`docs/plan/`、`docs/progress/`。
- `scripts/` 根目录只保留分类目录：`scripts/verify/`、`scripts/dev/`、`scripts/release/`、`scripts/smoke/` 和 `scripts/lib/`；不要新增根级脚本 wrapper。
- 过时长期文档直接删除；需要保留审计轨迹时归档快照。
- 避免巨石文档：主入口只保留职责、摘要、当前事实和链接；长表、历史日志、验收证据和专题设计移到 owner 子文档或 archive。
- 文档不写个人本机绝对路径、私有服务器、生产 secret、token、日志或截图中的敏感信息。
- 修改目录、协议、分工或稳定规则后，同步 README、roadmap、architecture、governance owner 文档和 verifier。
- `.agenthub/memory/**` 是 gitignored 本机草稿，不是 SSOT；不得把 `project.md` 当进度或规则权威。权威仍是本文件、`docs/progress/MASTER.md` 与 GitHub issues（指针见 `docs/archives/analysis/local-memory-pointer.md`）。

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
| CI 路径筛选与 job 结构（统一 `changes` job） | `scripts/verify/verify-ci-gates.ps1` | checks.yml → validate |
| action runtime 只允许 node24（防 Node-20 major 回退，#1580） | `scripts/verify/verify-action-runtimes.ps1`（负向自测 `scripts/verify/tests/verify-action-runtimes.Tests.ps1`） | checks.yml → validate |
| Hub lint finding fingerprint ratchet（防新增/替换，#1573） | `scripts/verify/verify-hub-lint-ratchet.py`（负向自测 `scripts/verify/tests/verify-hub-lint-ratchet.Tests.py`，baseline `scripts/verify/hub-lint-baseline.json`） | checks.yml → go-hub |
| skill 白名单只提交 active skill | `scripts/verify/verify-project-skills.ps1` | checks.yml → validate |
| 文档与 Agent 入口 SSOT：根级入口/路径/行数/标记/映射表保鲜 | `scripts/verify/verify-doc-ssot.py`（负向自测 `scripts/verify/tests/verify-doc-entrypoints.Tests.ps1`） | checks.yml → validate |
| Web Hub-only 边界（不直连 Local Edge） | `scripts/verify/verify-web-hub-boundary.py` | checks.yml → validate |
| Hub 纯包导入（不依赖框架包） | `scripts/verify/verify-hub-pure-packages.py` | checks.yml → validate |
| Mobile Hub-only 边界（不直连 Local Edge/runtime） | `scripts/verify/verify-mobile-hub-boundary.py` | checks.yml → validate |
| hubClient thin-shell SSOT（客户端不分叉 REST 实现） | `scripts/verify/verify-hubclient-ssot.py` | checks.yml → validate |
| Design token SSOT（CSS 硬编码颜色禁令） | `scripts/verify/verify-design-token-ssot.ps1` | checks.yml → validate |
| 演示诚实：stub/fixture 不得冒充真实登录/API | `scripts/verify/verify-real-e2e-contract.ps1` | checks.yml → validate |
| OpenAPI↔hub router 合同一致 | `scripts/verify/verify-openapi-contract.py` | checks.yml → validate |
| shared 内不出现 Edge 客户端实现 | `scripts/verify/verify-shared-boundary.py` | checks.yml → validate |
| shared barrel 不泄漏 Edge 导出 | `scripts/verify/verify-shared-barrel.py` | checks.yml → validate |
| Hub handler 不直连 repository | `scripts/verify/verify-hub-layering.py` | checks.yml → validate |
| router 方法必须在 conventions.md 文档化 | `scripts/verify/verify-conventions.py` | checks.yml → validate |
| 出站 client 卫生：service/jwtutil/edge-hub 范围内禁裸 client、禁 request-path env 读取、外部响应必须有 body limit、retry 必须有预算；allowlist 只缩且带 issue（#1549/#1564） | `scripts/verify/verify-outbound-client-hygiene.py`（负向自测 `scripts/verify/tests/verify-outbound-client-hygiene.Tests.ps1`） | checks.yml → validate |
| shared REST contract 与 Hub router 一致 | `scripts/verify/verify-shared-rest-contract.py` | checks.yml → validate |
| shared UI 依赖 hubClient 门禁 | `scripts/verify/verify-shared-ui-hubclient.py` | checks.yml → validate |
| 前端覆盖率基线不回退 | `scripts/verify/verify-coverage-baseline.py` | checks.yml → validate |
| shared edge 表面不被 web/mobile-rn import（A-V3 门禁） | `scripts/verify/verify-shared-edge-surface-isolation.py` | checks.yml → validate |
| v4 旧 UI 组件/路由不得复活 | `scripts/verify/verify-v4-old-ui-active-paths.py` | checks.yml → validate |
| Hub/Edge gosec SAST 告警清零（#1574，hard fail） | `scripts/verify/verify-gosec-gates.sh`（负向自测 `scripts/verify/tests/verify-gosec-gates.Tests.sh`）；go-edge/go-hub Security scan (gosec) step 直接 fail-closed | checks.yml → go-edge / go-hub |
| OIDC 配置形状与边界（issuer/redirect/无 secret；`verify-oidc-readiness.ps1` 因断言旧服务/测试名已 KNOWN-OBSOLETE，重写待办） | `scripts/verify/verify-oidc-readiness.ps1`（未挂 CI） | — |
| P0 remote-control fixture 就绪 | `scripts/verify/verify-p0-remote-control-fixture.py` | checks.yml → backend-e2e-fixture |
| 后端 perf/leak 门禁（手动触发） | `scripts/verify/verify-backend-perf-leak-gates.ps1` | checks.yml → backend-perf-leak-gates |
| 部署形状 SSOT：唯一 production compose、镜像名 SSOT、遗留清单关闭（#1527） | `scripts/verify/verify-deployment-shape.ps1`（负向自测 `scripts/verify/tests/verify-deployment-shape.Tests.ps1`） | cd-pr-check.yml → deployment-files |
| Tauri packaged 行为与签名门禁 | `scripts/release/verify-tauri-package-readiness.ps1` | release-readiness.yml |
| Tauri installer 冒烟 | `scripts/release/verify-tauri-installer-smoke.ps1` | release-readiness.yml |
| Tauri dry 打包 | `scripts/release/verify-tauri-package-dry.ps1` | release-readiness.yml |
| secrets/token 不落库 | `scripts/verify/check-secrets.sh` | checks.yml → validate |
| 提交格式 `type(scope): 中文摘要`（PR 时） | `scripts/verify/verify-commit-messages.sh` | checks.yml → validate |
| UI Visual QA shell 行为证明（1440x810 light/dark） | `app/{desktop,web}/scripts/visual-qa-shell.mjs` | checks.yml → visual-qa-shell |
| 真实登录/OIDC e2e 链路（需真实服务与凭据，`scripts/verify/verify-oidc-flow.ps1` 等 gate 保留在 `scripts/verify/`） | 无 | 无 |
| 交互型 UI/UX 验收（Type/Motion/Empty 等跨组件行为） | 无 | 无 |

## 10. 验证纪律

所有变更至少运行：

```powershell
git diff --check
git status --short --branch
```

文档或 API 变更追加：

```powershell
python scripts/verify/verify-doc-ssot.py
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

## 12. 发布流程

唯一发布入口：本地打 tag → `git push origin <tag>` → `.github/workflows/release.yml` 触发构建并出 GitHub Release。旁路入口 cd-desktop.yml（手动触发）与 scripts/release/release.ps1（本地直传）已于 2026-08-02 删除，不再提供。

打 tag SOP：

1. 前置：master 全绿；版本号与 `app/desktop/package.json`、`app/desktop/src-tauri/tauri.conf.json`、`app/desktop/src-tauri/Cargo.toml` 一致（校验见 `scripts/release/verify-release-gate.ps1`）。
2. 打 tag：`git tag vX.Y.Z`（正式版）或 `git tag vX.Y.Z-rc.N`（候选版）；tag 指向的 commit 必须在 master 祖先链上，格式须匹配 `^v\d+\.\d+\.\d+(-rc\.\d+)?$`（release.yml 的 tag-guard job 双重守卫，任一不满足则 job 失败、不触发构建）。
3. push：`git push origin <tag>` → release.yml 构建出包并发布。
4. 发布产物：build-desktop（Windows NSIS + portable）、build-desktop-macos（DMG）、build-mobile（Android APK）。

冻结开关：`scripts/release/verify-release-gate.ps1` 末尾两条无条件 Blocker（signing/notarization 审批）是发布冻结开关，等管理员批准后再发布；不是常规门禁，不得按"永远红"误判为故障。
