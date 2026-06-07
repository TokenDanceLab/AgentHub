# 后端合并与端到端联调治理

> 最后更新：2026-06-08 05:15 +08:00
> 目标：把后端、Edge、Hub、Desktop、Web 的开发从并行堆积切回可审查、可合并、可验证的主线节奏。

## 当前基线

当前开发事实源是 `dev/delicious233`。`master` 只接收从 `dev/delicious233` 发起的 PR。后端主线仍在 `.worktrees/backend` 的 `feat/backend-edge-hub`，该线可以继续推进，但必须按本文的同步协议和合并门禁进入 `dev/delicious233`。

已确认的产品边界：

| 端 | 权威后端 | 原则 |
|---|---|---|
| Desktop 5173 | Local Edge | Desktop 只直接控制本机 Edge、Tauri Host、本机文件能力和本机 Agent Runtime。 |
| Web 5174 | Hub | Web 只通过 Hub 读取账号、会话、消息、Agent task、远程 Edge 路由和审计。 |
| Edge | Agent Runtime + 本地 store | Edge 是本地执行权威，负责 Run、Event、Artifact、Permission、CLI adapter 和本地持久化。 |
| Hub | 账号 + IM + 同步 + 中继 | Hub 是云端会话、设备、权限、审计、TeamRun 和远程路由权威。 |

禁止回退到旧架构：Web 不能直连 Local Edge；Desktop 不能绕过 Edge 直接启动 CLI；shared UI 不能持有 Tauri、Edge URL、Hub URL 或 token 存储细节。

## AH-SYNC v1

所有跨线程、跨负责人同步统一使用下面格式。普通代码评论和 PR 描述可以使用自然语言，但涉及合并、边界、阻塞、状态移交时必须使用该格式。

```markdown
AH-SYNC v1
from: backend|frontend|desktop|main
kind: status|request|handoff|blocker|proposal|ready-for-review
branch: <branch>
worktree: <relative worktree or main>
scope: hub-server|edge-server|api|docs|ci|runtime-adapter|e2e|desktop|web|shared
writes: <planned or modified paths>
state: planning|editing|testing|blocked|ready-for-review|paused
summary: <3-6 factual lines>
verified: <commands or none>
blockers: <blockers or none>
needs-from-main: <decisions or none>
next: <1-3 steps>
```

执行规则：

1. `kind: proposal` 用于 Web/Hub、Desktop/Edge 边界、API/event schema、permission、TeamRun ID、ExecutionTarget routing 和 DB schema 变化；主负责人确认后再实现。
2. 窄测试脚本修复、文档错字、非行为性注释可以直接进入 `editing`，但必须在下一条状态里列出路径和验证。
3. `ready-for-review` 代表该切片已经在所属 worktree 保存，且已跑完该切片最低验证；不代表可以自动合并。
4. 真实 CLI、self-hosted、消耗模型或生产资源的验证默认只在收口时运行一次；普通 PR 先用 fixture、unit、contract、fake callback 和 DB/Redis gate。
5. 任何线程不得自行合并到 `dev/delicious233` 或 `master`。合并、rebase、branch deletion 由主负责人统一执行。
6. OIDC/test harness、PowerShell 兼容性、脚本参数构造这类窄修复可以由后端负责人直接推进到 `ready-for-review`；仍需列出失败点、修复路径和复跑命令。

## 硬边界规则

这些规则进入 code review gate，不能只停留在文档里：

1. Web 分支不得引入 Local Edge、Tauri、filesystem 或 Desktop runtime capability；Web 只能经 Hub REST/WS 和 Hub-issued session。
2. Desktop 本地执行不得绕过 Edge；UI 只能经 platform adapter 到 Edge REST/WS，不得直接启动 CLI 或拼 shell。
3. Hub dispatch 必须绑定 exact `agent_instance_id` 和 exact Desktop device / ExecutionTarget；离线只能进对应 user/device/target queue，禁止 fallback 到其他在线 Desktop。
4. Edge `agentId` 必须显式校验 adapter registry；未知 runtime 不得静默 fallback 到默认 adapter。
5. 任何把 mock/demo 当验收证据的 PR 必须标注为 demo；生产接入项必须提供真实 Desktop->Edge 或 Web->Hub->Edge->Runtime 事件链证据。

## 合并切片

`feat/backend-edge-hub` 不能整包直接合并。后端进入 `dev/delicious233` 前按下面切片拆审：

