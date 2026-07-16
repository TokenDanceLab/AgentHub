# MASTER — AgentHub Cleanup Baseline

最后更新：2026-07-16  
Mode：`LOCAL_ONLY`（GitHub Issues 稍后由 lead 批量创建）  
Worktree：`.worktrees/cleanup-baseline`  
Branch：`chore/cleanup-baseline`（from `master@dbb808f2`）

## Task

把 AgentHub 从「可运行但叙事漂移 + god-file 债务 + 安全半接线」收敛到**清晰可接手基线**：

1. 知识可编译（轻量 `wiki/`，非第二 SSOT）
2. 卫生/叙事对齐（生产 LIVE vs CI decommissioned 漂移）
3. Strangler 清理切片（前端去重 → Edge 切分 → Hub/Edge 安全闭环）

**不做 big-bang 重写。**

## Authority

| 面 | 位置 |
|---|---|
| 产品规则 SSOT | `AGENTS.md` |
| 架构 SSOT | `docs/architecture.md` + `docs/architecture/` |
| API SSOT | `api/openapi.yaml` + `api/events.md` |
| 风险 SSOT | `docs/governance/security-risk-register.md` |
| 生产运维 SSOT | server `projects/agenthub/STATE.md`（hk3 LIVE） |
| 本专项进度 | 本文件 |
| 编译知识（非 SSOT） | `wiki/` |

## Analysis Inputs

- `docs/analysis/_raw_lane_results.json`（Architecture / Edge / Hub / Frontend / Risks）
- 待合成：`docs/analysis/project-overview.md` / `module-inventory.md` / `risk-assessment.md` / `cleanup-strategy.md`
- 待补充：`docs/analysis/frontend-dedupe-plan.md`

## Phases

- [ ] Phase 0: Analysis & strategy 落盘（Workflow: analysis-synthesize）
- [ ] Phase 1: P0 卫生与叙事对齐（Workflow: p0-hygiene）
- [ ] Phase 2: 轻量 llmwiki 种子（Workflow: llmwiki-bootstrap）
- [ ] Phase 3: 前端去重 strangler 计划与首切片（scout → implement）
- [ ] Phase 4: Edge god-file 提取 + capability/outbox seams
- [ ] Phase 5: Hub delivery/auth 安全闭环 + 证据等级

## Active Workflow Teams

| Team | Run | Model mix | Status |
|---|---|---|---|
| analysis-synthesize | `wf_167bbeb0-1e7` | fable + sonnet | running |
| llmwiki-bootstrap | `wf_69cf45c8-3a5` | fable + sonnet | running |
| p0-hygiene | `wf_9e2320c0-edf` | sonnet + fable | running |
| frontend-dedupe-scout | `wf_0521a2d3-baf` | fable + sonnet | running |

## Current Status

- Phase 0：**analysis 四件套已落盘**（project-overview / module-inventory / risk-assessment / cleanup-strategy + frontend-dedupe-plan）
- Phase 1：**P0 hygiene 补丁已写入 worktree**（checks.yml 去 decommission 叙事、risk 046/049 partial、deploy pointer、production compose 注释）
- Phase 2：**wiki 骨架与 10 页种子已生成**（index 链接名可能需 lint 对齐）
- Phase 3：**frontend-dedupe-plan 已写**（shared hubClient SSOT；Settings/TeamRun 孤儿分叉）
- 生产事实锁定 **hk3 LIVE**；主树 `docs/analysis` 污染已清，工作只在 worktree

下一跳：等剩余 Workflow 收尾 → wiki lint 修链 → `git diff --check` → 小步 commit → 发射实现 fleets

## Non-negotiables

1. Web 不直连 Local Edge；UI 不直接 spawn CLI
2. TokenDance ID 只证身份；Hub 本地授权
3. Mock/fixture/observed/approved-real 证据等级显式
4. 不提交 secrets / 私有主机 / 生产 token
5. 不在 `master` 直接改；合并路径 `chore/*` → `dev/delicious233` 或 PR → `master`（按仓库惯例）

## Next Steps (lead)

1. 等待/验收 4 个 Workflow 输出
2. `git diff --check` + 人工扫 false decommission claims
3. 提交 docs/wiki/hygiene 基线
4. 发射实现向 Workflow：frontend hubClient 收敛切片、Edge handlers 路由拆分勘察
