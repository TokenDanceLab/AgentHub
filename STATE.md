# AgentHub 当前状态

最后更新：2026-06-09 19:35 +08:00

本文只记录当前事实、分支治理和任务调度。长期路线图写在
`docs/roadmap.md`，不要把提交 SHA、工作区状态或临时派工写进路线图。

## 当前 Baseline

| 项目 | 当前事实 |
|---|---|
| 当前 dev | controller 集成批次已包含 Web visual smoke、Desktop sidecar binary smoke、Edge SQLite durable hardening、Hub 单任务 approval/artifact 合同、Product-loop observed fixture E2E gate、approved-real preflight manifest gate、Web 单任务 approval/artifact contract 消费、Edge fixture adapter runner、Hub file-change diff projection、runtime/provider icon polish、Real/Mock boundary、Desktop exact target observed bridge、Tauri package smoke gate、SDK fixture capability evidence、localhost observed loop gate、localhost services probe plan、Agent Builder fixture evidence UI、Web artifact/diff inspector、IM/@Agent 主链操作补强、SDK event fixture matrix；远端 HEAD 以 `git log -1 origin/dev/delicious233` 为准 |
| 最新 dev 内容 | P0 Desktop/QA、P0 Web 主链/typed transcript、Web offline target dispatch guard、Web approval/evidence、Edge SQLite observed smoke、Desktop sidecar observed smoke、CLI JSON readiness gate、P1 并发拓扑/Edge durable 状态同步、Web real-mode visual smoke、Desktop sidecar binary smoke、Edge SQLite durable hardening、Hub 单任务 approval/artifact 合同、Product-loop observed fixture E2E gate、approved-real preflight manifest gate、Web task approval/artifact contract consumption、Edge fixture adapter runner contract、Hub task file-change diff metadata、runtime/provider icons polish、real-mode explicit boundary、Desktop exact target sidecar evidence、Tauri package readiness hardening、SDK fixture capability evidence、localhost observed loop runner、localhost services probe plan、Desktop Agent Builder fixture evidence、Web artifact/diff inspector、IM/@Agent mainchain actions、SDK event fixture matrix |
| RC tag | `v0.3.0-rc.6 = ceccabe6`，指向 Desktop P0 + product-loop QA gate 稳定基线，不等于最新 dev |
| master | 暂缓推进；当前只保证 `dev/delicious233` 干净可用 |
| 主工作树 | `D:\Code\TokenDance\AgentHub` 落后且有大量 dirty 文件，当前不作为开发或事实来源 |
| Git 维护风险 | 旧上下文记录过 bad-tree auto-gc 风险；未获明确批准前不做 destructive gc/prune/reset |

## 已合入能力

当前 `origin/dev/delicious233` 已经具备以下基础能力：

