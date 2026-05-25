# ADR-001: Hub-Edge 双层架构

**日期**: 2026-05-24
**状态**: 已采纳
**决策者**: Delicious233, Johnny, Trump

## 背景

AgentHub 需要同时管理远程 IM 通信（多端消息同步、群聊、中继）和本地 Agent CLI 执行（Claude Code、Codex、OpenCode）。这两种任务在延迟要求、部署拓扑和故障隔离上存在根本性冲突：远程通信需要中心化路由，本地执行必须零延迟直连进程。

## 决策

采用 **Hub-Edge 双层架构**，而非单体服务：

- **Edge Server**（本地）：负责 Agent CLI 进程编排、workspace 管理、事件投递和本地持久化。每个开发者本机运行自己的 Edge。
- **Hub Server**（云端）：负责账号、IM 消息路由、多端同步、Edge 注册与中继。不参与 Agent 进程执行。
- **Desktop UI** 同时连接本地 Edge（本地执行）和 Hub（远程 IM），形成双连接模式。

数据线分为三条：控制线（UI -> Edge -> Agent CLI）、事件线（Agent CLI -> Edge EventStore -> WebSocket -> UI）、同步线（Edge -> Hub -> 其他设备）。

## 后果

- 部署复杂性增加：每个开发者需要同时运行 Edge Server 和 Agent CLI，而 Hub 需要独立云部署。
- 关注点分离收益显著：Edge 崩溃不影响 IM 通信，Hub 宕机不影响本地 Agent 执行。
- Desktop 需维护两条 WebSocket 连接（Edge + Hub），断线重连策略需分别处理。
- Edge 是权威写入方（Conversation、Thread、Run 等），Hub 同步镜像；冲突以 Edge 为准。

## 备选方案

- **单体 Go 服务**：将 IM 和 Agent 执行合并为一个进程。被否决——本地 CLI 执行要求零网络延迟，远端的 IM 路由又必须在中心节点上完成，单体部署在何处都会产生远程调用开销。
- **纯 Hub 模式**：Agent 执行也走云端。被否决——桌面场景下本地文件访问和低延迟 CLI 交互是硬需求，纯云端无法满足。
