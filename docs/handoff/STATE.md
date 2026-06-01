# AgentHub 项目状态

最后更新：2026-06-01 UTC+8 | 分支：dev/delicious233 | 本轮：Ultracode 大规模并行开发

> **2026-06-01 Ultracode 全维度并行推进**：本轮 5 个 Workflow + 5 个独立 Agent 并行审计与开发，覆盖 Web 前端 P0、Go 后端竞品对比、Desktop 前端竞品对比、Mobile/Shared/i18n 审计、OIDC/TeamRun smoke test、Desktop ChatView 同步、分支与脏文件审计、比赛材料整理。

## 本轮团队产出

| 类型 | 名称 | 维度 | 修复 | 状态 |
|------|------|:--:|:--:|:--:|
| Workflow | web-frontend-p0-sprint | 7 | 7/7 | ✅ |
| Workflow | backend-competitor-optimize | 5 | 14/16 | ✅ |
| Workflow | desktop-frontend-optimize | 5 | 23/23 | ✅ |
| Workflow | mobile-shared-audit | 3 | 17/17 | ✅ |
| Workflow | deep-research | 比赛策略 | — | ✅ |
| Agent | oidc-smoke-test | 14 子测试 | 14 | ✅ |
| Agent | teamrun-smoke-test | 11 子测试 | 11 | ✅ |
| Agent | desktop-chatview-sync | 6 组件 | 6 | ✅ |
| Agent | fix-desktop-test-regressions | 28 回归 | 28 | ✅ |
| Agent | audit-agenthub-git | 分支/Worktree | — | ✅ |
| Agent | audit-bytedance-wiring | 8 场景 | — | ✅ |
| Agent | move-competition-docs | 仓库清理 | — | ✅ |

## P0 必修项（bytedance 终审）— 全部完成

| # | 项目 | 证据 |
|---|------|------|
| P0-1 | RunDetail 消费 getTaskRunEventSummary | `app/web/src/components/RunDetail.tsx` — 6 项指标 (Steps/Elapsed/Tokens/Approvals/Artifacts) |
| P0-2 | ChatView 新 block types | `app/web/src/components/ChatView.types.ts` + ApprovalCard/ArtifactCard/DeployCard/LinkCard |
| P0-3 | Web IMView pin/archive/search/sort | `app/web/src/views/IMView.tsx` + IMSearchBar/IMSessionActions |
| P0-4 | 上下文连续性通用化 | `edge-server/internal/runnerctx/context_budget.go` — BuildContextPreface + 3 adapter 注入 |
| P0-5 | Web WS 重连恢复 | `app/web/src/stores/connectionStore.ts` + `useHubWSConnection.ts` + `WebLayout.tsx` 恢复编排 |
| P0-6 | deploy_card/link_card 渲染 | DeployCard + LinkCard 组件，ChatView block switch 分支 |
| P0-7 | ApprovalCard + 审批 UI | ApprovalCard 组件 + ChatView 渲染 + RunDetail 审批统计 |
| — | Desktop ChatView 同步 | 6 新组件 (ApprovalCard/ArtifactCard/DeployCard/LinkCard/ArtifactPreview/ReplyPreviewBar) |
| — | OIDC 烟雾测试 | `hub-server/tests/oidc/oidc_smoke_test.go` — 14/14 通过 |
| — | TeamRun smoke test | `hub-server/tests/teamrun/teamrun_smoke_test.go` — 11 子测试 |

## 8 个执行场景覆盖率

| 场景 | 状态 | 难度 |
|------|:--:|:--:|
| 1. Desktop 本地离线 | **可运行** | — |
| 2. Desktop 本地在线 Hub | 代码完整，缺部署态 smoke | 简单 |
| 3. SSH 远程 Desktop | 未实现（仅模型常量） | 困难 |
| 4. Desktop Relay 远程 | Relay 基础设施存在但未接线 task 路由 | 中等 |
| 5. Desktop 直连云 | 未实现 | 困难 |
| 6. Desktop Relay 到云 | 未实现（依赖 4+5） | 困难 |
| 7. Web → Desktop 最小闭环 | 代码完整，缺部署态 smoke | 简单-中等 |
| 8. Web → Cloud | 未实现 | 困难 |

## 测试状态

| 层级 | 总数 | 通过 | 状态 |
|------|:--:|:--:|:--:|
| Web Vitest | 45 | 45 | 🟢 |
| Desktop Vitest | 1115 | 1115 | 🟢 (回归已修复) |
| Go OIDC smoke (独立子包) | 14 | 14 | 🟢 |
| Go TeamRun smoke (独立子包) | 11 | 11 | 🟢 |
| Go tests/ (需 PG+Redis) | — | — | 🔴 TestMain 连真实 PG |

## 仓库状态

| 项目 | 数量 |
|------|:--:|
| 主分支 | dev/delicious233 (ahead 62, behind 20) |
| 本地分支 | 10 个 |
| Worktree | 3 个 (主 + AgentHub-backend-device-uuid + AgentHub-desktop-clean) |
| Stash | 3 个 |
| 脏文件 | ~317 个 (201 modified + 114 untracked) — 本轮的开发产出 |

## 已知待办

- [ ] 整理 317 个脏文件（分类 + 提交或清理）
- [ ] dev/delicious233 推送 62 ahead + rebase 20 behind
- [ ] master 更新 182 behind
- [ ] 两 Worktree 分支合并/清理（device-uuid, desktop-clean）
- [ ] 3 个 stash 处理（应用/分支/删除）
- [ ] Hub server WSL Docker 真实运行验证（Go in WSL 编译通过，待启动测试）
- [ ] 场景 2、7 部署态 smoke test
- [ ] 场景 3-6、8 开发或降级为"规划中"
- [ ] 比赛材料 → `D:\Code\TokenDance\docs\competition\`（已移出 AgentHub 仓库）
- [ ] 删除 `tmp_redis_debug.go` 等调试文件