- Hub/Edge/Device/Target 合同和精确 target dispatch proof。
- Desktop Local Edge diagnostics、Hub task bridge、target 注册/同步和 sidecar readiness。
- Web Agent 主链、target 选择、typed transcript blocks、artifact/replay 渲染基础。
- Web boundary/deploy readiness、product-loop fixture QA、Tauri package/readiness gate。
- Edge SQLite store、迁移、row/projection tests，Desktop sidecar 默认使用 app-data SQLite 路径。
- Edge SQLite local readiness helper and per-write reopen contract are now in progress on `codex/edge-sqlite-store-readiness-next`; this remains fixture-only and does not promote SQLite to production row-first CRUD.
- SDK fixture mapper，用 fixture 覆盖 OpenAI/Claude 形状事件到现有 Edge 事件合同的映射。
- 基于 `@lobehub/icons` 的 runtime/provider/model/tool icon 组件和 fallback。
- Edge SQLite durable observed fixture smoke：覆盖 `agenthub-edge --store-backend sqlite --store-db <temp.db>` 配置入口、snapshot rows、run projection、pins 和 alpha durability 边界。
- Desktop sidecar observed fixture smoke：覆盖 fixture/mock sidecar health、SQLite app-data path、stdout/stderr log path、health URL、preflight/readiness、no direct CLI spawn，并保留缺真实 sidecar binary 时 strict gate 失败。
- CLI JSON readiness checker：覆盖 Codex `exec --json`、Claude Code `stream-json` permission bridge、OpenCode `run --format json` permission risk、命令计划脱敏和 no-spend fixture boundary。
- Web real-mode visual smoke 集成提交：`e2ee21f0 fix(web): surface real-mode replay evidence`，覆盖 Hub `approval.requested` 标题/描述投影、避免重复 approval evidence label、右侧 inspector 在 runtime evidence 存在时展示 Hub replay evidence 而不是 demo `B0 SQLite` fixture。
- Desktop sidecar binary smoke 集成提交：`74660003 test(desktop): 增加 sidecar binary smoke`，覆盖 Windows Local Edge sidecar build/placement、strict bundled sidecar readiness、dry package gate 复用 prepare 脚本，以及二进制/打包产物 ignore 边界。
- Edge SQLite durable hardening 集成提交：`fd5fa202 test(edge): harden sqlite durable store slice`，覆盖 approval requested/decided replay item、file-change/artifact evidence、pins、run replay projection 和删除 snapshot 后的 row-first restore。
- Hub 单任务 approval/artifact 合同集成提交：`6b5a3e4e feat(hub): 支持单任务审批和产物投影`，覆盖 `/web/agent-tasks/{id}/approvals`、`POST /web/agent-tasks/{id}/approvals/{approvalId}/decide`、`/web/agent-tasks/{id}/artifacts`、owner scope、exact target/device control、correlation fields 和 200 OK envelope OpenAPI。
- Product-loop observed fixture E2E gate 集成提交：`8dc7dcac test(product-loop): add observed fixture e2e gate`，覆盖 Web -> Hub -> Desktop/Tauri sidecar readiness -> Local Edge -> adapter fixture -> Hub replay -> Web transcript/approval/artifact render 的可复跑 gate，明确 `real_tested=false`。
- Approved-real preflight manifest gate 集成提交：`84a39563 test(real): add approved-real preflight manifest gate`，覆盖 approval、budget、timeout、artifact root、redaction、runtime、URL、测试账号标识和 secret scan；明确 `real_tested=false`，不运行真实登录、CLI/model/API、部署、签名、公证、release upload。
- Web task approval/artifact contract consumption 集成提交：`d9e174f9 feat(web): consume task approval artifact contracts`，覆盖 Web Hub client 的单任务 approvals/artifacts list、approval decide，以及 `useWebWorkbenchModel` 对 active task approval/artifact 的查询、失效和 transcript projection merge；Playwright stubbed-Hub smoke 覆盖 Web 只消费 Hub `/web/agent-tasks/...` 合同。
- Edge fixture adapter runner contract 集成提交：`18c1f4cc test(edge): add fixture adapter runner contract`，覆盖 fake process fixture runner 的 session/task/route/approval/file-change/artifact/transcript/result 事件归一、运行证据持久化、redaction 和 malformed/error stream no-panic；不执行真实 Codex/Claude/OpenCode 或模型/API。
- Hub task file-change diff metadata 集成提交：`74f9579a feat(hub): project task file-change diff metadata`，让 `/web/agent-tasks/{id}/artifacts` 从 `run.agent.file_change` 投影最小 `diff`、`edit_id`、`review_status`、`can_apply`、`can_revert` 只读字段；不实现 apply/revert 文件写入。
- Runtime/provider icons polish 集成提交：`6eee0af6 feat(ui): polish runtime provider icons`，基于 LobeHub icon registry 强化 OpenAI-compatible/custom、MCP、AgentProfile、ExecutionTarget、Target Health 等 fallback，不改主题和大布局。
- Real/Mock boundary 集成提交：`04aef85c fix(web): make real mode boundaries explicit`，`observed/approved-real` 下缺 Agents/Projects/Tasks 数据时不再静默回 mock，而是展示明确空态/错误态；demo/mock/fixture 仍保留样例数据。
- Desktop exact target observed bridge 集成提交：`e0a6591c test(desktop): bind observed sidecar smoke to exact target`，让 Hub dispatch queue、Edge run body、Desktop readiness/diagnostics 和 sidecar observed fixture 记录 expected/observed `target_id` / `edge_device_id`，区分 matched/mismatch/offline/missing，仍不启动真实 CLI/model/API。
- Tauri package smoke gate 集成提交：`29982e85 test(desktop): harden tauri package smoke gate`，强化 Windows unsigned/dev package reproducibility、sidecar placement、Local Edge diagnostics、macOS unsigned policy boundary；不执行真实 build/sign/notarize/release upload。
- SDK fixture capability evidence 集成提交：`c49d2ee1 test(edge): expand sdk fixture capability evidence`，扩展 SDK-like / custom OpenAI-compatible fixture metadata、RuntimeManifest capability/health 和 golden tests；不安装 SDK 包、不联网、不跑真实 CLI/model/API。
- localhost observed loop gate 集成提交：`b9e53b25 test(e2e): add localhost observed loop gate`，新增 no-spend localhost observed runner、manifest、safe artifact root、direct Hub-to-Edge rejection、local stack readiness 组合；当前仍 `RealTested=false`。
- localhost services probe plan 集成提交：`935704b5 test(e2e): add localhost service probe plan`，在 localhost observed runner 中加入 `ProbeServices` health marker、统一 log root、service probe/pid/health manifests；默认不启动服务，`RealTested=false`。
- Desktop Agent Builder fixture evidence UI 集成提交：`6c855195 feat(desktop): show fixture agent builder evidence`，在 Builder 中展示 fixture-only、runtime/profile、provider/model、tools/MCP、approval policy、workspace trust、Local Edge fixture health 和 no-spend evidence；不运行真实 SDK/CLI/model/API。
- Web artifact/diff inspector 集成提交：`01ff715d feat(web): surface task diff evidence in inspector`，保留 Hub task artifact 的 diff/patch/edit/review/apply/revert metadata，把 file-change artifact 投影进 `RuntimeEvidenceSnapshot.diffs`，并在 transcript/inspector 展示只读 diff/edit/review 状态；不实现 apply/revert 文件写入。
- IM/@Agent 主链操作补强集成提交：`8258983f feat(web): strengthen agent mainchain actions`，在共享 composer 中展示 Agent/Target/Task 状态，缺 Desktop/Edge target 时禁用启动 Agent task，选中 target 后明确按钮语义，并补充消息级 pin 操作入口；不扩展 Hub 持久化 pin 合同。
- SDK event fixture matrix 集成提交：`83059e82 test(edge): add SDK fixture event matrix`，用 Claude/OpenAI SDK-like 静态 JSON 样例覆盖 text/tool/file_change/permission/result/artifact canonical events；不安装 SDK 包、不联网、不运行真实模型/API。

