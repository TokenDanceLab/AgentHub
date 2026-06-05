> 📦 已归档

# AgentHub 模块边界

日期：2026-05-22

本文记录原 `packages/*` 规划里的共享职责。仓库已改为扁平结构，不再保留顶层 `packages/` 目录；这些职责后续可以落到 `api/` 契约、各 Go 模块内部 package，或 `app/shared/`。

## 前端共享层

`app/shared/` 负责前端共用代码：

- React 组件。
- UI 状态和视觉 token。
- API client。
- WebSocket event client。
- 纯前端工具函数。

`app/shared/` 不负责服务端状态权威，也不直接访问 Runner。

## Hub Server

`hub-server/` 负责中心协作能力：

- 用户、联系人、群聊。
- 消息路由和 Hub authority 会话。
- 设备注册和在线状态。
- Edge-Hub 同步。
- Hub relay 和远程控制。
- 云端 artifact 元数据和必要缓存。

## Edge Server

`edge-server/` 负责本地或远程 Edge Node：

- 本地项目、Thread、Turn、AgentRun 管理。
- 本地消息、记忆、上下文构造。
- Runner 管理。
- 本地 EventStore 和未来同步 outbox。
- 本地审批策略。
- Artifact 索引。

## Runner

`runner/` 负责执行器能力：

- Claude Code / Codex / OpenCode 适配。
- 进程生命周期。
- workspace / worktree 管理。
- 日志、diff、preview。
- patch 生成和 apply/discard 的底层执行。

Runner 不负责审批决策。遇到高风险操作时，Runner 暂停并等待 Edge 决策。

## API 契约

`api/` 负责跨模块通信契约：

- REST API request / response。
- WebSocket event envelope。
- 标准错误码。
- 事件版本、序号、去重字段。

后续如果需要生成 Go / TypeScript 类型，优先从 `api/openapi.yaml` 和 `api/events.schema.json` 生成。

## Docker 和部署文件

Docker 配置按模块就近管理：

- `hub-server/` 需要容器化时，放 `hub-server/Dockerfile` 或 `hub-server/compose.yaml`。
- `edge-server/` 需要本地边缘节点环境时，放 `edge-server/Dockerfile` 或模块内 compose。
- `runner/` 需要隔离 Agent CLI 或依赖环境时，放 `runner/Dockerfile`。
- 根目录只在需要跨 Hub、Edge、Runner 一键联调时保留可选 `compose.yaml`。

这样避免一个根级 `docker/` 同时承载三套完全不同的运行环境。

## 领域模型归属

| 模型 | 主要归属 | 说明 |
|---|---|---|
| `Project` | Edge | 本地项目和 workspace 入口。 |
| `Conversation` | Hub / Edge | 由 `ConversationAuthority` 决定写入权威。 |
| `Thread` | Hub / Edge | 挂在 Conversation 下的任务分支。 |
| `Turn` | Edge | 一轮用户或 Agent 操作。 |
| `AgentRun` | Edge | 调度和状态权威在 Edge，实际执行在 Runner。 |
| `Artifact` | Edge / Hub | 元数据可同步，字节内容按需读取或缓存。 |
| `ApprovalRequest` | Edge | Edge 做策略判断，Runner 等待结果。 |
| `EdgeEvent` | Edge | 本地 append-only 事件，未来同步到 Hub。 |
