---
id: cleanup-playbook
title: Strangler 清理剧本：阶段、验证脊、禁止操作
type: overview
status: active
updated: 2026-07-16
sources:
  - AGENTS.md
  - docs/architecture.md
  - docs/decisions.md
  - docs/governance/security-risk-register.md
  - docs/progress/MASTER.md
  - docs/roadmap.md
tags:
  - cleanup
  - strangler-fig
  - verification
  - governance
  - playbook
related:
  - agenthub-cleanup-overview
  - hub-edge-overview
  - ssot-map
  - production-live-hk3
  - ci-decommission-drift
  - risk-ah-sr-register
  - risk-evid-grade-confusion
  - risk-session-secret-boundary
  - decision-wiki-is-compiled
  - decision-incremental-cleanup
  - decision-production-live-narrative
summary: >
  Strangler 五个阶段（分析落盘 → P0 卫生 → wiki 编译 → Strangler 切片 → 安全闭环），
  每条相位的验证脊（git diff --check + 表面验收 + verify 脚本 + Go/前端测试矩阵），
  以及绝对不能做的事（无 SPEC 大改、复制 switch 测试、fixture 冒充 production）。
---

# 清理剧本

AgentHub cleanup-baseline 专项不搞 big-bang 重写。用 **Strangler Fig** 模式：在不动整体结构的前提下，逐片对齐 SSOT、消除漂移、封闭安全缺口。本页是五个阶段的执行剧本，并明确验证脊和禁区。

SSOT 事实源参见 [[ssot-map]]；架构边界参见 [[hub-edge-overview]]；清理总览参见 [[agenthub-cleanup-overview]]。

## 五个阶段

| Phase | 目标 | 产出 | 状态 |
|---|---|---|---|
| **Phase 0**: Analysis & strategy | 多 lane 分析落盘，确认清理切片优先级 | `docs/analysis/` 下的模块清单、风险评估、清理策略 | running |
| **Phase 1**: P0 卫生与叙事对齐 | 消除 CI/docs 中的虚假 "decommissioned" 措辞，锁定 hk3 LIVE | 生产叙事对齐、CI 注释修正、deploy image/template 命名收敛 | running |
| **Phase 2**: 轻量 llmwiki 种子 | 编译知识层，提供 agent/human 快速定位入口 | `wiki/` 树：overview + module + flow + hotspot + risk + decision + ops-pointer | running |
| **Phase 3**: Strangler 切片 — 前端去重 | 收敛 Desktop/Web 重复 UI 和 adapter 逻辑到 `app/shared/` | hubClient 收敛切片 → 组件去重 → platform adapter 对齐 | 待开始 |
| **Phase 4**: Strangler 切片 — Edge 拆分 | 从 god-file 提取 capability/outbox seams | handler 路由拆分、outbox/journal 接口、lifecycle 提取 | 待开始 |
| **Phase 5**: Hub/Edge 安全闭环 | 关闭 open High/Critical 风险，补齐证据等级 | delivery contract、per-run capability、OIDC browser login 证据 | 待开始 |

### Phase 0 — 分析落盘

- 输入：`docs/analysis/_raw_lane_results.json`（Architecture / Edge / Hub / Frontend / Risks 五个 lane）
- 合成：`project-overview.md` / `module-inventory.md` / `risk-assessment.md` / `cleanup-strategy.md`
- 产出用于决定 Phase 3-5 的切片顺序和范围

### Phase 1 — P0 卫生与叙事对齐

关键事实已在 MASTER 中锁定：

> **生产 Hub 是 LIVE on hk3。** CI 和工作流注释中仍写 "runtime decommissioned" 属于 **DRIFT**，不是权威。

- 修正 `.github/workflows/` 中的 decommission 措辞 → 参见 [[ci-decommission-drift]]
- 统一 deploy image name（hub vs hub-server）→ 参见 [[deploy-image-name-divergence]]
- 指定唯一 production compose 模板入口 → 参见 [[deploy-template-divergence]]
- 将 `edge-server/internal/runners` 标记为兼容摘要包，不作为新 Agent 业务模型 → 参见 [[edge-runners-compat]]

### Phase 2 — wiki 编译

遵循 [[decision-wiki-is-compiled]]：wiki 是编译知识，非第二 SSOT。编译要点：

- 每页必须指向 SSOT sources，不自创规则
- 区分证据等级（fixture / readiness-only / observed / approved-real / production）
- ops 页面只写指针，不复制 secret / 私有路径 → 参见 [[ops-evidence-boundary]]

### Phase 3 — 前端 Strangler 切片

入口：`app/shared/` 是 Desktop/Web 的唯一共享 UI 层。

具体步骤：
1. **scout**：扫描 Desktop/Web 中重复的 hubClient / adapter / UI 组件副本
2. **slice**：将一份重复实现提取到 `app/shared/`，两端改为 import
3. **verify**：两端 Playwright + Visual QA，主视口 `1440x810`
4. **commit**：小步提交，每个切片一个 commit
5. **repeat**：逐片推进，不搞一次大迁移

目标模块参见：
- [[module-shared-workbench]] — 共享合同
- [[module-desktop]] — Tauri Desktop 路径
- [[module-web]] — Hub-only Web 路径
- [[flow-control-run]] — 控制线
- [[flow-event-transcript]] — 事件线

### Phase 4 — Edge god-file 拆分

- 从当前 `edge-server/` 提取 handler 路由拆分
- 建立 outbox/journal 接口（对应 ADR-016: delivery outbox / ACK / retry / dead-letter）
- 保持 adapter 接口不变，只改内部结构