当前不声明已经完成：

- 真实 TokenDanceID 登录全链路验收。
- 真实 CLI/model/API 消耗或 approved-real 运行证据。
- 签名安装器、macOS notarization、release upload、updater metadata。
- Web/Mobile/IM 全部真实远控闭环的发布级验收。

## 当前并发线

| 线程 | 负责人 | 状态 | 边界 |
|---|---|---|---|
| Edge SQLite durable observed smoke | Johnny/backend | 已合入 dev：`63fb6273` | fixture-only alpha durability gate；不代表完整 relational CRUD |
| Desktop sidecar observed smoke | Trump/Desktop | 已合入 dev：`79e1e453` | fixture/mock sidecar 证据；真实打包仍需要 sidecar binary |
| CLI JSON readiness checker | Edge/SDK worker | 已合入 dev：`bf1a7ab5` | 静态/fixture JSON 合同；不运行真实 CLI/model/API |
| Web real-mode visual smoke | Trump/Web | 已推 dev：`e2ee21f0` + `2aff026d` | review branch `origin/codex/p1-web-real-mode-visual-smoke` commit `855c8cea`；改动只在 `app/shared/**`，不碰 Hub/Edge/Desktop/Mobile |
| Hub 单任务 approval/artifact | Johnny/backend | 已集成并验证 controller：`6b5a3e4e` | review branch `origin/codex/p1-hub-task-approval-artifacts` commit `8a76183f`；只改 Hub/API，补 `/web/agent-tasks` approval decision 与 artifact metadata/list 最小合同 |
| Desktop sidecar binary/package smoke | Desktop/Tauri | 已集成并验证 controller：`74660003` | review branch `origin/codex/p1-desktop-sidecar-binary-smoke` commit `f70194c4`；本地 build/placement/smoke gate，不提交二进制、不签名/公证/release upload |
| Edge SQLite durable hardening | Johnny/Edge | 已集成并验证 controller：`fd5fa202` | review branch `origin/codex/p1-edge-sqlite-durable-hardening` commit `28655b25`；fixture-only durable gate，不声明完整 production DB |
| Edge SQLite local store readiness | Edge storage worker | 本 worktree 进行中：`codex/edge-sqlite-store-readiness-next` | local temp SQLite only；新增 readiness report + per-write reopen contract；不跑真实 CLI/model/API，不声明 production row-first CRUD |
| Hub/Event/Replay 合同审计 | Johnny/backend | 已产出报告 | 指向单任务 approval/artifact Hub 合同缺口；后续进入实现 worker |
| Approved-real preflight manifest | worker/Heisenberg | 已集成并验证 controller：`84a39563` | preflight-only manifest gate；不代表真实登录、真实 CLI/model/API 或生产动作完成 |
| Web task approval/artifact consumption | worker/James | 已集成并验证 controller：`d9e174f9` | Web Hub-only 消费单任务 approval/artifact 合同；Playwright 使用 stubbed Hub，不代表真实服务联调 |
| Desktop/Web/Edge 下一轮拓扑审计 | explorer/Cicero | 已产出只读报告 | 推荐下一轮优先 Desktop target-bound observed bridge、Edge fixture adapter runner、macOS unsigned package gate 等独立切片 |
| Edge fixture adapter runner | worker/Harvey | 已集成并验证 controller：`18c1f4cc` | no-spend fake process fixture runner，不代表 approved-real CLI/SDK |
| Hub artifact/diff projection | worker/Archimedes | 已集成并验证 controller：`74f9579a` | Hub 只读投影合同；Web inspector 消费和真实 apply/revert 另行推进 |
| Runtime/provider icons | worker/Nietzsche | 已集成并验证 controller：`6eee0af6` | shared icon resolver/fallback；无截图验证，无大布局改动 |
| Real/Mock boundary | worker/Plato | 已集成并验证 controller：`04aef85c` | shared real-mode 空态/错误态，不改后端合同 |
| Desktop exact target observed bridge | worker/Maxwell | 已集成并验证 controller：`e0a6591c` | fixture/observed target binding，不跑真实 CLI/model/API |
| Tauri package smoke | worker/Curie | 已集成并验证 controller：`29982e85` | readiness/policy + fixture smoke，不做真实签名、公证、release upload |
| SDK fixture capability | worker/Meitner | 已集成并验证 controller：`c49d2ee1` | Edge fixture capability/golden tests，不安装或运行真实 SDK/CLI |
| localhost observed loop gate | worker/Gauss | 已集成并验证 controller：`b9e53b25` | runner/manifest/readiness-only gate，`RealTested=false` |
| localhost services probe | worker/Ptolemy | 已集成并验证 controller：`935704b5` | service probe manifests 和 fail-closed readiness，不启动真实服务 |
| localhost real stack smoke | localhost observed worker | 分支 `codex/localhost-services-real-loop` 已新增脚本/文档/test，待集成 | 启动或探测 Web/Desktop/Hub/Local Edge 的 no-spend 本地服务子集；Local Edge 使用 `agenthub-runner-mock` + SQLite，`RealTested=false` |
| approved-real/no-secret demo readiness | Codex approved-real demo worker | 本 worktree 进行中：`codex/approved-real-demo-readiness` | 统一 runner 串联 localhost observed fixture replay、可选 localhost real-stack smoke、approved-real preflight 读取和 redacted manifest；默认 `READY_FOR_APPROVAL`/`BLOCKED`，`RealLoginTested=false`、`RealCliTested=false`、`MockAdapterUsed=true`，不跑真实登录/CLI/model/API，不碰 Mobile |
| Agent Builder fixture UI | worker/Franklin | 已集成并验证 controller：`6c855195` | Desktop Builder fixture/no-spend evidence，可见但不声明 live SDK execution |
| Web artifact/diff inspector | worker/Erdos | 已集成并验证 controller：`01ff715d` | Web/shared 只读消费 Hub file-change diff metadata；不实现 apply/revert |
| IM/@Agent mainchain UX | worker/Raman | 已集成并验证 controller：`8258983f` | Agent/Target/Task 状态和消息 pin UI；不扩展 Hub pin 持久化 |
| SDK event fixture matrix | worker/Hegel | 已集成并验证 controller：`83059e82` | Claude/OpenAI SDK-like 离线事件矩阵；不安装 SDK、不跑真实模型/API |
| State/worktree 审计 | state auditor | 已产出只读报告 | 给出 merged-clean、dirty/manual-confirm、active lane 和 `edge-sql-store` 异常建议；不删除 |
| Mobile | Trump/mobile | 独立收口 | `codex/mobile-expo-rn-plan` 已保存进度；主控只在协议漂移时介入 |

