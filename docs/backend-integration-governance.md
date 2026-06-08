# 后端合并与端到端联调治理

> 最后更新：2026-06-08 21:51 +08:00
> 目标：把后端、Edge、Hub、Desktop、Web 的开发从并行堆积切回可审查、可合并、可验证的主线节奏。

## 当前基线

当前开发事实源是 `dev/delicious233`。`master` 只接收从 `dev/delicious233` 发起的 PR。后端长期线程已关闭并归档，后端旧整合线合并由 backend merge Agent 负责；主负责人只记录合并状态、规划后续依赖和按需派发新的短生命周期 subagent/worktree。关键后端/API/Edge 窄切片已经多批合入，当前有效迁移进入收尾，只剩 WS delivery reliability、remote Edge CORS 这类小片和 real CLI/release/refactor/helper 等延期项；但 `feat/backend-edge-hub` 仍有未吸收提交，因此不能把后端旧整合线视为全部并入主线。

已确认的产品边界：

| 端 | 权威后端 | 原则 |
|---|---|---|
| Desktop 5173 | Local Edge | Desktop 只直接控制本机 Edge、Tauri Host、本机文件能力和本机 Agent Runtime。 |
| Web 5174 | Hub | Web 只通过 Hub 读取账号、会话、消息、Agent task、远程 Edge 路由和审计。 |
| Edge | Agent Runtime + 本地 store | Edge 是本地执行权威，负责 Run、Event、Artifact、Permission、CLI adapter 和本地持久化。 |
| Hub | 账号 + IM + 同步 + 中继 | Hub 是云端会话、设备、权限、审计、TeamRun 和远程路由权威。 |

禁止回退到旧架构：Web 不能直连 Local Edge；Desktop 不能绕过 Edge 直接启动 CLI；shared UI 不能持有 Tauri、Edge URL、Hub URL 或 token 存储细节。

## 旧后端分支收口账本

`feat/backend-edge-hub` 仍会被 `git log --cherry-pick --right-only origin/dev/delicious233...feat/backend-edge-hub` 列出大量提交；这不是未完成证明，因为主线采用了语义小片吸收，而不是整提交 cherry-pick。后续 review 以本节和当前代码/测试为准，不恢复旧 `docs/roadmaps/BACKEND-ROADMAP.md`、根级 `HANDOFF-BACKEND-AGENT.md` 或第二套 backend roadmap。当前收尾只核验 WS delivery reliability、remote Edge CORS 等小片；real CLI、release、refactor/helper 类改动继续延期或另起 proposal。

| 类别 | 处理结论 | 当前证据 |
|---|---|---|
| IM/TeamRun realtime 修复 | 已迁入主线 | `6743a41e` session lifecycle bus wiring、`57ed2ea1` friend accepted recipient、`f3b63b51` AgentTeam WS events、`63696863` coordinator route auto-parse。 |
| WS dispatch 防丢 | 已迁入主线 | `b78dd5cf` 在普通非 target dispatch 的 WebSocket enqueue 失败时保留 pending payload；target/control queue 的 list/ack 语义已由早期小片吸收。 |
| OpenAPI / event contract | 已迁入主线 | `216cbf58` 补 backend OpenAPI gaps；`3306ddbe` 补 Hub WebSocket frame 和 user-level presence schema；`api/events.md` 已记录 message edit/reaction 和 device presence payload。 |
| Security / auth / Edge hardening | 已吸收或登记 | OIDC token exchange redaction、Edge JWT device binding、Cloud Edge registration、Edge env/log/CORS hardening、ExecutionTarget credential output 均已由当前代码/测试吸收；`0d12b155` 恢复 AH-SR-045..049 并按当前 dev 重算状态。 |
| Audit migration / attachments / message edit/reaction/search | 已吸收，skip | audit pgcrypto + TRUNCATE guard、attachment metadata/MIME/S3/image refs、message edit/reaction/search 已由当前主线的小片和 focused tests 覆盖。 |
| CORS/dev config | 部分吸收，剩余 defer | CORS error/testability 已吸收；生产 CORS 保持单一正式 origin。旧分支里的 Mobile/Desktop dev redirect 全量端口扩展不直接迁入，需等对应 app 端口/回调事实确认。 |
| Deploy/readiness | 已迁入主线 | `46313daf` 让 deploy health gate 默认检查 `/health/ready` 且要求 `status=ok`、`ready=true`；`7f3df20b` rollback 不再先 `docker compose down` 停依赖，并在 rollback 前检查预加载镜像。 |
| Real CLI / model / release gates | defer / proposal only | D3 real CLI/model、self-hosted runner、release publish、签名、notarization、artifact upload 需要 runner、预算、secret 和脱敏证据审批，不能作为 backend branch migration 直接合入。 |
| 大重构 | defer，禁止整包合并 | `e1720e8a`、`8bd642cc` 属结构重构；`repository.WrapNotFound` helper 已在主线，剩余服务层样板清理只能后续按小文件切片推进。 |
| 旧 docs/handoff | skip | 当前事实源为本文、`docs/roadmap.md` 和 `docs/governance/security-risk-register.md`；旧 handoff/roadmap 仅作历史参考，不恢复为 active docs。 |

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