| Slice | 范围 | 可先合入条件 | 最低验证 |
|---|---|---|---|
| A0. Runtime log privacy | `edge-server/internal/lifecycle/process_executor*` | CLI argv、command path、config value 不进入启动日志；只保留摘要 | focused lifecycle tests |
| A. Codex runtime adapter | `edge-server/internal/adapters/codex*`、`api/events.md`、必要 cmd config | 只增强 Codex 事件归一、file_change/path-safety 和 skills-dir 传播；真实 CLI smoke 不阻塞代码合入 | adapter/lifecycle/cmd focused tests + edge-server short gate |
| B. Hub callback redaction | `edge-server/internal/hub/` | callback 失败不包含原始 response body；4xx/5xx 行为不变 | Hub focused tests + edge-server short gate |
| C1. Runtime smoke scripts | `scripts/edge-runtime-smoke.ps1`、`scripts/integration-e2e.ps1`、`tests/scripts/edge-runtime-smoke.ps1` | 默认不跑真实 CLI；脚本测试证明兼容性 | script tests |
| C2. OIDC diagnostics | `scripts/verify-oidc-flow.ps1`、`tests/scripts/verify-oidc-flow.ps1` | 诊断输出脱敏；本体访问本地服务，测试只做 fake/static | OIDC script tests |
| D1. Backend E2E CI gate | `.github/workflows/checks.yml`、`scripts/verify-ci-gates.ps1` 和依赖 tests | 依赖测试先进入主线；不能单合 workflow 让 CI 变红 | Hub tests + CI policy gate |
| D2. Release preflight | `.github/workflows/release.yml` | 发布流程变更单独审批，不和普通脚本硬化混合 | release dry policy review |
| D3. Real CLI/model E2E | `.github/workflows/real-cli-e2e.yml`、real CLI 脚本 | 只在专用 runner、预算和 artifact 脱敏确认后手动/夜间运行 | opt-in real CLI evidence |
| E. Docs/governance | `docs/`、`AGENTS.md`、项目 skill | 不创建第二事实源；不写本机隐私或私有日志 | `git diff --check -- AGENTS.md docs` |
| F. Edge local thread pins | `edge-server/internal/store/`、`edge-server/internal/api/`、`api/openapi.yaml`、`api/events.md` | 只实现 Edge 本地 Thread item pin，不引入 Hub DB、UI 或 mobile 依赖；pin 随 thread/delete 和 run cleanup 级联清理 | store/api focused tests + contract diff check |
| G. DB persistence | Edge SQL store、Hub migrations、repository tests | migration 可回滚或有兼容路径；mock 数据替换为 DB 合同 | Hub PG/Redis gate + Edge store tests |

每个切片进入主线前必须回答三件事：它解决什么用户可见问题、它触碰哪个权威边界、失败时怎么回滚或降级。

### `feat/backend-edge-hub` 首轮合并顺序

当前 dirty diff 的首轮推荐顺序：

