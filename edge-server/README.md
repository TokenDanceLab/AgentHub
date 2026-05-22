# AgentHub Edge Server

Edge Server 是靠近项目和 Runner 的控制节点。

它可以运行在 Desktop 内、本地/远程机器上，或作为 headless Cloud Edge 运行。

Runtime: Go.

## 职责

- 本地或 Edge authority 的 Conversation。
- Project registry 和 workspace roots。
- `.agenthub/` 项目记忆和上下文构造。
- Runner 发现、健康检查和调度。
- Artifact 元数据索引。
- Desktop UI 的本地 REST API / WebSocket。
- 连接 Hub 的 sync、relay 和远程命令 client。
- 本地数据和 Local Runner Fast Path 的权限边界。

## 不负责什么

- 全局账号系统。
- 全局好友和群聊关系。
- `authority=hub` 时的云端会话权威。
- 直接执行 Agent CLI 子进程；Runner 拥有进程生命周期。

## 协议面

- UI <-> Edge：REST JSON API + WebSocket events，处理本地 IM、本地 artifact、本地 run control。
- Edge <-> Hub：REST sync API + reverse WebSocket relay，处理 sync events、heartbeat、远程命令。
- Edge <-> Runner：local REST API + typed event stream，处理 run start/cancel、RunnerEvent、artifact reads。

## 依赖

- `api/` 契约：REST endpoint、WebSocket event、错误格式。
- `docs/system-architecture.md`：Hub-Edge-Runner 架构和职责边界。
- `docs/implementation-guide.md`：当前实现顺序和三部分分工。
- Go package 按实际代码需要创建，不提前铺空目录。
