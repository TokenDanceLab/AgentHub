# 后端合并与端到端联调治理

> 最后更新：2026-06-08 13:35 +08:00
> 目标：把后端、Edge、Hub、Desktop、Web 的开发从并行堆积切回可审查、可合并、可验证的主线节奏。

## 当前基线

当前开发事实源是 `dev/delicious233`。`master` 只接收从 `dev/delicious233` 发起的 PR。后端长期线程已关闭并归档，后端旧整合线合并由 backend merge Agent 负责；主负责人只记录合并状态、规划后续依赖和按需派发新的短生命周期 subagent/worktree。关键后端/API/Edge 窄切片已经多批合入，但 `feat/backend-edge-hub` 仍有未吸收提交，因此不能把后端旧整合线视为全部并入主线。

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
| C3. OIDC fake/local gate | `hub-server/internal/service/oidc*`、`scripts/verify-oidc-flow.ps1`、`tests/scripts/verify-oidc-flow.ps1` | Hub callback 拒绝 stale state entry；脚本提供 `-LocalOnly` fake/static gate，不连接 live Hub 或 TokenDance ID | Hub OIDC focused tests + OIDC script tests |
| D1. Backend E2E CI gate | `.github/workflows/checks.yml`、`scripts/verify-ci-gates.ps1` 和依赖 tests | 依赖测试先进入主线；不能单合 workflow 让 CI 变红 | Hub tests + CI policy gate |
| D2. Release preflight | `.github/workflows/release.yml` / `.github/workflows/release-readiness.yml` | 真实 tag release 与 readiness dry policy 分离；发布流程变更单独审批，不和普通脚本硬化混合 | release dry policy review |
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
   - **D2a. Tauri package readiness**：`codex/tauri-package-readiness` 只收口 Desktop package/Tauri/Cargo/Cargo.lock 版本一致、Windows sidecar 命名、NSIS + portable zip 收集策略、updater `latest.json`/`.sig` artifact gate 和独立 release readiness dry policy。该片保留真实 tag release workflow，不做 Authenticode、macOS Developer ID、notarization、staple 或真实 GitHub Release 发布改造。
