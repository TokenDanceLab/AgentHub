# AgentHub 文档

最后更新：2026-10-18

## 快速入口

| 角色 | 先读 | 然后 |
|------|------|------|
| **新开发者** | [developer-quickstart.md](developer-quickstart.md) | [architecture.md](architecture.md) |
| **评审/产品** | [architecture.md](architecture.md) | [decisions.md](decisions.md) → [governance/README.md](governance/README.md) |
| **贡献者** | [../CONTRIBUTING.md](../CONTRIBUTING.md) | [developer-quickstart.md](developer-quickstart.md) · [../AGENTS.md](../AGENTS.md) |
| **功能设计** | [architecture.md](architecture.md) | [decisions.md](decisions.md) |

端口全景和部署证据边界见 [architecture/05-deployment.md](architecture/05-deployment.md)。

## API 契约

本目录不维护第二份 API 表；权威契约如下：

| 内容 | 权威文件 | 验证 |
|---|---|---|
| REST 路径、schema、实现状态标记 | [`api/openapi.yaml`](../api/openapi.yaml) | OpenAPI YAML parse / endpoint tests |
| WebSocket envelope、frame、事件族和源码 owner | [`api/events.md`](../api/events.md) | WS tests / event normalizer tests |
| Hub→Edge dispatch、admission、execution intent、callback ownership | [`api/dispatch.md`](../api/dispatch.md) | dispatch/runcontrol tests |
| 命名、分页、错误、权限、版本 | [`api/conventions.md`](../api/conventions.md) | API review / handler tests |

改动顺序：新 REST 接口先改 `api/openapi.yaml`；新 WS 事件先改源码 owner 再同步 `api/events.md`；跨 Hub→Edge 语义先改 `api/dispatch.md`；通用命名/错误/分页/权限先改 `api/conventions.md`。新增鉴权或 session 行为时同步 [architecture/06-auth-identity.md](architecture/06-auth-identity.md)。

## 目录结构

```
docs/
├── README.md                          ← 导航索引（你在这里）
├── developer-quickstart.md            ← 新人入门
├── architecture.md                    ← 架构概览（→ architecture/ 模块详情）
├── architecture/                      ← 模块化架构文档（含部署/协议/CI）
├── component-acceptance.md            ← shared 组件验收标准
├── decisions.md                       ← 当前架构决策 register
├── governance/                        ← 治理：机器验证映射
└── reference/                         ← 轻量技术参考
```

## 按需查阅

| 需要 | 去看 |
|------|------|
| 模块架构 | [architecture.md](architecture.md) |
| 当前架构决策 | [decisions.md](decisions.md) |
| 历史版本 | Git 历史 · [CHANGELOG.md](../CHANGELOG.md) · GitHub Releases（v0.6.1 起） |
| 仓库布局裁决 | ADR-018 摘要见 [decisions.md](decisions.md) |
| 项目规则和文档规则 | [../AGENTS.md](../AGENTS.md) |
| WebSocket 事件合同 | [../api/events.md](../api/events.md) |
| Agent Protocol / SDK 边界 | [reference/agent-protocols.md](reference/agent-protocols.md) |
| 组件验收标准 | [component-acceptance.md](component-acceptance.md) |
| 分支和 worktree 规则 | [../AGENTS.md](../AGENTS.md) |
| 治理（验证映射与 owner 指针） | [governance/README.md](governance/README.md) |
| 安全策略与漏洞报告 | [../SECURITY.md](../SECURITY.md) |
| 机器验证映射 | [governance/verifier-map.md](governance/verifier-map.md) |
| 后端性能/泄漏证据 | 机器门禁 `scripts/verify/verify-backend-perf-leak-gates.py`；证据等级见 [architecture/05-deployment.md](architecture/05-deployment.md) |
