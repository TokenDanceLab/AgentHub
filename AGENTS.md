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
- 在 workspace 内做跨系统治理时，先读 `../AGENTS.md` 和 `../docs/`；AgentHub 仓内 docs 只负责本产品实现细节。

人类同学先读：

1. `README.md`
2. `docs/architecture.md`

Agent 不要一次性扫全仓库。按下面顺序加载，够用就停：

1. 先读本文件。
2. 读 `docs/roadmap.md` 和 `docs/architecture.md` — 当前目标、架构边界和实现阶段。
3. 做 Desktop/Web v4 重构时，继续读 `docs/roadmap/` 子文档了解各模块进展。
4. 明确任务卡：目标、所属方向、写入范围、接口影响、验收命令。
5. 如果用户要求持续推进、自我迭代、长程开发、worktree/subagent 分发或交叉 review，默认先加载 `.agents/skills/dev-loop/SKILL.md`，再按其中 `references/` 执行。短任务（单文件修复、小改动）不需要。
6. 只读相关主文档章节：产品或架构不清读 `docs/architecture.md`。
7. 改接口时读 `api/README.md`、`api/openapi.yaml`、`api/events.md`。
8. 改 TokenDance ID 登录、OIDC、跨产品鉴权、Feishu/Lark 集成、Gateway 调用、安全风险、公开包装、i18n 或共享设计 token 时，同步读 `../docs/identity/identity-auth.md`、`../docs/identity/authorization-model.md`、`../docs/security/security-risk.md`、`../docs/identity/feishu-integration.md`、`../docs/ecosystem/product-matrix.md`、`../docs/ecosystem/ecosystem-execution-queue.md`、`../docs/identity/i18n-packaging.md`、`../docs/design/design-system.md`、`../docs/design/design-playbook.md` 或 `../docs/design/visual-qa-matrix.md` 中相关文档。
9. 做统一登录、Feishu/Lark、Gateway、SEO/i18n、开源包装等生态级产品需求时，先读 `../docs/ecosystem/ecosystem-execution-queue.md` 和 `docs/governance/governance-execution.md`，再把其中属于 AgentHub 的项拆到本仓库 issue/roadmap。
10. 持续开发和任务拆解读 `docs/architecture.md`（路线图摘要）和当前分支路线图。
11. 客户端任务读 `docs/roadmap.md` 和 `docs/architecture.md`。
12. 需要论证时最多读 1-3 篇精确的 `docs/reference/**`。

`reference/**` 是第三方源码调研，默认不改、不翻译、不全文扫描。

## 2. 三人分工

AgentHub 的开发工作流是"三个开发者，每个开发者可以带一个或多个 Agent"。Agent 是协助者，不是仓库负责人。

| 部分 | 负责范围 | 主要目录 |
|---|---|---|
| 前端 | Web 工作台、IM 交互、Diff/Preview/Approval 面板、前端状态 | `app/web/`、`app/shared/` |
| 后端 | Hub Server、TokenDance ID 接入、Edge-Hub 通信、账号/群聊/同步/中继、Profile/Skill/MCP/审计 | `hub-server/`、`edge-server/`、`api/` |
| 客户端（Desktop） | Desktop Tauri、Edge 本地调度、Agent Runtime 进程、workspace、执行目标体验、tray | `app/desktop/`、`edge-server/` |
| 客户端（Mobile） | Expo/React Native 移动端、OIDC deep-link、SecureStore、Notifications | `app/mobile-rn/` |

Desktop 是 Tauri 项目；Mobile 主线是 Expo + React Native development build。Mobile 不再维护旧 Tauri 实现，旧 Tauri Mobile package 已从活跃源码树移除。

共享边界：

- API 契约写在 `api/`。
- Edge Server 同时连接前端和 Hub，改动前先看 `docs/architecture.md`。
- 跨两个方向的改动先在 PR 描述里写清楚影响面。
- 开发者必须审查自己 Agent 生成的代码、文档和命令输出；不要把未看懂的 Agent 改动直接合入。

### Desktop / Web / Mobile 端口与资源分配

Desktop/Web 是本轮 v4 shared workbench 主线，端口必须固定且不能互相抢占。Mobile RN 使用独立 Expo Web 视觉预览端口。

