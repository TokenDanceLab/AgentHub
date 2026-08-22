# AgentHub 文档

最后更新：2026-08-20

## 快速入口

| 角色 | 先读 | 然后 |
|------|------|------|
| **新开发者** | [developer-quickstart.md](developer-quickstart.md) | [architecture.md](architecture.md) |
| **评审/产品** | [architecture.md](architecture.md) | [decisions.md](decisions.md) → [governance/README.md](governance/README.md) |
| **贡献者** | [../CONTRIBUTING.md](../CONTRIBUTING.md) | [developer-quickstart.md](developer-quickstart.md) · [../AGENTS.md](../AGENTS.md) |
| **功能设计** | [architecture.md](architecture.md) | [decisions.md](decisions.md) |
| **历史追溯** | [history.md](history.md) · [archives/](archives/) | TokenDance docs 外部归档 |

端口全景（默认端口表 SSOT）见 [architecture/05-deployment.md](architecture/05-deployment.md)。

## 目录结构

```
docs/
├── README.md                          ← 导航索引（你在这里）
├── developer-quickstart.md            ← 新人入门
├── api-reference.md                   ← API 契约入口（→ api/）
├── architecture.md                    ← 架构概览（→ architecture/ 模块详情）
├── architecture/                      ← 模块化架构文档
├── archives/                          ← 已关闭程序快照（analysis/plan/handoff）与历史文档归档
├── component-acceptance.md            ← shared 组件验收标准
├── decisions.md                       ← 当前架构决策摘要
├── governance/                        ← 治理：机器验证映射 + 指针（内部治理正文在私有 docs）
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
| 现役 SPEC | SPEC 完成后外迁；历史见 [history.md](history.md) |
| 仓库布局裁决 | ADR-018 摘要见 [decisions.md](decisions.md)；历史分析见 [history.md](history.md) |
| 项目规则和文档规则 | [../AGENTS.md](../AGENTS.md) |
| WebSocket 事件合同 | [../api/events.md](../api/events.md) |
| SDK Agent 策略 | [reference/README.md](reference/README.md)（含 [sdk-agent-strategy.md](reference/sdk-agent-strategy.md)、[agent-protocol-compat.md](reference/agent-protocol-compat.md)） |
| 组件验收标准 | [component-acceptance.md](component-acceptance.md) |
| 分支和 worktree 规则 | [../AGENTS.md](../AGENTS.md) |
| 治理（公开区：验证映射 + 指针） | [governance/README.md](governance/README.md) |
| 安全风险摘要 | [../SECURITY.md](../SECURITY.md)（SSOT 在 TokenDance 私有治理文档） |
| 机器验证映射 | [governance/verifier-map.md](governance/verifier-map.md) |
| 后端性能/泄漏证据 | 机器门禁 `scripts/verify/verify-backend-perf-leak-gates.py`；旧证据分类 [archives/reference/backend-performance-gates.md](archives/reference/backend-performance-gates.md)（已归档） |
| 发布/截图历史清单 | [history.md](history.md) |
