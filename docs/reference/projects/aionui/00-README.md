# AionUi 参考项目索引

> 源码：`reference/aionui/` | GitHub：[iOfficeAI/AionUi](https://github.com/iOfficeAI/AionUi)
> 版本：v1.9.25 | Stars：26,311 | License：Apache-2.0

## 阅读顺序

| 文件 | 内容 | 行数 |
|------|------|------|
| [01-overview.md](./01-overview.md) | 项目概况：定位、技术栈、架构图、核心数据 | ~200 |
| [02-architecture.md](./02-architecture.md) | 架构深度：进程模型、数据流、状态机、边界处理 | ~350 |
| [03-ui-patterns.md](./03-ui-patterns.md) | UI/UX 模式：组件树、交互状态、设计系统 | ~300 |
| [04-agent-model.md](./04-agent-model.md) | Agent 编排模型：多 Agent 适配、Team 模式、ACP | ~350 |
| [05-security.md](./05-security.md) | 安全模型：沙箱、扩展权限、审批、审计 | ~200 |
| [06-adoption-map.md](./06-adoption-map.md) | AgentHub 采纳映射：亮点→文件+优先级 | ~250 |
| [07-gap-analysis.md](./07-gap-analysis.md) | **针对性差距报告**：AgentHub UI/客户端问题→AionUi 方案 | ~400 |
| [08-ui-packaging-gap.md](./08-ui-packaging-gap.md) | **设计力与产品包装对比**：品牌、README、官网、设计工程化 | ~330 |
| [09-ui-deep-comparison.md](./09-ui-deep-comparison.md) | **UI 深度对比报告**：设计 token、微观交互、组件、可访问性逐项对比 | ~300 |

## 建议阅读路径

- **快速了解**：01 → 06（overview + 采纳清单）
- **架构决策参考**：02 → 04（架构 + Agent 模型）
- **前端设计参考**：03（UI 模式）
- **安全设计参考**：05（安全模型）
- **直接动手**：07（差距报告 + AionUi 方案对照）

## 与 AgentHub 的关系

AionUi 是 AgentHub 最重要的 Tier 1 参考项目之一。两者高度互补：

| 维度 | AgentHub | AionUi |
|------|----------|--------|
| 定位 | Hub-Edge 分布式 Agent 协作平台 | 本地优先的 Cowork Agent 桌面应用 |
| 客户端 | Tauri（Rust） | Electron（Node.js） |
| 后端 | Go（Hub Server + Edge Server） | Node.js（内置 Web 服务器） |
| Agent 管理 | 远程调度、Hub 中转 | 本地扫描、自动发现 |
| 多 Agent | Hub 编排、worktree 隔离 | Team Mode、MCP 协调 |
| 扩展 | API + SDK | Extension 系统（沙箱） |
