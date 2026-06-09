# AgentHub 当前状态

最后更新：2026-06-09 08:37 +08:00

本文记录当前事实、分支治理和任务分配。长期路线写在
`docs/roadmap.md`。

## 当前 Baseline

| 项目 | 当前事实 |
|---|---|
| 稳定 dev | `origin/dev/delicious233 = 19079563`，已打 `v0.3.0-rc.5` |
| 当前集成分支 | `origin/codex/p1-critical-evidence-integration = a4dfa628` |
| 集成分支相对 dev | `ahead 85 / behind 0` |
| master | `origin/master = f3b91ab0`；集成分支相对 master 是 `ahead 272 / behind 1` |
| 主工作树 | `D:\Code\TokenDance\AgentHub` 过时且有 dirty 风险，当前隔离不用 |
| Git 维护风险 | auto-gc 报 `fatal: bad tree object fff550960821b6454a476d755465c71d9deaa258` |

## 当前集成候选包含内容

当前集成分支已经包含 P0/P1 远程控制证据线：

- Hub 精确 target 和 Edge dispatch proof。
- Desktop Profile/Target readiness、Local Edge sidecar diagnostics。
- Edge CLI/SDK fixture contract、脱敏、trace refs、real-tested guard。
- Web target labels、selected-run replay、明确 real/mock/no-target 状态。
- Local product-loop、localhost product-loop、approved-real evidence verifier、OIDC readiness、Web deploy readiness、Tauri package readiness gates。
- Edge SQLite row-first store alpha。
- LobeHub runtime/provider icons 和 fallback 覆盖。

当前不声明：公开部署、签名安装器、macOS notarization、真实 TokenDanceID 证明、
默认真实模型/CLI 消耗。

## 分支治理

| 分支 | 负责人 | 用途 | 规则 |
|---|---|---|---|
| `codex/p1-critical-evidence-integration` | Controller Codex | 当前集成候选和 gate 分支 | 只推 controller 审核后的提交；worker 不直接改 Roadmap/STATE。 |
| `dev/delicious233` | Controller Codex | 开发 baseline | 最低 gate 通过后，从干净集成分支 fast-forward。 |
| `master` | Controller Codex | 稳定发布分支 | 先检查 master-only commit，不 force push。 |
| `v0.3.0-rc.6` | 需要发布审批 | 下一个 rc tag 候选 | 未获明确审批前不创建、不推送。 |

## 任务分配包

用户是顶层产品负责人。Controller Codex 向用户负责，并协调 Trump、
Johnny、Mobile 负责人、Evidence/docs 负责人和 subagent。

### Controller Codex

职责：保持 baseline 干净，控制合并顺序，完成最终验证，协调所有实现线。

分支：

| 分支 | 用途 |
|---|---|
| `codex/p1-critical-evidence-integration` | 当前 controller 集成分支，只用于 gate 和 promoted baseline。 |
| `codex/p0-desktop-tauri-edge-build` | Desktop/Tauri/Local Edge 可用构建。 |
| `codex/p0-product-loop-qa` | Web/backend/Desktop slice 合入后运行完整组合链路回归。 |

任务：

1. 在 `codex/p1-critical-evidence-integration` 上重跑最低 gate。
2. gate 通过后，将 `dev/delicious233` fast-forward 到干净集成分支。
3. 提升 master 前先检查 `origin/master` 独有提交。
4. 负责 Desktop 启动流、Local Edge sidecar 启动/诊断、日志/app-data 持久、Windows unsigned package smoke。
5. Trump 和 Johnny slice 可用后启动 QA 分支。

### Trump

职责：Web 和 shared 前端产品体验。

分支：

| 分支 | 用途 | 写入范围 |
|---|---|---|
| `codex/p0-web-agent-main-chain` | IM/@Agent 入口、目标选择、启动运行、target health、mock/real 标签 | `app/web/**`、`app/shared/**` |
| `codex/p0-web-transcript-artifacts` | typed transcript blocks 和最小 artifact/diff/preview cards | `app/shared/**`、`app/web/**` tests |

任务：

1. 做一屏 Web 主链：Agent/联系人式入口、target picker、run start、route/run status、replay panel。
2. 渲染 target health：no target、offline、degraded、ready、wrong profile、signed out。
3. 明确 mock/fixture/observed/approved-real 模式；real mode 不得静默 fallback 到 mock。
4. 渲染 typed transcript blocks：route decision、subtask、permission request/result、file change、tool result、artifact、preview、failure、finished。
5. artifact/diff/preview cards 只基于现有事件合同或 Johnny 提供的新合同实现。
6. 不改 backend schema、Hub handler、Edge handler。

建议验证：

```powershell
corepack.cmd pnpm --dir app\web typecheck
corepack.cmd pnpm --dir app\web exec vitest run --reporter=dot
corepack.cmd pnpm --dir app\shared exec vitest run src\workbench\AgentHubWorkbench.test.tsx --reporter=dot
```

### Johnny

职责：Hub、Edge、事件合同、dispatch、permission、持久化运行状态。

分支：

| 分支 | 用途 | 写入范围 |
|---|---|---|
| `codex/p0-hub-edge-approval-loop` | Permission request/approve/deny 生命周期和 replay events | `hub-server/**`、`edge-server/**`、`api/**` |
| `codex/p0-target-health-inventory` | target/runtime health contract 和 Desktop/Hub sync | `hub-server/**`、`edge-server/**`、`api/**`，必要时窄范围 `app/desktop/**` bridge tests |
| `codex/p1-edge-sqlite-durability` | Edge SQLite 从 alpha 推到 guarded durability candidate | `edge-server/internal/store/**`、Edge tests |
| `codex/p1-agent-sdk-custom-runtime` | OpenAI/Claude/custom Agent runtime registry 和 adapter path | `edge-server/internal/adapters/**`、`api/**`、聚焦 docs |

任务：

1. 实现 permission request/approve/deny/timeout/cancel/resume/abort events 和 replay。
2. 确保 Edge 等待 permission decision 时不绕过 policy，也不会无限挂起。
3. 收紧 target health 字段：target ID、Edge device ID、runtime、workspace、profile、last seen、degraded reasons。
4. 保持 Web Hub-only；Web 不直接连接 Local Edge。
5. approval 和 health contract 稳定后再推进 SQLite durability。
6. 把 OpenAI/Claude/custom agents 映射进现有 adapter contract，不把 provider policy 写死。

建议验证：

```powershell
cd hub-server
go test ./... -short -count=1
cd ..\edge-server
go test ./... -short -count=1
cd ..
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-live-chain-topology.ps1 -RepoRoot .
```

## Controller 下一步

1. 提交并推送 `docs/roadmap.md` 和 `STATE.md`。
2. 在集成 worktree 重跑最低 gate。
3. 若干净，将 `dev/delicious233` fast-forward 到集成分支。
4. 检查 master-only commit，用受控 merge/promote 路径推进 master。
5. 从新 baseline 启动下一轮 worker。

## 安全规则

- 不在 dirty 主工作树开发。
- 不 force push `dev`、`master` 或 tag。
- 未获明确发布审批，不创建/推送 `v0.3.0-rc.6`。
- 未获明确审批，不跑真实登录、真实模型消耗、部署、签名、公证、updater、release upload。
- 未获明确审批，不对 bad-tree 问题做 destructive git maintenance。
- Mobile 由线程 `019ea616-0dbf-7263-a785-87fdb2e9d8a4` 负责；这里只协调协议漂移。