8. **F. Edge local Thread pins**：已合入 `dev/delicious233`，提交 `75bcf144 feat(edge): add local thread item pins`。范围只有 `edge-server/internal/store/`、`edge-server/internal/api/`、`api/openapi.yaml`、`api/events.md` 和本文档/roadmap；实现 `/v1/threads/{threadId}/pins` GET/POST/DELETE、`ThreadPin` snapshot 持久化、thread delete/run cleanup 级联清理、事件 `thread.pin.created/deleted` 和 OpenAPI 合同。验证 `go test ./internal/store -run "ThreadPin|Pins|CleanupRuns|FileStore" -count=1`、`go test ./internal/api -run "ThreadPin|ThreadPins|PostThreadMessage" -count=1`、`go test ./internal/api ./internal/store -short -count=1`、`edge-server go test ./... -short -count=1`、OpenAPI YAML parse 和 diff check 通过；未运行真实 CLI/model。
9. **API/Event route summary alias**：已合入 `dev/delicious233`，提交 `51ac4b8c fix(api): add agent task summary alias`。该片只补 Hub `GET /web/agent-tasks/:id/summary` 到既有 `TaskEventSummary`，并在 OpenAPI 增加 `/web/agent-tasks/{id}/summary` 兼容 alias；不改前端、Edge、runtime schema 或真实 CLI gate。
10. **G1. Hub AgentProfile read-through**：已合入 `dev/delicious233`，提交 `c30cbeec feat(web): 接入 Hub AgentProfile 到 Agents 页`。该前端切片只把 Hub `/web/agent-profiles` 投影到 shared Agents 页已安装列表和 `WorkbenchAgent` 字段，阻断 Web real mode demo agent fallback；不做 AgentProfile CRUD、自建 Agent、市场闭环、TeamRun Orchestrator、Edge SQL 或真实 CLI/model gate。
11. **G0. Edge repository contract harness**：已合入 `dev/delicious233`，提交 `4a5ccaf3 test(edge): add store repository contract harness`。该片只新增 `edge-server/internal/store/store_contract_test.go` 并更新本文档/roadmap，让 in-memory `Store` 与 JSON `FileStore` 共跑生命周期、pins、thread delete cascade、run cleanup cascade、FileStore 删除持久化和 snapshot restore 合同；不引入 SQL、migration、Hub DB 或 API schema 变化。
12. **Edge runtime event docs contract**：已合入 `dev/delicious233`，提交 `0e6f5f7a test(edge): document runtime event contract`。该片只补齐已在 Edge runtime 代码中发出的 `run.agent.sub_agent_status` 与 `run.agent.task_dispatch_failed` 文档，并新增测试确保 adapter event constants / known hardcoded runtime events 出现在 `api/events.md`；不重命名事件、不改 payload、不运行真实 CLI/model。
13. **G2a. Web AgentProfile mutations**：已合入 `dev/delicious233`，提交 `35060823 feat(web): wire agent profile mutations`。范围仅 `app/web` Hub client/mutation hooks、`app/shared` Agents 页 empty/error/saving/create/update/delete 交互和 focused tests；不做 publish/install/market、TeamRun Orchestrator、ExecutionTarget inventory、后端 schema/OpenAPI 硬化、Edge SQL 或真实 CLI/model gate。前端 mapper 继续按当前 Hub 实现发送 JSON string 字段，并过滤 `Hub AgentProfile`、`Hub owner scope`、runtime/model hint 等 UI fallback 文案，避免写回 Hub description/runtime/permission。验证 `app/shared` `AgentHubWorkbench.test.tsx` 29/29、`app/web` focused tests 22/22、Web typecheck、`verify-web-hub-boundary.ps1` 15/15 通过。
14. **G2b. Backend AgentProfile contract hardening**：已合入 `dev/delicious233`，提交 `5e730169 fix(api): harden agent profile payload contract`。Hub create/update 接受当前 JSON string payload 和 OpenAPI object/array payload，marshal 到现有 JSON string model fields；service updateable fields 增加 type guards，malformed payload 返回 400 而不是 panic；OpenAPI 只记录当前 create/delete 200 OK envelope，不改 handler status 行为。不改 Web/shared mutation 行为，不扩展 publish/install/market，不做 DB migration、Edge SQL、release workflow 或真实 CLI/model gate。验证 handler/service focused、hub-server short、OpenAPI YAML parse、diff check 和冲突标记扫描通过；未运行真实 CLI/model。
15. **ExecutionTarget contract hardening**：已合入 `dev/delicious233`，提交 `f9fbaf0e fix(api): harden execution target payload contract`。范围仅 Hub `/web/execution-targets` create/update request normalization、handler/service focused tests、OpenAPI request schema 和本文档/roadmap；`workspace_allowlist` 接受 JSON string array 或 OpenAPI array，`capabilities`/`metadata` 接受 JSON string object 或 OpenAPI object，并继续以现有 JSON string model/response 存储返回。空数组/空对象用于清空本地 allowlist/capabilities/metadata；invalid scalar/schema 返回 400。该片不做 DB migration、ExecutionTarget routing 行为迁移、Desktop Edge mapper、Hub Projects、Edge SQL、release workflow、D1b/D2/D3 或真实 CLI/model gate。
16. **Hub Projects/workspaces P1**：已合入 `dev/delicious233`，提交 `1cd052fc feat(api): add hub project workspace endpoints`。范围仅新增 Web-owned Hub `/web/projects` 与 `/web/projects/{id}` list/create/get/update，背后复用现有 owner-scoped `workspaces` 表和 `Workspace` projection `{id,name,description,owner_id,created_at,updated_at}`；list 支持 `pageSize`、`pageCursor` 和 `q` 搜索；create/update 保持当前 Hub 200 OK envelope；PATCH 已由主负责人补成部分更新语义：省略字段不变、显式空 description 可清空、空白 name 返回 `BAD_REQUEST`。该片不实现 delete，不 hard-delete workspace，不加 `deleted_at` 或 migration，不改 Edge-owned `/v1/projects`、Web/shared UI、Desktop Edge mapper、Edge SQL、TeamRun routing、release workflow、D1b/D2/D3 或真实 CLI/model gate。delete/soft-delete 需要先明确 workspace 与 agent_instances/artifacts 的关系和 orphan policy 后另起 proposal。
17. **C3. OIDC fake/local gate**：本轮在 `codex/login-local-gates` 收口 Hub state expiry/replay 和脚本 gate 语义。Hub OIDC callback 在消费 Redis state 后还会校验 `created_at` 不超过 10 分钟，防止手工/fake state entry 绕过 TTL 后继续打 token endpoint；`verify-oidc-flow.ps1 -LocalOnly` 强制跳过 live Hub 与 TokenDance ID phases，只做 fake/static diagnostics。该片不做真实 TokenDanceID/生产登录，不改 Web UI、Desktop packaging、Edge SQL 或真实 CLI/model gate。
18. **G3. Edge SQLite opt-in store**：`codex/edge-sql-store` 首片实现 Edge 本地 SQLite opt-in backend，并显式支持 `--store-backend memory|file|sqlite` / `AGENTHUB_STORE_BACKEND=memory|file|sqlite`。留空 backend 保持旧兼容：有 `--store-file` 走 JSON file store，否则 memory；显式 memory 拒绝 store file/db，显式 file 要求 `--store-file`，sqlite 要求 `--store-db`。SQLite 当前以 snapshot 表保存 repository 状态并共跑 memory/file/sqlite contract；不引入 Hub DB、Web/Projects UI、Desktop/Tauri 或真实 CLI/model gate。后续 relational schema/migration 另拆。
19. **Desktop Edge mapper first slice**：`codex/desktop-edge-mapper` 首片把 Local Edge `/v1/agents`、`/v1/model-catalog` 和 health runners 投影到 Desktop Workbench agents / Local Edge target，保留 Edge `runtimeId` 并让 `StartRunRequest.agentId` 使用 adapter runtime id；移除提交到 Edge runs 的 `provider` 字段，阻断 Desktop live/auto 空线程回落 demo transcript。该片不改 Web、Hub、Edge API/OpenAPI、Edge lifecycle 或真实 CLI/model gate；target preference mutation、Tauri host readiness 和安装包联调继续另拆。
20. **G4. Artifact/Diff/Preview read-only Edge 前置**：`codex/artifact-diff-preview-readonly` 只补 Edge 本地只读 evidence store 和 REST 合同：`GET /v1/runs/{runId}/diff`、`GET /v1/artifacts`、`GET /v1/previews`，memory/file/sqlite 共用 snapshot contract。该片不做 preview start/stop、artifact apply/discard/content、Hub artifact store、Projects UI、Desktop mapper、Web 直连 Edge 或真实 CLI/model gate；artifact/preview lifecycle 事件仍为 planned。

