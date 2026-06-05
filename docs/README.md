# AgentHub 文档索引

## 目录结构

```
docs/
├── README.md                  # 本文件
├── architecture.md            # 产品定位 + 系统架构 + 实现状态（三合一主文档）
├── adr/                       # 架构决策记录（12 篇 ADR）
├── designs/                   # 组件级设计文档（7 篇）
├── handoffs/                  # 交接文档与 STATE.md（11 篇）
├── reference/                 # 参考资料
│   ├── competitive/           # 竞品分析
│   ├── projects/              # 参考项目深度调研
│   └── technical/             # 技术参考与审计报告
├── governance/                # 治理文档（分支规范、文档标准、安全风险登记）
├── operations/                # 运维文档
└── archive/                   # 历史归档（旧方案、旧审查、旧计划）
```

## 核心文档快速入口

| 文档 | 路径 | 说明 |
|------|------|------|
| 架构文档 | [architecture.md](architecture.md) | 产品定位、系统架构、实现状态（首选入口） |
| 项目状态 | [handoffs/STATE.md](handoffs/STATE.md) | 当前迭代状态与进度 |
| 架构决策 | [adr/](adr/) | ADR-001 ~ ADR-011 架构决策记录 |
| 设计文档 | [designs/](designs/) | 组件级设计方案 |
| 交接文档 | [handoffs/](handoffs/) | 会话交接与角色分工 |
| 竞品分析 | [reference/competitive/](reference/competitive/) | 竞品调研与对比报告 |

## 文档维护规则

1. **主文档优先**：架构说明优先写进 `architecture.md`，不要新增分散的架构文档。
2. **入口简洁**：新读者从 `architecture.md` 开始，需要细节时再查 `reference/` 或 `archive/`。
3. **归档策略**：过时或被替换的文档移入 `archive/`，不要直接删除，也不要留在活跃目录中。
