# AgentHub 当前状态

最后更新：2026-06-09 11:03 +08:00

本文只记录当前事实、分支治理和任务调度。长期路线图写在
`docs/roadmap.md`，不要把提交 SHA、工作区状态或临时派工写进路线图。

## 当前 Baseline

| 项目 | 当前事实 |
|---|---|
| 当前 dev | 以 `origin/dev/delicious233` 最新提交为准；P0 实现基线为 `249c4a21`，本文所在提交是其后的状态同步 |
| 最新 dev 内容 | P0 Desktop/QA、P0 Web 主链/typed transcript、Web offline target dispatch guard 和状态同步已合入 |
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

当前不声明已经完成：

- 真实 TokenDanceID 登录全链路验收。
- 真实 CLI/model/API 消耗或 approved-real 运行证据。
- 签名安装器、macOS notarization、release upload、updater metadata。
- Web/Mobile/IM 全部真实远控闭环的发布级验收。

## 当前并发线

| 线程 | 负责人 | 状态 | 边界 |
|---|---|---|---|
| Edge SQLite durable 复核 | Johnny/backend | 运行中 | 先确认主线 SQLite 是否只需验证/收口；不重复 cherry-pick 旧分支 |
| Desktop/Tauri 复核 | Trump/Desktop | 运行中 | 只读评估 Desktop Edge mapper、unsigned package smoke、macOS 风险 |
| SDK/runtime 研究 | SDK researcher | 运行中 | 输出 Claude/OpenAI Agent SDK、自定义 runtime、Lobe icons 具体报告 |
| State/worktree 审计 | state auditor | 运行中 | 只读整理 worktree/branch，给出清理候选；不删除 |
| Mobile | Trump/mobile | 独立收口 | `codex/mobile-expo-rn-plan` 已保存进度；主控只在协议漂移时介入 |

## 分支治理

- 新实现必须从最新 `origin/dev/delicious233` 开隔离 worktree，不在主工作树开发。
- Worker 不直接推 `dev/delicious233`、`master` 或 tag。
- Controller 负责最终集成、验证、fast-forward/push。
- 已合入或过时 worktree 只能在只读审计确认后逐个归档，不能一把删除。
- `v0.3.0-rc.6` 已存在，保留为稳定 RC 基线；后续 tag 需先通过独立 release gate。

## 下一步优先级

1. **真实产品闭环验收**：在 fixture gate 之外，准备受控 observed/approved-real 路径，验证 Web -> Hub -> Desktop -> Edge -> adapter -> replay -> Web。
2. **Desktop/Tauri 可安装可启动**：先做 Windows unsigned package smoke，再拆 macOS sidecar/app-data/signing/notarization 风险。
3. **Edge SQLite durable 收口**：基于当前 dev 已有 SQLite store 做迁移/重启/packaged-sidecar 证据，不重复实现旧分支。
4. **Web real-mode 继续收口**：Projects、Targets、Runs、Approvals、Artifacts 全部保持 Hub-only，不静默 fallback mock。
5. **SDK/custom runtime**：先做 manifest/registry/fixture contract 和图标专业化；真实 SDK/API 调用放到批准后的独立切片。

## 安全规则

- Web 只连接 Hub，不直接连接 Local Edge 或 raw runtime。
- Desktop renderer 不获得 raw process execution 权限。
- Mock、fixture、observed、approved-real、production 必须显式区分。
- 未获明确审批，不跑真实登录、真实模型消耗、部署、签名、公证、updater、release upload。
- Roadmap 只写路线；当前事实写在本文。