### 当前 ready-for-review 同步

```markdown
AH-SYNC v1
from: frontend
kind: ready-for-review
branch: codex/lobe-icons-runtime-branding
worktree: .worktrees/lobe-icons-runtime-branding
scope: shared|desktop|docs
writes: app/shared/src/workbench/RuntimeBrandIcon.*; app/shared/src/workbench/designIcons.tsx; app/shared/src/workbench/pages/AgentsPage.*; app/desktop/src/components/settings/cards/{RuntimeInventoryCard,RunnerRow,ProviderHealthRow,McpRuntimeCard}.tsx; docs/roadmap.md; docs/backend-integration-governance.md
state: ready-for-review
summary: Added a shared RuntimeBrandIcon registry behind the existing design icon registry; model/provider/runtime logos use @lobehub/icons where available; internal tools/runtimes use compact local fallbacks; model-card status styling is scoped so brand icons are not styled as status pills; Web/mobile/backend boundaries are unchanged.
verified: rebase to latest origin/dev/delicious233; vitest RuntimeBrandIcon + icon-governance; agenthub-desktop typecheck; agenthub-web typecheck; git diff --check
blockers: Full @agenthub/shared lint remains blocked by pre-existing shared test/story/module issues outside this slice.
needs-from-main: Review and merge ordering only.
next: Main owner reviews the isolated icon diff and decides merge order.
```

## 硬边界规则

这些规则进入 code review gate，不能只停留在文档里：