| 资源 | Desktop/Tauri | Web | Mobile |
|---|---|---|---|
| Vite/Expo Web 开发端口 | **5173** (strict) | **5174** (strict) | **5177** |
| 前端源码 | `app/desktop/src/` | `app/web/src/` | `app/mobile-rn/src/` |
| 平台入口 | `app/desktop/src/App.tsx` + Tauri host adapter | `app/web/src/App.tsx` + Hub/Web adapter | `app/mobile-rn/src/App.tsx` + Expo/RN adapters |
| Native 项目 | `app/desktop/src-tauri/` | 无 | Expo development build (`app/mobile-rn/app.config.ts`, `eas.json`) |
| Native package | `agenthub-desktop` | 无 | `agenthub-mobile-rn` |
| App identifier | `com.agenthub.desktop` | 无 | `tech.vectorcontrol.agenthub.mobile` |
| 共享前端 | `app/shared/` (`@agenthub/shared`) | `app/shared/` (`@agenthub/shared`) | RN-safe contracts only |
| Storybook | 6006 | 共用 shared/desktop story | 无 |

其他固定端口：

| 服务 | 端口 | 说明 |
|---|---|---|
| Hub Server (本地) | 8080 | 开发时 localhost |
| Edge Server (本地) | 3210 | Desktop 本地 Edge |
| OIDC callback (Desktop) | 随机 (127.0.0.1:0) | Rust TcpListener 动态分配 |
| OIDC callback (Mobile) | 深链 `agenthub://` | 不走本地 HTTP server |
| Web 工作台 | 5174 | `app/web/vite.config.ts` |

Native 隔离规则：

- **Desktop Agent 只能修改** `app/desktop/src-tauri/` 的 Tauri/Rust 能力；Mobile Agent 不新增或恢复旧 Tauri Mobile native host。
- 任何 Agent 不得修改对方的 native 配置。Mobile native 配置集中在 `app/mobile-rn/app.config.ts`、`eas.json` 和 Expo plugin 配置。
- 如需共享 Rust 代码，先提议创建 `app/shared-rust/` crate；Mobile RN 默认不消费 Rust crate。
- Desktop 特有功能（tray、Edge 进程管理、keyring）不往 Web/Mobile 移植；Web 只能通过 Hub/Web adapter 访问远端能力；Mobile 特有功能（deep link、platform secure store）不往 desktop 移植。
- 共享的前端代码（类型、hooks、i18n、UI 组件）放 `app/shared/`，两个项目通过 `workspace:*` 引用。

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

所有 AgentHub 登录工作先读 `../docs/identity/identity-auth.md`。

- Hub Agent 负责 Hub Server 作为 TokenDance ID relying party 的后端流程：Hub-owned callback、code exchange、ID token 验证、`tokendance_sub` 到 Hub user 的映射、Hub 本地 access/refresh session 签发。
- Client Agent 负责 Desktop/Web 登录入口、系统浏览器 PKCE/回调体验和 Hub session 存储；客户端不得直接集成 GitHub、Google、飞书，也不得把第三方 provider token 存进 AgentHub。
- GitHub、Google、飞书等第三方 provider 只在 TokenDance ID 中管理；AgentHub 只注册和使用自己的 TokenDance ID OAuth/OIDC client。
- AgentHub Home 的 `https://hub.vectorcontrol.tech/api/auth/callback` 是产品官网静态站 OIDC callback，不是 Hub API 登录 callback。
- 现有 TokenDance ID bearer-token middleware 只是兼容路径；最终浏览器/桌面登录必须由 Hub Server 兑换 code 并签发 Hub 本地 session。

协作提醒：Hub Agent 和 Client Agent 在做登录链路时，只接 TokenDance ID 这一层。不要在 Hub、Desktop、Web 中新增 GitHub/Google/飞书按钮、provider callback、provider token storage 或 provider account table；这些需求全部回到 `tokendance-id` 的 provider registry / `oauth_bindings`。

### AgentHub 授权边界

AgentHub 角色、组织、项目、Thread、Run、Approval、Agent Profile、Integration 或 Execution Target 权限变更先读 `../docs/identity/authorization-model.md`。