当前不允许把 `feat/backend-edge-hub` dirty diff 一次性合进 `dev/delicious233`，因为它同时改 runtime 行为、脚本框架、CI release gate、项目 skill 和治理文档，review 面过宽，失败时无法快速定位。

### 并行评审结论（2026-06-08 03:57 +08:00）

- **D1a fixture-only CI gate**：已合入 `dev/delicious233`。后续 D1b 只能在新增依赖测试已进入主线且不会让 CI 变红时再拆，并继续断言不含 `-RealCli`、Docker、root `go test ./tests -count=1` 或真实 CLI/auth secret。
- **D3 real CLI/model gate**：继续 blocked。候选 workflow 缺 GitHub `environment` approval、预算/请求上限控制，且 redaction validation 失败后仍可能上传 artifact；修复前不得合入。
- **G1/G2a/G2b/ExecutionTarget/Projects DB-backed state**：Hub AgentProfile -> shared Agents 页 read-through 已合入；G2a Web mutation/empty/error/saving 切片已合入；G2b 后端 AgentProfile request contract hardening 和 OpenAPI 当前行为同步已合入；ExecutionTarget request contract hardening 已合入；Hub Projects/workspaces P1 已合入；Web Projects read-through 已作为 `0c79f277 feat(web): read Hub projects into workbench` 合入并打 `v0.3.0-rc.1` 稳定候选 tag。G2a 只消费既有 Hub CRUD 合同并过滤 UI fallback 写回；G2b 与 ExecutionTarget 不改 Hub schema、Edge store、publish/install、routing 或 market lifecycle；Projects P1/read-through 只做现有 workspaces list/create/get/update 与 shared Projects list 数据口，不做 delete/migration。
- **API/Event contract sync**：`codex/api-event-summary-alias` 已把 Web client 已用的 `/web/agent-tasks/{id}/summary` 声明为 Hub/OpenAPI 兼容 alias，复用既有 `/web/agent-tasks/{id}/events/summary` response contract；`codex/event-contract-docs` 继续做 Edge runtime event 文档/测试漂移收口，不混入 Web UI、Edge pins 或真实 CLI gate。
- **Runtime adapter roadmap**：Codex `exec --json` adapter 仍是 Phase 1 batch 模式；完整 multi-turn、turn steer/interrupt、approval、subagent 和 diff patch delta 需要后续 Codex app-server 通道，不应在当前能力声明中写成已完成。

## 端到端联调顺序