1. Web 分支不得引入 Local Edge、Tauri、filesystem 或 Desktop runtime capability；Web 只能经 Hub REST/WS 和 Hub-issued session。
2. Desktop 本地执行不得绕过 Edge；UI 只能经 platform adapter 到 Edge REST/WS，不得直接启动 CLI 或拼 shell。
3. Hub dispatch 必须绑定 exact `agent_instance_id` 和 exact Desktop device / ExecutionTarget；离线只能进对应 user/device/target queue，禁止 fallback 到其他在线 Desktop。
4. Edge `agentId` 必须显式校验 adapter registry；未知 runtime 不得静默 fallback 到默认 adapter。
5. 任何把 mock/demo 当验收证据的 PR 必须标注为 demo；生产接入项必须提供真实 Desktop->Edge 或 Web->Hub->Edge->Runtime 事件链证据。
6. Claude/OpenAI 等 Agent SDK 只能作为 Edge runtime/provider adapter 实验接入；Hub AgentProfile、TeamRun、memory、approval、ExecutionTarget 和 Web/Tauri 产品模型必须继续使用 AgentHub 自有 `AgentHubAgentSpec` / DSL 边界，不得暴露 SDK 对象或让 Web/Tauri 直接调用 SDK。
7. SDK 接入合同分层固定为：Hub owns orchestration/API；Edge owns adapters；Web/Desktop consume AgentHub-owned fields only；Tauri never owns SDK objects。PoC 顺序固定为 Claude SDK read-only adapter fixture -> OpenAI Agents SDK sandbox fixture -> SDK event mapper golden tests -> TeamRun fixture E2E；审批前不得跑真实 SDK/model。

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
| D1. Backend E2E CI gate | `.github/workflows/checks.yml`、`scripts/verify-ci-gates.ps1` 和依赖 tests | 保留 fixture-only gate；新增 backend focused subset 只能跑现有 short focused packages，不能引入真实 CLI/model、service containers 或外部 endpoint | Hub/Edge focused tests + CI policy gate |
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
7. **D1b. Backend focused subset CI gate / D2-D3 release and real CLI gates**：D1b 本片只新增 `backend-focused-subset`，显式运行 Hub `repository/service/app/handler/router` 和 Edge `store/api/lifecycle/cmd/agenthub-edge` focused short tests；保留 `backend-e2e-fixture` 不替换。`scripts/verify-ci-gates.ps1` 必须检查新 job、精确命令和禁用模式，继续阻断 `-RealCli`、真实 CLI/model key、self-hosted、service containers、Docker、外部 URL 和根级泛化 E2E。`release.yml` / `release-readiness.yml` 是 D2 发布流程变更；`real-cli-e2e.yml` 是 D3，只能在专用 runner、环境审批、预算和 artifact 脱敏确认后 opt-in/nightly。
   - **D2a. Tauri package readiness**：`codex/tauri-package-readiness` 只收口 Desktop package/Tauri/Cargo/Cargo.lock 版本一致、Windows sidecar 命名、NSIS + portable zip 收集策略、updater `latest.json`/`.sig` artifact gate、generated artifact ignore gate 和独立 release readiness dry policy。`codex/tauri-installer-smoke` 在该 policy gate 后增加 Windows installer smoke preflight：检查本地 Node/pnpm/Go/Rust 命令可用性、Edge sidecar entrypoint、NSIS image assets、portable staging names 和 ignored output paths，但不执行 `pnpm install`、`pnpm tauri build`、签名、notarization、staple 或真实 GitHub Release 发布。该片保留真实 tag release workflow，不做 Authenticode、macOS Developer ID、notarization、staple 或真实发布改造。
   - **D2b. Release dry build topology**：本片只做 topology/preflight only（拓扑/预检）边界，不把完整 Tauri 构建当成静态 readiness 通过条件，也不声明当前 dry topology 会产出安装器或 updater 文件。静态 gate 只验证 `release-readiness.yml` 把 Windows sidecar `agenthub-edge-x86_64-pc-windows-msvc.exe`、Windows unsigned NSIS/portable artifact 命名、`latest.json`/`.sig` updater metadata、`artifact-manifest.json` hash/size 记录、portable zip 必备内容、ignored 输出路径、workflow artifact 上传边界和 `TAURI_SIGNING_PRIVATE_KEY` 禁用边界写清楚；fixture/built-artifact gate 只检查 updater metadata shape、signature file shape、manifest hash/size 和 portable zip sidecar 内容，不需要真实私钥。`pnpm tauri build` / full Tauri build 只能留在单独的 `workflow_dispatch` + `run_windows_package_dry` 手动 opt-in job，不能被静态 policy 或 installer smoke preflight 代替审批。`codex/macos-unsigned-dry-policy` 只新增 macOS arm64 unsigned dry policy/readiness 边界：记录 future `agenthub-edge-aarch64-apple-darwin` sidecar、future `AgentHub.app` / `AgentHub_${version}_aarch64.dmg` bundle 命名和 workflow artifact-only 边界；manual dry job 只生成 `dist/macos-unsigned-dry-policy.json` policy manifest 并通过 `actions/upload-artifact` 上传到当前 workflow run；不得运行 `pnpm tauri build`、Developer ID signing、`codesign --sign`、`xcrun notarytool`、`stapler staple`、release asset upload 或 updater 生产 metadata 发布。真实 Authenticode、Apple Developer ID signing、notarytool notarization、stapler staple、GitHub Release upload 和 updater 生产 metadata 发布必须另起 approval slice / 审批片，并要求专门审批、secret 边界和脱敏证据。
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
19. **Desktop Edge mapper / target preference**：`codex/desktop-edge-mapper` 首片把 Local Edge `/v1/agents`、`/v1/model-catalog` 和 health runners 投影到 Desktop Workbench agents / Local Edge target，保留 Edge `runtimeId` 并让 `StartRunRequest.agentId` 使用 adapter runtime id；移除提交到 Edge runs 的 `provider` 字段，阻断 Desktop live/auto 空线程回落 demo transcript。后续 `codex/desktop-target-tauri-host` 收口 Desktop-owned Local Edge target preference、Tauri host readiness command 和 sidecar launch args 测试；不改 Web、Hub、Edge API/OpenAPI、Edge lifecycle 或真实 CLI/model gate，安装包联调继续另拆。
20. **G3b. Edge SQLite relational migration**：`codex/edge-relational-store` 已补 SQLite migration table/runner、snapshot v1、owner/workspace/run/artifact/diff/preview relational lifecycle v2 schema，以及 rollback-to-v1/reapply tests。该片只改 Edge store migration 层，不改 Hub/Web/Desktop/API routes 或真实 CLI/model gate；后续 runtime evidence 写入和 artifact lifecycle 继续另拆。
21. **G4. Artifact/Diff/Preview read-only Edge 前置**：`codex/artifact-diff-preview-readonly` 只补 Edge 本地只读 evidence store 和 REST 合同：`GET /v1/runs/{runId}/diff`、`GET /v1/artifacts`、`GET /v1/previews`，memory/file/sqlite 共用 snapshot contract。该片不做 preview start/stop、artifact apply/discard/content、Hub artifact store、Projects UI、Desktop mapper、Web 直连 Edge 或真实 CLI/model gate；artifact/preview lifecycle 事件仍为 planned。
22. **G5. Runtime evidence writer**：`codex/runtime-evidence-writer` 只在 Edge lifecycle 结构化 runtime 事件流中写入本地 evidence snapshot：`run.agent.file_change` -> run diff file，`artifact.created` -> artifact metadata，`preview.ready` -> preview metadata。该片不新增 REST routes，不做 preview start/stop、artifact apply/discard/content、Hub artifact store、Desktop/Web UI 或真实 CLI/model gate。
23. **Packaged Desktop OIDC readiness**：`codex/packaged-login-e2e` 只把 packaged Desktop loopback bind、keyring entry 和 Tauri readiness command 纳入 `verify-oidc-flow.ps1 -LocalOnly` fake/static gate；不连接真实 TokenDanceID、不打开真实登录窗口、不改 Web/Hub OIDC 行为，真实 packaged E2E 仍保持 proposal-only gate。
24. **Packaged real login dry readiness**：`codex/login-real-readiness-gate` 新增 `scripts/verify-packaged-login-real-readiness.ps1` 和 `tests/scripts/verify-packaged-login-real-readiness.ps1`，只做 repo 静态扫描，分开验证 fake/local gate、packaged readiness gate、future real E2E gate。该片不连接 Hub/TokenDance ID，不打开浏览器，不需要 secrets，不消费真实 CLI/model；未来真实 packaged login 仍需显式批准测试 OAuth client、测试账号、Hub 测试环境、浏览器窗口和无密证据边界。
25. **Runtime evidence inspector consumption**：`codex/runtime-evidence-inspector` 只把已存在的 Edge read-only diff/artifact/preview snapshot 消费到 shared RightInspector，并由 Desktop 复用既有 Edge evidence hook 传入；review 修复已改为从 transcript raw run id / normalized evidence id 安全解析当前 run，artifact metadata 行不再伪装为可点击操作，preview URL 会切到 Browser tab；不新增 backend route，不做 mutation/apply/discard/content、Web 直连 Edge、Hub route 或真实 CLI/model gate。
26. **Artifact/preview metadata dereference**：`codex/artifact-lifecycle-next` 只把已存在的 Edge read-only artifact/preview index 增加单条 metadata lookup：`GET /v1/artifacts/{artifactId}`、`GET /v1/previews/{previewId}`，并同步 store contract 与 OpenAPI status。该片不新增 content blob store，不做 artifact apply/discard、preview start/stop、Hub artifact store、Desktop/Web UI、Web 直连 Edge 或真实 CLI/model gate。
27. **Artifact content contract readiness**：`codex/artifact-content-contract` 只做 proposal/test-only 收口。当前后续 `codex/artifact-content-source-proposal` 只补 Edge `store.Artifact.contentSource` 安全元数据、memory/file/sqlite snapshot contract、SQLite relational readiness columns、runtime evidence 的相对/绝对路径净化，以及 OpenAPI artifact metadata schema。`contentSource.path` 只能是 workspace-relative 或 basename-only；绝对私有路径不得保存或返回；basename-only source 标记为不可读。因此本片仍不实现 `GET /v1/artifacts/{artifactId}/content`，继续保持 content/apply/discard planned。下一片若要实现只读 content handler，必须先补 MIME type、checksum、preview-safe size cap、approved workspace root resolver 和 no-secret read policy；仍不得做 apply/discard、Hub artifact store、Web 直连 Edge、Desktop UI 或真实 CLI/model gate。
28. **Preview lifecycle readiness**：`codex/preview-lifecycle-readiness` 只补 preview stopped metadata contract：Edge lifecycle 持久化 `preview.stopped` 到现有 preview 记录，`POST /v1/previews/{previewId}:stop` 将已有本地 preview 转为 `stopped` 并清空 ready URL，OpenAPI 标记 stop implemented，shared event/state 接收 stopped 事件供 Desktop inspector 的 read-only evidence surface 使用。该片不实现 `POST /v1/previews` start，不启动或停止真实 dev server/OS process，不打开 browser，不新增 Hub preview store，不让 Web 直连 Edge，不改 mobile，不跑真实 CLI/model。
29. **Preview fake-runner start contract**：`codex/preview-runner-fake` 只补 Edge fake preview runner interface 与 `POST /v1/previews` metadata contract。API 为已有 run 创建 `starting` preview metadata，fake runner 测试可把同一条记录标记为 `ready` 或 `stopped`；OpenAPI 补请求 schema，但 route-status gate 继续把 start 归为 planned，直到真实 process runner policy 单独收口。该片不启动真实 dev server、不管理真实 OS process、不打开 browser、不做 artifact content/apply/discard、不新增 Hub preview store、不让 Web 直连 Edge、不改 Desktop/mobile、不跑真实 CLI/model。
30. **SDK AgentSpec contract draft**：`codex/agent-spec-schema` 只补 `AgentHubAgentSpec` docs/schema/fixture 合同草案，OpenAPI 仅新增 component-only `experimental/contract draft` schema，不声明任何 endpoint 已接收或返回该完整 shape；后续 SDK PoC 只按 fixture 顺序推进，审批前不安装 SDK、不跑真实 CLI/model。