- TokenDance ID 只证明用户是谁；Hub Server 必须用 Hub-local user、org/project membership、resource/action check 决定用户能做什么。
- Feishu/Lark 触发的任务、卡片按钮和 H5 操作必须先从飞书 actor 解析到 TokenDance ID `sub`，再映射 Hub user 并校验 Hub 权限。
- 所有外部动作都必须映射到 TokenDance ID `sub` 后再做 Hub 权限判断；Feishu token、provider token、Desktop/Web 本地状态不能直接授权 Hub action。
- Desktop/Web 只负责 UX 和保存 Hub-issued session；不能把 TokenDance ID access token、Feishu token 或 browser localStorage state 当成 Hub 权限来源。
- 高风险动作如启动远程 run、审批命令、读取项目数据、修改 integration secret 或共享 Agent Profile，必须在 Hub Server handler/service 层有 allow/deny 测试或明确验收项。

### 安全风险治理边界

AgentHub 的 `docs/governance/security-risk-register.md` 是本仓库风险事实源；跨仓库分级、状态词、发布门禁和 accepted-risk 规则见 `../docs/security/security-risk.md`。

- 涉及 Hub 登录/session、Edge 远程执行、Desktop/Web token storage、Feishu/Lark action、TokenDance API key、integration secret、公开 stats 或 generated artifact 的风险变更，必须同步更新本仓库风险表。
- Critical/High 风险在未修复、未验证或未显式 accepted 之前阻断公开发布；accepted risk 必须写 owner、日期、原因、补偿控制和复查触发条件。
- 需要生产 endpoint、host、日志、备份或 secret 证明的结论只在私有运维文档记录；AgentHub 公开文档只写证据指针和无密结论。
- 发布前从 workspace 根运行 `.\scripts\verify-ci-gates.ps1`；默认治理 pass 里的 security warning 不是可忽略噪声，而是未关闭 release blocker。

### Feishu/Lark 应用边界

AgentHub 飞书/Lark 应用规划见 `../docs/identity/feishu-integration.md`。Feishu app 只做协作入口：应用机器人收发消息、事件订阅、卡片交互、工作台/H5 和任务通知。它不得成为 AgentHub 第二套登录系统；飞书 OAuth provider、飞书账号绑定、TokenDance ID 账号自动创建和 `oauth_bindings` 由 TokenDance ID 负责。Hub Server 接收 Feishu Integration Gateway 转发的业务事件后，仍按 TokenDance ID `sub` 和 AgentHub 权限执行。

- AgentHub 交互机器人必须按飞书应用机器人设计；群自定义机器人只适合单向通知，不作为接收消息、用户交互或卡片回调方案。
- 生产 Feishu Gateway 必须保留 HTTPS Webhook 入口：`POST /integrations/feishu/events` 用于事件订阅，`POST /integrations/feishu/card-actions` 用于卡片回调。SDK 长连接/WebSocket 只作为企业自建应用开发或内测可选入口，不能成为唯一生产路径。
- `im.message.receive_v1` 处理必须用 `message_id` 做幂等；普通 2.0 事件可按 `event_id` 幂等。所有外部事件先验签/解密、去重、入队，再快速返回飞书。
- 卡片交互按 `card.action.trigger` 建模。回调 3 秒内返回 toast、卡片更新或保持原内容；不要用 HTTP 3xx 处理卡片按钮，耗时 AgentHub 操作必须异步执行。
- Feishu H5/工作台 JSAPI 只用于飞书客户端上下文和体验增强；长期 user token、`offline_access`、账号绑定和 refresh token 只归 TokenDance ID。

### i18n 与公开文案边界

AgentHub Desktop/Web 的 zh/en 字典、登录入口、错误/空状态、Agent Runtime/Profile/Configuration/Execution Target 术语、Feishu/Lark 协作入口和 Gateway 调用文案变更时，先查 `../docs/identity/i18n-packaging.md`。新增用户可见字符串必须保证中英文语义一致，尤其不能把第三方 provider 写成 AgentHub 直连登录，也不能把 TokenDance API key 写成 TokenDance ID token。

### TokenDance Gateway 调用边界

AgentHub 后续调用模型 API 网关时，产品名写 TokenDance Gateway / 词元跳动 API 网关，设计边界见 `../docs/ecosystem/product-matrix.md`。TokenDance API key 只能由 Hub Server、Edge Server 或受信后端/本地运行面持有，不得暴露给浏览器 UI、飞书卡片 value、公开日志或第三方 OAuth session。TokenDance ID access token 只用于登录/身份，不是 `api.vectorcontrol.tech/v1` 的模型 API bearer token。

