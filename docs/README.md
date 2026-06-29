# AgentHub 文档

最后更新：2026-06-29

## 快速入口

| 角色 | 先读 | 然后 |
|------|------|------|
| **新开发者** | [developer-quickstart.md](developer-quickstart.md) | [architecture.md](architecture.md) → [roadmap.md](roadmap.md) |
| **评审/产品** | [architecture.md](architecture.md) | [decisions.md](decisions.md) → [governance/threat-model.md](governance/threat-model.md) |
| **贡献者** | [../CONTRIBUTING.md](../CONTRIBUTING.md) | [developer-quickstart.md](developer-quickstart.md) |
| **功能设计** | [architecture.md](architecture.md) | [decisions.md](decisions.md) |
| **历史追溯** | [history.md](history.md) | TokenDance docs 外部归档 |

端口速记：Desktop/Tauri `5173`，Web `5174`，Mobile RN Expo `5177`，Hub `8080`，Edge `3210`。

## 目录结构

```
docs/
├── README.md                          ← 导航索引（你在这里）
├── developer-quickstart.md            ← 新人入门
├── architecture.md                    ← 架构概览（→ architecture/ 模块详情）
├── architecture/                      ← 模块化架构文档
├── decisions.md                       ← 当前架构决策摘要
├── roadmap.md                         ← 总路线、当前优先级、验收边界
├── governance/                        ← 治理：执行映射、安全风险、威胁模型
├── history.md                         ← 历史归档索引（外部 TokenDance docs）
├── images/                            ← 截图与图片资源
└── reference/                         ← 轻量技术参考
```

## 按需查阅

| 需要 | 去看 |
|------|------|
| 当前架构决策摘要 | [decisions.md](decisions.md) |
| 旧架构决策正文和背景 | [history.md](history.md) |
| 历史设计、审计、发布、参考调研 | [history.md](history.md) |
| spec-driven 专项归档 | [history.md](history.md) |
| 当前 spec-driven 进度 | 无 active SPEC 时不保留；执行中才临时出现 `progress/MASTER.md` |
| 项目规则和文档规则 | [../AGENTS.md](../AGENTS.md) |
| WebSocket 事件合同 | [../api/events.md](../api/events.md) |
| SDK Agent 策略 | [reference/sdk-agent-strategy.md](reference/sdk-agent-strategy.md) |
| 分支和 worktree 规则 | [../AGENTS.md](../AGENTS.md) |
| 安全风险 | [governance/security-risk-register.md](governance/security-risk-register.md) |
| 威胁模型 | [governance/threat-model.md](governance/threat-model.md) |
| 后端性能/泄漏证据 | [reference/backend-performance-gates.md](reference/backend-performance-gates.md) |
| 发布/截图历史清单 | [history.md](history.md) |