## 分支治理

- 新实现必须从最新 `origin/dev/delicious233` 开隔离 worktree，不在主工作树开发。
- Worker 不直接推 `dev/delicious233`、`master` 或 tag。
- Controller 负责最终集成、验证、fast-forward/push。
- 已合入或过时 worktree 只能在只读审计确认后逐个归档，不能一把删除。
- `v0.3.0-rc.6` 已存在，保留为稳定 RC 基线；后续 tag 需先通过独立 release gate。

## 下一步优先级

1. **真实 TokenDanceID 登录打通**：先跑 no-secret readiness gates，再用一次性测试账号和已批准环境运行真实登录链路，不把 secret 写入仓库。
2. **approved-real 录屏前审批**：先运行 `scripts\verify-approved-real-demo-readiness.ps1` 产出 redacted manifest；若状态是 `READY_FOR_APPROVAL`，再由人工批准真实 TokenDanceID 测试账号/安全 env、录屏范围和是否允许真实 CLI/model/API。无批准时只能演示 fixture/mock replay。
3. **localhost observed service runner 升级**：在现有 no-spend manifest gate 上，逐步加入可启动的 Web dev server、Local Edge mock/SQLite 和 Hub health/service probe。
4. **Windows/Tauri unsigned package smoke**：验证 sidecar binary、no-bundle build 和 unsigned installer readiness；签名、公证、release upload 另行推进。
5. **受控 approved-real CLI/SDK 方案**：已具备 preflight manifest gate；真实 CLI/model/API 消耗、部署和签名仍必须另获批准。

## 安全规则

- Web 只连接 Hub，不直接连接 Local Edge 或 raw runtime。
- Desktop renderer 不获得 raw process execution 权限。
- Mock、fixture、observed、approved-real、production 必须显式区分。
- 未获明确审批，不跑真实登录、真实模型消耗、部署、签名、公证、updater、release upload。
- Roadmap 只写路线；当前事实写在本文。
