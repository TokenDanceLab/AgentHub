# AgentHub 当前状态

最后更新：2026-06-09 19:50 +08:00

本文只记录当前事实、分支治理和任务调度。长期路线图写在
`docs/roadmap.md`，架构边界写在 `docs/architecture.md`。

## 当前 Baseline

| 项目 | 当前事实 |
|---|---|
| 当前 dev | `origin/dev/delicious233` 最新 HEAD 是 `a95469dd feat(hub): add project group thread contract`。 |
| RC tag | `v0.3.0-rc.6 = fa6cd35e`，是已存在的历史 RC 基线，不移动、不重打。下一版候选使用 `0.3.0-rc.7` / `v0.3.0-rc.7`。 |
| master | `origin/master = f3b91ab0`，落后 dev 约 374 个提交；release 前走 PR/merge gate，不直接改写 master。 |
| 主工作树 | `D:\Code\TokenDance\AgentHub` 当前存在大量 dirty 文件且落后远端；新开发和文档收敛从最新 `origin/dev/delicious233` 开隔离 worktree。 |
| 当前文档分工 | `docs/roadmap.md` 只写路线、优先级和边界；`STATE.md` 写当前事实；`docs/architecture.md` 写结构和实现边界。 |
| Git 维护风险 | 旧上下文记录过 bad-tree auto-gc 风险；未获明确批准前不做 destructive gc/prune/reset。 |

## 已合入能力

当前 `origin/dev/delicious233` 已经具备以下公开仓库内可确认能力。

### Web / IM / shared workbench

- Web Agent 主链、target 选择、typed transcript blocks、artifact/replay 渲染基础已进入 dev。
- Web Projects query hooks 已接入 Hub，为 real-mode Projects 数据读取提供基础。
- Web 只通过 Hub 消费单任务 approvals/artifacts 合同，并在 transcript projection 中合并 active task approval/artifact。
- Web real-mode boundary 已显式化：`observed` / `approved-real` 下缺 Agents/Projects/Tasks 数据时显示 empty/error，不静默回 demo/mock。
- Web artifact/diff inspector 已消费 Hub file-change diff metadata，能展示只读 diff、patch、edit/review、apply/revert metadata。
- IM/@Agent 主链操作已补强：composer 展示 Agent/Target/Task 状态，缺 Desktop/Edge target 时禁用启动 Agent task，消息级 pin 入口已进入 UI。
- 群聊编排 fixture 已合入，覆盖 human -> agent、agent -> agent、项目群 `@Agent` queued 和 orchestrator route decision 的可见投影。
- target health 合同已强化，Web/Desktop 可表达 ready、offline、degraded、missing、signed-out 和分页限制等状态。
- runtime/provider/model/tool icon polish 已合入，基于 LobeHub icon registry 和 fallback。

### Hub / API / approval / artifact

- Hub/Edge/Device/Target 合同和 exact target dispatch proof 已进入 dev。
- Hub 单任务 approval/artifact 合同已合入，覆盖 approval list、approval decide、artifact list、owner scope、exact target/device control、correlation fields 和 200 OK envelope OpenAPI。
- Hub file-change diff projection 已合入，artifact list 可从 `run.agent.file_change` 投影最小 `diff`、`edit_id`、`review_status`、`can_apply`、`can_revert` 只读字段。
- approval roundtrip context gate 已合入，用于锁定 task approval request/decision 的上下文投影。
- 编排路由审计队列字段已进入 Hub dev 基线。
- TokenDance ID OIDC 后端登录交换已在 Hub README/API 层描述；真实 TokenDanceID 登录全链路仍未声明完成。

### Desktop / Local Edge / package readiness

- Desktop Local Edge diagnostics、Hub task bridge、target 注册/同步和 sidecar readiness 已进入 dev。
- Desktop sidecar observed fixture smoke 已覆盖 fixture/mock sidecar health、SQLite app-data path、stdout/stderr log path、health URL、preflight/readiness、no direct CLI spawn。
- Desktop exact target observed bridge 已记录 expected/observed `target_id` / `edge_device_id`，能区分 matched、mismatch、offline、missing。
- Tauri package smoke gate 已强化 Windows unsigned/dev package reproducibility、sidecar placement、Local Edge diagnostics、macOS unsigned policy boundary；不执行真实 build/sign/notarize/release upload。
- Desktop Agent Builder fixture evidence UI 已合入，展示 fixture-only runtime/profile、provider/model、tools/MCP、approval policy、workspace trust、Local Edge fixture health 和 no-spend evidence。