1. **B. Hub callback 错误脱敏**：已合入 `dev/delicious233`，提交 `9d43b18d fix(edge): redact hub callback response bodies`。范围只有 `edge-server/internal/hub/callback.go` 和 `edge-server/internal/hub/callback_test.go`；验证 `go test ./internal/hub -count=1` 和 `edge-server go test ./... -short -count=1` 通过。
2. **A0+A. Codex adapter 运行时修复 + 启动日志脱敏**：已在 `codex/integrate-codex-adapter` 集成分支提交 `3de37f25 fix(edge): harden codex adapter runtime events`。范围为 `api/events.md`、Codex adapter、file_change/path-safety、lifecycle parser context、argv/command 日志摘要和 cmd skills-dir 传播；验证 focused Go tests、`go test ./internal/adapters ./internal/lifecycle ./internal/httpserver ./cmd/agenthub-edge -short -count=1`、`edge-server go test ./... -short -count=1`、`git diff --cached --check` 通过。真实 Codex smoke 尚未重跑，只能作为 readiness gate，不能宣称 runtime production-ready。
3. **C1. Edge runtime smoke 脚本硬化**：已在 `codex/integrate-backend-c-scripts` 提交 `32cd688a test(scripts): harden edge runtime smoke gate`。范围只有 `scripts/edge-runtime-smoke.ps1`、`scripts/integration-e2e.ps1`、`tests/scripts/edge-runtime-smoke.ps1`；默认行为改为 CI-safe fake process fixture，真实 CLI/model 只能显式传 `-RealCli` opt-in，`-SkipCli` 仅保留兼容语义。验证 `powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\scripts\edge-runtime-smoke.ps1` 和 `pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\edge-runtime-smoke.ps1 -Port 34990 -TimeoutSec 20` 通过。
4. **C2. OIDC 诊断脱敏**：已在 `codex/integrate-backend-c-scripts` 提交 `09aef187 test(oidc): redact diagnostics output`。范围只有 `scripts/verify-oidc-flow.ps1`、`tests/scripts/verify-oidc-flow.ps1`；OIDC env 和 authorization URL 诊断只输出脱敏摘要，`RepoRoot` 默认初始化已移出 `param()` 并覆盖“不传 `-RepoRoot`”回归。验证 `pwsh -NoProfile -ExecutionPolicy Bypass -File .\tests\scripts\verify-oidc-flow.ps1 -RepoRoot .`、`powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-oidc-flow.ps1 -SkipHub -SkipTD`、`pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-oidc-flow.ps1 -SkipHub -SkipTD` 通过；Windows PowerShell 5.1 中文显示仍可能 mojibake，但退出码和断言通过。
5. **E. Docs / handoff / skills / ignore 规则**：已合入 `dev/delicious233`，提交 `3c36c314 docs(skills): add codex team coordination skill` 和 `1afcde3d docs(skills): align skill ignore whitelist`。范围只有 `.agents/skills/dev-team/SKILL.md`、`.agents/skills/dev-team-codex/SKILL.md`、`.gitignore`、`AGENTS.md`；generic `dev-team` 不再硬编码模型、供应商或本地 alias，`dev-team-codex` 单独记录 Leader `gpt-5.5 xhigh` / Workers `gpt-5.5 high` 编队，`.gitignore` 和 `AGENTS.md` whitelist 同步包含 `dev-team-codex` 与 `env-sandbox`。
6. **D1a. Backend TeamRun fixture CI gate**：已合入 `dev/delicious233`，提交 `901e5153 ci(backend): add fixture-only teamrun gate`。范围只有 `.github/workflows/checks.yml`、`scripts/verify-ci-gates.ps1` 和本文档/roadmap；workflow 只显式运行 `hub-server` 内的 `go test ./tests/teamrun -run '^TestTeamRunSmoke$' -count=1`，不触发真实 CLI、Edge runtime smoke、docker compose 或根级泛化 E2E。
7. **D1b/D2/D3. 剩余 CI / release / real CLI gates**：延后。D1b 只在新增依赖测试已进入主线且不会让 CI 变红时再拆；`release.yml` 是发布流程变更；`real-cli-e2e.yml` 只能在专用 runner、环境审批、预算和 artifact 脱敏确认后 opt-in/nightly。
8. **F. Edge local Thread pins**：已合入 `dev/delicious233`，提交 `75bcf144 feat(edge): add local thread item pins`。范围只有 `edge-server/internal/store/`、`edge-server/internal/api/`、`api/openapi.yaml`、`api/events.md` 和本文档/roadmap；实现 `/v1/threads/{threadId}/pins` GET/POST/DELETE、`ThreadPin` snapshot 持久化、thread delete/run cleanup 级联清理、事件 `thread.pin.created/deleted` 和 OpenAPI 合同。验证 store/API focused tests、`edge-server go test ./... -short -count=1`、OpenAPI YAML parse 和 diff check 通过；未运行真实 CLI/model。
9. **API/Event route summary alias**：已合入 `dev/delicious233`，提交 `51ac4b8c fix(api): add agent task summary alias`。独立切片只补 Hub `GET /web/agent-tasks/:id/summary` 到既有 `TaskEventSummary`，并在 OpenAPI 增加 `/web/agent-tasks/{id}/summary` 兼容 alias；不改前端、Edge、runtime schema 或真实 CLI gate。
10. **G1. Hub AgentProfile read-through**：本前端切片 `codex/g1-agentprofile-readthrough` 只把 Hub `/web/agent-profiles` 投影到 shared Agents 页已安装列表和 `WorkbenchAgent` 字段，阻断 Web real mode demo agent fallback；不做 AgentProfile CRUD、自建 Agent、市场闭环、TeamRun Orchestrator、Edge SQL 或真实 CLI/model gate。

当前不允许把 `feat/backend-edge-hub` dirty diff 一次性合进 `dev/delicious233`，因为它同时改 runtime 行为、脚本框架、CI release gate、项目 skill 和治理文档，review 面过宽，失败时无法快速定位。

### 并行评审结论（2026-06-08 03:57 +08:00）

