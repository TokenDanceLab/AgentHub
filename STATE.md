# AgentHub 当前状态

最后更新：2026-06-09 15:32 +08:00

本文只记录当前事实、分支治理和任务调度。长期路线图写在
`docs/roadmap.md`，不要把提交 SHA、工作区状态或临时派工写进路线图。

## 当前 Baseline

| 项目 | 当前事实 |
|---|---|
| 当前 dev | controller 集成批次已包含 Web visual smoke、Desktop sidecar binary smoke、Edge SQLite durable hardening、Hub 单任务 approval/artifact 合同、Product-loop observed fixture E2E gate、approved-real preflight manifest gate、Web 单任务 approval/artifact contract 消费；远端 HEAD 以 `git log -1 origin/dev/delicious233` 为准 |
| 最新 dev 内容 | P0 Desktop/QA、P0 Web 主链/typed transcript、Web offline target dispatch guard、Web approval/evidence、Edge SQLite observed smoke、Desktop sidecar observed smoke、CLI JSON readiness gate、P1 并发拓扑/Edge durable 状态同步、Web real-mode visual smoke、Desktop sidecar binary smoke、Edge SQLite durable hardening、Hub 单任务 approval/artifact 合同、Product-loop observed fixture E2E gate、approved-real preflight manifest gate、Web task approval/artifact contract consumption |
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
| Hub/Event/Replay 合同审计 | Johnny/backend | 已产出报告 | 指向单任务 approval/artifact Hub 合同缺口；后续进入实现 worker |
| Approved-real preflight manifest | worker/Heisenberg | 已集成并验证 controller：`84a39563` | preflight-only manifest gate；不代表真实登录、真实 CLI/model/API 或生产动作完成 |
| Web task approval/artifact consumption | worker/James | 已集成并验证 controller：`d9e174f9` | Web Hub-only 消费单任务 approval/artifact 合同；Playwright 使用 stubbed Hub，不代表真实服务联调 |
| Desktop/Web/Edge 下一轮拓扑审计 | explorer/Cicero | 已产出只读报告 | 推荐下一轮优先 Desktop target-bound observed bridge、Edge fixture adapter runner、macOS unsigned package gate 等独立切片 |
| State/worktree 审计 | state auditor | 已产出只读报告 | 给出 merged-clean、dirty/manual-confirm、active lane 和 `edge-sql-store` 异常建议；不删除 |
| Mobile | Trump/mobile | 独立收口 | `codex/mobile-expo-rn-plan` 已保存进度；主控只在协议漂移时介入 |

## 分支治理

- 新实现必须从最新 `origin/dev/delicious233` 开隔离 worktree，不在主工作树开发。
- Worker 不直接推 `dev/delicious233`、`master` 或 tag。
- Controller 负责最终集成、验证、fast-forward/push。
- 已合入或过时 worktree 只能在只读审计确认后逐个归档，不能一把删除。
- `v0.3.0-rc.6` 已存在，保留为稳定 RC 基线；后续 tag 需先通过独立 release gate。

## 下一步优先级

1. **Desktop target-bound observed bridge**：把 Hub exact target/device dispatch 与 Desktop Local Edge sidecar observed 证据绑定，证明远控落到指定 Desktop，不启动真实 CLI/model。
2. **Edge executable fixture adapter runner**：在 no-spend fixture 内把 CLI/SDK adapter 的 process/event/parser/approval/artifact 合同收紧，为 approved-real 做前置。
3. **真实本地服务 observed loop**：在不消耗真实模型、不部署的前提下，逐步把 Web、Hub、Desktop sidecar、Local Edge 从 fixture gate 推进到 localhost observed gate。
4. **受控 approved-real 方案**：已具备 preflight manifest gate；真实登录、真实 CLI/model/API 消耗、部署和签名仍必须另获批准。

## 安全规则

- Web 只连接 Hub，不直接连接 Local Edge 或 raw runtime。
- Desktop renderer 不获得 raw process execution 权限。
- Mock、fixture、observed、approved-real、production 必须显式区分。
- 未获明确审批，不跑真实登录、真实模型消耗、部署、签名、公证、updater、release upload。
- Roadmap 只写路线；当前事实写在本文。
