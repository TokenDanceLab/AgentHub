# AgentHub 文档

> 新 Agent / 新开发者？按顺序读：**roadmap → architecture → STATE**

## 必读 (3 分钟)

| 顺序 | 文档 | 为什么 |
|:----:|------|--------|
| 1 | [roadmap.md](roadmap.md) | **该做什么**。当前 Sprint 目标 + 可打钩任务 + 已知缺口 |
| 2 | [architecture.md](architecture.md) | **怎么运作**。产品定位 + 三层架构 + 数据流 + 实现状态 |
| 3 | [handoffs/STATE.md](handoffs/STATE.md) | **现在在哪**。当前构建/测试状态、阻塞项、部署信息 |

读完这三份即可开始工作。

## 按需查阅

| 需要 | 去看 |
|------|------|
| 某个架构决策的背景 | [adr/](adr/) — 11 篇 ADR |
| 某个组件的设计方案 | [designs/](designs/) — 7 篇设计文档 |
| 竞品怎么做的 | [reference/projects/](reference/projects/) — 25 个竞品深度调研 |
| 分支规则、安全风险 | [governance/](governance/) — 分支治理、文档标准、安全风险登记 |
| 历史方案、旧审查 | [archive/](archive/) — 完整归档索引见 [archive/INDEX.md](archive/INDEX.md) |
| 完整路线图历史 | [archive/roadmap-full-history-20260605.md](archive/roadmap-full-history-20260605.md) |
| 交接记录 | [handoffs/](handoffs/) — STATE.md + 最新 session 交接 |

## 目录结构

```
docs/
├── README.md            ← 你在这里
├── roadmap.md           ← Sprint 目标 + 待办清单
├── architecture.md      ← 三合一主文档
├── adr/                 ← 架构决策记录
├── designs/             ← 组件设计文档
├── handoffs/            ← STATE.md + 最新交接
├── reference/           ← 技术参考 + 竞品调研
│   └── projects/        ← 25 个竞品深度调研
├── governance/          ← 分支规范、文档标准、安全风险
└── archive/             ← 历史归档 (INDEX.md 为索引)
```

## 规则

1. **路线图唯一**：目标只写在 `roadmap.md`，完成打钩，不另建文件
2. **主文档优先**：架构说明写进 `architecture.md`，不新增分散文档
3. **交接精简**：`handoffs/` 只保留 STATE.md + 最近 session，旧的归档到 `archive/handoffs/`
4. **归档不删**：过时文档移入 `archive/`，不直接删除