### Edge / CLI / SDK / SQLite

- Edge SQLite store、迁移、row/projection tests、durable observed fixture smoke、row-first restore、approval/file-change/artifact evidence、pins 和 replay projection 已合入。
- SQLite local store readiness 已进入 dev，覆盖 local temp SQLite readiness report 和 per-write reopen contract；仍不声明 production row-first CRUD 完成。
- Edge fixture adapter runner contract 已合入，覆盖 fake process fixture runner 的 session/task/route/approval/file-change/artifact/transcript/result 事件归一、运行证据持久化、redaction 和 malformed/error stream no-panic。
- CLI JSON readiness checker 和 CLI approved-real readiness tightening 已合入，覆盖 Codex `exec --json`、Claude Code `stream-json` permission bridge、OpenCode `run --format json` permission risk、命令计划脱敏、approved-real 前置检查和 no-spend fixture boundary。
- SDK fixture capability evidence 与 SDK event fixture matrix 已合入，用 Claude/OpenAI SDK-like 静态样例覆盖 text/tool/file_change/permission/result/artifact canonical events；不安装 SDK 包、不联网、不运行真实模型/API。
- AgentSpec fixture demo 已导出，Agent/Profile/市场 fixture 摘要已合入，覆盖 runtime/model/provider、skills、MCP、tool allowlist、memory、avatar、approval 和 target preference 的 demo 合同。

### Product-loop / readiness gates

- Product-loop observed fixture E2E gate 已合入，覆盖 Web -> Hub -> Desktop/Tauri sidecar readiness -> Local Edge -> adapter fixture -> Hub replay -> Web transcript/approval/artifact render，明确 `real_tested=false`。
- localhost observed loop gate、localhost service probe plan 和 localhost 真实服务 smoke 已进入 dev，用于 no-spend 本地服务组合探测；默认不代表真实 CLI/model/API 或生产部署完成。
- approved-real preflight manifest gate、redacted demo manifest gate 和 no-secret demo readiness gate 已合入，用于审批前检查 approval、budget、timeout、artifact root、redaction、runtime、URL、测试账号标识和 secret scan。
- Web deploy/readiness、boundary、product-loop fixture QA 和 Tauri readiness gate 已作为当前 dev 基础能力存在。

## 当前不声明已经完成

- 真实 TokenDanceID 登录全链路验收。
- `scripts/verify-token-dance-id-login-readiness.ps1` 的 `READY_FOR_OPERATOR` 只表示 no-secret readiness 通过：环境提供了 approved test account/client 元数据且 OIDC discovery 可用；fixture discovery 只能验证脚本合约，不能当作真实登录 evidence。
- 真实 CLI/model/API 消耗或 approved-real 运行证据。
- 真实 Web/Mobile/IM 全部远控闭环的发布级验收。
- Hub AgentProfile 市场安装/发布 mutation、真实头像 asset 管线和持久化配置闭环。
- Artifact/Diff 的真实 apply/revert 文件写入。
- 签名安装器、macOS notarization、release upload、updater metadata。
- 生产部署、公开发布或 3 分钟 Demo 视频交付。

## 当前并发线

| 线程 | 状态 | 边界 |
|---|---|---|
| Web/IM 主链 | 最新 dev 已合入 target health、agent mainchain actions、group orchestration fixtures、real-mode boundary、artifact/diff inspector | 仍需真实 Hub data、真实 task queue 和群成员权限闭环。 |
| Hub approval/artifact/diff | 最新 dev 已合入单任务 approval/artifact 合同、diff metadata、approval context gate、编排路由审计队列字段 | apply/revert 写文件、TeamRun/单任务完全统一和 production 权限 gate 继续推进。 |
| Desktop/Local Edge | 最新 dev 已合入 diagnostics、sidecar observed/binary/package smoke、exact target bridge、Builder fixture UI | 真实签名包、真实 sidecar binary 发布和跨平台安装仍需审批与平台 gate。 |
| Edge/CLI/SDK/SQLite | 最新 dev 已合入 SQLite durable/readiness、fixture adapter runner、CLI JSON readiness、SDK capability/event matrix | 真实 CLI/model/API 消耗和 production durable store promotion 尚未完成。 |
| Product-loop/readiness | 最新 dev 已合入 observed fixture E2E、localhost probe/smoke、approved-real/no-secret gates、P0 approved-real gold-path harness | 缺账号/env 或缺 evidence 时必须输出 `BLOCKED_WITH_EVIDENCE`；本文不记录 secret 或证据包细节。 |
| Mobile | 独立收口 | 只按 Hub target/run/approval/replay 合同对齐，不分叉 runtime 或登录语义。 |