任务分发：

- 一个主线 issue 对应一个方向：前端、后端、客户端。小任务写进对应 issue、路线图或 PR。
- 分发前先写任务卡：分支名、worktree、负责人、写入范围、依赖、验收命令。
- 只有写入范围互不重叠时才并行；会改同一批文件的任务按顺序做。
- 主 Agent 负责拆解、验收、提交和 PR；subagent 只负责被分配的窄任务。
- subagent 提示必须包含：目标、允许修改的路径、必须阅读的文档、必须运行的检查、隐私红线。
- subagent 不自行扩大范围；发现范围不够，停下交回主 Agent。

### subagent 质量红线

以下情况视为交付不合格，主 Agent 必须退回重做：

1. **冲突标记未清理**：提交包含 `<<<<<<<`、`=======`、`>>>>>>>` 等未解决的合并冲突标记。
2. **CI 降级规避**：不得通过降低覆盖率阈值、放宽 lint 规则、跳过检查步骤来让 CI 变绿。
3. **不完整功能**：提交标记为 `feat` 但实际只有脚手架或占位符。不完整功能用 `wip:` 前缀或留在本地分支。
4. **未验证的提交**：提交前未运行对应模块的测试和 typecheck。前端至少跑 `pnpm typecheck && pnpm test`，后端至少跑 `go test ./... -short -count=1`。
5. **大规模无关联改动**：一个 PR 包含不相关的文件变更（如同时改 desktop UI 和 CI workflow 且不在 PR 描述中说明关联）。
6. **伪造验收证据**：声称"已完成"但截图是 mock 数据、空壳页面或无法交互的静态 UI。

subagent 完成后、提交前，自检：
```powershell
git diff --check                  # 无冲突标记、无行尾空格
git status --short --branch       # 确认只改了允许的路径
```

### 并行团队调度策略

> 具体执行口径以仓库级 skill 为准，不在本文件硬编码模型、供应商或本地 alias 映射。

- 通用多团队、多 subagent 并行开发、审查、测试和文档同步，读 `.agents/skills/dev-team/SKILL.md`。
- Codex 专用 Leader/Worker 编队，读 `.agents/skills/dev-team-codex/SKILL.md`。
- `dev-loop` 仍负责长程单线推进、交叉审查和循环验证；需要并行攻坚时由 `dev-team` 或 `dev-team-codex` 接管分队调度。
- 每个 subagent 必须有明确写入范围、禁改范围、验证命令和回报格式；主 Agent 负责集成审查和最终验证。

### Agent 间进度同步

当前活跃进度以 `docs/roadmap.md`、`docs/architecture.md` 和相关计划文档为准。其他 Agent 或人类提交的结论进入对应 roadmap、design plan、governance 或 `docs/reference/`，不要新增长期状态目录。

### 仓库级 Skill

- 仓库只提交白名单 skill：`.agents/skills/dev-loop/`、`.agents/skills/test-coverage/`、`.agents/skills/pre-push/`、`.agents/skills/integration-test/`、`.agents/skills/adapter-dev/`、`.agents/skills/env-sandbox/`、`.agents/skills/ui-screenshot/`、`.agents/skills/dev-team/`、`.agents/skills/dev-team-codex/`。
- 长程多步骤任务（跨文件重构、多步骤功能、需要审查的变更）默认先读 `.agents/skills/dev-loop/SKILL.md`；本轮 Desktop/Web v4 clean rebuild 是用户明确排除 dev-loop 的例外，按 roadmap/plan 直接推进。
- 短任务（单文件修复、typo、小改动）不需要 dev-loop——直接做。
- `.agents/skills/dev-loop/references/` 已内嵌模型分配策略、审查清单、worktree 指南；不要假设外部同名 skill 一定可用。
- `docs/architecture.md` 路线图摘要和 `docs/roadmap.md` 是持续开发台账，用来记录当前目标、方向任务、分支进展、验证和下一步；不要把详细方案写成第二套主文档。
- 除白名单 skill 外，`.agents/`、`.codex/`、`.claude/` 的本机状态、缓存、会话记录和个人配置不得提交。

## 3. 技术主线