- **D1a fixture-only CI gate**：已合入 `dev/delicious233`。后续 D1b 只能在新增依赖测试已进入主线且不会让 CI 变红时再拆，并继续断言不含 `-RealCli`、Docker、root `go test ./tests -count=1` 或真实 CLI/auth secret。
- **D3 real CLI/model gate**：继续 blocked。候选 workflow 缺 GitHub `environment` approval、预算/请求上限控制，且 redaction validation 失败后仍可能上传 artifact；修复前不得合入。
- **G1 DB-backed state**：Hub AgentProfile -> shared Agents 页 read-through 正在 `codex/g1-agentprofile-readthrough` 前端切片实现。该片只读消费 Hub-owned AgentProfile，不改 Hub schema、Edge store 或 AgentProfile CRUD。
- **API/Event contract sync**：`codex/api-event-summary-alias` 已把 Web client 已用的 `/web/agent-tasks/{id}/summary` 声明为 Hub/OpenAPI 兼容 alias，复用既有 `/web/agent-tasks/{id}/events/summary` response contract；不混入 Edge pins。
- **Runtime adapter roadmap**：Codex `exec --json` adapter 仍是 Phase 1 batch 模式；完整 multi-turn、turn steer/interrupt、approval、subagent 和 diff patch delta 需要后续 Codex app-server 通道，不应在当前能力声明中写成已完成。

## 端到端联调顺序

0. **Shared data contract**：先扩 `AgentHubPlatform` / shared data ports。当前 ports 已覆盖 conversations、run submit、attachments、preview 和 Contacts 只读 Hub `listContacts()`；仍缺 docs、projects、tasks、agents、targets、message actions，以及 Contacts mutation/error/empty/schema。real mode 禁止静默 demo fallback。
1. **Chat 主链路**：Desktop 走 Edge threads/items/runs/events；Web 走 Hub sessions/messages/ws/agent-tasks。
2. **Agent/Profile/Runtime/Target**：Desktop 接 Edge `/v1/agents` 和 `/v1/model-catalog`；Web 接 Hub `/web/agent-profiles`、`/client/sessions/{id}/agents` 和 ExecutionTarget inventory。
3. **Hub + Exact Edge routing**：Hub 只能路由到 owner-scoped exact device；目标 Edge 离线、无权限或 workspace 越界时 fail closed。
4. **Edge + CLI adapters**：Codex、Claude Code、OpenCode 输出统一为 AgentHub typed events；路径、失败摘要、runtime output 先脱敏再 callback。
5. **Inspector Evidence / Artifact / Diff / Preview**：补 Edge planned routes 或删除客户端假调用；`/v1/runs/{runId}/diff`、artifact index/content、preview lifecycle 用真实 API/事件替代 UI mock。
6. **Permission/Approval**：permission request、policy decision、UI decision、Edge ack、Hub audit、TeamEvent 必须能用同一 run/task ID 串起来。
7. **DB-backed product surfaces**：Contacts、Docs、Tasks、Projects、Settings、AgentProfile、ExecutionTarget 逐页定义 owner/schema/mutation/loading/error/empty 后替换 mock。
8. **TeamRun / Tasks**：最后接 TeamRun console/shared Tasks。先决定 Tasks 页映射 Hub AgentTeam/TeamTask，还是另建 product task DB，禁止直接把 mock 字段塞进 TeamRun。

### 当前 mock 面

v4 shell 已统一，但生产数据接线只覆盖聊天主链路。仍然依赖 demo/mock 的区域：

| 面 | 当前问题 | 下一步 |
|---|---|---|
| Contacts | 只读 Hub `listContacts()` port 已接入 Web shared page；mutation、error/empty、schema owner 和 friend request/remark/block/search 仍未生产化 | 补 Hub contacts mutation/error/empty/schema 合同 |
| Docs | 无统一 document/artifact store | 定义 `ProjectArtifact` / `DocumentPreview` owner、blob、version、provider、permission |
| Agents | G1 已建立 Hub `AgentProfile` 到 shared Agents 已安装页的只读 mapper，并阻断 Web real mode demo agent fallback；Desktop/Edge runtime inventory、AgentProfile CRUD、empty/error、market/install 和 target preference mutation 仍未生产化 | 继续拆 AgentProfile CRUD/empty/error、ExecutionTarget inventory 和 Desktop Edge runtime mapper |
| Tasks/Runs | Tasks 页是本地任务 mock；TeamRun router 已有但 shared UI 未消费 | 先定 Tasks = TeamRun projection 还是独立 product task |
| Projects | Project rail 数据和 artifact/workspace 关系未生产化 | 定义 Hub/Edge ownership 和 mutation |
| Settings | UI 偏好可本地持久化，但账号/设备/运行偏好未 DB-backed | 区分 local preference、Hub user preference、Edge runtime config |
| RightInspector | 默认任务/文件内容来自 demo evidence；client 已调用 artifacts/previews，但 Edge OpenAPI 仍有 planned 项 | 先补 Edge routes 或移除假调用，再接 evidence snapshot |

