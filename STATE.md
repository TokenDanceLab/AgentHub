# AgentHub 当前状态

最后更新：2026-06-09 14:39 +08:00

本文只记录当前事实、分支治理和任务调度。长期路线图写在
`docs/roadmap.md`，不要把提交 SHA、工作区状态或临时派工写进路线图。

## 当前 Baseline

| 项目 | 当前事实 |
|---|---|
| 当前 dev | `origin/dev/delicious233 = 2aff026d docs(state): record web visual smoke integration` |
| 最新 dev 内容 | P0 Desktop/QA、P0 Web 主链/typed transcript、Web offline target dispatch guard、Web approval/evidence、Edge SQLite observed smoke、Desktop sidecar observed smoke、CLI JSON readiness gate、P1 并发拓扑/Edge durable 状态同步、Web real-mode visual smoke 集成已合入 |
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
| Hub 单任务 approval/artifact | Johnny/backend | 运行中：thread `019eab05-39ef-7b70-bece-4b2a853fe9e8` | 只改 Hub/API；补 `/web/agent-tasks` approval decision 与 artifact metadata/list 最小合同 |
| Desktop sidecar binary/package smoke | Desktop/Tauri | 已集成 controller：`74660003`，待验证/推 dev | review branch `origin/codex/p1-desktop-sidecar-binary-smoke` commit `f70194c4`；本地 build/placement/smoke gate，不提交二进制、不签名/公证/release upload |
| Edge SQLite durable hardening | Johnny/Edge | 已集成 controller：cherry-pick 进行中，待验证/推 dev | review branch `origin/codex/p1-edge-sqlite-durable-hardening` commit `28655b25`；fixture-only durable gate，不声明完整 production DB |
| Hub/Event/Replay 合同审计 | Johnny/backend | 已产出报告 | 指向单任务 approval/artifact Hub 合同缺口；后续进入实现 worker |
| State/worktree 审计 | state auditor | 已产出只读报告 | 给出 merged-clean、dirty/manual-confirm、active lane 和 `edge-sql-store` 异常建议；不删除 |
| Mobile | Trump/mobile | 独立收口 | `codex/mobile-expo-rn-plan` 已保存进度；主控只在协议漂移时介入 |

## 分支治理

- 新实现必须从最新 `origin/dev/delicious233` 开隔离 worktree，不在主工作树开发。
- Worker 不直接推 `dev/delicious233`、`master` 或 tag。
- Controller 负责最终集成、验证、fast-forward/push。
- 已合入或过时 worktree 只能在只读审计确认后逐个归档，不能一把删除。
- `v0.3.0-rc.6` 已存在，保留为稳定 RC 基线；后续 tag 需先通过独立 release gate。

## 下一步优先级

1. **Desktop/Tauri sidecar binary smoke 集成**：review branch `codex/p1-desktop-sidecar-binary-smoke` 已 ready，优先审查并合入 Windows 本地 sidecar placement/readiness 证据。
2. **Edge SQLite durable hardening 集成**：review branch `codex/p1-edge-sqlite-durable-hardening` 已 ready，审查并合入 approval/artifact/replay/pins 重启恢复 fixture-only gate。
3. **Hub 单任务 approval/artifact 合同**：worker 已推 review branch，等最终 AH-SYNC 后审查合入，支撑 Web/Mobile/IM 单任务审批与产物列表。
4. **组合链路 observed E2E**：等 Web + Hub approval/artifact + Desktop sidecar binary smoke 回来后，开单一 product-loop worktree，验证 Web -> Hub -> Desktop -> Edge -> adapter fixture -> replay -> Web。
5. **受控 approved-real 方案**：先形成审批清单和成本/凭据边界；真实登录、真实 CLI/model/API 消耗、部署和签名必须另获批准。

## 安全规则

- Web 只连接 Hub，不直接连接 Local Edge 或 raw runtime。
- Desktop renderer 不获得 raw process execution 权限。
- Mock、fixture、observed、approved-real、production 必须显式区分。
- 未获明确审批，不跑真实登录、真实模型消耗、部署、签名、公证、updater、release upload。
- Roadmap 只写路线；当前事实写在本文。