### Phase 5 — 安全闭环

对准 `docs/governance/security-risk-register.md` 中的 open High/Critical 项：

| 风险 ID | 关闭动作 |
|---|---|
| AH-SR-028 | 轮换所有部署实例 Hub JWT secret |
| AH-SR-035 | 完成 staging/prod OIDC browser login 证据 |
| AH-SR-036 | 完成 Desktop login/logout/reconnect 闭环证据 |
| AH-SR-037 | Web session 从 sessionStorage 迁移到 server-owned session |
| AH-SR-045 | Remote Edge read API scoped authorization |
| AH-SR-046 | Per-run capability token + negative tests |
| AH-SR-048 | Runtime/debug log 脱敏 smoke |
| AH-SR-049 | Hub-Edge durable delivery contract |

完整风险登记参见 [[risk-ah-sr-register]]。

## 验证脊

所有变更必须通过以下验证链。无论哪个 Phase，不允许跳过。

### 全阶段基础验证

```powershell
git diff --check
git status --short --branch
```

### 文档/API 变更

```powershell
pwsh ./scripts/verify/verify-doc-ssot.ps1
python -c "import yaml, pathlib; yaml.safe_load(pathlib.Path('api/openapi.yaml').read_text(encoding='utf-8')); print('yaml ok')"
```

### Go 变更（按 touched service）

```powershell
cd edge-server; go test ./... -short -count=1
cd ../hub-server; go test ./... -short -count=1
```

### 前端变更（按 touched app）

```powershell
cd app/desktop; corepack pnpm test; corepack pnpm typecheck
cd ../web; corepack.cmd pnpm typecheck; corepack.cmd pnpm exec vite build
```

### UI 工作流变更

- shared unit/contract + Desktop/Web Playwright + Visual QA
- 主视口 `1440x810`
- 证据等级按 `.agents/skills/real-e2e-acceptance/SKILL.md` 标注
- Vite renderer 不等于 packaged Desktop；stub/fixture/readiness-only 必须写 `real_tested=false`

### Release Gate

```powershell
pwsh ./scripts/release/verify-release-gate.ps1
```

## 禁止操作

### 无 SPEC 大型改动

长程多步骤任务必须先建立 SPEC 和 `docs/progress/MASTER.md`，再执行。短任务（单文件修复、typo）不需要完整 SPEC，但仍遵守范围、隐私和验证规则。

### 破坏性 Git 操作

- 禁止 `reset --hard`、`push --force main`
- 不在共享分支 force-push
- `master` 禁止直接 push

### 无保护力测试

以下测试反模式禁止提交：

| 反模式 | 原因 |
|---|---|
| 测试复制实现 switch | 只能证明测试和实现一起错 |
| 测常量字符串 | 编译器已保证 |
| 硬断错误文案 | 文案不是行为合同 |
| mock 被测函数自己 | mock 应模拟外部系统，不模拟实现内部 |

### 证据等级混淆

绝对禁止以下冒充：

- fixture/stub/readiness-only 冒充真实登录、真实模型/API 或 packaged Desktop
- Vite renderer 冒充 Tauri packaged + sidecar + installer
- mock 模式静默降级为 real mode 无提示

参见 [[risk-evid-grade-confusion]]。

### 架构红线

以下操作不可协商：

1. UI 不能直接启动 Agent CLI
2. Web 不能持有 TokenDance API key、本机文件系统能力或 Local Edge 直连能力
3. Desktop renderer 不能获得 raw process execution 权限
4. TokenDance ID 只证身份；Hub 本地决定权限
5. 通用 UI 组件禁止在 Desktop/Web 各自复制本地副本；必须从 `app/shared/` 导入

### 安全红线

- 禁止提交 `.env`、API key、token、cookie、私钥、证书、SSH 配置
- 禁止提交真实服务器 IP、内网地址、数据库连接串、生产账号、个人路径
- 禁止提交生产数据库 dump、用户数据、聊天记录
- TokenDance API key 不得暴露给浏览器 UI 或公开日志

参见 [[risk-session-secret-boundary]]。

### 文档规则

- 项目规则只写 `AGENTS.md`，不在 wiki 或 roadmap 复制规则
- wiki 不自创产品策略，只编译 SSOT → 参见 [[decision-wiki-is-compiled]]
- 历史 longform 不留在活跃 `docs/`，外迁到 `docs/history.md` 指向的外部归档
- 避免巨石文档：入口只保留职责、摘要、当前事实和链接

## 工作流

### 建立 worktree

```powershell
git checkout dev/delicious233
git pull --ff-only
git worktree add .worktrees/<topic> -b <type>/<topic>
```

规则：一个 worktree 对应一个短分支和一个任务卡/PR。完成后 push、开 PR、合并后删除分支和 worktree。

### 提交格式

```text
type(scope): 中文摘要
```

`type`: `feat|fix|docs|refactor|chore|test|perf|ci|revert`。摘要不超过 50 字。

### 合并路径

```text
feat/* 或 docs/* -> dev/delicious233 -> master
```

## 相关决策

- [[decision-incremental-cleanup]] — 优先 SSOT 对齐 + seam 硬化，不做 Hub/Edge 重写
- [[decision-wiki-is-compiled]] — wiki 是编译知识，产品 SSOT 留在 `wiki/` 外部
- [[decision-production-live-narrative]] — 单一生产叙事：hk3 LIVE；decommission 措辞是历史漂移

## 运维指针

- [[production-live-hk3]] — hk3 生产事实
- [[ops-evidence-boundary]] — ops 只写指针，不复制 secret