- Hub Server 和 Edge Server 使用 Go。早期独立 `runner/` 目录已废弃；当前执行生命周期在 `edge-server/internal/lifecycle/`，Agent Runtime 协议适配在 `edge-server/internal/adapters/`。`edge-server/internal/runners/` 仍保留为内部兼容包，通过 `/v1/runners` 提供 Runtime/Target health 摘要；但 root-level `runner/` 目录（原独立服务）已不再存在。
- UI 使用 React + TypeScript，Desktop 使用 Tauri。
- 主协议是 REST JSON API + WebSocket typed events。
- REST endpoint 入口是 `api/openapi.yaml`。
- WebSocket 事件入口是 `api/events.md`。
- Protobuf、Connect-RPC、JSON-RPC 只作为历史参考，不是当前主线。

### 前端规范

**共享 UI 包**：`app/shared/src/ui/`（`@shared/ui`）。所有通用组件在此维护，desktop 和 web 从 `@shared/ui` 导入。禁止在 app 内创建重复的本地 UI 副本。

**样式**：CSS Modules + OKLCH 设计 tokens（`var(--primary)`, `var(--border)` 等）。禁止硬编码颜色值。

**设计落地**：页面/组件重做、共享 UI、视觉 QA 或 token 变更先读 `../docs/design/design-playbook.md` 和 `../docs/design/visual-qa-matrix.md`。AgentHub 必须按 dense command-center surface 验收，截图优先覆盖 thread/run/diff/approval 等真实工作流状态，不能只截空壳。

**测试**：`cd app/desktop && pnpm test`。共享 UI 组件测试放在 `app/shared/src/ui/*.test.tsx`。新组件必须有测试 + Storybook story。

**Storybook**：`cd app/desktop && pnpm storybook`（端口 6006）。Story 放 `app/shared/src/ui/*.stories.tsx`。

**Lint**：各 app 独立 eslint 配置。`pnpm lint`。Web 之前没有 lint，已补充。

**类型检查**：`pnpm typecheck` 在 desktop 和 web 各跑一次。当前 `app/shared/src/ui` 存在 React 类型解析 / pnpm 跨包虚拟存储的既有限制；提交说明必须区分既有 shared-ui 限制和本次新增错误。

前端架构详见 `docs/architecture.md`。

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

当前分支状态和合并规则详见 `docs/governance/branch-governance.md`。摘要：

```
feat/* → dev/delicious233 → master
```

| 分支 | 说明 | 状态 |
|------|------|:--:|
| **dev/delicious233** | 当前集成开发分支 | ✅ 活跃 |
| **feat/super-phase1-safety-foundation** | SUPER 工程修复（52 任务全完成，待合并） | 🔥 活跃 |
| master | PR-only 稳定快照，v0.5.0 | ✅ 当前 |
| ~~feat/glm-frontend-integration~~ | GLM 前端集成（已删除） | ✅ 已删除 |
| ~~dev/delicious223~~ | 旧集成主线 | ✅ 已归档 |
| ~~origin/dev/trump~~ | 已归档 | ✅ 已清理 |
| ~~origin/dev/johnny~~ | 已归档 | ✅ 已清理 |

接手提醒：当前主树可能存在 ahead/dirty 并行状态。继续前先运行 `git status --short --branch` 和 `git worktree list`，以 live 输出为准；不要按本表直接推断可提交范围。

规则：
- `master` 禁止直接 push，必须通过 PR。
- 始终从 `dev/delicious233` 开始工作。
- `dev/*` 合并前本地验证：`go test ./...` + `pnpm test` + 对应前端真实构建入口。Web 优先用 `corepack.cmd pnpm typecheck` + `corepack.cmd pnpm exec vite build`，避免把 Windows wrapper/lifecycle 债误判为 Vite 构建失败。
- `feat/*` 合并前需要 rebase 到最新 `dev/delicious233`，解决冲突后再开 PR。
- 删除已合并的 `feat/*` 分支和对应的 worktree。
- Trump、Johnny 和旧 Web parity 残留内容不合并到 `dev/delicious233`，除非先单独审查并拆成可验证的小 patch。

开发引擎：`.agents/skills/dev-loop/` — 模型分配（opus/sonnet/haiku）+ 标准循环 + 交叉审查。

