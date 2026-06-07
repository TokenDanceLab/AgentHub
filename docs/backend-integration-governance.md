# 后端合并与端到端联调治理

> 最后更新：2026-06-08 01:56 +08:00
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
| A. Runtime adapter | `edge-server/internal/adapters/`、必要的 `lifecycle` 参数摘要 | 不改变公共 API；只增强 Codex/Claude/OpenCode 归一事件和路径脱敏 | `go test ./internal/adapters ./internal/lifecycle -short -count=1` |
| B. Edge E2E harness | `scripts/edge-runtime-*.ps1`、`tests/scripts/edge-runtime-*.ps1` | 默认不跑真实 CLI；TODO 场景必须显式失败，不伪装完成 | `powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\scripts\edge-runtime-e2e.ps1` |
| C. Hub/Edge callback | `edge-server/internal/hub/`、Hub callback fake DB/WS gate | fake callback 可证明 DB/WS 写入；真实 CLI 留 self-hosted gate | Hub/Edge focused Go tests |
| D. API/events contract | `api/events.md`、`api/openapi.yaml` | schema 向前兼容；Web/Desktop 消费字段清楚 | OpenAPI parse + contract tests |
| E. CI/release gates | `.github/workflows/`、`scripts/verify-*.ps1` | 不降低检查强度，不把真实 CLI 变成普通 PR 硬依赖 | `pwsh -NoProfile -File .\scripts\verify-ci-gates.ps1` |
| F. Docs/governance | `docs/`、`AGENTS.md`、项目 skill | 不创建第二事实源；不写本机隐私或私有日志 | `git diff --check -- AGENTS.md docs` |
| G. DB persistence | Edge SQL store、Hub migrations、repository tests | migration 可回滚或有兼容路径；mock 数据替换为 DB 合同 | Hub PG/Redis gate + Edge store tests |

每个切片进入主线前必须回答三件事：它解决什么用户可见问题、它触碰哪个权威边界、失败时怎么回滚或降级。

### `feat/backend-edge-hub` 首轮合并顺序

当前 dirty diff 的首轮推荐顺序：

1. **B. Hub callback 错误脱敏**：范围最小，先合 `edge-server/internal/hub/callback.go` 和测试。验证 `go test ./internal/hub -count=1`。
2. **A. Codex adapter 运行时修复**：再合 `edge-server/internal/adapters/*`、必要的 lifecycle 参数摘要、cmd tests 和 `api/events.md`。验证 focused Go tests；真实 Codex smoke 只跑一次作为收口证据。
3. **C. Edge runtime smoke / OIDC 脚本硬化**：独立合 `scripts/edge-runtime-smoke.ps1`、`scripts/verify-oidc-flow.ps1` 和 `tests/scripts/*`。验证脚本测试，不和 adapter 改动混在一起。
4. **D. Real CLI opt-in E2E**：合 `scripts/edge-runtime-e2e.ps1`、`tests/scripts/edge-runtime-e2e.ps1`、`real-cli-e2e.yml` 和 README。必须写清这是 opt-in/self-hosted/nightly，不是普通 PR 硬门禁。
5. **E. CI / release gate policy**：最后让 `checks.yml`、`release.yml`、`verify-ci-gates.ps1` 依赖新 gate。只有目标测试在 PG/Redis 和 CI 时间限制下稳定后才进入。
6. **F. Docs / handoff / skills / ignore 规则**：收尾合文档、`.gitignore`、`dev-team-codex`。措辞只写“入口、边界、待办、证据”，不能把 opt-in 或计划写成已完成。

当前不允许把 `feat/backend-edge-hub` dirty diff 一次性合进 `dev/delicious233`，因为它同时改 runtime 行为、脚本框架、CI release gate、项目 skill 和治理文档，review 面过宽，失败时无法快速定位。

## 端到端联调顺序

0. **Shared data contract**：先扩 `AgentHubPlatform` / shared data ports。当前 ports 只覆盖 conversations、run submit、attachments、preview，缺 contacts、docs、projects、tasks、agents、targets、message actions。real mode 禁止静默 demo fallback。
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
| Contacts | shared rail page 使用 `WORKBENCH_MOCK_*` | 接 Hub contacts/friend request/remark/block/search 合同 |
| Docs | 无统一 document/artifact store | 定义 `ProjectArtifact` / `DocumentPreview` owner、blob、version、provider、permission |
| Agents | Desktop composer agents 仍可能来自 demo；Edge `AgentInfo`、Hub `AgentProfile`、shared `WorkbenchAgent` 未统一 | 建 shared Agent/Profile/Runtime/Target mapper |
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

1. 等 backend 线程把 `verify-oidc-flow` harness 小修发送 `ready-for-review`。
2. 根据 backend diff 切片审查结果，先合入低风险的 test harness / adapter contract，再处理 Hub/DB/CI 大切片。
3. 同步更新 `docs/roadmap.md` 中 P0/P1 为端到端联调，而不是继续记录旧 UI PR 前状态。
4. 开始建立 Edge SQL store 和 Hub DB-backed product surfaces 的 schema/mutation/test 队列。