当前不允许把 `feat/backend-edge-hub` dirty diff 一次性合进 `dev/delicious233`，因为它同时改 runtime 行为、脚本框架、CI release gate、项目 skill 和治理文档，review 面过宽，失败时无法快速定位。

### 并行评审结论（2026-06-08 03:57 +08:00）

- **D1a/D1b backend CI gates**：D1a fixture-only gate 已合入 `dev/delicious233`。D1b 只允许 `backend-focused-subset` 这种现有 focused package short gate；policy verifier 必须继续断言不含 `-RealCli`、Docker、service containers、external URL、root `go test ./tests -count=1` 或真实 CLI/auth secret。
- **D3 real CLI/model gate**：继续 blocked。候选 workflow 缺 GitHub `environment` approval、预算/请求上限控制，且 redaction validation 失败后仍可能上传 artifact；修复前不得合入。
- **G1/G2a/G2b/ExecutionTarget/Projects DB-backed state**：Hub AgentProfile -> shared Agents 页 read-through 已合入；G2a Web mutation/empty/error/saving 切片已合入；G2b 后端 AgentProfile request contract hardening 和 OpenAPI 当前行为同步已合入；ExecutionTarget request contract hardening 已合入；Hub Projects/workspaces P1 已合入；Web Projects read-through 已作为 `0c79f277 feat(web): read Hub projects into workbench` 合入并打 `v0.3.0-rc.1` 稳定候选 tag；Projects create/update UI gate 已作为 `fd7be0f9 feat(web): 收口 Hub Projects 创建更新 UI gate` 合入。G2a 只消费既有 Hub CRUD 合同并过滤 UI fallback 写回；G2b 与 ExecutionTarget 不改 Hub schema、Edge store、publish/install、routing 或 market lifecycle；Projects P1/read-through/create/update UI 只做现有 workspaces list/create/get/update 与 shared Projects 基础交互，不做 delete/migration。
- **API/Event contract sync**：`codex/api-event-summary-alias` 已把 Web client 已用的 `/web/agent-tasks/{id}/summary` 声明为 Hub/OpenAPI 兼容 alias，复用既有 `/web/agent-tasks/{id}/events/summary` response contract；`codex/event-contract-docs` 继续做 Edge runtime event 文档/测试漂移收口，不混入 Web UI、Edge pins 或真实 CLI gate。
- **Runtime adapter roadmap**：Codex `exec --json` adapter 仍是 Phase 1 batch 模式；完整 multi-turn、turn steer/interrupt、approval、subagent 和 diff patch delta 需要后续 Codex app-server 通道，不应在当前能力声明中写成已完成。

