# AgentHub 文档

最后更新：2026-08-16

## 快速入口

| 角色 | 先读 | 然后 |
|------|------|------|
| **新开发者** | [developer-quickstart.md](developer-quickstart.md) | [architecture.md](architecture.md) |
| **评审/产品** | [architecture.md](architecture.md) | [decisions.md](decisions.md) → [governance/threat-model.md](governance/threat-model.md) |
| **贡献者** | [../CONTRIBUTING.md](../CONTRIBUTING.md) | [developer-quickstart.md](developer-quickstart.md) · [../AGENTS.md](../AGENTS.md) |
| **功能设计** | [architecture.md](architecture.md) | [decisions.md](decisions.md) |
| **历史追溯** | [history.md](history.md) · [archives/](archives/) | TokenDance docs 外部归档 |

端口全景（默认端口表 SSOT）见 [architecture/05-deployment.md](architecture/05-deployment.md)。

## 目录结构

```
docs/
├── README.md                          ← 导航索引（你在这里）
├── developer-quickstart.md            ← 新人入门
├── architecture.md                    ← 架构概览（→ architecture/ 模块详情）
├── architecture/                      ← 模块化架构文档
├── archives/                          ← 已关闭程序快照（analysis/plan/handoff）与历史文档归档
├── decisions.md                       ← 当前架构决策摘要
├── governance/                        ← 治理：执行映射、安全风险、威胁模型
├── history.md                         ← 历史归档索引（外部 TokenDance docs）
├── images/                            ← 截图与图片资源
└── reference/                         ← 轻量技术参考
```

## 按需查阅

| 需要 | 去看 |
|------|------|
| API 索引 | [api-reference.md](api-reference.md) |
| 模块架构 | [architecture/README.md](architecture/README.md) |
| 当前架构决策摘要 | [decisions.md](decisions.md) |
| 旧架构决策正文和背景 | [history.md](history.md) |
| 现役 SPEC | SPEC 完成后外迁；历史见 [archives/plan/](archives/plan/) 与 [history.md](history.md) |
| 仓库布局裁决 | ADR-018 摘要见 [decisions.md](decisions.md)；历史分析见 [archives/](archives/) |
| 项目规则和文档规则 | [../AGENTS.md](../AGENTS.md) |
| WebSocket 事件合同 | [../api/events.md](../api/events.md) |
| SDK Agent 策略 | [reference/sdk-agent-strategy.md](reference/sdk-agent-strategy.md) |
| 分支和 worktree 规则 | [../AGENTS.md](../AGENTS.md) |
| 安全风险 | [governance/security-risk-register.md](governance/security-risk-register.md) |
| 机器验证映射 | [governance/verifier-map.md](governance/verifier-map.md) |
| 威胁模型 | [governance/threat-model.md](governance/threat-model.md) |
| 后端性能/泄漏证据 | [reference/backend-performance-gates.md](reference/backend-performance-gates.md) |
| 发布/截图历史清单 | [history.md](history.md) |