## 分支治理

- 新实现必须从最新 `origin/dev/delicious233` 开隔离 worktree，不在主工作树开发。
- Worker 不直接推 `dev/delicious233`、`master` 或 tag。
- Controller 负责最终集成、验证、fast-forward/push。
- 已合入或过时 worktree 只能在只读审计确认后逐个归档，不能一把删除。
- `v0.3.0-rc.6` 已存在且指向 `fa6cd35e`，保留为历史 RC 基线；后续 tag 需先通过独立 release gate。
- Desktop 下一版候选已按 `0.3.0-rc.7` 准备；只有 release gate 通过并获人工确认后才允许创建 `v0.3.0-rc.7` tag。
- 当前 open PR 仅保留 4 个：`#293`、`#296` 为 Mobile 线，`#294`、`#295` 为旧 Web 分支；release promote 前需要关闭、重开小票或明确接受风险。
- 第一批清理候选只包含已被 dev 吸收且 worktree clean 的分支；`dev/johnny`、`feat/backend-edge-hub`、`codex/backend-*` 属于旧大分叉，只能 cherry-pick 级复查。

## Release Gate 快照

- `verify-ci-gates.ps1`、`verify-tauri-package-readiness.ps1 -RepoRoot .`、`verify-tauri-installer-smoke.ps1 -RepoRoot . -StrictToolchain` 已在 RC7 版本基线上通过。
- Web focused tests、Web typecheck、shared focused tests、Hub `go test ./... -short -count=1` 已通过。
- Edge `go test ./... -short -count=1` 仍有 `TestClaudeCodeParseStreamUsesBrokeredPermissionHandler` 未找到 pending Claude permission request 的失败，需要复跑或修复后再声明整仓 release gate 通过。
- approved-real 金链路当前状态：Desktop Edge CLI no-spend PASS，Hub replay/Web manifest `READY_FOR_APPROVAL`，TokenDanceID readiness `BLOCKED`，缺 `AGENTHUB_TDID_LOGIN_ISSUER_URL`、`AGENTHUB_TDID_LOGIN_CLIENT_ID`、`AGENTHUB_TDID_LOGIN_TEST_ACCOUNT_REF`。
- security risk register 仍有 High open release blockers；未获 waiver/closure 前不发布 stable，不把 remote/cloud/auth 口径写成 production-ready。

## 下一步优先级

1. **P0 approved-real 金链路总 gate**：先运行 `scripts\verify-p0-approved-real-gold-path.ps1`。它只编排无密 readiness/evidence：TokenDanceID readiness、Desktop target/Local Edge/CLI no-spend smoke、Hub replay/Web 展示和 redacted manifest；如果缺账号/env、CLI smoke 或 replay evidence，状态必须是 `BLOCKED_WITH_EVIDENCE`。
2. **真实 TokenDanceID 登录打通**：先跑 `scripts/verify-token-dance-id-login-readiness.ps1`；只有输出 `READY_FOR_OPERATOR` 后，操作员才使用一次性/预批准测试账号和已批准环境运行真实登录链路，不把 secret 写入仓库。`BLOCKED` 必须先补齐 approved client/test-account 元数据或 OIDC discovery。
3. **approved-real 录屏前审批**：先运行 `scripts\verify-approved-real-demo-readiness.ps1` 或顶层 gold-path harness 产出 redacted manifest；若状态是 `READY_FOR_APPROVAL`，再由人工批准真实 TokenDanceID 测试账号/安全 env、录屏范围和是否允许真实 CLI/model/API。无批准时只能演示 fixture/mock replay。
4. **localhost observed service runner 升级**：在现有 no-spend manifest gate 上，逐步加入可启动的 Web dev server、Local Edge mock/SQLite 和 Hub health/service probe。
5. **Windows/Tauri unsigned package smoke**：验证 sidecar binary、no-bundle build 和 unsigned installer readiness；签名、公证、release upload 另行推进。
6. **受控 approved-real CLI/SDK 方案**：已具备 preflight manifest gate；真实 CLI/model/API 消耗、部署和签名仍必须另获批准。

## 安全规则

- Web 只连接 Hub，不直接连接 Local Edge 或 raw runtime。
- Desktop renderer 不获得 raw process execution 权限。
- Mock、fixture、observed、approved-real、production 必须显式区分。
- 未获明确审批，不跑真实登录、真实模型消耗、部署、签名、公证、updater、release upload。
- Roadmap 只写路线；当前事实写在本文。
