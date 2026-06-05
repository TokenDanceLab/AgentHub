# AgentHub 文档索引

## 目录结构

```
docs/
├── getting-started/              # 快速了解项目
│   └── GOAL.md                   # 项目总目标与启动入口
├── architecture/                 # 架构设计
│   ├── system-design/            # 系统架构、产品需求、实现指南
│   ├── technical-decisions/      # ADR 架构决策记录
│   ├── component-design/         # 组件设计方案
│   │   └── design-docs/          # 组件级设计文档
│   ├── decisions/                # ADR 副本 / 历史决策
│   └── design/                   # 设计文档
├── development/                  # 开发指南
│   ├── handoffs/                 # 交接文档与 STATE.md
│   ├── frontend/                 # 前端开发
│   ├── backend/                  # 后端开发
│   └── desktop/                  # 桌面端开发
├── reference/                    # 参考资料
│   ├── competitive/              # 竞品分析
│   ├── projects/                 # 参考项目深度调研
│   ├── technical/                # 技术参考与审计报告
│   ├── cross-comparison/         # 跨项目横向对比
│   ├── codex/                    # Codex CLI 源码研究
│   ├── planning/                 # 研究到实现的规划文档
│   └── web-research/             # Web 调研笔记
├── tutorials/                    # 路线图与教程
│   └── roadmap.md                # 分阶段路线图
├── roadmaps/                     # 模块级路线图（client / integration 等）
├── governance/                   # 治理文档（分支规范、文档标准、安全风险登记）
├── operations/                   # 运维文档
├── guides/                       # 使用指南（FAQ、快捷键、本地开发搭建）
├── handoff/                      # 会话交接记录（活跃工作副本）
├── research/                     # 研究综述
├── review/                       # 审查与 gap 分析
├── inbox/                        # 未分类待整理文档
├── archive/                      # 历史归档
├── user-guides/                  # 用户手册
├── agent-guides/                 # Agent 使用指南
└── api-reference/                # API 参考
```

## 核心文档快速入口

| 文档 | 路径 | 说明 |
|------|------|------|
| 产品需求 | [product-requirements.md](architecture/system-design/product-requirements.md) | AgentHub 产品功能需求定义 |
| 系统架构 | [system-architecture.md](architecture/system-design/system-architecture.md) | 整体系统架构设计 |
| 实现指南 | [implementation-guide.md](architecture/system-design/implementation-guide.md) | 架构落地的实现指引 |
| 项目状态 | [STATE.md](development/handoffs/STATE.md) | 当前迭代状态与进度 |
| 全局路线图 | [roadmap.md](roadmap.md) | 项目长期路线图 |
| 分模块路线图 | [roadmaps/](roadmaps/) | client / integration / quality 等模块路线图 |
| 快速开始 | [GOAL.md](getting-started/GOAL.md) | 项目入口，了解 AgentHub 在做什么 |
| 技术决策 | [technical-decisions/](architecture/technical-decisions/) | ADR 架构决策记录（11 篇） |
| 竞品分析 | [competitive/](reference/competitive/) | 竞品调研与对比报告 |
| 参考项目 | [projects/](reference/projects/) | 20+ 开源 / 商业项目深度调研 |
| 使用指南 | [guides/](guides/) | FAQ、快捷键、本地开发搭建 |

## 文档维护规则

1. **新文档归类**：先放入 `inbox/`，待确认归属后移入对应分类目录。
2. **交接文档**：每次会话结束将交接记录写入 `handoff/`，长期沉淀版移入 `development/handoffs/`。
3. **归档策略**：过时或被替换的文档移入 `archive/`，不要直接删除。
4. **索引同步**：新增或移动目录后，同步更新本文档的目录结构树。