## 端到端联调顺序

0. **Shared data contract**：先扩 `AgentHubPlatform` / shared data ports。当前 ports 已覆盖 conversations、run submit、attachments、preview、Contacts 只读 Hub `listContacts()`、Web Projects read-through 和 Projects create/update UI gate；仍缺 docs、tasks、targets、message actions、Contacts mutation/error/empty/schema，以及 Projects delete/soft-delete policy 和 artifact/workspace relationship。real mode 禁止静默 demo fallback。
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
| Agents | G1 已建立 Hub `AgentProfile` 到 shared Agents 已安装页的只读 mapper，并阻断 Web real mode demo agent fallback；G2a 已合入 Web AgentProfile create/update/delete、empty/error/saving 和 mapper 写回保护；G2b 已合入 Hub AgentProfile JSON-like request contract hardening；ExecutionTarget contract hardening 已合入 Hub request normalization；Desktop Edge 首切片已从 Local Edge `/v1/agents`、`/v1/model-catalog` 和 health runners 投影 Workbench agents/Local Edge target，并在 review 修正 StartRunRequest adapter id、provider 字段和 live 空线程 demo fallback；`codex/desktop-target-tauri-host` 正在补 Desktop-owned Local Edge preference 与 Tauri host readiness；market/install 仍未生产化 | 继续验证 Desktop target preference/Tauri host readiness；market/install 后置 |
| Tasks/Runs | Tasks 页是本地任务 mock；TeamRun router 已有但 shared UI 未消费 | 先定 Tasks = TeamRun projection 还是独立 product task |
| Projects | Hub Projects/workspaces P1 已合入 Web-owned `/web/projects` list/create/get/update，复用现有 owner-scoped `workspaces`；Web Projects read-through 已把 shared Project rail 接生产 list 数据；Projects create/update UI gate 已在 `fd7be0f9` 合入；Hub 目前不提供 runs/artifacts/feed，因此只投影基础 workspace 字段和空数组；artifact/workspace 关系和 delete/soft-delete policy 未定义 | artifact 关系、delete/soft-delete/orphan policy 需另起 proposal |
| Settings | UI 偏好可本地持久化，但账号/设备/运行偏好未 DB-backed | 区分 local preference、Hub user preference、Edge runtime config |
| RightInspector | 默认任务/文件内容仍主要来自 demo/event evidence；Edge 已补 artifact/diff/preview read-only REST 空态/数据合同，runtime evidence 写入已收口，`codex/runtime-evidence-inspector` 已在 shared inspector 增加 read-only snapshot 消费并由 Desktop 复用既有 Edge evidence hook；review blocker 修复覆盖 raw run id、Desktop App v4 harness、artifact metadata 非交互行和 preview 切 tab，已通过 focused gate 复验；`codex/artifact-lifecycle-next` 补单条 artifact/preview metadata lookup；`codex/preview-lifecycle-readiness` 补 stopped metadata transition；`codex/preview-runner-fake` 补 fake start metadata；artifact content/apply/discard、真实 preview process runner 和真实 CLI evidence 仍未完成 | Review/merge runtime evidence inspector、metadata lookup、stopped transition 和 fake start contract；artifact apply/discard/content 另拆 |

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

