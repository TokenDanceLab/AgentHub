# AgentHub 文档

最后更新：2026-06-10

## 快速入口

| 角色 | 先读 | 然后 |
|------|------|------|
| **新开发者** | [developer-quickstart.md](developer-quickstart.md) | [architecture.md](architecture.md) → [roadmap.md](roadmap.md) |
| **评审/产品** | [design-decisions.md](design-decisions.md) | [architecture.md](architecture.md) → [governance/threat-model.md](governance/threat-model.md) |
| **贡献者** | [contributing.md](contributing.md) | [developer-quickstart.md](developer-quickstart.md) |

端口速记：Desktop/Tauri `5173`，Web `5174`，Mobile RN Expo `5177`，Hub `8080`，Edge `3210`。

## 目录结构

```
docs/
├── README.md                          ← 导航索引（你在这里）
├── developer-quickstart.md            ← 新人入门
├── architecture.md                    ← 架构概览（→ architecture/ 模块详情）
├── architecture/                      ← 6 篇模块化架构文档
├── roadmap.md                         ← 路线图概览（→ roadmap/ 模块详情）
├── roadmap/                           ← 模块化路线图
├── contributing.md                    ← 贡献指南
├── design-decisions.md                ← 5 个关键技术决策摘要
├── right-panel-enhancement-design.md  ← 右侧面板增强设计
├── adr/                               ← 架构决策记录（11 篇）
├── designs/                           ← 进行中设计文档
├── governance/                        ← 治理：分支规范、文档标准、安全风险、威胁模型
├── deployment/                        ← 部署手册
├── release/                           ← 发布清单
└── reference/                         ← 技术参考 + 竞品调研
    ├── competitive-analysis.md
    ├── cc-switch-integration-design.md
    ├── cc-switch-provider-model-ref.md
    ├── cc-switch-storage.md
    ├── cc-switch-model-mapping-deep.md
    ├── sdk-agent-strategy.md
    ├── research-synthesis.md
    └── projects/                      ← 竞品调研（15 个项目）
```

## 按需查阅

| 需要 | 去看 |
|------|------|
| 某个架构决策的背景 | [adr/](adr/) — 11 篇 ADR |
| 右侧面板功能设计 | [right-panel-enhancement-design.md](right-panel-enhancement-design.md) |
| Artifact 生命周期 | [designs/artifact-lifecycle-plan.md](designs/artifact-lifecycle-plan.md) |
| Adapter 架构 | [designs/enhanced-adapter-architecture.md](designs/enhanced-adapter-architecture.md) |
| 竞品分析 | [reference/competitive-analysis.md](reference/competitive-analysis.md) |
| cc-switch 集成 | [reference/cc-switch-integration-design.md](reference/cc-switch-integration-design.md) |
| SDK Agent 策略 | [reference/sdk-agent-strategy.md](reference/sdk-agent-strategy.md) |
| 分支规则 | [governance/branch-governance.md](governance/branch-governance.md) |
| 安全风险 | [governance/security-risk-register.md](governance/security-risk-register.md) |
| 威胁模型 | [governance/threat-model.md](governance/threat-model.md) |
| 部署 | [deployment/hk2-deployment-runbook.md](deployment/hk2-deployment-runbook.md) |