## 分支清理规则

清理顺序固定为登记、验证、合并或归档、删除：

1. `git worktree list` 和 `git branch --format` 记录当前分支/worktree。
2. 对每个 backend/codex 临时分支判断：已合入、待 review、重复、过时、协作者分支。
3. 已合入或重复分支先确认没有独有未保存 diff，再删除本地 worktree 和本地分支。
4. 协作者分支 `dev/johnny`、`dev/trump` 不自动删除、不直合，只按小 patch 审查。
5. `.worktrees/backend` 和仍在工作的 backend review worktree 在切片合并前保留。
6. 根目录临时 merge plan 不长期保留；结论进入本文、`docs/roadmap.md` 或 `docs/governance/branch-governance.md` 后再归档或删除。

### 当前分支分类

当前分类来自只读分支审计，删除前仍以 live `git branch`、`git worktree list` 和 `git cherry` 复核。

必须保留并审查：

| 分支 | 处理 |
|---|---|
| `feat/backend-edge-hub` | 后端整合主线，保留；本地 ahead 的提交按切片进入主线。 |
| `codex/backend-api-contract-0607` | API/events 合同 patch-unique，review 后决定是否纳入 Slice D。 |
| `codex/backend-cli-e2e-0607` | CLI/E2E 脚本语义 patch-unique，review 后决定是否纳入 Slice B。 |
| `codex/backend-oidc-log-0607` | OIDC 错误脱敏 patch-unique，需要安全 review。 |
| `codex/backend-release-artifact-0607` | release artifact CI patch-unique，需要 release gate review。 |
| `codex/backend-docs-governance` | docs/governance 交接 patch-unique，review 后并入本文或归档。 |
| `codex/backend-johnny-pick` | Johnny 剩余更新 patch-unique，只能拆小 patch，不能直合。 |
| `codex/backend-openapi-contract` | OpenAPI 合同 patch-unique，review 后纳入 Slice D。 |

等价吸收或重复，确认无独有 dirty diff 后可清理。2026-06-08 已完成本地干净项清理，只剩 dirty 项保留：

| 分支 | 处理 |
|---|---|
| `codex/backend-docs-sync-0607` / `codex/backend-docs-sync-2-0607` | 本地 worktree + branch 已删除。 |
| `codex/backend-review-readonly` | 本地 worktree + branch 已删除。 |
| `codex/backend-gate-fixes` / `codex/backend-sync-at4` / `codex/backend-ci-e2e-0607` / `codex/backend-db-migration-0607` | 本地 worktree + branch 已删除。 |
| `codex/backend-env-sanitizer-0607` / `codex/backend-health-ready-0607` / `codex/backend-hub-edge-e2e-0607` | 本地 worktree + branch 已删除。 |
| `codex/backend-remote-cors-0607` / `codex/backend-target-credential-0607` / `codex/backend-ws-delivery-0607` | 本地 worktree + branch 已删除。 |
| `codex/backend-edge-split` / `codex/backend-test-coverage` | worktree 有未提交改动，保留，等待审查。 |

## 隐私与证据

- 不提交真实 token、生产日志、本机 CLI 输出原文、私有服务器地址、个人路径截图或模型响应全文。
- 允许在公开文档里写无密结论、相对路径、命令名、失败类别和可复现测试名。
- 本机路径进入测试 fixture 前必须脱敏为 workspace-relative、basename 或 `<outside-workspace>` 形式。
- 真实 CLI 证据只记录“运行了哪个 gate、通过/失败原因、是否消耗模型”，不贴完整 prompt/output。

## 当前下一步

1. 先审 `codex/g1-agentprofile-readthrough`，确认 shared Agents 页消费 Hub AgentProfile 且 Web real mode 不回退 demo agents；该片不消费真实 CLI/model。
2. 再审后端 G0 `codex/edge-store-contract`，它是 Edge store contract harness，不等于 SQL store 上线。
3. D1b/D2/D3 单独排期；D3 保持 blocked，先补 environment、budget、runner 和 artifact upload policy。
4. 按 Desktop/Edge 与 Web/Hub 两条线推进生产对接，继续保持 Web 不直连 Local Edge、Desktop 不绕过 Edge。