1. 后端长期线程已关闭；后端旧整合线由 backend merge Agent 继续处理，主负责人不接管该合并，只把结果作为后续 Edge/Desktop/Web/packaging 规划输入。当前有效迁移进入收尾，只剩 WS delivery reliability、remote Edge CORS 这类小片和 real CLI/release/refactor/helper 等延期项；旧 `feat/backend-edge-hub` 整分支不得写成已合并。
2. `v0.3.0-rc.1` 已打在 `0c79f277`，作为 shared v4 workbench + Hub/Edge 合并基线；Web Projects read-through 已完成并保持 shared `/v1/projects` 与 Desktop/Edge 语义不变。
3. 下一批实现按 roadmap 排序：登录 fake/local gate、Edge SQLite opt-in backend、Edge relational migration、Tauri Windows installer/updater metadata readiness、TeamRun dry fixture evidence、Artifact/Diff/Preview read-only endpoints、runtime evidence metadata 写入、artifact/preview metadata lookup 和 Projects create/update UI gate 已合入；`codex/tauri-package-readiness` follow-up 已补 generated artifact ignore gate，待 review；`codex/tauri-installer-smoke` 补 Windows installer smoke preflight，作为完整 dry package build 前的轻量本地/CI 先决条件检查；`codex/desktop-target-tauri-host` 正在收口 Desktop-owned Local Edge preference 与 Tauri host readiness；`codex/runtime-evidence-inspector` 已补 shared inspector read-only snapshot 消费并完成 review blocker 修复和 focused gate 复验，待 review/merge；`codex/preview-lifecycle-readiness` 只补 preview stopped metadata transition；D1b `backend-focused-subset` 只跑现有 Hub/Edge focused short packages，继续禁止真实 CLI/model、service containers、external endpoint 和根级泛化 E2E；`codex/preview-runner-fake` 只补 fake start metadata contract；SDK PoC 下一步只做 Claude read-only fixture、OpenAI sandbox fixture、mapper golden tests 和 TeamRun fixture E2E。下一批继续推进 packaged login E2E；Projects delete/soft-delete policy、artifact/workspace relationship、真实 preview process runner、artifact content/apply/discard、真实 SDK/model execution、macOS signing/notarization 和 D2/D3 gate policy 继续保持独立 proposal。
4. 按 Desktop/Edge 与 Web/Hub 两条线推进生产对接，继续保持 Web 不直连 Local Edge、Desktop 不绕过 Edge；D3 真实 CLI/model gate 保持 blocked，先补 environment、budget、runner 和 artifact upload policy。