0. **Shared data contract**：先扩 `AgentHubPlatform` / shared data ports。当前 ports 已覆盖 conversations、run submit、attachments、preview、Contacts 只读 Hub `listContacts()` 和 Web Projects read-through；仍缺 docs、tasks、targets、message actions，以及 Contacts/Projects mutation/error/empty/schema。real mode 禁止静默 demo fallback。
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
| Agents | G1 已建立 Hub `AgentProfile` 到 shared Agents 已安装页的只读 mapper，并阻断 Web real mode demo agent fallback；G2a 已合入 Web AgentProfile create/update/delete、empty/error/saving 和 mapper 写回保护；G2b 已合入 Hub AgentProfile JSON-like request contract hardening；ExecutionTarget contract hardening 已合入 Hub request normalization；Desktop Edge 首切片已从 Local Edge `/v1/agents`、`/v1/model-catalog` 和 health runners 投影 Workbench agents/Local Edge target，并在 review 修正 StartRunRequest adapter id、provider 字段和 live 空线程 demo fallback；market/install 和 target preference mutation 仍未生产化 | 继续补 Desktop target preference mutation、Tauri host readiness；market/install 后置 |
| Tasks/Runs | Tasks 页是本地任务 mock；TeamRun router 已有但 shared UI 未消费 | 先定 Tasks = TeamRun projection 还是独立 product task |
| Projects | Hub Projects/workspaces P1 已合入 Web-owned `/web/projects` list/create/get/update，复用现有 owner-scoped `workspaces`；Web Projects read-through 已把 shared Project rail 接生产 list 数据，Hub 目前不提供 runs/artifacts/feed，因此只投影基础 workspace 字段和空数组；artifact/workspace 关系和 delete/soft-delete policy 未定义 | Projects create/update UI 排在 Edge SQL、Desktop mapper、登录和安装包基线之后；artifact 关系和 delete/soft-delete 需另起 proposal |
| Settings | UI 偏好可本地持久化，但账号/设备/运行偏好未 DB-backed | 区分 local preference、Hub user preference、Edge runtime config |
| RightInspector | 默认任务/文件内容仍主要来自 demo/event evidence；Edge 已补 artifact/diff/preview read-only REST 空态/数据合同，但 preview lifecycle、artifact content/apply/discard 和真实 CLI evidence 写入仍未完成 | 下一片把 runtime file_change/artifact/preview evidence 写入 store，再接 shared inspector 的生产 snapshot |

## 分支清理规则

清理顺序固定为登记、验证、合并或归档、删除：

1. `git worktree list` 和 `git branch --format` 记录当前分支/worktree。
2. 对每个 backend/codex 临时分支判断：已合入、待 review、重复、过时、协作者分支。
3. 已合入或重复分支先确认没有独有未保存 diff，再删除本地 worktree 和本地分支。
4. 协作者分支 `dev/johnny`、`dev/trump` 不自动删除、不直合，只按小 patch 审查。
5. `.worktrees/backend` 和历史 backend review worktree 不再自行推进；清理前逐个确认是否已合入、重复、过时或仍含独有 dirty diff。
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

1. 后端长期线程已关闭；后端旧整合线由 backend merge Agent 继续处理，主负责人不接管该合并，只把结果作为后续 Edge/Desktop/Web/packaging 规划输入。旧 `feat/backend-edge-hub` 和历史 backend worktree 仍需由该合并线确认抽片或清理。
2. `v0.3.0-rc.1` 已打在 `0c79f277`，作为 shared v4 workbench + Hub/Edge 合并基线；Web Projects read-through 已完成并保持 shared `/v1/projects` 与 Desktop/Edge 语义不变。
3. 下一批实现按 roadmap 排序：登录 fake/local gate、Edge SQLite opt-in backend、Tauri Windows installer/updater metadata readiness 已合入；Desktop Edge mapper 首切片正在合入，后续继续补 target preference mutation、Tauri host readiness；Artifact/Diff/Preview read-only endpoints 已在候选分支收口，下一片只接 runtime evidence 写入与 inspector snapshot。ByteDance/TeamRun demo evidence、Projects create/update UI 仍按独立切片推进。Edge relational migration、Projects delete/soft-delete policy、macOS signing/notarization 和 D1b/D2/D3 gate policy 继续保持独立 proposal。
4. 按 Desktop/Edge 与 Web/Hub 两条线推进生产对接，继续保持 Web 不直连 Local Edge、Desktop 不绕过 Edge；D3 真实 CLI/model gate 保持 blocked，先补 environment、budget、runner 和 artifact upload policy。