历史本地执行主链路和旧里程碑的已验收子项已合入主线；当前 Desktop/Web v4 clean rebuild 以 `docs/roadmap.md`、`docs/architecture.md` 和 `docs/roadmap/` 子文档为准。

进度同步：

- 每个开发者至少在一天结束前 push 当前分支。
- 完成一个可说明的小阶段就 push，不要把多天工作只留在本机。
- 跨方向改动尽早开 draft PR 或普通 PR，让另外两条线知道接口变化。
- PR 合并前先同步最新 `dev/delicious223`，解决冲突后再合。
- 不在共享分支上 force-push；确实需要时先在群里说明。
- Issue 只保留三部分主线任务：前端、后端、客户端。小任务写进对应 issue 或 PR，不额外开一堆 issue。
- 本地提交 hook 放在 `scripts/git-hooks/`。首次克隆后运行 `.\scripts\setup.ps1` 启用。
- hook 是本地辅助，GitHub Actions 是最低限度的共享检查。

### Worktree + Subagent

- 项目级 worktree 固定放在 `.worktrees/`，已写入 `.gitignore`，不得提交。
- 一个 worktree = 一个短分支 = 一个 PR。不要多个 Agent 共用同一 worktree。
- 创建前同步 `dev/delicious223`：`git checkout dev/delicious233 && git pull --ff-only`。
- 创建示例：`git worktree add .worktrees/client-edge-foundation -b feat/client-edge-foundation`。
- 每个 worktree 必须绑定任务卡和写入范围；范围变化先更新任务卡或 PR 说明。
- DeepSeek、Codex、Claude 等可在 worktree 内调度 subagent，但 subagent 只能在当前 worktree 的指定路径内工作。
- 完成后运行验收命令、push 分支、开 PR；合并后执行 `git worktree remove .worktrees/<name>`。
- worktree 内禁止保存密钥、真实服务器配置、私有日志和本机 Agent 状态。

## 5. 文档规则

- 主文档只保留一份：`docs/architecture.md`（概览）+ `docs/architecture/`（模块详情）。
- `docs/roadmap.md`（概览）+ `docs/roadmap/`（模块路线图）记录持续开发目标、当前进展和下一步。
- AgentHub 自有文档中文优先；`README_EN.md` 是唯一常规英文入口。
- 新增长期说明先考虑合并进主文档，不要随手新增根级文档。
- 详细调研放 `docs/reference/`。
- 过时文档直接删除（git 历史保留追溯能力），不归档。
- 文档、issue、PR 正文中文为主；代码标识、路径、API 字段、命令保留英文。
- 不使用未解释缩写。第一次出现时写白话解释。
- 修改目录、协议、分工后，同步 `README.md`、本文件和相关主文档。
- 不在文档中依赖个人本机绝对路径、私人服务器、私人账号或不可公开的环境。
- 如果别人克隆仓库后需要某个配置或命令才能开发，把它写进 `README.md`、主文档或 `.env.example`。

### 文档维护规则

1. **过时即删**：不再使用的文档直接删除（git 历史保留追溯能力）。
2. **代码变更同步文档**：重构接口、改错误码格式、改目录结构后，必须同步更新 `api/conventions.md`、`docs/architecture.md`、`docs/roadmap.md` 中对应章节，不留过期描述。
3. **行号引用禁令**：文档不引用源码行号（行号随重构失效）。改用函数名、类型名或"XX 文件中"等稳定锚点。
4. **阶段名一致性**：文档中使用当前 Phase 命名（Phase 1-7），不使用旧命名（Phase A/B/C/D）。
5. **自检频率**：项目级 AGENTS.md 最多每 14 天自检一次；`docs/` 目录结构每 7 天可做一次过期扫描。

## 6. 安全和隐私

禁止提交或粘贴：

- `.env`、API key、token、cookie、私钥、证书、SSH 配置。
- 真实服务器 IP、内网地址、数据库连接串、生产账号、个人路径。
- 生产数据库 dump、用户数据、聊天记录、日志中的敏感字段。
- GitHub issue、PR、commit message 中也不要写上述内容。
- 本机 Agent 记忆和运行状态，例如 `.claude/`、`.codex/`、`.agents/`（仓库级 `.agents/skills/dev-loop/` 是唯一例外）。
- 服务器主机名不得出现在仓库文件中；生产配置限 `.env.production`（已 gitignored）。

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

