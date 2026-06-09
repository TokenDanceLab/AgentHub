# AgentHub 文档

> 双入口：**评审/新用户**走上半部分了解产品；**开发者**走下半部分接入开发。

## 🏆 评审与产品入口（先读这些）

| 顺序 | 文档 | 为什么 |
|:----:|------|--------|
| 1 | [competition/competitive-positioning.md](competition/competitive-positioning.md) | **我们在赛道里的位置**。工程规模对比 + 架构维度 + 独有能力 + 评分对应 |
| 2 | [design-decisions.md](design-decisions.md) | **为什么这样选**。Go+CLI / Hub-Edge / 自研WS / Tauri / 三级审批 5 个关键决策 |
| 3 | [architecture.md](architecture.md) | **怎么运作**。产品定位 + 三层架构 + 数据流 + 实现状态 |
| 4 | [governance/threat-model.md](governance/threat-model.md) | **安全深度**。信任边界图 + 安全亮点卡（浓缩 44 条风险台账） |
| 5 | [roadmap.md](roadmap.md) | **做到哪了，接下来做什么**。当前 Sprint + 已知缺口 |
| 6 | [competition/teamrun-e2e-evidence.md](competition/teamrun-e2e-evidence.md) | **真实运行证据**。TeamRun 端到端 |

> 完整对外文档（角色化导航 + 架构图 + 中英双语）：**https://hub.vectorcontrol.tech/docs**

## 🔧 开发者入口

> 新 Agent / 新开发者？按顺序读：**roadmap → architecture → v4 plan → integration governance → frontend progress → v4 audit → integration plan → legacy inventory**

### 必读 (3 分钟)

| 顺序 | 文档 | 为什么 |
|:----:|------|--------|
| 1 | [roadmap.md](roadmap.md) | **该做什么**。当前 Sprint 目标 + 可打钩任务 + 已知缺口 |
| 2 | [architecture.md](architecture.md) | **怎么运作**。产品定位 + 三层架构 + 数据流 + 实现状态 |
| 3 | [desktop-web-v4-clean-rebuild-plan.md](desktop-web-v4-clean-rebuild-plan.md) | **怎么重构**。Desktop/Web v4 shared workbench 的实施边界、任务和验收 |
| 4 | [backend-integration-governance.md](backend-integration-governance.md) | **怎么合后端和联调**。AH-SYNC、后端切片、Desktop/Edge、Web/Hub、DB 和真实 CLI gate 的统一规则 |
| 5 | [v4-frontend-progress-2026-06-07.md](v4-frontend-progress-2026-06-07.md) | **前端现在到哪了**。5173/5174 shared UI、profile/avatar、Docs/Projects 预览、主题、侧栏、动效、证据和下一步 |
| 6 | [v4-design-parity-audit-2026-06-07.md](v4-design-parity-audit-2026-06-07.md) | **怎么验收 UI 对齐**。5173/5174/5176 的截图、computed-style、交互 smoke 和剩余风险 |
| 7 | [desktop-edge-web-integration-plan.md](desktop-edge-web-integration-plan.md) | **下一步怎么接生产链路**。Desktop/Tauri/Local Edge 与 Web/Hub 的平台边界、旧客户端清理和分阶段验收 |
| 8 | [v4-legacy-client-inventory-2026-06-07.md](v4-legacy-client-inventory-2026-06-07.md) | **旧客户端怎么清**。仍留在源码树里的旧 Desktop/Web 文件定性、迁移顺序和删除边界 |
| 9 | [v4-merge-pr-readiness-2026-06-07.md](v4-merge-pr-readiness-2026-06-07.md) | **怎么准备合并和 PR**。当前分支事实、未提交变更分类、验证门禁和 PR 描述骨架 |
| 10 | [v4-pr-draft.md](v4-pr-draft.md) | **PR 草稿**。创建 draft PR 前的标题、正文、验证 checklist 和 gh 命令 |
| 11 | [v4-clean-rebuild-decision-questions.md](v4-clean-rebuild-decision-questions.md) | **还要拍板什么**。实现前需要确认的问题和推荐答案 |

读完 roadmap、architecture 和当前任务计划即可开始工作。

端口速记：Desktop/Tauri 前端是 `5173`，Web 前端是 `5174`，Mobile RN Expo Web 视觉预览是 `5177`，`5176/desktop` 是只读的 `agenthub-design` design demo。

## 按需查阅

| 需要 | 去看 |
|------|------|
| 某个架构决策的背景 | [adr/](adr/) — 11 篇 ADR |
| 某个组件的设计方案 | [designs/](designs/) — 4 篇设计文档 |
| 竞品和设计参考怎么做的 | [reference/](reference/) — 竞品、CLI、桌面 UX 和设计系统调研 |
| 分支规则、安全风险 | [governance/](governance/) — 分支治理、文档标准、安全风险登记 |
| 历史方案、旧审查 | [archive/](archive/) — 完整归档索引见 [archive/INDEX.md](archive/INDEX.md) |
| 完整路线图历史 | [archive/roadmap-full-history-20260605.md](archive/roadmap-full-history-20260605.md) |

## 目录结构

```
docs/
├── README.md            ← 你在这里（评审入口 + 开发者入口）
├── roadmap.md           ← Sprint 目标 + 待办清单
├── architecture.md      ← 三合一主文档
├── design-decisions.md  ← 5 个关键技术决策（评审向）
├── desktop-web-v4-clean-rebuild-plan.md
├── backend-integration-governance.md
├── v4-frontend-progress-2026-06-07.md
├── v4-design-parity-audit-2026-06-07.md
├── desktop-edge-web-integration-plan.md
├── v4-legacy-client-inventory-2026-06-07.md
├── v4-merge-pr-readiness-2026-06-07.md
├── v4-pr-draft.md
├── v4-clean-rebuild-decision-questions.md
├── adr/                 ← 架构决策记录（11 篇）
├── competition/         ← 竞品定位 + 真实运行证据（评审向）
├── designs/             ← 组件设计文档
├── governance/          ← 分支规范、文档标准、安全风险台账、威胁模型
└── archive/             ← 历史归档 (INDEX.md 为索引)
```

## 规则

1. **路线图唯一**：当前目标和优先级写在 `roadmap.md`，完成打钩，不另建第二套 backlog
2. **主文档优先**：架构说明写进 `architecture.md`
3. **计划直达**：阶段性实施计划直接放在 `docs/`，并由 roadmap 链接
4. **归档不删**：过时文档移入 `archive/`，不直接删除