运行命令以真实入口为准：Edge 是 `edge-server/cmd/agenthub-edge`，Hub 是 `hub-server/cmd/server-hub`。`scripts/dev-start.ps1` / `scripts/dev-start.sh` 已修复 Hub 入口路径。`scripts/client-smoke.ps1` 当前使用 Edge 内置 `agenthub-runner-mock` 兼容 profile，不再构建早期已删除的独立 `runner/` 目录。

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
corepack.cmd pnpm typecheck
corepack.cmd pnpm exec vite build
```

前端和客户端测试要求：

- 前端状态转换和 API client 要有单元测试。
- 关键 UI 流程后续用 Playwright 覆盖：新建 Thread、启动 Run、查看 Diff、Approval、Preview。
- Desktop/Edge 执行链路改动至少提供本地 smoke test 步骤；无法自动化时写在 PR 验收里。

### 7.1 测试质量红线

以下类型测试**禁止提交**，CR 时直接 reject：

| 反模式 | 示例 | 为什么禁止 |
|---|---|---|
| **JUDGE+JURY** | `classifyFile("a.html")` → 断言返回 `kindPreview`，与 switch 实现同构 | 测试和实现是同一份逻辑的副本。改实现必改测试，但测试不会发现 bug——它只是重复实现。 |
| **SIGNATURE** | `TestRiskLow == "low"` 测常量值 | 常量值由编译器保证。测它不增加任何保护。 |
| **硬编码错误字符串** | `err.Error()` → 断言 `== "parse stream error: ..."` | 错误文案是 UI，随时可能调整。测行为（`err != nil`），不测文案。 |
| **纯 mirror mock** | Mock 返回值和实现一模一样，没有任何外部输入 | Mock 应该模拟外部系统（HTTP、DB、文件系统），不是模拟被测函数自己。 |

**正确做法**：

| 层级 | 怎么做 | 示例 |
|---|---|---|
| **E2E / 集成测试** | httptest.NewServer → 真实 SSE 流 → adapter 解析 → 验证输出事件 | `anthropic_sdk_e2e_test.go` |
| **行为测试** | 给输入，验证输出行为，不碰内部状态 | `secure_emitter_test.go`（mock hook → emitter → 验证事件） |
| **边界测试** | nil/空输入、超时、取消、畸形数据 | `TestTakeWorkdirSnapshot` 测空路径返回 nil |

**Go 适配器优先用 `httptest.NewServer`** mock 外部 API，不 mock 内部接口。

## 8. 质量治理

### 测试覆盖率

| 模块 | 最低覆盖率 | 当前 |
|------|-----------|------|
| edge-server | 75% | CI 强制阻断 |
| hub-server | 40% | CI 强制阻断 |
| app/desktop | 不做硬性要求 | 不做硬性要求 |
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

## 9. Spec-Driven Develop 治理

本仓库采用 spec-driven-develop 工作流驱动大型复杂任务。规则如下：

1. **进度追踪**：活跃进度以 `docs/progress/MASTER.md` 为准。spec-driven-develop 启动后，任务卡、阶段验收、阻塞项和里程碑状态统一写入该文件，不在 AGENTS.md 或 roadmap 中重复记录进度细节。
2. **任务追踪模式**：`GITHUB_STANDARD` — 使用 GitHub Issues + Milestones + Labels 进行任务分解、分配和追踪。spec 产出的大型任务拆为 Milestone，子任务映射为 Issue，按 Label 区分方向（frontend/backend/client/docs/governance）。
3. **仓库**：`TokenDanceLab/AgentHub`（github.com/TokenDanceLab/AgentHub）。
4. **当前活跃 Phase 与分支**：
   - Phase：`super-phase1-safety-foundation`
   - 分支：`feat/super-phase1-safety-foundation`
   - 入口文档：`docs/progress/MASTER.md`（不在本文件重复记录子任务进度）
5. **默认工作流规则**：新增 feature 工作（含跨文件重构、多步骤功能、协议变更、安全加固）默认走 spec-driven-develop 工作流：
   - 先加载 `.agents/skills/spec-driven-develop/SKILL.md`（如存在）或 `spec-driven-develop` skill。
   - 产出 spec 文档、任务分解、验收标准后再进入实现。
   - 短任务（单文件修复、typo、小改动）不受此约束，直接做。
